-- Payment state (BL-2, 9 Oct 2026): what the client's Stripe subscription
-- says about being paid, as the webhook records it (src/lib/checkout/payment.ts).
-- Additive only: five nullable columns, no default, no existing row changed,
-- and harmless landing before or after the deploy - the webhook skips its
-- payment step and the dashboard draws no payment banner while they are absent.
--   payment_status       Stripe's subscription status as last recorded: past_due
--                        draws the owner's banner; null on every row until an event sets it
--   payment_status_at    the Stripe event time that set it, so an older event
--                        delivered late never overwrites a newer one
--   payment_retry_at     when Stripe next tries the failed invoice; null when it will not
--   payment_invoice_url  Stripe's hosted page for the failed invoice, where an owner can pay it
--   payment_ended_at     when the webhook ended the client because Stripe stopped
--                        charging (unpaid, paused, incomplete_expired); only a client
--                        ended this way is made active again when a payment clears
alter table client_domains add column if not exists payment_status text;
alter table client_domains add column if not exists payment_status_at timestamptz;
alter table client_domains add column if not exists payment_retry_at timestamptz;
alter table client_domains add column if not exists payment_invoice_url text;
alter table client_domains add column if not exists payment_ended_at timestamptz;
