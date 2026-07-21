-- =====================================================================
-- File 137: HOÀN PHÍ CHO "ĐÓNG 2 KHOÁ LIỀN" / "TRỌN CẤP ĐỘ CON" + BẮT
-- BUỘC ĐÓNG ĐỦ (19/07/2026)
-- =====================================================================
-- Theo đúng yêu cầu:
--   1) Bắt buộc đóng ĐỦ (không công nợ) khi chọn 2 hình thức "gộp"
--      (COMBO_2_COURSES/FULL_SUB_LEVEL) — vì đây là 2 hình thức có chiết
--      khấu, không hợp lý để cho nợ 1 phần rồi vẫn hưởng giá đã giảm.
--   2) Công thức hoàn phí: Số tiền hoàn = Tổng tiền thực đóng - (Giá lẻ 1
--      khoá x Số khoá đã học) - Giá trị quà tặng đã dùng — chống trục lợi
--      đóng gộp lấy giá rẻ rồi học 1 khoá là nghỉ.
--   3) Hoàn được cả 3 kênh: Ví AIScoins / Tiền mặt / Chuyển khoản (trước
--      đây cơ chế hoàn phí CŨ — dành cho hệ thống payment_plan cũ, khác
--      bảng — chỉ hoàn được tiền mặt).
--
-- LƯU Ý QUAN TRỌNG cần bạn biết: "Số khoá đã học" và "Giá trị quà tặng đã
-- dùng" là 2 SỐ NHÂN VIÊN KẾ TOÁN TỰ NHẬP TAY khi xử lý hoàn phí — hệ
-- thống KHÔNG tự đếm 2 số này (chưa có cơ chế theo dõi quà tặng khuyến
-- mãi gắn với từng gói, và số khoá "hoàn thành" cần xét nghỉ có phép/học
-- dở dang — nên để đúng người xử lý hoàn phí quyết định, đúng như cơ chế
-- hoàn phí cũ trong hệ thống cũng làm vậy). Hệ thống chỉ đảm nhiệm đúng
-- phần TÍNH TOÁN CHÍNH XÁC theo công thức + ghi sổ, không tự suy đoán.
-- =====================================================================
alter table invoices add column if not exists chosen_plan_type text
  check (chosen_plan_type in ('BY_MONTH', 'BY_COURSE', 'COMBO_2_COURSES', 'FULL_SUB_LEVEL'));
comment on column invoices.chosen_plan_type is 'Hình thức đóng học phí đã chọn cho hoá đơn này (1 trong 4 công thức file 124) — dùng để bắt buộc đóng đủ + tính hoàn phí cho COMBO_2_COURSES/FULL_SUB_LEVEL. Xem file 137.';

