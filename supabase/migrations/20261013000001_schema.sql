-- Fanout AI — core schema (spec §6).
-- Tables only. Access control lives in 20261013000002_access.sql,
-- triggers and server-side functions in 20261013000003_functions.sql.

-- ---------------------------------------------------------------------------
-- plan_limits: the single source of truth for what each plan may do.
-- ---------------------------------------------------------------------------
create table public.plan_limits (
  plan text primary key check (plan in ('guest', 'free', 'pro')),
  generations integer not null check (generations >= 0),
  period text not null check (period in ('lifetime', 'month')),
  max_length text not null check (max_length in ('short', 'medium', 'long'))
);

insert into public.plan_limits (plan, generations, period, max_length) values
  ('guest', 3, 'lifetime', 'medium'),
  ('free', 5, 'month', 'medium'),
  ('pro', 100, 'month', 'long');

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger.
-- plan / stripe_* / subscription_* are server-only (see column grants).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  ui_language text not null default 'en' check (ui_language in ('en', 'sr')),
  default_content_language text not null default 'en'
    check (default_content_language in ('en', 'sr')),
  default_tone text not null default 'professional'
    check (default_tone in ('professional', 'casual', 'funny', 'inspirational')),
  plan text not null default 'free' references public.plan_limits (plan),
  stripe_customer_id text unique,
  stripe_subscription_id text,
  subscription_status text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- usage_counters: quota state. Written only by consume_generation() & co.
-- period is 'YYYY-MM' (UTC) for monthly plans or 'lifetime' for guests.
-- ---------------------------------------------------------------------------
create table public.usage_counters (
  user_id uuid not null references public.profiles (id) on delete cascade,
  period text not null check (period = 'lifetime' or period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  generations integer not null default 0 check (generations >= 0),
  words integer not null default 0 check (words >= 0),
  refinements integer not null default 0 check (refinements >= 0),
  primary key (user_id, period)
);

-- ---------------------------------------------------------------------------
-- generations: one row per "Generate" click. Server-written.
-- ---------------------------------------------------------------------------
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 300),
  tone text not null check (tone in ('professional', 'casual', 'funny', 'inspirational')),
  length text not null check (length in ('short', 'medium', 'long')),
  content_language text not null check (content_language in ('en', 'sr')),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 8),
  source_kind text not null default 'none' check (source_kind in ('none', 'url', 'text')),
  source_url text check (char_length(source_url) <= 2048),
  -- Extracted/pasted source text, kept so the per-type stream requests can reuse it.
  source_text text check (char_length(source_text) <= 8000),
  types text[] not null check (
    cardinality(types) between 1 and 5
    and types <@ array['blog', 'linkedin', 'instagram', 'email', 'x_thread']
  ),
  mode text not null check (mode in ('live', 'sample')),
  model text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  refinements_used integer not null default 0 check (refinements_used >= 0),
  created_at timestamptz not null default now(),
  check ((source_kind = 'url') = (source_url is not null))
);

create index generations_user_created_idx on public.generations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- contents: the user's library. Full CRUD on own rows.
-- ---------------------------------------------------------------------------
create table public.contents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  generation_id uuid references public.generations (id) on delete set null,
  type text not null check (type in ('blog', 'linkedin', 'instagram', 'email', 'x_thread')),
  title text not null check (char_length(title) between 1 and 200),
  body_md text not null check (char_length(body_md) <= 100000),
  language text not null check (language in ('en', 'sr')),
  tone text check (tone in ('professional', 'casual', 'funny', 'inspirational')),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  word_count integer not null default 0 check (word_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 'simple' config: no stemming, so English and Serbian search behave the same.
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body_md, ''))
  ) stored
);

create index contents_user_created_idx on public.contents (user_id, created_at desc);
create index contents_tags_idx on public.contents using gin (tags);
create index contents_search_idx on public.contents using gin (search);

-- ---------------------------------------------------------------------------
-- publish_destinations: where a user can publish to.
-- The shape of config is enforced here so a bad destination cannot even be
-- stored: email carries no address (it always goes to the account's own
-- verified email), discord must be a real Discord webhook URL.
-- ---------------------------------------------------------------------------
create table public.publish_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('email', 'discord')),
  label text not null check (char_length(label) between 1 and 60),
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint publish_destinations_config_shape check (
    (kind = 'email' and config = '{}'::jsonb)
    or (
      kind = 'discord'
      and jsonb_typeof(config -> 'webhook_url') = 'string'
      and config ->> 'webhook_url' ~ '^https://discord\.com/api/webhooks/[0-9]{5,30}/[A-Za-z0-9_-]{20,200}$'
      and config = jsonb_build_object('webhook_url', config -> 'webhook_url')
    )
  )
);

create index publish_destinations_user_idx on public.publish_destinations (user_id);
create unique index publish_destinations_one_email_idx
  on public.publish_destinations (user_id) where kind = 'email';

-- ---------------------------------------------------------------------------
-- publish_jobs / publish_attempts: scheduled publishing. Server-written.
-- ---------------------------------------------------------------------------
create table public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content_id uuid not null references public.contents (id) on delete cascade,
  destination_id uuid not null references public.publish_destinations (id) on delete cascade,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'published', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  simulated boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index publish_jobs_user_scheduled_idx on public.publish_jobs (user_id, scheduled_at);
-- The cron tick claims due jobs through this partial index.
create index publish_jobs_due_idx on public.publish_jobs (scheduled_at) where status = 'scheduled';

create table public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.publish_jobs (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail text
);

create index publish_attempts_job_idx on public.publish_attempts (job_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Server-only bookkeeping tables. No client access at all.
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

create table public.app_counters (
  day date primary key,
  real_generations integer not null default 0 check (real_generations >= 0)
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
