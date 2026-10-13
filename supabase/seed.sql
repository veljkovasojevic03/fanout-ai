-- Local development seed (`supabase db reset`). Non-sensitive data only.
--
-- Intentionally empty: plan_limits is seeded by the schema migration because the
-- app needs it in every environment, and users are created through the real
-- sign-up / guest flows so the auth triggers are exercised.
select 1;
