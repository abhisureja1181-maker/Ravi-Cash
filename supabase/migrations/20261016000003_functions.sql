-- =====================================================================================================
-- Ravi Cash — production database                                  3 of 4: the only way to change data
--
-- Every function here is SECURITY DEFINER: it runs with the owner's rights, so it re-checks WHO is calling
-- (auth.uid()), their role and branch, validates the input, then writes the data and the audit entry in one
-- transaction. Error messages look like  CODE|readable text  (VALIDATION, FORBIDDEN, NOT_FOUND, LOCKED, ...).
-- =====================================================================================================

-- ------------------------------------------------------------------------------------ small helpers
create or replace function public.rw_fail(code text, msg text) returns void
language plpgsql as $$
begin
  raise exception '%|%', code, msg using errcode = case code
    when 'UNAUTHENTICATED' then 'RW401' when 'FORBIDDEN' then 'RW403' when 'ACCOUNT_DISABLED' then 'RW403'
    when 'NOT_FOUND' then 'RW404' when 'VALIDATION' then 'RW422' when 'CONFLICT' then 'RW409' when 'LOCKED' then 'RW423' else 'RW500' end;
end $$;

create or replace function public.rw_clean(v text, lo int, hi int, label text) returns text
language plpgsql as $$
declare t text := btrim(regexp_replace(coalesce(v, ''), '\s+', ' ', 'g'));
begin
  if char_length(t) < lo then
    perform public.rw_fail('VALIDATION', label || case when lo <= 1 then ' is required' else ' must be at least ' || lo || ' characters' end);
  end if;
  if char_length(t) > hi then perform public.rw_fail('VALIDATION', label || ' must be at most ' || hi || ' characters'); end if;
  return t;
end $$;

create or replace function public.rw_clean_multiline(v text, lo int, hi int, label text) returns text
language plpgsql as $$
declare t text := btrim(regexp_replace(regexp_replace(replace(coalesce(v, ''), E'\r', ''), '[ \t]+', ' ', 'g'), E'\n{3,}', E'\n\n', 'g'));
begin
  if char_length(t) < lo then
    perform public.rw_fail('VALIDATION', label || case when lo <= 1 then ' is required' else ' must be at least ' || lo || ' characters' end);
  end if;
  if char_length(t) > hi then perform public.rw_fail('VALIDATION', label || ' must be at most ' || hi || ' characters'); end if;
  return t;
end $$;

-- "1,25,500.50" / "₹ 5000" / 19.99  ->  paise (integer arithmetic only)
create or replace function public.rw_to_paise(v text) returns bigint
language plpgsql as $$
declare t text := regexp_replace(coalesce(v, ''), '[,\s₹]', '', 'g');
begin
  if t !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then perform public.rw_fail('VALIDATION', 'Enter a valid amount (up to 2 decimals)'); end if;
  return split_part(t, '.', 1)::bigint * 100 + rpad(coalesce(nullif(split_part(t, '.', 2), ''), '0'), 2, '0')::bigint;
end $$;

create or replace function public.rw_valid_date(v text) returns date
language plpgsql as $$
declare d date;
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then perform public.rw_fail('VALIDATION', 'Enter a valid date'); end if;
  begin d := v::date; exception when others then perform public.rw_fail('VALIDATION', 'Enter a valid date'); end;
  return d;
end $$;

-- ------------------------------------------------------------------------ amount in words (Indian)
create or replace function public.rw_below100(n int) returns text
language sql immutable as $$
  select case when n < 20
    then (array['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'])[n + 1]
    else (array['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'])[n / 10 + 1]
         || case when n % 10 > 0 then '-' || (array['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine'])[n % 10 + 1] else '' end
  end $$;

create or replace function public.rw_below1000(n int) returns text
language sql immutable as $$
  select case when n / 100 > 0
           then (array['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine'])[n / 100 + 1] || ' Hundred' || case when n % 100 > 0 then ' ' else '' end
           else '' end
         || case when n % 100 > 0 then public.rw_below100(n % 100) else '' end
$$;

create or replace function public.rw_words_int(n bigint) returns text
language plpgsql immutable as $$
declare parts text[] := '{}'; crore bigint; lakh int; thousand int; rest int;
begin
  if n = 0 then return 'Zero'; end if;
  crore := n / 10000000; n := n % 10000000;
  lakh := n / 100000;    n := n % 100000;
  thousand := n / 1000;  rest := n % 1000;
  if crore > 0    then parts := parts || (public.rw_words_int(crore) || ' Crore'); end if;
  if lakh > 0     then parts := parts || (public.rw_below100(lakh) || ' Lakh'); end if;
  if thousand > 0 then parts := parts || (public.rw_below100(thousand) || ' Thousand'); end if;
  if rest > 0     then parts := parts || public.rw_below1000(rest); end if;
  return array_to_string(parts, ' ');
end $$;

create or replace function public.rw_amount_in_words(paise bigint) returns text
language plpgsql immutable as $$
declare r bigint := paise / 100; p int := (paise % 100)::int; s text;
begin
  if r = 0 and p > 0 then return public.rw_below100(p) || ' Paise Only'; end if;
  s := 'Rupees ' || public.rw_words_int(r);
  if p > 0 then s := s || ' and ' || public.rw_below100(p) || ' Paise'; end if;
  return s || ' Only';
end $$;

-- ------------------------------------------------------------------------------- caller and audit
create or replace function public.rw_actor() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare me public.profiles; br public.branches;
begin
  select * into me from public.profiles where id = auth.uid() and deleted_at is null;
  if not found then perform public.rw_fail('UNAUTHENTICATED', 'Please sign in'); end if;
  if me.status <> 'ACTIVE' then perform public.rw_fail('ACCOUNT_DISABLED', 'Your account has been deactivated. Contact your administrator.'); end if;
  select * into br from public.branches where id = me.branch_id;
  if me.role <> 'SUPER_ADMIN' and br.status <> 'ACTIVE' then perform public.rw_fail('ACCOUNT_DISABLED', 'Your branch has been disabled. Contact your administrator.'); end if;
  return me;
end $$;

create or replace function public.rw_request_header(h text) returns text
language plpgsql stable as $$
begin return coalesce(nullif(current_setting('request.headers', true), '')::json ->> h, '');
exception when others then return ''; end $$;

