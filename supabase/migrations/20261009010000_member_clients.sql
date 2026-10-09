-- 9 Oct 2026. AG-1 / audit security-2 (launch blocker LB2): per-client member
-- scoping. Additive only (create table if not exists, create index if not
-- exists) under the 19 Sep 2026 authorisation. NOT APPLIED when written: it is
-- applied after integration and read back on real data.
--
-- A member with no live row here sees every client on their account, which is
-- how every member works today, so the table arriving changes nothing until an
-- owner invites someone to one client only. A member with live rows sees only
-- those clients (src/lib/tracking/scope.ts).
--
-- Rows are never deleted: taking a member off one client sets removed_at, as
-- dashboard_members does, and every read requires removed_at is null
-- (members-live.test.mts). Removing a member's last client removes the member,
-- because a live member with no live row here reads as every client.
--
-- client_domain_id takes no on-delete action on purpose: deleting a client a
-- member is limited to fails while the row exists, rather than dropping the row
-- and widening that member to every client on the account. Nothing in the code
-- deletes client_domains or accounts.
create table if not exists dashboard_member_clients (
  member_id        uuid not null references dashboard_members(id) on delete cascade,
  client_domain_id uuid not null references client_domains(id),
  added_by         text,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       text,
  primary key (member_id, client_domain_id)
);
create index if not exists dashboard_member_clients_live_client_idx
  on dashboard_member_clients (client_domain_id) where removed_at is null;
alter table dashboard_member_clients enable row level security;
