-- =====================================================================================================
-- Ravi Cash — production database (Supabase / PostgreSQL 15+)            1 of 4: tables and guards
--
-- Design rules
--   * Money is stored as integer PAISE (bigint). Business dates are plain DATEs in India time.
--   * Clients never write tables directly. Every change goes through a SECURITY DEFINER function (file 3)
--     that checks the caller's role, branch and the voucher rules, and writes the audit trail.
--   * Vouchers can never be deleted, and cannot be changed except by the admin functions (trigger below).
--   * The audit log is append-only and hash-chained: each row's hash covers the previous row's hash, so a
--     removed or edited row is detected by rw_verify_audit().
-- =====================================================================================================

create extension if not exists pgcrypto with schema extensions;   -- digest()

create or replace function public.rw_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ------------------------------------------------------------------------------------------ types
create type public.rw_role           as enum ('SUPER_ADMIN', 'BRANCH_ADMIN', 'USER', 'VIEWER');
create type public.rw_user_status    as enum ('ACTIVE', 'INACTIVE', 'SUSPENDED');
create type public.rw_voucher_type   as enum ('PAYMENT', 'RECEIPT');
create type public.rw_voucher_status as enum ('ACTIVE', 'VOID', 'DELETED');

-- --------------------------------------------------------------------------------------- settings
create table public.settings (
  id                        smallint primary key default 1 check (id = 1),     -- exactly one row
  company                   jsonb   not null default jsonb_build_object(
                              'name', 'RAVI WATER FLOW PUMPS', 'tagline', 'Water Flow Pumps & Irrigation Solutions',
                              'address', 'Main Road, Rajkot, Gujarat 360001', 'phone', '+91 281 000 0000',
                              'email', 'accounts@raviwaterflow.example', 'gstin', ''),
  prefix_payment            text    not null default 'CPV' check (prefix_payment ~ '^[A-Z]{2,6}$'),
  prefix_receipt            text    not null default 'CRV' check (prefix_receipt ~ '^[A-Z]{2,6}$'),
  number_pad                smallint not null default 6 check (number_pad between 4 and 10),
  fiscal_year_start_month   smallint not null default 4 check (fiscal_year_start_month between 1 and 12),
  max_voucher_amount_paise  bigint  not null default 1000000000 check (max_voucher_amount_paise > 0),   -- ₹1,00,00,000
  large_payment_alert_paise bigint  not null default 5000000,                                            -- ₹50,000
  block_negative_cash       boolean not null default false,
  user_backdate_days        smallint not null default 7 check (user_backdate_days between 0 and 365),
  max_attachments           smallint not null default 6 check (max_attachments between 1 and 20),
  updated_at                timestamptz not null default now(),
  updated_by                uuid
);
insert into public.settings default values;

-- ---------------------------------------------------------------------------------------- branches
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  reg_prefix  text not null unique check (reg_prefix ~ '^[A-Z]{2,5}$'),      -- first part of register ids, e.g. IND
  name        text not null check (char_length(name) between 3 and 100),
  address     text not null default '-',
  contact     text not null default '-',
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------------------- profiles
-- One row per sign-in account (auth.users). Login works with the synthetic address
-- <username>@<branchcode>.ravicash.invalid  (see rw_login_email); the real e-mail is kept here.
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete restrict,
  branch_id            uuid not null references public.branches (id),
  username             text not null check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name            text not null check (char_length(full_name) between 3 and 80),
  email                text,
  mobile               text check (mobile is null or mobile = '' or mobile ~ '^[6-9][0-9]{9}$'),
  designation          text not null default '',
  role                 public.rw_role        not null default 'USER',
  status               public.rw_user_status not null default 'ACTIVE',
  joining_date         date not null default public.rw_today(),
  must_change_password boolean not null default true,
  last_login_at        timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  created_by           uuid
);
create unique index profiles_username_uq on public.profiles (lower(username)) where deleted_at is null;
create unique index profiles_email_uq    on public.profiles (lower(email))    where deleted_at is null and email is not null and email <> '';
create index profiles_branch_idx         on public.profiles (branch_id);

-- ---------------------------------------------------------------------------------- cash registers
create table public.cash_registers (
  id              text primary key,                                        -- e.g. IND-RP-001
  user_id         uuid not null unique references public.profiles (id),
  branch_id       uuid not null references public.branches (id),
  opening_paise   bigint not null default 0 check (opening_paise >= 0),
  created_at      timestamptz not null default now()
);
create index cash_registers_branch_idx on public.cash_registers (branch_id);

-- -------------------------------------------------------------------------------- voucher numbering
-- One counter row per voucher type. Incrementing it takes a row lock, so two vouchers can never get the
-- same number, and because it happens in the same transaction as the insert, a failed save leaves no gap.
create table public.voucher_counters (
  type      public.rw_voucher_type primary key,
  last_seq  bigint not null default 0
);
insert into public.voucher_counters (type) values ('PAYMENT'), ('RECEIPT');