-- =====================================================================
-- PHẦN 1 — Ghi lai chosen_plan_type dung luc chon hinh thuc (ca 2 duong:
-- hoa don nhap do phu huynh/nhan vien chon, va hoa don tao thu cong).
-- =====================================================================
create or replace function choose_draft_invoice_plan(p_invoice_id uuid, p_plan_type text)
returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_chosen_option jsonb;
  v_chosen_amount numeric;
  v_applied numeric;
  v_excess numeric;
  v_wallet_id uuid;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'Không tìm thấy hoá đơn.';
  end if;

  if not (
    is_linked_to_student(v_invoice.student_id)
    or current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền thao tác với hoá đơn này.';
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'Hoá đơn này không còn ở trạng thái chờ chọn hình thức đóng.';
  end if;

  select opt into v_chosen_option
  from jsonb_array_elements(coalesce(v_invoice.draft_options, '[]'::jsonb)) opt
  where opt->>'plan_type' = p_plan_type
  limit 1;

  if v_chosen_option is null then
    raise exception 'Hình thức đóng học phí này không có trong danh sách lựa chọn của hoá đơn.';
  end if;

  v_chosen_amount := (v_chosen_option->>'amount_vnd')::numeric;

  update invoices set
    amount_vnd = v_chosen_amount,
    manual_discount_vnd = 0,
    discount_type = 'none',
    chosen_plan_type = p_plan_type,
    status = 'unpaid'
  where id = p_invoice_id
  returning * into v_invoice;

  if coalesce(v_invoice.carried_over_credit_vnd, 0) > 0 then
    v_applied := least(v_invoice.carried_over_credit_vnd, v_chosen_amount);
    v_excess := greatest(v_invoice.carried_over_credit_vnd - v_chosen_amount, 0);

    if v_applied > 0 then
      insert into debt_ledger (invoice_id, source, amount_vnd) values (p_invoice_id, 'CLASS_TRANSFER', v_applied);
    end if;
    if v_excess > 0 then
      v_wallet_id := get_or_create_family_wallet(v_invoice.student_id);
      insert into wallet_topup_batches (wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate, amount_vnd_paid, method, created_by)
      values (v_wallet_id, v_excess, v_excess, 0, 1.0, v_excess, 'class_transfer_credit', current_employee_id());
    end if;

    update invoices set carried_over_credit_vnd = 0 where id = p_invoice_id;
    perform refresh_invoice_status(p_invoice_id);
    select * into v_invoice from invoices where id = p_invoice_id;
  end if;

  return v_invoice;
end;
$func$;

create or replace function create_invoice_for_payment_option(
  p_student_id uuid, p_option text,
  p_manual_discount_rate numeric default 0, p_special_category text default null
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_base_price numeric;
  v_manual_rate numeric;
  v_final_price numeric;
  v_class_id uuid;
  v_center_id uuid;
  v_due_date date;
  v_result invoices;
  v_existing_invoice_id uuid;
  v_student_name text;
  v_auto_program record;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền tạo hoá đơn.';
  end if;

  select id into v_existing_invoice_id from invoices
  where student_id = p_student_id and status <> 'void'
    and period_year = extract(year from current_date)::int
    and period_month = extract(month from current_date)::int;
  if v_existing_invoice_id is not null then
    select full_name into v_student_name from students where id = p_student_id;
    raise exception 'Học sinh "%" đã có hoá đơn cho tháng %/% rồi (mã hoá đơn: %).',
      coalesce(v_student_name, '—'), extract(month from current_date)::int, extract(year from current_date)::int, v_existing_invoice_id;
  end if;

  select class_id, center_id into v_class_id, v_center_id from students where id = p_student_id;
  select * into v_auto_program from get_auto_discount_program_for_class(v_class_id, v_center_id);

  v_manual_rate := greatest(least(coalesce(p_manual_discount_rate, 0), 1), 0);
  v_base_price := calculate_payment_option_amount(p_student_id, p_option);
  v_final_price := v_base_price * (1 - v_manual_rate) * (1 - coalesce(v_auto_program.discount_rate, 0));

  select end_date into v_due_date from classes where id = v_class_id;
  if v_due_date is null then
    v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason, special_category, applied_discount_program_id, chosen_plan_type)
  values (
    p_student_id, v_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when p_special_category is not null then 'special' when v_auto_program.program_id is not null then 'program' when v_manual_rate > 0 then 'case' else 'none' end,
    v_base_price - v_final_price,
    case when v_auto_program.program_id is not null
      then format('%s — %s (-%s%%)%s', payment_option_label(p_option), v_auto_program.program_name, round(v_auto_program.discount_rate*100,1),
        case when v_manual_rate > 0 then format(' + Tay %s%%', round(v_manual_rate*100,1)) else '' end)
      else format('%s — Ưu đãi tay %s%%', payment_option_label(p_option), round(v_manual_rate*100,1))
    end,
    p_special_category, v_auto_program.program_id, p_option
  )
  returning * into v_result;

  return v_result;
end;
$func$;

-- =====================================================================
-- PHẦN 2 — Bat buoc dong DU khi chosen_plan_type la 1 trong 2 hinh thuc
-- gop (COMBO_2_COURSES/FULL_SUB_LEVEL) — khong cho dong 1 phan.
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

  -- MOI — 2 hinh thuc gop bat buoc dong DU, khong cho dong 1 phan (tranh
  -- huong gia da giam ma khong tra du tien).
  if v_invoice.chosen_plan_type in ('COMBO_2_COURSES', 'FULL_SUB_LEVEL') then
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

  -- MOI — dung dieu kien bat buoc dong DU nhu record_counter_payment.
  if v_invoice.chosen_plan_type in ('COMBO_2_COURSES', 'FULL_SUB_LEVEL') then
    select coalesce(sum(amount_vnd), 0) into v_already_paid from debt_ledger where invoice_id = p_invoice_id;
    v_net_owed := v_invoice.amount_vnd - coalesce(v_invoice.manual_discount_vnd, 0);
    -- Uoc luong so VND tuong ung so coin dinh tru (chua tinh boost) de
    -- kiem tra truoc — se kiem tra chinh xac lai sau khi tinh xong.
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

-- =====================================================================
-- PHẦN 3 — Hoan phi cho 2 hinh thuc gop, dung cong thuc moi, hoan duoc
-- ca 3 kenh (Vi/Tien mat/Chuyen khoan).
-- =====================================================================
create or replace function calculate_bulk_plan_refund(p_invoice_id uuid, p_courses_completed int, p_gift_value_used numeric default 0)
returns numeric
language plpgsql
stable
as $func$
declare
  v_invoice invoices%rowtype;
  v_total_paid numeric;
  v_per_course_price numeric;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if v_invoice.id is null then raise exception 'Không tìm thấy hoá đơn.'; end if;
  if v_invoice.chosen_plan_type not in ('COMBO_2_COURSES', 'FULL_SUB_LEVEL') then
    raise exception 'Chỉ hoàn phí kiểu này cho hoá đơn "Đóng 2 khoá liền"/"Trọn cấp độ con".';
  end if;
  if p_courses_completed < 0 then
    raise exception 'Số khoá đã học không hợp lệ.';
  end if;

  select coalesce(sum(amount_vnd), 0) into v_total_paid from debt_ledger where invoice_id = p_invoice_id;
  -- "Gia le 1 khoa" = gia THEO KHOA (khong giam) cua khoa hoc sinh dang
  -- hoc — dung lam muc gia doi chieu cho tung khoa da hoc thuc te.
  v_per_course_price := calculate_payment_option_amount(v_invoice.student_id, 'BY_COURSE');

  return greatest(v_total_paid - (p_courses_completed * v_per_course_price) - coalesce(p_gift_value_used, 0), 0);
end;
$func$;

create or replace function process_bulk_plan_refund(
  p_invoice_id uuid, p_courses_completed int, p_gift_value_used numeric,
  p_refund_method text, p_note text default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_actor_id uuid;
  v_refund numeric;
  v_wallet_id uuid;
begin
  v_actor_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được xử lý hoàn phí.';
  end if;

  if p_refund_method not in ('WALLET', 'CASH', 'BANK_TRANSFER') then
    raise exception 'Hình thức hoàn phí không hợp lệ.';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  if v_invoice.status <> 'paid' then
    raise exception 'Chỉ hoàn phí được cho hoá đơn đã đóng đủ.';
  end if;

  v_refund := calculate_bulk_plan_refund(p_invoice_id, p_courses_completed, p_gift_value_used);

  if p_refund_method = 'WALLET' then
    v_wallet_id := get_or_create_family_wallet(v_invoice.student_id);
    insert into wallet_topup_batches (wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate, amount_vnd_paid, method, created_by)
    values (v_wallet_id, v_refund, v_refund, 0, 1.0, v_refund, 'class_transfer_credit', v_actor_id);
  end if;

  -- Ghi so am (hoan tien) theo dung kenh da chon — CASH/BANK_TRANSFER
  -- ghi truc tiep so am; WALLET van ghi 1 dong -v_refund de theo doi
  -- dong tien ra, du tien da chuyen thanh coin trong vi o tren.
  perform append_financial_log(p_refund_method, -v_refund, p_invoice_id, v_actor_id, v_wallet_id, v_invoice.student_id,
    format('Hoàn phí "%s" — đã học %s khoá, quà tặng đã dùng %s đ.%s',
      payment_option_label(v_invoice.chosen_plan_type), p_courses_completed, coalesce(p_gift_value_used,0),
      case when p_note is not null then ' Ghi chú: ' || p_note else '' end));

  update invoices set status = 'void' where id = p_invoice_id;

  return v_refund;
end;
$func$;

comment on function process_bulk_plan_refund(uuid, int, numeric, text, text) is
  'Hoàn phí cho hoá đơn "Đóng 2 khoá liền"/"Trọn cấp độ con" — công thức: Tổng đã đóng - (Giá lẻ 1 khoá x Số khoá đã học) - Giá trị quà tặng đã dùng. Hoàn được cả Ví/Tiền mặt/Chuyển khoản. Xem file 137.';
