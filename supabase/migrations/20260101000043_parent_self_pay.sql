-- =====================================================================
-- File 43: PHU HUYNH TU DONG HOC PHI QUA VI (chua tung co - hien tai
-- deduct_wallet_fifo() chi cho phep NHAN VIEN goi, phu huynh khong tu
-- thanh toan duoc qua App) - chay sau file 42
-- =====================================================================
create or replace function pay_invoice_via_wallet(p_invoice_id uuid, p_coin_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
begin
  select student_id into v_student_id from invoices where id = p_invoice_id;
  if v_student_id is null then raise exception 'Không tìm thấy hoá đơn.'; end if;
  if not is_linked_to_student(v_student_id) then
    raise exception 'Bạn không có quyền thanh toán hoá đơn này.';
  end if;

  perform deduct_wallet_fifo(p_invoice_id, p_coin_amount, null);
end;
$func$;

-- deduct_wallet_fifo() hien tai chi cho phep ACC/CENTER_MANAGER/CONSULTANT/
-- exec goi - can mo them cho chinh PHU HUYNH cua hoc sinh do goi qua ham
-- bao boc o tren (pay_invoice_via_wallet). Sua dieu kien kiem tra quyen.
create or replace function deduct_wallet_fifo(p_invoice_id uuid, p_coin_to_deduct numeric, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
  v_wallet_id uuid;
  v_remaining_to_deduct numeric := p_coin_to_deduct;
  v_batch record;
  v_take numeric;
  v_total_vnd numeric := 0;
begin
  select student_id into v_student_id from invoices where id = p_invoice_id;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
    or (p_actor_id is null and is_linked_to_student(v_student_id)) -- phu huynh tu thanh toan qua pay_invoice_via_wallet()
  ) then
    raise exception 'Bạn không có quyền trừ ví cho hoá đơn này.';
  end if;

  select id into v_wallet_id from wallets where student_id = v_student_id;
  if v_wallet_id is null then raise exception 'Học viên chưa có ví.'; end if;

  for v_batch in
    select * from wallet_topup_batches
    where wallet_id = v_wallet_id and coin_remaining > 0
    order by created_at asc
    for update
  loop
    exit when v_remaining_to_deduct <= 0;
    v_take := least(v_batch.coin_remaining, v_remaining_to_deduct);
    update wallet_topup_batches set coin_remaining = coin_remaining - v_take where id = v_batch.id;
    insert into debt_ledger (invoice_id, source, batch_id, amount_coin, amount_vnd, conversion_rate_used)
    values (p_invoice_id, 'WALLET', v_batch.id, v_take, v_take * v_batch.conversion_rate, v_batch.conversion_rate);
    v_total_vnd := v_total_vnd + (v_take * v_batch.conversion_rate);
    v_remaining_to_deduct := v_remaining_to_deduct - v_take;
  end loop;

  if v_remaining_to_deduct > 0 then
    raise exception 'Số dư ví không đủ — còn thiếu % AIScoins.', v_remaining_to_deduct;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, p_invoice_id, p_actor_id, v_wallet_id, v_student_id,
    format('Thanh toán hoá đơn qua ví: %s AIScoins', p_coin_to_deduct));
  perform refresh_invoice_status(p_invoice_id);
end;
$func$;
