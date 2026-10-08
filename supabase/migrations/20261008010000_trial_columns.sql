-- The alwaystracked 14-day free trial (Danny, 8 Oct 2026), built dark behind
-- src/config/trial.ts TRIAL.enabled. Additive: three nullable columns, no
-- default, no existing row changed.
--   orders.trial_ends_at            when a trialing order's first charge is due
--   client_domains.trial_ends_at    the same date, for the dashboard's plan line
--   client_domains.trial_cancelled_at  an owner's "Cancel trial", for "Trial cancelled - tracking stops <date>"
alter table orders add column if not exists trial_ends_at timestamptz;
alter table client_domains add column if not exists trial_ends_at timestamptz;
alter table client_domains add column if not exists trial_cancelled_at timestamptz;