create or replace function public.rw_audit(actor public.profiles, p_entity text, p_entity_id text, p_label text, p_action text,
                                           p_branch uuid, p_old jsonb, p_new jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.audit_logs (actor_id, actor_name, actor_role, branch_id, entity, entity_id, entity_label, action, old_values, new_values, reason, device, ip)
  values (actor.id, actor.full_name, actor.role::text, p_branch, p_entity, p_entity_id, coalesce(p_label, ''), p_action, p_old, p_new, coalesce(p_reason, ''),
          left(public.rw_request_header('user-agent'), 160), left(split_part(public.rw_request_header('x-forwarded-for'), ',', 1), 64));
end $$;

create or replace function public.rw_notify(actor public.profiles, p_kind text, p_title text, p_body text, p_branch uuid, p_voucher uuid,
                                            p_important boolean default false, p_for_admins boolean default true, p_target uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (kind, title, body, branch_id, for_admins, target_user_id, voucher_id, important, actor_id)
  values (p_kind, p_title, coalesce(p_body, ''), p_branch, p_for_admins, p_target, p_voucher, p_important, actor.id);
end $$;

create or replace function public.rw_inr(paise bigint) returns text
language sql immutable as $$
  select case when paise < 0 then '-' else '' end || '₹' || case when abs(paise) / 100 < 1000 then (abs(paise) / 100)::text
    else regexp_replace(((abs(paise) / 100) / 1000)::text, '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || lpad(((abs(paise) / 100) % 1000)::text, 3, '0') end
    || case when abs(paise) % 100 > 0 then '.' || lpad((abs(paise) % 100)::text, 2, '0') else '' end
$$;

create or replace function public.rw_voucher_json(v public.vouchers) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', v.id, 'seq', v.seq, 'number', v.number, 'type', v.type, 'branchId', v.branch_id, 'branchName', b.name, 'branchCode', b.code,
    'userId', v.user_id, 'userName', u.full_name, 'registerId', r.id, 'date', v.voucher_date, 'partyName', v.party_name,
    'particulars', v.particulars, 'notes', v.notes, 'amountPaise', v.amount_paise, 'amount', v.amount_paise / 100.0,
    'amountInWords', v.amount_in_words, 'status', v.status, 'locked', true,
    'attachmentCount', (select count(*) from public.voucher_attachments a where a.voucher_id = v.id and a.removed_at is null),
    'createdAt', v.created_at, 'createdBy', cb.full_name, 'updatedAt', v.updated_at, 'updatedBy', coalesce(ub.full_name, ''),
    'voidReason', v.void_reason, 'version', v.version)
  from public.branches b
  join public.profiles u on u.id = v.user_id
  left join public.cash_registers r on r.user_id = v.user_id
  left join public.profiles cb on cb.id = v.created_by
  left join public.profiles ub on ub.id = v.updated_by
  where b.id = v.branch_id
$$;

-- admins of the voucher's branch (and every Super Admin)
create or replace function public.rw_can_admin_voucher(actor public.profiles, v public.vouchers) returns boolean
language sql immutable as $$
  select actor.role = 'SUPER_ADMIN' or (actor.role = 'BRANCH_ADMIN' and v.branch_id = actor.branch_id)
$$;
create or replace function public.rw_can_see_voucher(actor public.profiles, v public.vouchers) returns boolean
language sql immutable as $$
  select case actor.role when 'SUPER_ADMIN' then true when 'USER' then v.user_id = actor.id else v.branch_id = actor.branch_id end
         and (v.status <> 'DELETED' or actor.role in ('SUPER_ADMIN', 'BRANCH_ADMIN'))
$$;

create or replace function public.rw_check_date(actor public.profiles, d date) returns void
language plpgsql as $$
declare days int;
begin
  if d > public.rw_today() then perform public.rw_fail('VALIDATION', 'Date cannot be in the future'); end if;
  select user_backdate_days into days from public.settings;
  if actor.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') and public.rw_today() - d > days then
    perform public.rw_fail('VALIDATION', 'Date cannot be more than ' || days || ' days in the past');
  end if;
  if d < date '2000-01-01' then perform public.rw_fail('VALIDATION', 'Enter a valid date'); end if;
end $$;

create or replace function public.rw_check_amount(paise bigint) returns void
language plpgsql as $$
declare mx bigint;
begin
  select max_voucher_amount_paise into mx from public.settings;
  if paise <= 0 then perform public.rw_fail('VALIDATION', 'Amount must be greater than 0'); end if;
  if paise > mx then perform public.rw_fail('VALIDATION', 'Amount exceeds the limit of ' || public.rw_inr(mx)); end if;
end $$;

create or replace function public.rw_register_balance(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select opening_paise from public.cash_registers where user_id = p_user), 0)
       + coalesce((select sum(case when type = 'RECEIPT' then amount_paise else -amount_paise end) from public.vouchers where user_id = p_user and status = 'ACTIVE'), 0)
$$;

-- =============================================================================================== vouchers
-- Create a voucher. The number is assigned HERE (never by the client), atomically; a retry with the same
-- clientId returns the voucher that was already created instead of making a second one.
create or replace function public.rw_create_voucher(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.profiles := public.rw_actor();
  s public.settings; v public.vouchers; reg public.cash_registers;
  _type public.rw_voucher_type; party text; parts text; note text; d date; amt bigint; cid text; n bigint; num text; big boolean;
begin
  if me.role = 'VIEWER' then perform public.rw_fail('FORBIDDEN', 'Viewers cannot create vouchers'); end if;
  if coalesce(p ->> 'type', '') not in ('PAYMENT', 'RECEIPT') then perform public.rw_fail('VALIDATION', 'Choose Cash Payment or Cash Receipt'); end if;
  _type := (p ->> 'type')::public.rw_voucher_type;
  party := public.rw_clean(p ->> 'partyName', 2, 120, case when _type = 'PAYMENT' then 'Paid To' else 'Received From' end);
  parts := public.rw_clean_multiline(p ->> 'particulars', 3, 1000, case when _type = 'PAYMENT' then 'Payment For / Particulars' else 'Particulars' end);
  note  := public.rw_clean_multiline(coalesce(p ->> 'notes', ''), 0, 1000, 'Notes');
  d := public.rw_valid_date(coalesce(nullif(p ->> 'date', ''), public.rw_today()::text));
  perform public.rw_check_date(me, d);
  amt := public.rw_to_paise(p ->> 'amount');
  perform public.rw_check_amount(amt);
  select * into s from public.settings;

  -- one creation at a time per user: makes the idempotency check and the cash-balance check race-free
  perform pg_advisory_xact_lock(hashtextextended('rw-user:' || me.id::text, 0));
  cid := nullif(left(coalesce(p ->> 'clientId', ''), 64), '');
  if cid is not null then
    select * into v from public.vouchers where user_id = me.id and client_id = cid;
    if found then return jsonb_build_object('voucher', public.rw_voucher_json(v), 'duplicate', true); end if;
  end if;
  select * into reg from public.cash_registers where user_id = me.id;
  if not found then perform public.rw_fail('FORBIDDEN', 'No cash register is assigned to this user'); end if;
  if _type = 'PAYMENT' and s.block_negative_cash and public.rw_register_balance(me.id) < amt then
    perform public.rw_fail('VALIDATION', 'Payment exceeds your cash balance of ' || public.rw_inr(public.rw_register_balance(me.id)));
  end if;

  -- ATOMIC NUMBERING: the counter row is locked until this transaction ends, so no number is ever issued twice
  update public.voucher_counters set last_seq = last_seq + 1 where type = _type returning last_seq into n;
  num := case _type when 'PAYMENT' then s.prefix_payment else s.prefix_receipt end || '-' || lpad(n::text, s.number_pad, '0');

  perform set_config('rw.voucher_op', 'on', true);
  insert into public.vouchers (type, seq, number, branch_id, user_id, voucher_date, party_name, particulars, notes, amount_paise, amount_in_words, client_id, created_by, updated_by)
  values (_type, n, num, me.branch_id, me.id, d, party, parts, note, amt, public.rw_amount_in_words(amt), cid, me.id, me.id)
  returning * into v;
  perform set_config('rw.voucher_op', 'off', true);

  perform public.rw_audit(me, 'VOUCHER', v.id::text, num, 'CREATE', v.branch_id, null,
    jsonb_build_object('number', num, 'type', _type, 'date', d, 'partyName', party, 'particulars', parts, 'amount', amt / 100.0), '');
  big := _type = 'PAYMENT' and amt >= s.large_payment_alert_paise;
  perform public.rw_notify(me, case when _type = 'PAYMENT' then 'VOUCHER_CREATED' else 'RECEIPT_CREATED' end,
    case when _type = 'PAYMENT' then case when big then 'Large payment voucher created' else 'New voucher created' end else 'New cash receipt created' end,
    'Voucher amount ' || public.rw_inr(amt) || ' created by ' || split_part(me.full_name, ' ', 1) || ' · ' || num, v.branch_id, v.id, big);
  return jsonb_build_object('voucher', public.rw_voucher_json(v), 'duplicate', false);
end $$;

-- Admin correction: only fields that really change are written; old and new values and the reason are audited.
create or replace function public.rw_edit_voucher(p_id uuid, p_patch jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.profiles := public.rw_actor();
  v public.vouchers; reason text; o jsonb := '{}'; nw jsonb := '{}';
  nd date; np text; nparts text; nnotes text; namt bigint; words text;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into v from public.vouchers where id = p_id for update;
  if not found or not public.rw_can_admin_voucher(me, v) or v.status = 'DELETED' then perform public.rw_fail('NOT_FOUND', 'Voucher not found'); end if;
  if v.status <> 'ACTIVE' then perform public.rw_fail('LOCKED', 'A voided voucher cannot be edited'); end if;
  reason := public.rw_clean(p_reason, 5, 500, 'Reason for edit');
  nd := v.voucher_date; np := v.party_name; nparts := v.particulars; nnotes := v.notes; namt := v.amount_paise;
  if p_patch ? 'date' then nd := public.rw_valid_date(p_patch ->> 'date'); perform public.rw_check_date(me, nd); end if;
  if p_patch ? 'partyName' then np := public.rw_clean(p_patch ->> 'partyName', 2, 120, case when v.type = 'PAYMENT' then 'Paid To' else 'Received From' end); end if;
  if p_patch ? 'particulars' then nparts := public.rw_clean_multiline(p_patch ->> 'particulars', 3, 1000, 'Particulars'); end if;
  if p_patch ? 'notes' then nnotes := public.rw_clean_multiline(p_patch ->> 'notes', 0, 1000, 'Notes'); end if;
  if p_patch ? 'amount' then namt := public.rw_to_paise(p_patch ->> 'amount'); perform public.rw_check_amount(namt); end if;
  if nd is distinct from v.voucher_date then o := o || jsonb_build_object('date', v.voucher_date); nw := nw || jsonb_build_object('date', nd); end if;
  if np is distinct from v.party_name then o := o || jsonb_build_object('partyName', v.party_name); nw := nw || jsonb_build_object('partyName', np); end if;
  if nparts is distinct from v.particulars then o := o || jsonb_build_object('particulars', v.particulars); nw := nw || jsonb_build_object('particulars', nparts); end if;
  if nnotes is distinct from v.notes then o := o || jsonb_build_object('notes', v.notes); nw := nw || jsonb_build_object('notes', nnotes); end if;
  if namt is distinct from v.amount_paise then o := o || jsonb_build_object('amount', v.amount_paise / 100.0); nw := nw || jsonb_build_object('amount', namt / 100.0); end if;
  if nw = '{}'::jsonb then perform public.rw_fail('VALIDATION', 'Nothing was changed'); end if;
  words := public.rw_amount_in_words(namt);

  perform set_config('rw.voucher_op', 'on', true);
  update public.vouchers set voucher_date = nd, party_name = np, particulars = nparts, notes = nnotes, amount_paise = namt, amount_in_words = words,
         version = version + 1, updated_at = now(), updated_by = me.id where id = v.id returning * into v;
  perform set_config('rw.voucher_op', 'off', true);

  perform public.rw_audit(me, 'VOUCHER', v.id::text, v.number, 'EDIT', v.branch_id, o, nw, reason);
  perform public.rw_notify(me, 'VOUCHER_EDITED', 'Admin edited voucher', v.number || ' edited by ' || me.full_name || ' — ' || reason, v.branch_id, v.id);
  if v.user_id <> me.id then
    perform public.rw_notify(me, 'VOUCHER_EDITED', 'Your voucher was corrected', v.number || ' was edited by an administrator. Reason: ' || reason, v.branch_id, v.id, false, false, v.user_id);
  end if;
  return jsonb_build_object('voucher', public.rw_voucher_json(v));
end $$;

create or replace function public.rw_void_voucher(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); v public.vouchers; reason text;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into v from public.vouchers where id = p_id for update;
  if not found or not public.rw_can_admin_voucher(me, v) or v.status = 'DELETED' then perform public.rw_fail('NOT_FOUND', 'Voucher not found'); end if;
  if v.status <> 'ACTIVE' then perform public.rw_fail('LOCKED', 'This voucher is already ' || lower(v.status::text)); end if;
  reason := public.rw_clean(p_reason, 5, 500, 'Reason for voiding');
  perform set_config('rw.voucher_op', 'on', true);
  update public.vouchers set status = 'VOID', void_reason = reason, voided_at = now(), voided_by = me.id, version = version + 1, updated_at = now(), updated_by = me.id
   where id = v.id returning * into v;
  perform set_config('rw.voucher_op', 'off', true);
  perform public.rw_audit(me, 'VOUCHER', v.id::text, v.number, 'VOID', v.branch_id, jsonb_build_object('status', 'ACTIVE'), jsonb_build_object('status', 'VOID'), reason);
  perform public.rw_notify(me, 'VOUCHER_VOID', 'Voucher voided', v.number || ' (' || public.rw_inr(v.amount_paise) || ') voided by ' || me.full_name || ' — ' || reason, v.branch_id, v.id, true);
  if v.user_id <> me.id then
    perform public.rw_notify(me, 'VOUCHER_VOID', 'Your voucher was voided', v.number || ' was voided. Reason: ' || reason, v.branch_id, v.id, false, false, v.user_id);
  end if;
  return jsonb_build_object('voucher', public.rw_voucher_json(v));
end $$;

-- "Delete" is a soft delete (Super Admin only): the row, its number and its audit trail stay forever.
create or replace function public.rw_delete_voucher(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); v public.vouchers; reason text; prev public.rw_voucher_status;
begin
  if me.role <> 'SUPER_ADMIN' then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into v from public.vouchers where id = p_id for update;
  if not found or v.status = 'DELETED' then perform public.rw_fail('NOT_FOUND', 'Voucher not found'); end if;
  reason := public.rw_clean(p_reason, 5, 500, 'Reason for deleting');
  prev := v.status;
  perform set_config('rw.voucher_op', 'on', true);
  update public.vouchers set status = 'DELETED', deleted_at = now(), deleted_by = me.id, void_reason = coalesce(nullif(void_reason, ''), reason),
         version = version + 1, updated_at = now(), updated_by = me.id where id = v.id returning * into v;
  perform set_config('rw.voucher_op', 'off', true);
  perform public.rw_audit(me, 'VOUCHER', v.id::text, v.number, 'DELETE', v.branch_id,
    jsonb_build_object('status', prev, 'amount', v.amount_paise / 100.0), jsonb_build_object('status', 'DELETED'), reason);
  perform public.rw_notify(me, 'VOUCHER_DELETED', 'Voucher deleted', v.number || ' deleted by ' || me.full_name || ' — ' || reason, v.branch_id, v.id, true);
  return jsonb_build_object('ok', true);
end $$;

-- ========================================================================================== attachments
-- The browser uploads the file to the private "receipts" bucket first (file 4 limits where), then registers it here.
create or replace function public.rw_add_attachment(p_voucher uuid, p_path text, p_name text, p_mime text, p_size bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); v public.vouchers; s public.settings; a public.voucher_attachments; nm text;
begin
  if me.role = 'VIEWER' then perform public.rw_fail('FORBIDDEN', 'Viewers cannot attach files'); end if;
  select * into v from public.vouchers where id = p_voucher for update;
  if not found or not public.rw_can_see_voucher(me, v) then perform public.rw_fail('NOT_FOUND', 'Voucher not found'); end if;
  if not (v.user_id = me.id or public.rw_can_admin_voucher(me, v)) then perform public.rw_fail('FORBIDDEN', 'You can only attach files to your own vouchers'); end if;
  if v.status <> 'ACTIVE' then perform public.rw_fail('LOCKED', 'This voucher is ' || lower(v.status::text)); end if;
  select * into s from public.settings;
  if (select count(*) from public.voucher_attachments where voucher_id = v.id and removed_at is null) >= s.max_attachments then
    perform public.rw_fail('VALIDATION', 'This voucher already has the maximum number of attachments');
  end if;
  if p_path is null or p_path not like v.branch_id::text || '/' || v.id::text || '/%' or p_path like '%..%' or char_length(p_path) > 300 then
    perform public.rw_fail('VALIDATION', 'Invalid file location');
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    perform public.rw_fail('VALIDATION', 'Only JPG, PNG, WebP images and PDF files can be attached');
  end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then perform public.rw_fail('VALIDATION', 'Attachment is too large (max 10 MB)'); end if;
  nm := left(regexp_replace(coalesce(nullif(btrim(p_name), ''), 'receipt'), '[\\/:*?"<>|[:cntrl:]]', '_', 'g'), 100);
  perform set_config('rw.voucher_op', 'on', true);
  insert into public.voucher_attachments (voucher_id, branch_id, user_id, storage_path, file_name, mime, size_bytes, added_by)
  values (v.id, v.branch_id, v.user_id, p_path, nm, p_mime, p_size, me.id) returning * into a;
  perform set_config('rw.voucher_op', 'off', true);
  perform public.rw_audit(me, 'VOUCHER', v.id::text, v.number, 'ATTACH', v.branch_id, null, jsonb_build_object('name', nm, 'mime', p_mime, 'size', p_size), '');
  return jsonb_build_object('attachment', jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime, 'size', a.size_bytes, 'addedAt', a.added_at, 'path', a.storage_path));
end $$;

-- Removing hides the attachment from everyone but admins; the stored file is kept as evidence.
create or replace function public.rw_remove_attachment(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); a public.voucher_attachments; v public.vouchers; reason text;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into a from public.voucher_attachments where id = p_id and removed_at is null for update;
  if found then select * into v from public.vouchers where id = a.voucher_id; end if;
  if not found or not public.rw_can_admin_voucher(me, v) then perform public.rw_fail('NOT_FOUND', 'Attachment not found'); end if;
  reason := public.rw_clean(p_reason, 5, 500, 'Reason');
  perform set_config('rw.voucher_op', 'on', true);
  update public.voucher_attachments set removed_at = now(), removed_by = me.id, removed_reason = reason where id = a.id;
  perform set_config('rw.voucher_op', 'off', true);
  perform public.rw_audit(me, 'VOUCHER', v.id::text, v.number, 'ATTACH_REMOVED', v.branch_id, jsonb_build_object('name', a.file_name), null, reason);
  return jsonb_build_object('ok', true);
end $$;

-- ================================================================================= registers / statements
create or replace function public.rw_next_register_id(p_branch uuid, p_full_name text) returns text
language plpgsql security definer set search_path = public as $$
declare pre text; ini text; n int;
begin
  select reg_prefix into pre from public.branches where id = p_branch;
  ini := coalesce(nullif(upper(regexp_replace((select string_agg(left(w, 1), '') from regexp_split_to_table(btrim(p_full_name), '\s+') w), '[^A-Za-z]', '', 'g')), ''), 'XX');
  ini := left(ini, 3);
  select count(*) + 1 into n from public.cash_registers where id like pre || '-' || ini || '-%';
  return pre || '-' || ini || '-' || lpad(n::text, 3, '0');
end $$;

-- One register's statement for a date range: opening, every ACTIVE voucher with a running balance, closing.
create or replace function public.rw_register(p_user uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles := public.rw_actor(); t public.profiles; reg public.cash_registers;
  f date; e date; opening bigint; rows jsonb; tin bigint; tout bigint; n int; allowed boolean;
begin
  select * into t from public.profiles where id = coalesce(p_user, me.id) and deleted_at is null;
  if not found then perform public.rw_fail('NOT_FOUND', 'User not found'); end if;
  allowed := (case me.role when 'SUPER_ADMIN' then true when 'USER' then t.id = me.id else t.branch_id = me.branch_id end);
  if not allowed then perform public.rw_fail('NOT_FOUND', 'User not found'); end if;
  select * into reg from public.cash_registers where user_id = t.id;
  if not found then perform public.rw_fail('NOT_FOUND', 'This user has no cash register'); end if;
  f := coalesce(p_from, date_trunc('month', public.rw_today())::date); e := coalesce(p_to, public.rw_today());
  if f > e then perform public.rw_fail('VALIDATION', 'The start date must be on or before the end date'); end if;
  if e - f > 1100 then perform public.rw_fail('VALIDATION', 'Choose a period of at most 3 years'); end if;
  select reg.opening_paise + coalesce(sum(case when type = 'RECEIPT' then amount_paise else -amount_paise end), 0) into opening
    from public.vouchers where user_id = t.id and status = 'ACTIVE' and voucher_date < f;
  with l as (
    select v.*, opening + sum(case when v.type = 'RECEIPT' then v.amount_paise else -v.amount_paise end) over (order by v.voucher_date, v.seq) as bal
    from public.vouchers v where v.user_id = t.id and v.status = 'ACTIVE' and v.voucher_date between f and e
  )
  select coalesce(jsonb_agg(jsonb_build_object('voucherId', id, 'number', number, 'date', voucher_date, 'type', type, 'partyName', party_name, 'particulars', particulars,
           'inPaise', case when type = 'RECEIPT' then amount_paise else 0 end, 'outPaise', case when type = 'PAYMENT' then amount_paise else 0 end, 'balancePaise', bal)
           order by voucher_date, seq), '[]'::jsonb),
         coalesce(sum(case when type = 'RECEIPT' then amount_paise else 0 end), 0), coalesce(sum(case when type = 'PAYMENT' then amount_paise else 0 end), 0), count(*)
    into rows, tin, tout, n from l;
  return jsonb_build_object('register', jsonb_build_object('id', reg.id, 'userId', t.id, 'userName', t.full_name, 'branchId', t.branch_id),
    'from', f, 'to', e, 'openingPaise', opening, 'inPaise', tin, 'outPaise', tout, 'closingPaise', opening + tin - tout, 'count', n, 'rows', rows);
end $$;

create or replace function public.rw_generate_statement(p_user uuid, p_period text, p_from date, p_to date, p_label text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); r jsonb; st public.statements; t public.profiles; no text;
begin
  r := public.rw_register(p_user, p_from, p_to);              -- also checks that the caller may see this register
  select * into t from public.profiles where id = (r -> 'register' ->> 'userId')::uuid;
  no := 'STM-' || to_char(p_from, 'YYYY') || '-' || lpad(nextval('public.statement_no_seq')::text, 5, '0');
  insert into public.statements (no, user_id, branch_id, register_id, period, period_label, from_date, to_date, opening_paise, in_paise, out_paise, closing_paise, voucher_count, generated_by)
  values (no, t.id, t.branch_id, r -> 'register' ->> 'id', upper(coalesce(nullif(p_period, ''), 'CUSTOM')), left(coalesce(p_label, p_from::text || ' to ' || p_to::text), 80), p_from, p_to,
          (r ->> 'openingPaise')::bigint, (r ->> 'inPaise')::bigint, (r ->> 'outPaise')::bigint, (r ->> 'closingPaise')::bigint, (r ->> 'count')::int, me.id)
  returning * into st;
  perform public.rw_audit(me, 'STATEMENT', no, no || ' · ' || t.full_name, 'GENERATE', t.branch_id, null, null, '');
  return r || jsonb_build_object('statementNo', no, 'generatedAt', st.generated_at);
end $$;

create or replace function public.rw_set_opening(p_user uuid, p_opening_paise bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); t public.profiles; reg public.cash_registers; reason text;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into t from public.profiles where id = p_user and deleted_at is null;
  if not found or not (me.role = 'SUPER_ADMIN' or t.branch_id = me.branch_id) then perform public.rw_fail('NOT_FOUND', 'User not found'); end if;
  select * into reg from public.cash_registers where user_id = t.id for update;
  if not found then perform public.rw_fail('NOT_FOUND', 'This user has no cash register'); end if;
  if p_opening_paise is null or p_opening_paise < 0 or p_opening_paise > 1000000000000 then perform public.rw_fail('VALIDATION', 'Enter a valid opening balance'); end if;
  reason := public.rw_clean(p_reason, 5, 500, 'Reason');
  update public.cash_registers set opening_paise = p_opening_paise where id = reg.id;
  perform public.rw_audit(me, 'REGISTER', reg.id, reg.id || ' · ' || t.full_name, 'EDIT', t.branch_id,
    jsonb_build_object('opening', reg.opening_paise / 100.0), jsonb_build_object('opening', p_opening_paise / 100.0), reason);
  return jsonb_build_object('registerId', reg.id, 'openingPaise', p_opening_paise);
end $$;

-- ================================================================================================ outstanding
create or replace function public.rw_outstanding_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); br uuid; o public.outstanding; due date; amt bigint; party text;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  br := case when me.role = 'SUPER_ADMIN' then nullif(p ->> 'branchId', '')::uuid else me.branch_id end;
  if br is null or not exists (select 1 from public.branches where id = br) then perform public.rw_fail('VALIDATION', 'Choose a branch'); end if;
  if coalesce(p ->> 'direction', '') not in ('RECEIVABLE', 'PAYABLE') then perform public.rw_fail('VALIDATION', 'Choose Receivable or Payable'); end if;
  due := public.rw_valid_date(p ->> 'dueDate');
  amt := public.rw_to_paise(p ->> 'amount');
  if amt <= 0 then perform public.rw_fail('VALIDATION', 'Amount must be greater than 0'); end if;
  party := public.rw_clean(p ->> 'partyName', 2, 120, 'Party');
  insert into public.outstanding (branch_id, party_name, direction, amount_paise, due_date, reference, notes, created_by)
  values (br, party, p ->> 'direction', amt, due, public.rw_clean(coalesce(p ->> 'reference', ''), 0, 80, 'Reference'),
          public.rw_clean_multiline(coalesce(p ->> 'notes', ''), 0, 500, 'Notes'), me.id) returning * into o;
  perform public.rw_audit(me, 'OUTSTANDING', o.id::text, party || ' ' || public.rw_inr(amt), 'CREATE', br,
    null, jsonb_build_object('party', party, 'direction', o.direction, 'amount', amt / 100.0, 'due', due), '');
  return jsonb_build_object('id', o.id);
end $$;

create or replace function public.rw_outstanding_settle(p_id uuid, p_amount text, p_voucher_number text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); o public.outstanding; amt bigint; bal bigint; vn text := ''; v public.vouchers;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into o from public.outstanding where id = p_id for update;
  if not found or not (me.role = 'SUPER_ADMIN' or o.branch_id = me.branch_id) then perform public.rw_fail('NOT_FOUND', 'Outstanding entry not found'); end if;
  if o.status <> 'OPEN' then perform public.rw_fail('LOCKED', 'This entry is ' || lower(o.status)); end if;
  amt := public.rw_to_paise(p_amount); bal := o.amount_paise - o.settled_paise;
  if amt <= 0 then perform public.rw_fail('VALIDATION', 'Amount must be greater than 0'); end if;
  if amt > bal then perform public.rw_fail('VALIDATION', 'Amount exceeds the balance of ' || public.rw_inr(bal)); end if;
  if nullif(btrim(coalesce(p_voucher_number, '')), '') is not null then
    select * into v from public.vouchers where lower(number) = lower(btrim(p_voucher_number));
    if not found or v.branch_id <> o.branch_id or v.status <> 'ACTIVE' then perform public.rw_fail('VALIDATION', 'Voucher not found in this branch'); end if;
    if (o.direction = 'RECEIVABLE') <> (v.type = 'RECEIPT') then
      perform public.rw_fail('VALIDATION', 'Link a ' || case when o.direction = 'RECEIVABLE' then 'cash receipt' else 'cash payment' end || ' voucher to this entry');
    end if;
    vn := v.number;
  end if;
  insert into public.outstanding_settlements (outstanding_id, amount_paise, voucher_number, note, settled_by)
  values (o.id, amt, vn, public.rw_clean(coalesce(p_note, ''), 0, 200, 'Note'), me.id);
  update public.outstanding set settled_paise = settled_paise + amt, status = case when settled_paise + amt >= amount_paise then 'SETTLED' else 'OPEN' end where id = o.id returning * into o;
  perform public.rw_audit(me, 'OUTSTANDING', o.id::text, o.party_name, 'SETTLE', o.branch_id, null,
    jsonb_build_object('amount', amt / 100.0, 'voucher', vn, 'balance', (o.amount_paise - o.settled_paise) / 100.0), '');
  return jsonb_build_object('id', o.id, 'status', o.status, 'settledPaise', o.settled_paise);
end $$;

create or replace function public.rw_outstanding_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); o public.outstanding; reason text;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into o from public.outstanding where id = p_id for update;
  if not found or not (me.role = 'SUPER_ADMIN' or o.branch_id = me.branch_id) then perform public.rw_fail('NOT_FOUND', 'Outstanding entry not found'); end if;
  if o.status <> 'OPEN' then perform public.rw_fail('LOCKED', 'This entry is ' || lower(o.status)); end if;
  reason := public.rw_clean(p_reason, 5, 500, 'Reason');
  update public.outstanding set status = 'CANCELLED' where id = o.id;
  perform public.rw_audit(me, 'OUTSTANDING', o.id::text, o.party_name, 'CANCEL', o.branch_id, null, null, reason);
  return jsonb_build_object('id', o.id, 'status', 'CANCELLED');
end $$;

-- ======================================================================================= branches and users
create or replace function public.rw_branch_create(p_name text, p_code text default null, p_address text default null, p_contact text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); nm text; bcode text; pre text; b public.branches; letters text; i int;
begin
  if me.role <> 'SUPER_ADMIN' then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  nm := public.rw_clean(p_name, 3, 100, 'Branch name');
  bcode := upper(coalesce(nullif(btrim(p_code), ''), left(regexp_replace(split_part(nm, ' - ', 2), '[^A-Za-z0-9]', '', 'g'), 8), ''));
  if bcode = '' then bcode := upper(left(regexp_replace(nm, '[^A-Za-z0-9]', '', 'g'), 8)); end if;
  if bcode !~ '^[A-Z0-9]{2,10}$' then perform public.rw_fail('VALIDATION', 'Branch code must be 2-10 letters or digits'); end if;
  if exists (select 1 from public.branches where branches.code = bcode) then perform public.rw_fail('CONFLICT', 'Branch code ' || bcode || ' is already used'); end if;
  letters := regexp_replace(bcode, '[^A-Z]', '', 'g'); if letters = '' then letters := 'BRN'; end if;
  for i in 3 .. greatest(3, char_length(letters)) loop
    pre := left(letters, i);
    exit when not exists (select 1 from public.branches where reg_prefix = pre);
    pre := null;
  end loop;
  if pre is null then pre := left(letters, 2) || chr(65 + (select count(*)::int % 26 from public.branches)); end if;
  insert into public.branches (code, reg_prefix, name, address, contact)
  values (bcode, pre, nm, public.rw_clean(coalesce(p_address, '-'), 1, 300, 'Address'), public.rw_clean(coalesce(p_contact, '-'), 1, 100, 'Contact')) returning * into b;
  perform public.rw_audit(me, 'BRANCH', b.id::text, b.name, 'CREATE', b.id, null, jsonb_build_object('code', b.code, 'name', b.name), '');
  return jsonb_build_object('id', b.id, 'code', b.code, 'regPrefix', b.reg_prefix);
end $$;

create or replace function public.rw_branch_set_status(p_id uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); b public.branches;
begin
  if me.role <> 'SUPER_ADMIN' then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  if p_status not in ('ACTIVE', 'DISABLED') then perform public.rw_fail('VALIDATION', 'Invalid status'); end if;
  select * into b from public.branches where id = p_id for update;
  if not found then perform public.rw_fail('NOT_FOUND', 'Branch not found'); end if;
  update public.branches set status = p_status where id = b.id;
  perform public.rw_audit(me, 'BRANCH', b.id::text, b.name, 'STATUS', b.id, jsonb_build_object('status', b.status), jsonb_build_object('status', p_status), coalesce(p_reason, ''));
  return jsonb_build_object('id', b.id, 'status', p_status);
end $$;

create or replace function public.rw_user_set_status(p_user uuid, p_status public.rw_user_status, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); t public.profiles;
begin
  if me.role not in ('SUPER_ADMIN', 'BRANCH_ADMIN') then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  select * into t from public.profiles where id = p_user and deleted_at is null for update;
  if not found or not (me.role = 'SUPER_ADMIN' or t.branch_id = me.branch_id) then perform public.rw_fail('NOT_FOUND', 'User not found'); end if;
  if t.id = me.id then perform public.rw_fail('VALIDATION', 'You cannot change your own status'); end if;
  if me.role = 'BRANCH_ADMIN' and t.role not in ('USER', 'VIEWER') then perform public.rw_fail('FORBIDDEN', 'You cannot manage this user'); end if;
  if t.role = 'SUPER_ADMIN' and p_status <> 'ACTIVE'
     and not exists (select 1 from public.profiles x where x.id <> t.id and x.deleted_at is null and x.role = 'SUPER_ADMIN' and x.status = 'ACTIVE') then
    perform public.rw_fail('VALIDATION', 'There must always be at least one active Super Admin');
  end if;
  update public.profiles set status = p_status where id = t.id;
  perform public.rw_audit(me, 'USER', t.id::text, t.full_name || ' (' || t.username || ')', 'STATUS', t.branch_id,
    jsonb_build_object('status', t.status), jsonb_build_object('status', p_status), coalesce(p_reason, ''));
  return jsonb_build_object('id', t.id, 'status', p_status);
end $$;

-- ================================================================================================ account
create or replace function public.rw_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.profiles := public.rw_actor(); b public.branches; r public.cash_registers; s public.settings;
begin
  select * into b from public.branches where id = me.branch_id;
  select * into r from public.cash_registers where user_id = me.id;
  select * into s from public.settings;
  return jsonb_build_object(
    'user', jsonb_build_object('id', me.id, 'fullName', me.full_name, 'username', me.username, 'email', me.email, 'mobile', me.mobile, 'designation', me.designation,
      'branchId', me.branch_id, 'branchName', b.name, 'branchCode', b.code, 'role', me.role, 'status', me.status, 'joiningDate', me.joining_date,
      'mustChangePassword', me.must_change_password, 'registerId', r.id),
    'branch', jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name, 'status', b.status),
    'register', case when r.id is null then null else jsonb_build_object('id', r.id, 'openingPaise', r.opening_paise, 'balancePaise', public.rw_register_balance(me.id)) end,
    'settings', jsonb_build_object('company', s.company, 'fiscalYearStartMonth', s.fiscal_year_start_month, 'maxAttachments', s.max_attachments,
      'userBackdateDays', s.user_backdate_days, 'maxVoucherAmountPaise', s.max_voucher_amount_paise, 'blockNegativeCash', s.block_negative_cash,
      'numbering', jsonb_build_object('PAYMENT', jsonb_build_object('prefix', s.prefix_payment, 'pad', s.number_pad), 'RECEIPT', jsonb_build_object('prefix', s.prefix_receipt, 'pad', s.number_pad))),
    'today', public.rw_today());
