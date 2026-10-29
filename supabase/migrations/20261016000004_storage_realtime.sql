-- =====================================================================================================
-- Ravi Cash — production database                                        4 of 4: receipts bucket + live sync
-- =====================================================================================================

-- ------------------------------------------------------------------------- private bucket for receipt photos
-- Files live at   <branch_id>/<voucher_id>/<file>   so the first folder is the branch and the second the voucher.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Who may open a file: anyone who may see the voucher it belongs to (the sub-select runs under the caller's RLS).
create policy receipts_read on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and exists (select 1 from public.vouchers v
                where v.id::text = (storage.foldername(name))[2] and v.branch_id::text = (storage.foldername(name))[1])
  );

-- Who may upload: only into the folder of an ACTIVE voucher they own (or, for admins, of their branch), never viewers.
-- Files cannot be overwritten or deleted by clients (no update / delete policy) — receipts are evidence.
create or replace function public.rw_can_upload_receipt(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vouchers v
    join public.profiles me on me.id = auth.uid() and me.deleted_at is null and me.status = 'ACTIVE'
    where v.id::text = (storage.foldername(p_name))[2] and v.branch_id::text = (storage.foldername(p_name))[1]
      and v.status = 'ACTIVE' and me.role <> 'VIEWER'
      and (v.user_id = me.id or me.role = 'SUPER_ADMIN' or (me.role = 'BRANCH_ADMIN' and v.branch_id = me.branch_id))
  )
$$;
grant execute on function public.rw_can_upload_receipt(text) to authenticated;

create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and array_length(storage.foldername(name), 1) = 2 and public.rw_can_upload_receipt(name));

-- ------------------------------------------------------------------------------------------ live sync
-- Supabase Realtime sends row changes to the people who are allowed to read the row (RLS applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.vouchers, public.notifications, public.cash_registers, public.outstanding, public.voucher_attachments;
  end if;
end $$;
alter table public.vouchers replica identity full;
alter table public.notifications replica identity full;