-- ------------------------------------------------------------------------------------------ vouchers
create table public.vouchers (
  id               uuid primary key default gen_random_uuid(),
  type             public.rw_voucher_type not null,
  seq              bigint not null,
  number           text   not null unique,
  branch_id        uuid   not null references public.branches (id),
  user_id          uuid   not null references public.profiles (id),
  voucher_date     date   not null check (voucher_date >= date '2000-01-01'),
  party_name       text   not null check (char_length(party_name) between 2 and 120),
  particulars      text   not null check (char_length(particulars) between 3 and 1000),
  notes            text   not null default '' check (char_length(notes) <= 1000),
  amount_paise     bigint not null check (amount_paise > 0),
  amount_in_words  text   not null,
  status           public.rw_voucher_status not null default 'ACTIVE',
  locked           boolean not null default true check (locked),             -- always true: vouchers are locked on save
  client_id        text check (char_length(client_id) <= 64),                -- makes offline retries idempotent
  void_reason      text not null default '',
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  created_by       uuid not null references public.profiles (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id),
  voided_at        timestamptz, voided_by uuid,
  deleted_at       timestamptz, deleted_by uuid,
  unique (type, seq),
  unique (user_id, client_id)
);
create index vouchers_branch_date_idx on public.vouchers (branch_id, voucher_date desc, seq desc);
create index vouchers_user_date_idx   on public.vouchers (user_id, voucher_date desc, seq desc);
create index vouchers_status_idx      on public.vouchers (status);
create index vouchers_party_idx       on public.vouchers (lower(party_name));

create table public.voucher_attachments (
  id              uuid primary key default gen_random_uuid(),
  voucher_id      uuid not null references public.vouchers (id),
  branch_id       uuid not null references public.branches (id),
  user_id         uuid not null references public.profiles (id),            -- owner of the voucher
  storage_path    text not null unique,                                     -- <branch_id>/<voucher_id>/<file> in the "receipts" bucket
  file_name       text not null,
  mime            text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  added_at        timestamptz not null default now(),
  added_by        uuid not null references public.profiles (id),
  removed_at      timestamptz, removed_by uuid, removed_reason text          -- hidden, never physically deleted
);
create index voucher_attachments_voucher_idx on public.voucher_attachments (voucher_id);

-- ------------------------------------------------------------------------------------ cash ledger view
-- One line per ACTIVE voucher with the register's running balance (opening + in - out).
create view public.cash_transactions with (security_invoker = true) as
select v.id as voucher_id, v.number, v.seq, v.voucher_date as txn_date, v.created_at, r.id as register_id, v.user_id, v.branch_id, v.type,
       case when v.type = 'RECEIPT' then v.amount_paise else 0 end as in_paise,
       case when v.type = 'PAYMENT' then v.amount_paise else 0 end as out_paise,
       (r.opening_paise + sum(case when v.type = 'RECEIPT' then v.amount_paise else -v.amount_paise end)
         over (partition by v.user_id order by v.voucher_date, v.seq rows between unbounded preceding and current row))::bigint as balance_paise
from public.vouchers v
join public.cash_registers r on r.user_id = v.user_id
where v.status = 'ACTIVE';

-- ----------------------------------------------------------------------------------------- statements
create table public.statements (
  id             uuid primary key default gen_random_uuid(),
  no             text not null unique,                                      -- STM-2026-00001
  user_id        uuid not null references public.profiles (id),
  branch_id      uuid not null references public.branches (id),
  register_id    text not null references public.cash_registers (id),
  period         text not null,
  period_label   text not null,
  from_date      date not null, to_date date not null,
  opening_paise  bigint not null, in_paise bigint not null, out_paise bigint not null, closing_paise bigint not null,
  voucher_count  integer not null,
  generated_by   uuid not null references public.profiles (id),
  generated_at   timestamptz not null default now()
);
create sequence public.statement_no_seq;

