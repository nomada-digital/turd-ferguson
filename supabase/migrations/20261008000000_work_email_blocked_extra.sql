-- Work email only, on every public submission (Danny, 8 Oct 2026).
-- Domains refused on top of src/lib/work-email.ts's built-in list, so one can
-- be added without a deploy. Comma-separated text, empty by default. Read
-- fail-safe: if the read fails, the built-in list still applies.
-- Additive: a new key; an existing row is left as it is.
insert into app_settings (key, value) values
  ('work_email_blocked_extra', '""'::jsonb)
on conflict (key) do nothing;