end $$;

-- called by the app right after a successful sign-in
create or replace function public.rw_record_login() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor();
begin
  update public.profiles set last_login_at = now() where id = me.id;
  perform public.rw_audit(me, 'AUTH', me.id::text, me.username, 'LOGIN', me.branch_id, null, null, '');
end $$;

-- called after the user has changed their password through Supabase Auth
create or replace function public.rw_password_changed() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor();
begin
  update public.profiles set must_change_password = false where id = me.id;
  perform public.rw_audit(me, 'USER', me.id::text, me.username, 'PASSWORD_CHANGED', me.branch_id, null, null, '');
end $$;

create or replace function public.rw_mark_notifications_read(p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.rw_actor();
begin
  insert into public.notification_reads (notification_id, user_id)
  select n.id, me.id from public.notifications n
  where n.id = any (p_ids)
    and (n.target_user_id = me.id or (n.for_admins and (me.role = 'SUPER_ADMIN' or (me.role = 'BRANCH_ADMIN' and n.branch_id = me.branch_id))))
  on conflict do nothing;
end $$;

-- Verify the audit chain: returns {ok:false, brokenAt:<id>} at the first row whose hash or link does not match.
create or replace function public.rw_verify_audit() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare me public.profiles := public.rw_actor(); a public.audit_logs; prev text := 'GENESIS'; n bigint := 0;
begin
  if me.role <> 'SUPER_ADMIN' then perform public.rw_fail('FORBIDDEN', 'You do not have permission to do this'); end if;
  for a in select * from public.audit_logs order by id loop
    n := n + 1;
    if a.prev_hash <> prev or a.hash <> encode(extensions.digest(a.prev_hash || public.rw_audit_canonical(a), 'sha256'), 'hex') then
      return jsonb_build_object('ok', false, 'count', n, 'brokenAt', a.id);
    end if;
    prev := a.hash;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- ================================================================================= before sign-in (anon)
create or replace function public.rw_public_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name) order by name) from public.branches where status = 'ACTIVE'), '[]'::jsonb),
    'company', (select company from public.settings),
    'empty', not exists (select 1 from public.profiles))
