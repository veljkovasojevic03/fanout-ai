-- Fanout AI — generator support (spec §5.2, §5.3, §5.7).
--
-- Three server-only functions wrap everything that must be atomic:
--   start_generation          quota + plan gating + live/sample decision + insert
--   claim_generation_stream   "each (generation, type) streams once" + regenerate cap
--   finish_generation_stream  token/word accounting
-- All are SECURITY DEFINER with an empty search_path and executable by
-- service_role only, like the functions in 20261013000003_functions.sql.

-- ---------------------------------------------------------------------------
-- generation_streams: one row per (generation, type) that has been streamed.
-- The primary key is what makes "streamed once" a database guarantee.
-- ---------------------------------------------------------------------------
create table public.generation_streams (
  generation_id uuid not null references public.generations (id) on delete cascade,
  type text not null check (type in ('blog', 'linkedin', 'instagram', 'email', 'x_thread')),
  attempts integer not null default 1 check (attempts >= 1),
  last_started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (generation_id, type)
);

alter table public.generation_streams enable row level security;
revoke all on public.generation_streams from anon, authenticated;
grant select on public.generation_streams to authenticated;
grant all on public.generation_streams to service_role;

create policy generation_streams_select_own on public.generation_streams
  for select to authenticated
  using (
    exists (
      select 1 from public.generations g
      where g.id = generation_id and g.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- start_generation: everything POST /api/generate must do atomically.
--
-- Order matters:
--   1. plan gating (length) BEFORE the quota is touched — a rejected request
--      must not cost a generation;
--   2. consume_generation() — the atomic quota check;
--   3. the global daily cap for live (paid) generations — when it is reached
--      the generation silently becomes a sample one (spec §5.3);
--   4. the generations row.
-- It is one transaction: if the insert fails, the quota increment rolls back.
--
-- status: 'ok' | 'no_profile' | 'length_not_allowed' | 'quota_exhausted'
-- ---------------------------------------------------------------------------
create function public.start_generation(
  p_user uuid,
  p_topic text,
  p_tone text,
  p_length text,
  p_content_language text,
  p_keywords text[],
  p_source_kind text,
  p_source_url text,
  p_source_text text,
  p_types text[],
  p_want_live boolean,
  p_daily_cap integer,
  p_model_free text,
  p_model_pro text
)
returns table (
  status text,
  generation_id uuid,
  mode text,
  model text,
  plan text,
  remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_max_length text;
  v_allowed boolean;
  v_remaining integer;
  v_mode text := 'sample';
  v_model text;
  v_id uuid;
  v_rank constant text[] := array['short', 'medium', 'long'];
begin
  select p.plan, l.max_length
    into v_plan, v_max_length
  from public.profiles p
  join public.plan_limits l on l.plan = p.plan
  where p.id = p_user;

  if not found then
    return query select 'no_profile'::text, null::uuid, null::text, null::text, null::text, 0;
    return;
  end if;

  if coalesce(array_position(v_rank, p_length), 99) > array_position(v_rank, v_max_length) then
    return query select 'length_not_allowed'::text, null::uuid, null::text, null::text, v_plan, 0;
    return;
  end if;

  select c.allowed, c.remaining
    into v_allowed, v_remaining
  from public.consume_generation(p_user) c;

  if not v_allowed then
    return query select 'quota_exhausted'::text, null::uuid, null::text, null::text, v_plan, 0;
    return;
  end if;

  if p_want_live and p_daily_cap > 0 then
    -- Conditional upsert: takes one of today's live slots only if one is left.
    insert into public.app_counters as a (day, real_generations)
    values ((now() at time zone 'utc')::date, 1)
    on conflict (day) do update
      set real_generations = a.real_generations + 1
      where a.real_generations < p_daily_cap;

    if found then
      v_mode := 'live';
      v_model := case when v_plan = 'pro' then p_model_pro else p_model_free end;
    end if;
  end if;

  insert into public.generations (
    user_id, topic, tone, length, content_language, keywords,
    source_kind, source_url, source_text, types, mode, model
  )
  values (
    p_user, p_topic, p_tone, p_length, p_content_language, coalesce(p_keywords, '{}'),
    p_source_kind, p_source_url, p_source_text, p_types, v_mode, v_model
  )
  returning id into v_id;

  return query select 'ok'::text, v_id, v_mode, v_model, v_plan, v_remaining;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_generation_stream: may this (generation, type) start streaming now?
--
-- First stream:  inserts the generation_streams row; a second attempt hits the
--                primary key and is refused ('already_streamed').
-- Regenerate:    only after a first stream, and only while the generation has
--                regenerations left (shared with refine, spec §4.2: 10 per
--                generation). The cap is checked and incremented under the row
--                lock taken on the generation, so concurrent requests cannot
--                both take the last one.
--
-- status: 'ok' | 'not_found' | 'type_not_selected' | 'already_streamed'
--         | 'not_started' | 'cap_reached'
-- `generation` is the full row as jsonb, so the route needs no second query.
-- ---------------------------------------------------------------------------
create function public.claim_generation_stream(
  p_generation uuid,
  p_user uuid,
  p_type text,
  p_regenerate boolean,
  p_max_regenerations integer
)
returns table (
  status text,
  generation jsonb,
  attempt integer,
  regenerations_left integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gen public.generations%rowtype;
  v_attempt integer := 1;
  v_inserted integer;
begin
  -- Ownership is part of the lookup: another user's id behaves exactly like a missing one.
  select g.* into v_gen
  from public.generations g
  where g.id = p_generation and g.user_id = p_user
  for update;

  if not found then
    return query select 'not_found'::text, null::jsonb, 0, 0;
    return;
  end if;

  if not (p_type = any (v_gen.types)) then
    return query select 'type_not_selected'::text, null::jsonb, 0, 0;
    return;
  end if;

  if not p_regenerate then
    insert into public.generation_streams (generation_id, type)
    values (p_generation, p_type)
    on conflict (generation_id, type) do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted = 0 then
      return query select 'already_streamed'::text, null::jsonb, 0, 0;
      return;
    end if;
  else
    if not exists (
      select 1 from public.generation_streams s
      where s.generation_id = p_generation and s.type = p_type
    ) then
      return query select 'not_started'::text, null::jsonb, 0, 0;
      return;
    end if;

    if v_gen.refinements_used >= p_max_regenerations then
      return query select 'cap_reached'::text, null::jsonb, 0, 0;
      return;
    end if;

    update public.generations g
    set refinements_used = g.refinements_used + 1
    where g.id = p_generation
    returning g.refinements_used into v_gen.refinements_used;

    update public.generation_streams s
    set attempts = s.attempts + 1, last_started_at = now(), completed_at = null
    where s.generation_id = p_generation and s.type = p_type
    returning s.attempts into v_attempt;
  end if;

  return query select
    'ok'::text,
    to_jsonb(v_gen),
    v_attempt,
    greatest(p_max_regenerations - v_gen.refinements_used, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_generation_stream: bookkeeping when a stream ends (or is stopped).
-- Adds token usage to the generation, words to the owner's usage counter for
-- their current period, and marks the generation completed once every
-- selected type has finished.
-- ---------------------------------------------------------------------------
create function public.finish_generation_stream(
  p_generation uuid,
  p_type text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_words integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_types text[];
  v_period text;
  v_done integer;
begin
  update public.generation_streams s
  set completed_at = now()
  where s.generation_id = p_generation and s.type = p_type;

  if not found then
    return;
  end if;

  update public.generations g
  set input_tokens = g.input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = g.output_tokens + greatest(coalesce(p_output_tokens, 0), 0)
  where g.id = p_generation
  returning g.user_id, g.types into v_user, v_types;

  select count(*) into v_done
  from public.generation_streams s
  where s.generation_id = p_generation and s.completed_at is not null;

  if v_done >= cardinality(v_types) then
    update public.generations g set status = 'completed' where g.id = p_generation;
  end if;

  if greatest(coalesce(p_words, 0), 0) > 0 then
    select case
        when l.period = 'lifetime' then 'lifetime'
        else to_char(now() at time zone 'utc', 'YYYY-MM')
      end
      into v_period
    from public.profiles p
    join public.plan_limits l on l.plan = p.plan
    where p.id = v_user;

    insert into public.usage_counters as c (user_id, period, words)
    values (v_user, v_period, p_words)
    on conflict (user_id, period) do update set words = c.words + excluded.words;
  end if;
end;
$$;

revoke all on function public.start_generation(
  uuid, text, text, text, text, text[], text, text, text, text[], boolean, integer, text, text
) from public, anon, authenticated;
revoke all on function public.claim_generation_stream(uuid, uuid, text, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.finish_generation_stream(uuid, text, integer, integer, integer)
  from public, anon, authenticated;

grant execute on function public.start_generation(
  uuid, text, text, text, text, text[], text, text, text, text[], boolean, integer, text, text
) to service_role;
grant execute on function public.claim_generation_stream(uuid, uuid, text, boolean, integer)
  to service_role;
grant execute on function public.finish_generation_stream(uuid, text, integer, integer, integer)
  to service_role;
