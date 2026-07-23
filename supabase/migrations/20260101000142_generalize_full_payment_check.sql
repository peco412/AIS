-- =====================================================================
-- File 142: MỞ RỘNG KIỂM TRA "BẮT BUỘC ĐÓNG ĐỦ" CHO MỌI COMBO (19/07/2026)
-- =====================================================================
-- File 141 thêm COMBO_3_COURSES/COMBO_4_COURSES (tuỳ chương trình) —
-- nhưng file 137 (quy tắc "bắt buộc đóng đủ") vẫn chỉ đang kiểm tra CỨNG
-- đúng 2 giá trị cũ (COMBO_2_COURSES/FULL_SUB_LEVEL) — nối lại cho đúng:
-- MỌI hình thức combo (bất kể 2/3/4 khoá) đều là gói gộp có chiết khấu,
-- đều cần bắt buộc đóng đủ như nhau.
-- =====================================================================
create or replace function record_counter_payment(
  p_invoice_id uuid, p_source text, p_amount_vnd numeric, p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
  v_invoice invoices%rowtype;
  v_already_paid numeric;
  v_net_owed numeric;
begin
  p_actor_id := current_employee_id();

  if p_source not in ('CASH', 'BANK_TRANSFER') then
    raise exception 'record_counter_payment chi dung cho CASH hoac BANK_TRANSFER.';
  end if;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen ghi nhan thu tien tai quay.';
  end if;

  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'So tien thu phai lon hon 0.';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id;
  v_student_id := v_invoice.student_id;

  -- SUA: kiem tra CHUNG cho moi combo (2/3/4 khoa), khong chi rieng
  -- COMBO_2_COURSES nua.
  if v_invoice.chosen_plan_type = 'FULL_SUB_LEVEL' or v_invoice.chosen_plan_type like 'COMBO\_%\_COURSES' escape '\' then
    select coalesce(sum(amount_vnd), 0) into v_already_paid from debt_ledger where invoice_id = p_invoice_id;
    v_net_owed := v_invoice.amount_vnd - coalesce(v_invoice.manual_discount_vnd, 0);
    if v_already_paid + p_amount_vnd < v_net_owed then
      raise exception 'Hình thức "%" bắt buộc đóng đủ 1 lần, không được đóng từng phần — còn thiếu % đ để đóng đủ.',
        payment_option_label(v_invoice.chosen_plan_type), v_net_owed - v_already_paid;
    end if;
  end if;

  insert into debt_ledger (invoice_id, source, amount_vnd) values (p_invoice_id, p_source, p_amount_vnd);
  perform append_financial_log(p_source, p_amount_vnd, p_invoice_id, p_actor_id, null, v_student_id, 'Thu hoc phi tai quay');
  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

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
  v_center_id uuid;
  v_program record;
  v_boost numeric := 1;
  v_invoice invoices%rowtype;
  v_already_paid numeric;
  v_net_owed numeric;
begin
  p_actor_id := current_employee_id();

  select * into v_invoice from invoices where id = p_invoice_id;
  v_student_id := v_invoice.student_id;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
    or (p_actor_id is null and is_linked_to_student(v_student_id))
  ) then
    raise exception 'Bạn không có quyền trừ ví cho hoá đơn này.';
  end if;

  -- SUA: kiem tra CHUNG cho moi combo, giong record_counter_payment.
  if v_invoice.chosen_plan_type = 'FULL_SUB_LEVEL' or v_invoice.chosen_plan_type like 'COMBO\_%\_COURSES' escape '\' then
    select coalesce(sum(amount_vnd), 0) into v_already_paid from debt_ledger where invoice_id = p_invoice_id;
    v_net_owed := v_invoice.amount_vnd - coalesce(v_invoice.manual_discount_vnd, 0);
    if v_already_paid < v_net_owed and p_coin_to_deduct < (v_net_owed - v_already_paid) then
      raise exception 'Hình thức "%" bắt buộc đóng đủ 1 lần, không được đóng từng phần.', payment_option_label(v_invoice.chosen_plan_type);
    end if;
  end if;

  v_wallet_id := get_or_create_family_wallet(v_student_id);
  if v_wallet_id is null then raise exception 'Học viên chưa có ví.'; end if;

  select center_id into v_center_id from students where id = v_student_id;
  select * into v_program from get_active_discount_program(v_center_id, 'wallet');
  if v_program.id is not null and v_program.discount_rate > 0 and v_program.discount_rate < 1 then
    v_boost := 1 / (1 - v_program.discount_rate);
  end if;

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
    values (p_invoice_id, 'WALLET', v_batch.id, v_take, round(v_take * v_batch.conversion_rate * v_boost), v_batch.conversion_rate);
    v_total_vnd := v_total_vnd + round(v_take * v_batch.conversion_rate * v_boost);
    v_remaining_to_deduct := v_remaining_to_deduct - v_take;
  end loop;

  if v_remaining_to_deduct > 0 then
    raise exception 'Số dư ví không đủ — còn thiếu % AIScoins.', v_remaining_to_deduct;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, p_invoice_id, p_actor_id, v_wallet_id, v_student_id,
    format('Thanh toán hoá đơn qua ví: %s AIScoins%s', p_coin_to_deduct,
      case when v_program.id is not null and v_program.discount_rate > 0
        then format(' (ưu đãi đóng học phí qua Ví %s%% — %s)', round(v_program.discount_rate * 100, 1), v_program.name)
        else '' end));
  perform refresh_invoice_status(p_invoice_id);
end;
$func$;