-- ----------------------------------------------------------------------------------------- outstanding
create table public.outstanding (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches (id),
  party_name     text not null check (char_length(party_name) between 2 and 120),
  direction      text not null check (direction in ('RECEIVABLE', 'PAYABLE')),
  amount_paise   bigint not null check (amount_paise > 0),
  settled_paise  bigint not null default 0 check (settled_paise >= 0 and settled_paise <= amount_paise),
  due_date       date not null,
  reference      text not null default '',
  notes          text not null default '',
  status         text not null default 'OPEN' check (status in ('OPEN', 'SETTLED', 'CANCELLED')),
  created_by     uuid not null references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index outstanding_branch_idx on public.outstanding (branch_id, status, due_date);

create table public.outstanding_settlements (
  id              uuid primary key default gen_random_uuid(),
  outstanding_id  uuid not null references public.outstanding (id),
  amount_paise    bigint not null check (amount_paise > 0),
  voucher_number  text not null default '',
  note            text not null default '',
  settled_at      timestamptz not null default now(),
  settled_by      uuid not null references public.profiles (id)
);

-- --------------------------------------------------------------------------------------- notifications
create table public.notifications (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  kind            text not null,
  title           text not null,
  body            text not null default '',
  branch_id       uuid references public.branches (id),
  for_admins      boolean not null default true,
  target_user_id  uuid references public.profiles (id),
  voucher_id      uuid references public.vouchers (id),
  important       boolean not null default false,
  actor_id        uuid
);
create index notifications_at_idx on public.notifications (at desc);
create table public.notification_reads (
  notification_id bigint not null references public.notifications (id) on delete cascade,
  user_id         uuid   not null references public.profiles (id),
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ---------------------------------------------------------------------------------------- audit log
create sequence public.audit_logs_id_seq;
create table public.audit_logs (
  id            bigint primary key,                    -- assigned inside the chain trigger (after the lock), never by the caller
  at            timestamptz not null,
  actor_id      uuid,
  actor_name    text not null,
  actor_role    text not null default '',
  branch_id     uuid,
  entity        text not null,
  entity_id     text,
  entity_label  text not null default '',
  action        text not null,
  old_values    jsonb,
  new_values    jsonb,
  reason        text not null default '',
  device        text not null default '',
  ip            text not null default '',
  prev_hash     text not null,
  hash          text not null
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index audit_logs_branch_idx on public.audit_logs (branch_id, id desc);

-- The text that is hashed for one audit row. Kept in one function so writing and verifying cannot drift apart.
create or replace function public.rw_audit_canonical(a public.audit_logs) returns text
language sql immutable as $$
  select jsonb_build_object('id', a.id, 'at', to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'actor_id', a.actor_id,
         'actor_name', a.actor_name, 'actor_role', a.actor_role, 'branch_id', a.branch_id, 'entity', a.entity, 'entity_id', a.entity_id,
         'entity_label', a.entity_label, 'action', a.action, 'old', a.old_values, 'new', a.new_values, 'reason', a.reason,
         'device', a.device, 'ip', a.ip)::text
$$;

create or replace function public.rw_audit_chain() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare last_hash text;
begin
  perform pg_advisory_xact_lock(727001);                         -- one writer at a time keeps the chain linear
  new.id := nextval('public.audit_logs_id_seq');                 -- id taken AFTER the lock, so id order == chain order
  new.at := coalesce(new.at, clock_timestamp());
  select hash into last_hash from public.audit_logs order by id desc limit 1;
  new.prev_hash := coalesce(last_hash, 'GENESIS');
  new.hash := encode(extensions.digest(new.prev_hash || public.rw_audit_canonical(new), 'sha256'), 'hex');
  return new;
end $$;
create trigger audit_logs_chain before insert on public.audit_logs for each row execute function public.rw_audit_chain();

create or replace function public.rw_forbid_change() returns trigger
language plpgsql as $$
begin raise exception 'LOCKED|% is append-only', tg_table_name using errcode = 'RW423'; end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs for each row execute function public.rw_forbid_change();
create trigger audit_logs_no_truncate before truncate on public.audit_logs for each statement execute function public.rw_forbid_change();

-- ------------------------------------------------------------------------------------ voucher guards
-- Direct writes are refused unless they come from the admin/creation functions, which switch the flag on
-- for their own transaction only. A voucher row can never be physically deleted.
create or replace function public.rw_voucher_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'LOCKED|Vouchers cannot be deleted. Void or soft-delete them through the admin function.' using errcode = 'RW423';
  end if;
  if coalesce(current_setting('rw.voucher_op', true), '') <> 'on' then
    raise exception 'LOCKED|Vouchers are locked. Use the voucher functions.' using errcode = 'RW423';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.type, new.seq, new.number, new.branch_id, new.user_id, new.created_at, new.created_by)
                   is distinct from (old.id, old.type, old.seq, old.number, old.branch_id, old.user_id, old.created_at, old.created_by) then
    raise exception 'LOCKED|Voucher number, type, owner, branch and creation details can never change' using errcode = 'RW423';
  end if;
  return new;
end $$;
create trigger vouchers_guard before insert or update or delete on public.vouchers for each row execute function public.rw_voucher_guard();
create trigger vouchers_no_truncate before truncate on public.vouchers for each statement execute function public.rw_forbid_change();

-- Attachment rows are append-only apart from the "removed" flags set by the admin function.
create or replace function public.rw_attachment_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'LOCKED|Attachments are never deleted' using errcode = 'RW423'; end if;
  if coalesce(current_setting('rw.voucher_op', true), '') <> 'on' then raise exception 'LOCKED|Use the attachment functions' using errcode = 'RW423'; end if;
  return new;
end $$;
create trigger voucher_attachments_guard before insert or update or delete on public.voucher_attachments for each row execute function public.rw_attachment_guard();
