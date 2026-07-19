-- =====================================================================
-- File 121: SỬA LỖI THẬT — "Tạo hoá đơn" báo lỗi 400 khi có ưu đãi đang
-- áp dụng (19/07/2026)
-- =====================================================================
-- LỖI: bấm "Tạo hoá đơn" (Theo khoá lẻ) báo "new row for relation
-- 'invoices' violates check constraint 'invoices_discount_type_check'".
--
-- NGUYÊN NHÂN: hàm create_single_course_invoice() (file 94) ghi giá trị
-- 'course' vào cột invoices.discount_type khi có ưu đãi hệ thống hoặc ưu
-- đãi tay đang áp dụng — nhưng cột này CHỈ CHO PHÉP 4 giá trị:
-- ('none', 'case', 'program', 'special') — 'course' KHÔNG NẰM TRONG DANH
-- SÁCH NÀY, insert luôn thất bại.
--
-- Đây là lỗi gõ nhầm rất dễ hiểu: hệ thống CŨNG có 1 khái niệm khác tên
-- là "applies_to" trên bảng discount_programs, CÓ giá trị 'course' hợp
-- lệ (mô tả PHẠM VI 1 chương trình ưu đãi áp dụng — theo khoá/cấp độ/
-- chương trình) — nhưng đó là cột HOÀN TOÀN KHÁC, khác bảng, khác ý
-- nghĩa (discount_type mô tả CÁCH 1 hoá đơn CỤ THỂ được giảm giá, không
-- phải phạm vi chương trình). Người viết code trước đây nhầm lẫn giữa 2
-- khái niệm giống tên nhưng khác chỗ này.
--
-- HẬU QUẢ: mọi hoá đơn "Theo khoá lẻ" tạo cho học sinh thuộc lớp/trung
-- tâm ĐANG CÓ ưu đãi hệ thống áp dụng (hoặc có gõ % ưu đãi tay) đều KHÔNG
-- TẠO ĐƯỢC — chỉ những trường hợp hoàn toàn không có ưu đãi nào mới tạo
-- thành công, nên lỗi này có thể đã âm thầm chặn kha khá trường hợp thật.
--
-- SỬA: đổi đúng 1 chữ 'course' -> 'case' cho khớp với check constraint.
-- =====================================================================
create or replace function create_single_course_invoice(
  p_student_id uuid, p_course_id uuid,
  p_manual_discount_rate numeric default 0, p_special_category text default null
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_plan_discount_rate numeric;
  v_auto_discount_rate numeric := 0;
  v_class_id uuid;
  v_center_id uuid;
  v_base_price numeric;
  v_final_price numeric;
  v_due_date date;
  v_manual_rate numeric;
  v_result invoices;
  v_existing_invoice_id uuid;
  v_student_name text;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tao hoa don.';
  end if;

  select id into v_existing_invoice_id from invoices
  where student_id = p_student_id
    and period_year = extract(year from current_date)::int
    and period_month = extract(month from current_date)::int;
  if v_existing_invoice_id is not null then
    select full_name into v_student_name from students where id = p_student_id;
    raise exception 'Học sinh "%" đã có hoá đơn cho tháng %/% rồi (mã hoá đơn: %).',
      coalesce(v_student_name, '—'), extract(month from current_date)::int, extract(year from current_date)::int, v_existing_invoice_id;
  end if;

  v_manual_rate := greatest(least(coalesce(p_manual_discount_rate, 0), 1), 0);

  select class_id, center_id into v_class_id, v_center_id from students where id = p_student_id;
  if v_class_id is not null then
    v_auto_discount_rate := get_auto_discount_for_class(v_class_id, v_center_id);
  end if;

  select price_vnd into v_base_price from program_courses where id = p_course_id;
  if v_base_price is null or v_base_price <= 0 then
    raise exception 'Chưa cấu hình học phí cho khoá này.';
  end if;

  v_final_price := v_base_price * (1 - least(v_auto_discount_rate + v_manual_rate, 1));

  select end_date into v_due_date from classes where id = v_class_id;
  if v_due_date is null then
    v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  end if;

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason, special_category)
  values (
    p_student_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when p_special_category is not null then 'special' when v_auto_discount_rate > 0 or v_manual_rate > 0 then 'case' else 'none' end,
    v_base_price - v_final_price,
    format('Theo khoá lẻ — Hệ thống %s%% + Tay %s%%', round(v_auto_discount_rate*100,1), round(v_manual_rate*100,1)),
    p_special_category
  )
  returning * into v_result;

  return v_result;
end;
$func$;
