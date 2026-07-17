-- =====================================================================
-- File 110: TÁCH RIÊNG "Ưu đãi nạp ví" VÀ "Ưu đãi đóng học phí qua Ví"
-- (17/07/2026) — theo đúng làm rõ của bạn: "Chỉ Nạp ví" / "Cả hai" ở
-- Chương trình ưu đãi KHÔNG phải giảm giá khi NẠP THÊM coin, mà là giảm
-- giá khi PHỤ HUYNH DÙNG VÍ CÓ SẴN ĐỂ ĐÓNG HỌC PHÍ.
--
-- Trước đây get_active_discount_program() bị dùng chung, không phân biệt
-- được đang gọi từ ngữ cảnh nào — calculate_topup_conversion() (tính
-- tỷ giá NẠP VÍ) và apply_program_discount_to_invoice() (áp giảm giá vào
-- HOÁ ĐƠN học phí) đều gọi CHUNG 1 hàm, và hàm đó (từ file 74) lại lọc
-- cứng theo applies_via IN ('wallet','both') — tức applies_via='wallet'
-- trước nay thực chất đang là "ưu đãi khi NẠP VÍ" (đúng lỗi gốc bạn phát
-- hiện), còn applies_via='counter' lại vô tình bị dùng sai chỗ ở hàm áp
-- giảm giá hoá đơn (đáng lẽ hàm đó phải lọc 'counter', không phải
-- 'wallet'). Sửa cả 3 chỗ liên quan, theo đúng nghĩa MỚI:
--   - 'counter' = giảm giá khi đóng học phí TẠI QUẦY (tiền mặt/chuyển khoản) — GIỮ NGUYÊN như cũ.
--   - 'wallet'  = giảm giá khi đóng học phí BẰNG VÍ có sẵn — Ý NGHĨA MỚI, không còn liên quan gì tới lúc NẠP VÍ nữa.
--   - 'both'    = áp cho cả 2 cách đóng học phí trên (KHÔNG áp cho nạp ví).
-- Nạp ví (calculate_topup_conversion) từ nay CHỈ còn tính theo mức nạp
-- (bậc thang cố định) + giảm giá riêng lẻ do Kế toán/Quản lý trung tâm tự
-- gõ tay (case_rate) — không còn cộng thêm % của bất kỳ "Chương trình ưu
-- đãi" nào cấu hình ở trang Kế toán nữa.
-- =====================================================================

-- Bắt buộc mọi nơi gọi phải nói rõ đang cần ưu đãi cho bối cảnh nào
-- ('counter' hoặc 'wallet') — không còn hàm 1 tham số mơ hồ như trước,
-- tránh lặp lại đúng lỗi đã xảy ra.
drop function if exists get_active_discount_program(uuid);

create or replace function get_active_discount_program(p_center_id uuid, p_applies_via text)
returns discount_programs
language sql stable
as $$
  select * from discount_programs
  where status = 'active'
    and valid_range @> now()
    and (applies_via = 'both' or applies_via = p_applies_via)
    and (scope = 'system' or center_id = p_center_id)
  order by (scope = 'system') desc
  limit 1;
$$;

-- =====================================================================
-- Nạp ví: bỏ hẳn phần cộng thêm % của "Chương trình ưu đãi" — chỉ còn
-- bậc thang theo số tiền nạp + % Kế toán/Quản lý trung tâm tự gõ riêng
-- cho từng trường hợp (case_rate, không đổi).
-- =====================================================================
create or replace function calculate_topup_conversion(
  p_coin_amount numeric, p_center_id uuid, p_case_discount_rate numeric default 0
) returns table (
  discount_rate numeric,
  conversion_rate numeric,
  program_id uuid,
  tier_rate numeric,
  program_rate numeric,
  program_name text,
  case_rate numeric
)
language plpgsql stable
as $func$
declare
  v_default_rate numeric;
  v_final_rate numeric;
begin
  v_default_rate := get_default_discount_rate(p_coin_amount);
  v_final_rate := least(v_default_rate + coalesce(p_case_discount_rate, 0), 0.40);

  return query select
    v_final_rate, (1 - v_final_rate), null::uuid,
    v_default_rate, 0::numeric, null::text,
    coalesce(p_case_discount_rate, 0);
end;
$func$;

-- =====================================================================
-- Áp ưu đãi vào hoá đơn học phí (nút tay của Kế toán/Quản lý trung tâm ở
-- trang Thu học phí) — SỬA LỖI: trước đây vô tình lọc theo 'wallet' dù
-- đang áp vào HOÁ ĐƠN, giờ lọc đúng 'counter'.
-- =====================================================================
create or replace function apply_program_discount_to_invoice(p_invoice_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_center_id uuid;
  v_program discount_programs;
  v_discount_vnd numeric;
begin
  p_approver_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen dieu chinh hoa don nay.';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  select center_id into v_center_id from students where id = v_invoice.student_id;
  select * into v_program from get_active_discount_program(v_center_id, 'counter');

  if v_program.id is null then
    raise exception 'Hien khong co chuong trinh uu dai nao dang hoat dong cho trung tam nay.';
  end if;

  v_discount_vnd := least(v_invoice.amount_vnd * v_program.discount_rate, v_invoice.amount_vnd);

  update invoices set
    manual_discount_vnd = v_discount_vnd,
    manual_discount_reason = format('Ap dung uu dai chuong trinh "%s" (%s%%)', v_program.name, v_program.discount_rate * 100),
    discount_type = 'program'
  where id = p_invoice_id;

  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

-- =====================================================================
-- 🆕 Đóng học phí BẰNG VÍ: đây là nơi DUY NHẤT áp ưu đãi applies_via =
-- 'wallet'/'both' từ nay — mỗi đồng coin trừ ra được TÍNH VÀO HOÁ ĐƠN
-- nhiều hơn giá trị mặt của nó đúng theo % ưu đãi, ngay tại lúc thanh
-- toán (không sửa tổng giá hoá đơn, tránh xung đột nếu 1 hoá đơn được
-- đóng nhiều đợt/nhiều cách khác nhau — ví dụ đóng 1 phần bằng ví, 1
-- phần tiền mặt tại quầy: phần ví được tính ưu đãi, phần tiền mặt thì
-- theo đúng giảm giá tại quầy nếu có, không trộn lẫn 2 loại).
-- Dùng chung cho cả nhân viên bấm hộ VÀ phụ huynh tự thanh toán qua App
-- (pay_invoice_via_wallet gọi lại đúng hàm này).
-- =====================================================================
create or replace function deduct_wallet_fifo(p_invoice_id uuid, p_coin_to_deduct numeric, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
  v_center_id uuid;
  v_wallet_id uuid;
  v_remaining_to_deduct numeric := p_coin_to_deduct;
  v_batch record;
  v_take numeric;
  v_total_vnd numeric := 0;
  v_program discount_programs;
  v_boost numeric := 1;
begin
  p_actor_id := current_employee_id();

  select student_id into v_student_id from invoices where id = p_invoice_id;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
    or (p_actor_id is null and is_linked_to_student(v_student_id))
  ) then
    raise exception 'Bạn không có quyền trừ ví cho hoá đơn này.';
  end if;

  v_wallet_id := get_wallet_id_for_student(v_student_id);
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