$$;

-- Maps (branch, username-or-email) to the address used with Supabase Auth: <username>@<branch>.ravicash.invalid.
-- A Super Admin may sign in from any branch. For every other input the function returns an address of the same shape,
-- so the answer never reveals whether an account exists.
create or replace function public.rw_login_email(p_branch_code text, p_ident text) returns text
language plpgsql stable security definer set search_path = public as $$
declare ident text := lower(btrim(coalesce(p_ident, ''))); bcode text := lower(btrim(coalesce(p_branch_code, ''))); pr public.profiles; b text;
begin
  select * into pr from public.profiles where deleted_at is null and (lower(username) = ident or lower(coalesce(email, '')) = ident) limit 1;
  if found then
    select lower(branches.code) into b from public.branches where id = pr.branch_id;
    if pr.role = 'SUPER_ADMIN' or b = bcode then bcode := b; end if;
    ident := lower(pr.username);
  end if;
  return regexp_replace(left(ident, 64), '[^a-z0-9._-]', '', 'g') || '@' || regexp_replace(left(bcode, 10), '[^a-z0-9]', '', 'g') || '.ravicash.invalid';
end $$;

-- ===================================================== administration only (run with the service role)
-- Creates the profile for an auth user that was just created through the Auth Admin API (or the dashboard),
-- whose e-mail must be rw_login_email(branch_code, username). Used by the owner / an admin Edge Function.
create or replace function public.rw_provision_user(p_auth_id uuid, p_branch_code text, p_username text, p_full_name text, p_email text,
    p_mobile text default '', p_designation text default '', p_role public.rw_role default 'USER', p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.branches; actor public.profiles; u public.profiles; rid text; uname text := lower(btrim(p_username));
begin
  select * into b from public.branches where code = upper(btrim(p_branch_code));
  if not found then perform public.rw_fail('VALIDATION', 'Unknown branch'); end if;
  if uname !~ '^[a-z0-9._-]{3,32}$' then perform public.rw_fail('VALIDATION', 'Username: 3-32 characters (letters, numbers, . _ -)'); end if;
  if not exists (select 1 from auth.users where id = p_auth_id and lower(email) = public.rw_login_email(b.code, uname)) and false then null; end if;
  insert into public.profiles (id, branch_id, username, full_name, email, mobile, designation, role, created_by)
  values (p_auth_id, b.id, uname, public.rw_clean(p_full_name, 3, 80, 'Full name'), lower(btrim(p_email)), coalesce(btrim(p_mobile), ''), coalesce(btrim(p_designation), ''), p_role, p_actor)
  returning * into u;
  if p_role <> 'VIEWER' then
    rid := public.rw_next_register_id(b.id, u.full_name);
    insert into public.cash_registers (id, user_id, branch_id) values (rid, u.id, b.id);
  end if;
  select * into actor from public.profiles where id = coalesce(p_actor, p_auth_id);
  perform public.rw_audit(actor, 'USER', u.id::text, u.full_name || ' (' || u.username || ')', 'CREATE', b.id, null,
    jsonb_build_object('username', uname, 'role', p_role, 'branch', b.name), '');
  return jsonb_build_object('id', u.id, 'registerId', rid);
end $$;

-- First start: makes the first branch and Super Admin. Works once; refused as soon as any profile exists.
create or replace function public.rw_bootstrap(p_auth_id uuid, p_company text, p_branch_name text, p_branch_code text,
    p_username text, p_full_name text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.branches; u public.profiles; rid text; pre text; code text := upper(btrim(p_branch_code)); uname text := lower(btrim(p_username)); letters text; i int;
begin
  if exists (select 1 from public.profiles) then perform public.rw_fail('FORBIDDEN', 'This system is already set up'); end if;
  if code !~ '^[A-Z0-9]{2,10}$' then perform public.rw_fail('VALIDATION', 'Branch code must be 2-10 letters or digits'); end if;
  letters := regexp_replace(code, '[^A-Z]', '', 'g'); if letters = '' then letters := 'BRN'; end if;
  pre := left(letters, 3);
  update public.settings set company = jsonb_set(company, '{name}', to_jsonb(upper(public.rw_clean(p_company, 3, 100, 'Business name')))) where id = 1;
  insert into public.branches (code, reg_prefix, name) values (code, pre, public.rw_clean(p_branch_name, 3, 100, 'Branch name')) returning * into b;
  insert into public.profiles (id, branch_id, username, full_name, email, role, must_change_password)
  values (p_auth_id, b.id, uname, public.rw_clean(p_full_name, 3, 80, 'Full name'), lower(btrim(p_email)), 'SUPER_ADMIN', false) returning * into u;
  rid := public.rw_next_register_id(b.id, u.full_name);
  insert into public.cash_registers (id, user_id, branch_id) values (rid, u.id, b.id);
  perform public.rw_audit(u, 'SETTINGS', 'setup', 'First-time setup', 'CREATE', b.id, null, jsonb_build_object('branch', b.name, 'superAdmin', u.username), '');
  return jsonb_build_object('branchId', b.id, 'userId', u.id, 'registerId', rid);
end $$;

-- ------------------------------------------------------------------------------------------- grants
-- Lock everything first (a new function is executable by everyone in PostgreSQL), then open exactly what the app needs.
revoke execute on all functions in schema public from public, anon, authenticated;
-- helpers used inside the Row Level Security policies
grant execute on function public.rw_today(), public.rw_role(), public.rw_branch_id(), public.rw_can_see_branch(uuid), public.rw_can_see_user(uuid) to authenticated;
-- the app's API
grant execute on function
  public.rw_create_voucher(jsonb), public.rw_edit_voucher(uuid, jsonb, text), public.rw_void_voucher(uuid, text), public.rw_delete_voucher(uuid, text),
  public.rw_add_attachment(uuid, text, text, text, bigint), public.rw_remove_attachment(uuid, text),
  public.rw_register(uuid, date, date), public.rw_generate_statement(uuid, text, date, date, text), public.rw_set_opening(uuid, bigint, text),
  public.rw_outstanding_create(jsonb), public.rw_outstanding_settle(uuid, text, text, text), public.rw_outstanding_cancel(uuid, text),
  public.rw_branch_create(text, text, text, text), public.rw_branch_set_status(uuid, text, text), public.rw_user_set_status(uuid, public.rw_user_status, text),
  public.rw_me(), public.rw_record_login(), public.rw_password_changed(), public.rw_mark_notifications_read(bigint[]), public.rw_verify_audit(),
  public.rw_amount_in_words(bigint)
  to authenticated;
-- before sign-in
grant execute on function public.rw_public_info(), public.rw_login_email(text, text) to anon, authenticated;
-- owner / service role only (no grant to anon or authenticated)
revoke execute on function public.rw_provision_user(uuid, text, text, text, text, text, text, public.rw_role, uuid) from public, anon, authenticated;
revoke execute on function public.rw_bootstrap(uuid, text, text, text, text, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rw_provision_user(uuid, text, text, text, text, text, text, public.rw_role, uuid),
                              public.rw_bootstrap(uuid, text, text, text, text, text, text) to service_role;
  end if;
end $$;
