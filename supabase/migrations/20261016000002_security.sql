-- =====================================================================================================
-- Ravi Cash — production database                                        2 of 4: Row Level Security
--
--   * Signed-in users may only READ rows inside their scope:
--       SUPER_ADMIN  -> every branch
--       BRANCH_ADMIN -> own branch (read everything, correct vouchers through the admin functions)
--       VIEWER       -> own branch, read-only
--       USER         -> only their own vouchers, register and statements
--   * Nobody can INSERT / UPDATE / DELETE a table through the API: there are no write policies. All writes go
--     through the SECURITY DEFINER functions in file 3.
--   * A disabled account, or a user of a disabled branch, immediately sees nothing (rw_role() returns NULL).
-- =====================================================================================================

-- ------------------------------------------------------------------------------- who is calling?
create or replace function public.rw_role() returns public.rw_role
language sql stable security definer set search_path = public as $$
  select p.role
  from public.profiles p join public.branches b on b.id = p.branch_id
  where p.id = auth.uid() and p.deleted_at is null and p.status = 'ACTIVE'
    and (p.role = 'SUPER_ADMIN' or b.status = 'ACTIVE')
$$;

create or replace function public.rw_branch_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.branch_id
  from public.profiles p join public.branches b on b.id = p.branch_id
  where p.id = auth.uid() and p.deleted_at is null and p.status = 'ACTIVE'
    and (p.role = 'SUPER_ADMIN' or b.status = 'ACTIVE')
$$;

create or replace function public.rw_can_see_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.rw_role()
           when 'SUPER_ADMIN' then true
           when 'BRANCH_ADMIN' then b = public.rw_branch_id()
           when 'VIEWER'       then b = public.rw_branch_id()
           when 'USER'         then b = public.rw_branch_id()
           else false end
$$;

create or replace function public.rw_can_see_user(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.rw_role()
           when 'SUPER_ADMIN'  then exists (select 1 from public.profiles x where x.id = u and x.deleted_at is null)
           when 'BRANCH_ADMIN' then exists (select 1 from public.profiles x where x.id = u and x.deleted_at is null and x.branch_id = public.rw_branch_id())
           when 'VIEWER'       then exists (select 1 from public.profiles x where x.id = u and x.deleted_at is null and x.branch_id = public.rw_branch_id())
           when 'USER'         then u = auth.uid()
           else false end
$$;

-- ------------------------------------------------------------------------ start from "no access"
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Functions are locked in file 3 (after they exist). Future objects: do not hand anything out automatically.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;     -- PostgreSQL grants EXECUTE to PUBLIC by default

grant usage on schema public to anon, authenticated;
-- (the helper functions used by the policies are granted in file 3, after the blanket REVOKE there)

-- read-only table access (rows are further filtered by the policies below)
grant select on public.branches, public.profiles, public.cash_registers, public.vouchers, public.voucher_attachments,
                public.cash_transactions, public.statements, public.outstanding, public.outstanding_settlements,
                public.notifications, public.notification_reads, public.audit_logs, public.settings to authenticated;

alter table public.settings                 enable row level security;
alter table public.branches                 enable row level security;
alter table public.profiles                 enable row level security;
alter table public.cash_registers           enable row level security;
alter table public.voucher_counters         enable row level security;   -- no policy at all: invisible to clients
alter table public.vouchers                 enable row level security;
alter table public.voucher_attachments      enable row level security;
alter table public.statements               enable row level security;
alter table public.outstanding              enable row level security;
alter table public.outstanding_settlements  enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_reads       enable row level security;
alter table public.audit_logs               enable row level security;

-- `(select ...)` makes Postgres evaluate the caller's role once per query instead of once per row.
create policy settings_read on public.settings for select to authenticated
  using ((select public.rw_role()) is not null);

create policy branches_read on public.branches for select to authenticated
  using (public.rw_can_see_branch(id));

create policy profiles_read on public.profiles for select to authenticated
  using (deleted_at is null and public.rw_can_see_user(id));

create policy registers_read on public.cash_registers for select to authenticated
  using (public.rw_can_see_user(user_id));

create policy vouchers_read on public.vouchers for select to authenticated
  using (
    (select public.rw_role()) is not null
    and (status <> 'DELETED' or (select public.rw_role()) in ('SUPER_ADMIN', 'BRANCH_ADMIN'))
    and case (select public.rw_role())
          when 'SUPER_ADMIN' then true
          when 'USER'        then user_id = (select auth.uid())
          else branch_id = (select public.rw_branch_id())
        end
  );

-- an attachment is visible exactly when its voucher is (the sub-select runs under the caller's own RLS)
create policy attachments_read on public.voucher_attachments for select to authenticated
  using (
    exists (select 1 from public.vouchers v where v.id = voucher_id)
    and (removed_at is null or (select public.rw_role()) in ('SUPER_ADMIN', 'BRANCH_ADMIN'))
  );

create policy statements_read on public.statements for select to authenticated
  using (public.rw_can_see_user(user_id));

create policy outstanding_read on public.outstanding for select to authenticated
  using ((select public.rw_role()) in ('SUPER_ADMIN', 'BRANCH_ADMIN')
         and ((select public.rw_role()) = 'SUPER_ADMIN' or branch_id = (select public.rw_branch_id())));

create policy outstanding_settlements_read on public.outstanding_settlements for select to authenticated
  using (exists (select 1 from public.outstanding o where o.id = outstanding_id));

create policy notifications_read on public.notifications for select to authenticated
  using (
    target_user_id = (select auth.uid())
    or (for_admins and (select public.rw_role()) = 'SUPER_ADMIN')
    or (for_admins and (select public.rw_role()) = 'BRANCH_ADMIN' and branch_id = (select public.rw_branch_id()))
  );

create policy notification_reads_own on public.notification_reads for select to authenticated
  using (user_id = (select auth.uid()));

create policy audit_read on public.audit_logs for select to authenticated
  using ((select public.rw_role()) = 'SUPER_ADMIN'
         or ((select public.rw_role()) = 'BRANCH_ADMIN' and branch_id = (select public.rw_branch_id())));
