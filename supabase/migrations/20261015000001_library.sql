-- Fanout AI — library, tags and refine (spec §4.3, §4.4).
--
--   contents.tags            shape enforced by a CHECK, so a client that skips the
--                            app's normalisation still cannot store junk
--   content_tags()           the caller's own tags, for autocomplete (RLS applies)
--   claim_refinement()       may this refine start, and in which mode? Atomic,
--                            service_role only, like the generator's functions.

-- The library's default order is "recently updated".
create index contents_user_updated_idx on public.contents (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Tags: 1–32 characters each, no surrounding spaces, no nulls. (At most 20 per
-- piece is already a column constraint.) Lower-casing and de-duplication are
-- done by the app; they are presentation, not integrity.
-- ---------------------------------------------------------------------------
create function public.tags_are_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    bool_and(t is not null and char_length(t) between 1 and 32 and t = btrim(t)),
    true
  )
  from unnest(p_tags) as t
$$;

alter table public.contents
  add constraint contents_tags_valid check (public.tags_are_valid(tags));

-- ---------------------------------------------------------------------------
-- content_tags: every tag the caller uses, most used first. SECURITY INVOKER,
-- so RLS on `contents` scopes it to the caller's own rows; the explicit
-- user_id filter is there for the planner (and as a second fence).
-- ---------------------------------------------------------------------------
create function public.content_tags()
returns table (tag text, uses bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.tag, count(*) as uses
  from public.contents c
  cross join lateral unnest(c.tags) as t (tag)
  where c.user_id = (select auth.uid())
  group by t.tag
  order by uses desc, t.tag
  limit 200
$$;

-- ---------------------------------------------------------------------------
-- Live refinements are paid model calls too, and a piece that is not linked to
-- a generation has no per-generation cap. They get their own global daily
-- counter, next to the one for live generations (spec §5.3).
-- ---------------------------------------------------------------------------
alter table public.app_counters
  add column real_refinements integer not null default 0 check (real_refinements >= 0);

-- ---------------------------------------------------------------------------
-- claim_refinement: everything POST /api/refine must decide atomically.
--
--   1. ownership — another user's content id behaves exactly like a missing one;
--   2. the per-generation cap, shared with regenerate (spec §4.2: 10 per
--      generation), checked and incremented under a row lock on the generation.
--      A piece with no generation has no such cap; the route rate-limits it;
--   3. live or sample: a live refine takes one slot of today's global budget.
--      When none is left it becomes a sample (canned) transformation;
--   4. `p_sample_ok = false` means the route has no canned transformation for
--      this request. It is then refused BEFORE anything is counted.
--
-- status: 'ok' | 'not_found' | 'cap_reached' | 'sample_unsupported'
-- ---------------------------------------------------------------------------
create function public.claim_refinement(
  p_user uuid,
  p_content uuid,
  p_max_refinements integer,
  p_want_live boolean,
  p_daily_cap integer,
  p_sample_ok boolean,
  p_model_free text,
  p_model_pro text
)
returns table (
  status text,
  content jsonb,
  mode text,
  model text,
  refinements_left integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content public.contents%rowtype;
  v_plan text;
  v_period_kind text;
  v_period text;
  v_used integer;
  v_left integer;
  v_mode text := 'sample';
  v_model text;
begin
  select c.* into v_content
  from public.contents c
  where c.id = p_content and c.user_id = p_user;

  if not found then
    return query select 'not_found'::text, null::jsonb, null::text, null::text, null::integer;
    return;
  end if;

  select p.plan, l.period into v_plan, v_period_kind
  from public.profiles p
  join public.plan_limits l on l.plan = p.plan
  where p.id = p_user;

  if v_content.generation_id is not null then
    select g.refinements_used into v_used
    from public.generations g
    where g.id = v_content.generation_id and g.user_id = p_user
    for update;

    if found and v_used >= p_max_refinements then
      return query select 'cap_reached'::text, null::jsonb, null::text, null::text, 0;
      return;
    end if;
  end if;

  if p_want_live and p_daily_cap > 0 then
    -- Conditional upsert: takes one of today's live slots only if one is left.
    insert into public.app_counters as a (day, real_refinements)
    values ((now() at time zone 'utc')::date, 1)
    on conflict (day) do update
      set real_refinements = a.real_refinements + 1
      where a.real_refinements < p_daily_cap;

    if found then
      v_mode := 'live';
      v_model := case when v_plan = 'pro' then p_model_pro else p_model_free end;
    end if;
  end if;

  if v_mode = 'sample' and not p_sample_ok then
    return query
      select 'sample_unsupported'::text, null::jsonb, null::text, null::text, null::integer;
    return;
  end if;

  if v_used is not null then
    update public.generations g
    set refinements_used = g.refinements_used + 1
    where g.id = v_content.generation_id
    returning g.refinements_used into v_used;
    v_left := greatest(p_max_refinements - v_used, 0);
  end if;

  v_period := case
    when v_period_kind = 'lifetime' then 'lifetime'
    else to_char(now() at time zone 'utc', 'YYYY-MM')
  end;

  insert into public.usage_counters as c (user_id, period, refinements)
  values (p_user, v_period, 1)
  on conflict (user_id, period) do update set refinements = c.refinements + 1;

  return query select
    'ok'::text,
    jsonb_build_object(
      'id', v_content.id,
      'type', v_content.type,
      'language', v_content.language,
      'tone', v_content.tone,
      'generation_id', v_content.generation_id
    ),
    v_mode,
    v_model,
    v_left;
end;
$$;

revoke all on function public.tags_are_valid(text[]) from public, anon, authenticated;
revoke all on function public.content_tags() from public, anon, authenticated;
revoke all on function public.claim_refinement(
  uuid, uuid, integer, boolean, integer, boolean, text, text
) from public, anon, authenticated;

-- A CHECK constraint runs its function as the role doing the write.
grant execute on function public.tags_are_valid(text[]) to authenticated, service_role;
grant execute on function public.content_tags() to authenticated, service_role;
grant execute on function public.claim_refinement(
  uuid, uuid, integer, boolean, integer, boolean, text, text
) to service_role;
