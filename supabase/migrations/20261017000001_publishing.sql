-- Fanout AI — scheduling and publishing (spec §4.5, Phase 6).
--
-- The tables exist since the first migration; this adds the state machine.
-- Every status change of a publish job goes through one of these functions,
-- each a single transaction, SECURITY DEFINER, service_role only:
--
--   create_publish_job        scheduled                (ownership, guests, limits)
--   update_publish_job        scheduled → scheduled    (new time and/or destination)
--   cancel_publish_job        scheduled | failed → cancelled
--   retry_publish_job         failed    → scheduled    (due now, capped attempts)
--   claim_publish_job         scheduled → processing   (one job: "Publish now")
--   claim_due_publish_jobs    scheduled → processing   (cron tick, SKIP LOCKED)
--   finish_publish_attempt    processing → published | failed
--   fail_stuck_publish_jobs   processing → failed      (no answer for too long)
--
-- A claim opens a row in publish_attempts; finishing closes it. Because a job
-- is only finished while it is 'processing' and its attempt is still open, a
-- replayed or late callback changes nothing.

-- When the current attempt started: what "stuck" is measured from.
alter table public.publish_jobs
  add column processing_at timestamptz;

-- The cron tick looks for stuck jobs through this partial index.
create index publish_jobs_processing_idx
  on public.publish_jobs (processing_at) where status = 'processing';

-- last_error and publish_attempts.detail hold a short machine code
-- (e.g. 'delivery_failed:429'), never free text: the UI translates it.
alter table public.publish_jobs
  add constraint publish_jobs_last_error_shape
  check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}(:[0-9]{3})?$');
alter table public.publish_attempts
  add constraint publish_attempts_detail_shape
  check (detail is null or detail ~ '^[a-z0-9_]{1,40}(:[0-9]{3})?$');

-- ---------------------------------------------------------------------------
-- create_publish_job
--
-- status: 'ok' | 'guest_not_allowed' | 'content_not_found'
--       | 'destination_not_found' | 'invalid_time' | 'too_many_jobs'
--
-- `p_scheduled_at` null means "now". A time in the past is clamped to now, so
-- a slow request never produces a job that looks overdue; more than
-- `p_max_ahead` in the future is refused.
-- ---------------------------------------------------------------------------
create function public.create_publish_job(
  p_user uuid,
  p_content uuid,
  p_destination uuid,
  p_scheduled_at timestamptz,
  p_max_open integer default 50,
  p_max_ahead interval default interval '366 days'
)
returns table (status text, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_open integer;
  v_when timestamptz := greatest(coalesce(p_scheduled_at, now()), now());
  v_job uuid;
begin
  -- The profile row is locked so two requests cannot both pass the count below.
  select p.plan into v_plan from public.profiles p where p.id = p_user for update;

  if not found or v_plan = 'guest' then
    return query select 'guest_not_allowed'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1 from public.contents c where c.id = p_content and c.user_id = p_user
  ) then
    return query select 'content_not_found'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1 from public.publish_destinations d
    where d.id = p_destination and d.user_id = p_user
  ) then
    return query select 'destination_not_found'::text, null::uuid;
    return;
  end if;

  if v_when > now() + p_max_ahead then
    return query select 'invalid_time'::text, null::uuid;
    return;
  end if;

  select count(*) into v_open
  from public.publish_jobs j
  where j.user_id = p_user and j.status in ('scheduled', 'processing');

  if v_open >= p_max_open then
    return query select 'too_many_jobs'::text, null::uuid;
    return;
  end if;

  insert into public.publish_jobs (user_id, content_id, destination_id, scheduled_at)
  values (p_user, p_content, p_destination, v_when)
  returning id into v_job;

  return query select 'ok'::text, v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_publish_job: reschedule and/or change the destination. Only while the
