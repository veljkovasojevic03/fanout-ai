-- Fanout AI — triggers and server-side functions (spec §5.2, §5.6, §6).
--
-- Every function here is SECURITY DEFINER with an empty search_path, so each
-- object is schema-qualified and a caller cannot redirect it with a shadowing
-- table or function. EXECUTE is revoked from PUBLIC (Postgres grants it by
-- default) and granted to service_role only.

-- ---------------------------------------------------------------------------
-- contents.updated_at
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger contents_set_updated_at
  before update on public.contents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile bootstrap: every auth user gets a profile.
-- Anonymous users start as 'guest', everyone else as 'free'.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- raw_user_meta_data is user-controlled: only ever used for the display name.
  v_name := nullif(
    left(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      80
    ),
    ''
  );

  insert into public.profiles (id, plan, display_name)
  values (
    new.id,
    case when coalesce(new.is_anonymous, false) then 'guest' else 'free' end,
    v_name
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Guest → account upgrade: when an anonymous user links an identity,
-- is_anonymous flips to false and the plan moves from 'guest' to 'free'.
-- A plan that is already 'pro' (or anything else) is left untouched.
-- ---------------------------------------------------------------------------
create function public.handle_user_upgraded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set plan = 'free'
  where p.id = new.id and p.plan = 'guest';
  return new;
end;
$$;

create trigger on_auth_user_upgraded
  after update of is_anonymous on auth.users
  for each row
  when (old.is_anonymous is true and new.is_anonymous is false)
  execute function public.handle_user_upgraded();

-- ---------------------------------------------------------------------------
-- consume_generation: the atomic quota check (spec §5.2).
--
-- One conditional UPDATE both checks the limit and increments the counter, so
-- two concurrent requests can never both take the last slot: the second one
-- waits on the row lock, then re-evaluates `generations < limit` and fails.
-- There is no read-then-write anywhere, in SQL or in application code.
-- ---------------------------------------------------------------------------
create function public.consume_generation(p_user uuid)
returns table (allowed boolean, remaining integer, plan text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_limit integer;
  v_period_kind text;
  v_period text;
  v_used integer;
begin
  select p.plan, l.generations, l.period
    into v_plan, v_limit, v_period_kind
  from public.profiles p
  join public.plan_limits l on l.plan = p.plan
  where p.id = p_user;

  if not found then
    return query select false, 0, null::text;
    return;
  end if;

  v_period := case
    when v_period_kind = 'lifetime' then 'lifetime'
    else to_char(now() at time zone 'utc', 'YYYY-MM')
  end;

  insert into public.usage_counters as c (user_id, period)
  values (p_user, v_period)
  on conflict (user_id, period) do nothing;

  update public.usage_counters c
  set generations = c.generations + 1
  where c.user_id = p_user
    and c.period = v_period
    and c.generations < v_limit
  returning c.generations into v_used;

  if not found then
    return query select false, 0, v_plan;
    return;
  end if;

  return query select true, v_limit - v_used, v_plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- check_rate_limit: fixed-window counter in Postgres (spec §5.6).
-- Returns true while the caller is within `p_max` calls for the current window.
-- The upsert is a single statement, so concurrent calls count correctly.
-- ---------------------------------------------------------------------------
create function public.check_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_window_seconds <= 0 or p_max < 0 or p_key is null or p_key = '' then
    raise exception 'check_rate_limit: invalid arguments';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  return v_count <= p_max;
end;
$$;

-- Housekeeping for rate_limits; called from the cron tick.
create function public.prune_rate_limits(p_older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits r where r.window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock the functions down.
-- ---------------------------------------------------------------------------
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_upgraded() from public, anon, authenticated;
revoke all on function public.consume_generation(uuid) from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.prune_rate_limits(interval) from public, anon, authenticated;

grant execute on function public.consume_generation(uuid) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.prune_rate_limits(interval) to service_role;
