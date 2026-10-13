-- Fanout AI — billing (spec §4.7, §5.10).
--
-- The Stripe webhook is the only thing that may change a plan. Both functions
-- here are SECURITY DEFINER, service_role only, and the plan is derived from
-- the subscription status INSIDE the database: no caller can ask for 'pro'.
--
--   link_stripe_customer   remember which Stripe customer belongs to a user
--   apply_stripe_event     idempotency (stripe_events) + the profile update,
--                          in one transaction

-- "Cancels on <date>" needs to be told apart from "Renews on <date>".
alter table public.profiles
  add column cancel_at_period_end boolean not null default false;

-- ---------------------------------------------------------------------------
-- link_stripe_customer: set-once. Returns the customer id the user is linked
-- to afterwards — the given one, or the one that was already there (two
-- checkout requests racing each other must end up with the same customer).
-- Guests cannot subscribe, so they are never linked: returns null.
-- ---------------------------------------------------------------------------
create function public.link_stripe_customer(p_user uuid, p_customer text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer text;
begin
  update public.profiles p
  set stripe_customer_id = p_customer
  where p.id = p_user and p.stripe_customer_id is null and p.plan <> 'guest';

  select p.stripe_customer_id into v_customer
  from public.profiles p
  where p.id = p_user and p.plan <> 'guest';

  return v_customer;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_stripe_event: one verified webhook event → one profile update.
--
--   1. Idempotency. The event id goes into stripe_events first; if it is
--      already there, nothing else happens ('duplicate'). Same transaction as
--      the update, so an event is never recorded without being applied —
--      if the update fails, Stripe's retry gets a clean second attempt.
--   2. Who. The profile linked to the Stripe customer. `p_user` (our own
--      client_reference_id / subscription metadata, set by the server at
--      checkout) is only used to link a customer that is not linked yet.
--   3. What. plan = 'pro' while the status is active or trialing; anything
--      else ends Pro. A guest never becomes anything through this function.
--   4. A subscription that is NOT active cannot overwrite the state of a
--      different, newer subscription ('ignored') — e.g. the late "deleted"
--      event of an old subscription after the user subscribed again.
--
-- returns: 'applied' | 'duplicate' | 'ignored' | 'no_user'
-- ---------------------------------------------------------------------------
create function public.apply_stripe_event(
  p_event_id text,
  p_event_type text,
  p_customer text,
  p_user uuid,
  p_subscription text,
  p_status text,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_subscription text;
  v_active boolean := coalesce(p_status in ('active', 'trialing'), false);
begin
  if p_event_id is null or p_customer is null or p_subscription is null or p_status is null then
    raise exception 'apply_stripe_event: missing arguments';
  end if;

  insert into public.stripe_events (id, type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  select p.id, p.stripe_subscription_id into v_user, v_subscription
  from public.profiles p
  where p.stripe_customer_id = p_customer
  for update;

  if not found and p_user is not null then
    update public.profiles p
    set stripe_customer_id = p_customer
    where p.id = p_user and p.stripe_customer_id is null and p.plan <> 'guest'
    returning p.id, p.stripe_subscription_id into v_user, v_subscription;
  end if;

  if v_user is null then
    return 'no_user';
  end if;

  if not v_active and v_subscription is not null and v_subscription <> p_subscription then
    return 'ignored';
  end if;

  update public.profiles p
  set plan = case
        when p.plan = 'guest' then 'guest'
        when v_active then 'pro'
        else 'free'
      end,
      stripe_subscription_id = p_subscription,
      subscription_status = p_status,
      current_period_end = p_period_end,
      cancel_at_period_end = v_active and coalesce(p_cancel_at_period_end, false)
  where p.id = v_user;

  return 'applied';
end;
$$;

revoke all on function public.link_stripe_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_stripe_event(
  text, text, text, uuid, text, text, timestamptz, boolean
) from public, anon, authenticated;

grant execute on function public.link_stripe_customer(uuid, text) to service_role;
grant execute on function public.apply_stripe_event(
  text, text, text, uuid, text, text, timestamptz, boolean
) to service_role;