-- job is still 'scheduled'. A null argument leaves that field as it is.
--
-- status: 'ok' | 'not_found' | 'not_scheduled' | 'destination_not_found' | 'invalid_time'
-- ---------------------------------------------------------------------------
create function public.update_publish_job(
  p_user uuid,
  p_job uuid,
  p_scheduled_at timestamptz,
  p_destination uuid,
  p_max_ahead interval default interval '366 days'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select j.status into v_status
  from public.publish_jobs j
  where j.id = p_job and j.user_id = p_user
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_status <> 'scheduled' then
    return 'not_scheduled';
  end if;

  if p_destination is not null and not exists (
    select 1 from public.publish_destinations d
    where d.id = p_destination and d.user_id = p_user
  ) then
    return 'destination_not_found';
  end if;

  if p_scheduled_at is not null and p_scheduled_at > now() + p_max_ahead then
    return 'invalid_time';
  end if;

  update public.publish_jobs j
  set scheduled_at = case
        -- greatest() skips nulls, so the "leave it alone" case is spelled out.
        when p_scheduled_at is null then j.scheduled_at
        else greatest(p_scheduled_at, now())
      end,
      destination_id = coalesce(p_destination, j.destination_id)
  where j.id = p_job;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_publish_job: scheduled → cancelled, and failed → cancelled (the user
-- has seen the failure and does not want to retry). A job that is being sent,
-- or has been sent, cannot be cancelled.
--
-- status: 'ok' | 'not_found' | 'not_scheduled'
-- ---------------------------------------------------------------------------
create function public.cancel_publish_job(p_user uuid, p_job uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select j.status into v_status
  from public.publish_jobs j
  where j.id = p_job and j.user_id = p_user
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_status not in ('scheduled', 'failed') then
    return 'not_scheduled';
  end if;

  update public.publish_jobs j set status = 'cancelled' where j.id = p_job;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- retry_publish_job: failed → scheduled, due immediately. The attempt cap
-- keeps Retry from becoming a way to send the same message without end.
--
-- status: 'ok' | 'not_found' | 'not_failed' | 'too_many_attempts'
-- ---------------------------------------------------------------------------
create function public.retry_publish_job(
  p_user uuid,
  p_job uuid,
  p_max_attempts integer default 5
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_attempts integer;
begin
  select j.status, j.attempts into v_status, v_attempts
  from public.publish_jobs j
  where j.id = p_job and j.user_id = p_user
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_status <> 'failed' then
    return 'not_failed';
  end if;
  if v_attempts >= p_max_attempts then
    return 'too_many_attempts';
  end if;

  update public.publish_jobs j
  set status = 'scheduled', scheduled_at = now()
  where j.id = p_job;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Claiming. Both functions return the same row shape: everything the
-- dispatcher needs except the recipient's email address, which the server
-- reads from Supabase Auth (it must be the account's own, verified address).
--
-- `destination_config` contains the Discord webhook URL. It is returned to the
-- service role only and must never be logged.
-- ---------------------------------------------------------------------------
create type public.claimed_publish_job as (
  job_id uuid,
  attempt_id uuid,
  user_id uuid,
  attempt integer,
  content_type text,
  content_title text,
  content_body text,
  content_language text,
  destination_kind text,
  destination_config jsonb
);

-- Internal: the second half of a claim, for jobs already moved to 'processing'.
create function public.open_publish_attempts(p_jobs uuid[])
returns setof public.claimed_publish_job
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with opened as (
    insert into public.publish_attempts (job_id)
    select unnest(p_jobs)
    returning id, job_id
  )
  select
    j.id, o.id, j.user_id, j.attempts,
    c.type, c.title, c.body_md, c.language,
    d.kind, d.config
  from opened o
  join public.publish_jobs j on j.id = o.job_id
  join public.contents c on c.id = j.content_id
  join public.publish_destinations d on d.id = j.destination_id;
end;
$$;

-- One job, for "Publish now" and Retry. Returns no row when the job is not the
-- caller's, not due, or not 'scheduled' any more (someone else claimed it).
create function public.claim_publish_job(p_user uuid, p_job uuid)
returns setof public.claimed_publish_job
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs uuid[];
begin
  with claimed as (
    update public.publish_jobs j
    set status = 'processing',
        processing_at = now(),
        attempts = j.attempts + 1,
        last_error = null
    where j.id = p_job
      and j.user_id = p_user
      and j.status = 'scheduled'
      and j.scheduled_at <= now()
    returning j.id
  )
  select coalesce(array_agg(id), '{}') into v_jobs from claimed;

  return query select * from public.open_publish_attempts(v_jobs);
end;
$$;

-- The cron tick. FOR UPDATE SKIP LOCKED: two ticks running at once each take
-- different jobs instead of waiting on (or double-sending) the same ones.
create function public.claim_due_publish_jobs(p_limit integer default 10)
returns setof public.claimed_publish_job
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs uuid[];
begin
  with due as (
    select j.id
    from public.publish_jobs j
    where j.status = 'scheduled' and j.scheduled_at <= now()
    order by j.scheduled_at
    limit greatest(least(p_limit, 50), 0)
    for update skip locked
  ),
  claimed as (
    update public.publish_jobs j
    set status = 'processing',
        processing_at = now(),
        attempts = j.attempts + 1,
        last_error = null
    from due
    where j.id = due.id
    returning j.id
  )
  select coalesce(array_agg(id), '{}') into v_jobs from claimed;

  return query select * from public.open_publish_attempts(v_jobs);
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_publish_attempt: the outcome of one attempt.
--
-- Applies only while the job is 'processing' AND this attempt is still open.
-- Anything else — a replayed callback, a callback that arrives after the job
-- was declared stuck, an attempt id from another job — returns 'stale' and
-- changes nothing.
--
-- returns: 'applied' | 'stale'
-- ---------------------------------------------------------------------------
create function public.finish_publish_attempt(
  p_job uuid,
  p_attempt uuid,
  p_ok boolean,
  p_detail text,
  p_simulated boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail text := case when p_ok then null else coalesce(p_detail, 'delivery_failed') end;
  v_status text;
begin
  if p_job is null or p_attempt is null or p_ok is null then
    raise exception 'finish_publish_attempt: missing arguments';
  end if;

  select j.status into v_status
  from public.publish_jobs j
  where j.id = p_job and j.status = 'processing'
  for update;

  if not found then
    return 'stale';
  end if;

  update public.publish_attempts a
  set finished_at = now(), ok = p_ok, detail = v_detail
  where a.id = p_attempt and a.job_id = p_job and a.finished_at is null;

  if not found then
    return 'stale';
  end if;

  update public.publish_jobs j
  set status = case when p_ok then 'published' else 'failed' end,
      published_at = case when p_ok then now() else null end,
      last_error = v_detail,
      simulated = coalesce(p_simulated, false),
      processing_at = null
  where j.id = p_job;

  return 'applied';
end;
$$;

-- ---------------------------------------------------------------------------
-- fail_stuck_publish_jobs: a job that has been 'processing' for longer than
-- `p_older_than` never got its answer (the dispatcher died, n8n never called
-- back). It is marked failed with a clear reason so the user can retry it.
-- ---------------------------------------------------------------------------
create function public.fail_stuck_publish_jobs(p_older_than interval default interval '10 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stuck as (
    update public.publish_jobs j
    set status = 'failed', last_error = 'timeout', processing_at = null
    where j.status = 'processing'
      and coalesce(j.processing_at, j.created_at) < now() - p_older_than
    returning j.id
  ),
  closed as (
    update public.publish_attempts a
    set finished_at = now(), ok = false, detail = 'timeout'
    from stuck
    where a.job_id = stuck.id and a.finished_at is null
  )
  select count(*) into v_count from stuck;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock everything down: service_role only.
-- ---------------------------------------------------------------------------
revoke all on function public.create_publish_job(uuid, uuid, uuid, timestamptz, integer, interval)
  from public, anon, authenticated;
revoke all on function public.update_publish_job(uuid, uuid, timestamptz, uuid, interval)
  from public, anon, authenticated;
revoke all on function public.cancel_publish_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.retry_publish_job(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.open_publish_attempts(uuid[]) from public, anon, authenticated;
revoke all on function public.claim_publish_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_due_publish_jobs(integer) from public, anon, authenticated;
revoke all on function public.finish_publish_attempt(uuid, uuid, boolean, text, boolean)
  from public, anon, authenticated;
revoke all on function public.fail_stuck_publish_jobs(interval) from public, anon, authenticated;

grant execute on function public.create_publish_job(uuid, uuid, uuid, timestamptz, integer, interval)
  to service_role;
grant execute on function public.update_publish_job(uuid, uuid, timestamptz, uuid, interval)
  to service_role;
grant execute on function public.cancel_publish_job(uuid, uuid) to service_role;
grant execute on function public.retry_publish_job(uuid, uuid, integer) to service_role;
grant execute on function public.claim_publish_job(uuid, uuid) to service_role;
grant execute on function public.claim_due_publish_jobs(integer) to service_role;
grant execute on function public.finish_publish_attempt(uuid, uuid, boolean, text, boolean)
  to service_role;
grant execute on function public.fail_stuck_publish_jobs(interval) to service_role;
