-- Fanout AI — access control (spec §5.1, §6).
--
-- Two layers, both required:
--   1. GRANTs decide which role may run which statement on which columns.
--   2. RLS policies decide which rows that statement may touch.
--
-- Supabase grants ALL on new public tables to anon/authenticated by default.
-- We do not rely on that: everything is revoked first, then granted back
-- explicitly, so a forgotten policy fails closed instead of open.

-- New objects created by later migrations start with no client access.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.plan_limits enable row level security;
alter table public.profiles enable row level security;
alter table public.usage_counters enable row level security;
alter table public.generations enable row level security;
alter table public.contents enable row level security;
alter table public.publish_destinations enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.publish_attempts enable row level security;
alter table public.stripe_events enable row level security;
alter table public.app_counters enable row level security;
alter table public.rate_limits enable row level security;

-- (select auth.uid()) is wrapped in a sub-select so Postgres evaluates it once
-- per statement instead of once per row.

-- plan_limits: read-only for every signed-in user (guests included).
grant select on public.plan_limits to authenticated;
create policy plan_limits_select on public.plan_limits
  for select to authenticated using (true);

-- profiles: read own row; update own row, whitelisted columns only.
-- plan, stripe_* and subscription_* are deliberately NOT in the column list,
-- so `update profiles set plan = 'pro'` is rejected by Postgres itself.
grant select on public.profiles to authenticated;
grant update (display_name, ui_language, default_content_language, default_tone)
  on public.profiles to authenticated;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- usage_counters: read own; no client writes.
grant select on public.usage_counters to authenticated;
create policy usage_counters_select_own on public.usage_counters
  for select to authenticated using (user_id = (select auth.uid()));

-- generations: read own; no client writes.
grant select on public.generations to authenticated;
create policy generations_select_own on public.generations
  for select to authenticated using (user_id = (select auth.uid()));

-- contents: full CRUD on own rows. `search` is generated, so it is not writable.
grant select, delete on public.contents to authenticated;
grant insert (user_id, generation_id, type, title, body_md, language, tone, tags, word_count)
  on public.contents to authenticated;
grant update (title, body_md, language, tone, tags, word_count)
  on public.contents to authenticated;
create policy contents_select_own on public.contents
  for select to authenticated using (user_id = (select auth.uid()));
create policy contents_insert_own on public.contents
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    -- A piece may only be linked to one of the user's own generations.
    and (
      generation_id is null
      or exists (
        select 1 from public.generations g
        where g.id = generation_id and g.user_id = (select auth.uid())
      )
    )
  );
create policy contents_update_own on public.contents
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy contents_delete_own on public.contents
  for delete to authenticated using (user_id = (select auth.uid()));

-- publish_destinations: CRUD on own rows; guests cannot create destinations.
grant select, delete on public.publish_destinations to authenticated;
grant insert (user_id, kind, label, config) on public.publish_destinations to authenticated;
grant update (label, config) on public.publish_destinations to authenticated;
create policy publish_destinations_select_own on public.publish_destinations
  for select to authenticated using (user_id = (select auth.uid()));
create policy publish_destinations_insert_own on public.publish_destinations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.plan <> 'guest'
    )
  );
create policy publish_destinations_update_own on public.publish_destinations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy publish_destinations_delete_own on public.publish_destinations
  for delete to authenticated using (user_id = (select auth.uid()));

-- publish_jobs: read own; writes only through server routes (service role).
grant select on public.publish_jobs to authenticated;
create policy publish_jobs_select_own on public.publish_jobs
  for select to authenticated using (user_id = (select auth.uid()));

-- publish_attempts: read own, resolved through the parent job.
grant select on public.publish_attempts to authenticated;
create policy publish_attempts_select_own on public.publish_attempts
  for select to authenticated
  using (
    exists (
      select 1 from public.publish_jobs j
      where j.id = job_id and j.user_id = (select auth.uid())
    )
  );

-- stripe_events, app_counters, rate_limits: RLS on, no policies, no grants.
-- Only the service role (which bypasses RLS) can touch them.

grant all on all tables in schema public to service_role;
