-- One run-health summary per tracking day (9 Oct 2026, audit reliability-6, spec OP-1).
-- Additive only, and harmless landing before or after the deploy: the code reads
-- dashboard_events for the day's claim before it writes one, and the index only
-- makes that exact.
--
-- lib/tracking/run-health.ts reportRunHealth writes a run_health_mail row with
-- props.day before it sends the day's summary to our own inbox. Every tracking
-- run asks as it closes, and two runs closing together can both read no claim;
-- this makes the second insert fail with 23505 instead of mailing twice. No
-- existing row has this event, so every row already satisfies it. A claim whose
-- mail reached nobody is renamed run_health_unsent, which leaves the index, so
-- the next reading of the day can try again.
create unique index if not exists dashboard_events_run_health_once
  on public.dashboard_events ((props->>'day'))
  where event = 'run_health_mail';
