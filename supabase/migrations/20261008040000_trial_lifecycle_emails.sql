-- The trial's lifecycle emails (8 Oct 2026, audit activation-1, activation-16, copy-4).
-- Additive only, and harmless landing before or after the deploy: the code reads
-- a missing flag row as off, and dedupes on a read of dashboard_events without
-- the index.
--
-- 1. One app_settings flag per new email, all off. Danny turns each on only
--    after approving its previews at /admin/emails. An existing row is kept.
insert into app_settings (key, value) values
  ('email_trial_started_enabled', 'false'::jsonb),
  ('email_trial_midpoint_enabled', 'false'::jsonb),
  ('email_trial_ending_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- 2. Each email the daily cron (or Stripe's trial_will_end) sends goes once per
--    client: lib/email/lifecycle-sweep.ts writes its dashboard_events row before
--    sending, and this makes a second claim - two runs racing - fail with 23505
--    instead of mailing twice. No existing row has these events, so every row
--    already satisfies it. A claim that reached nobody is renamed unsent_<event>,
--    which leaves the index, so the next morning can try again.
create unique index if not exists dashboard_events_lifecycle_mail_once
  on public.dashboard_events (client_domain_id, event)
  where event in ('trial_mail_midpoint', 'trial_mail_ending', 'setup_mail_24h', 'setup_mail_72h');
