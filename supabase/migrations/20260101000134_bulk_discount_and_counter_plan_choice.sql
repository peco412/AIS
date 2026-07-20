-- =====================================================================
-- File 134: CHIẾT KHẤU COMBO/TRỌN CẤP ĐỘ (dữ liệu tĩnh, chỉnh được) +
-- CHO PHÉP NHÂN VIÊN CHỌN HÌNH THỨC TẠI QUẦY (19/07/2026)
-- =====================================================================
-- Theo yêu cầu: "Đóng 2 khoá liền" giảm 10%, "Trọn cấp độ con" giảm 15%
-- — là dữ liệu tĩnh, CHỈNH ĐƯỢC qua giao diện (không hardcode trong code).
--
-- QUYẾT ĐỊNH: tạo bảng MỚI riêng (không dùng lại payment_plan_discounts
-- cũ) — vì payment_plan_discounts vẫn đang được nhiều hàm CŨ khác tham
-- chiếu (create_payment_plan_invoice, unify_auto_discount...) với đúng 3
-- giá trị cũ (sublevel/level/program) — đổi chung 1 bảng có thể làm hỏng
-- các luồng cũ chưa kịp rà hết. Tách bảng riêng cho AN TOÀN, không đụng
-- gì tới bảng cũ.
-- =====================================================================
create table if not exists bulk_payment_discounts (
  plan_type text primary key check (plan_type in ('COMBO_2_COURSES', 'FULL_SUB_LEVEL')),
  discount_rate numeric(5,4) not null default 0 check (discount_rate >= 0 and discount_rate <= 0.9),
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);
insert into bulk_payment_discounts (plan_type, discount_rate) values
  ('COMBO_2_COURSES', 0.10), ('FULL_SUB_LEVEL', 0.15)
on conflict (plan_type) do nothing;

alter table bulk_payment_discounts enable row level security;
create policy bulk_payment_discounts_select on bulk_payment_discounts for select using (true);
create policy bulk_payment_discounts_write on bulk_payment_discounts for all
  using (is_executive_or_tech())
  with check (is_executive_or_tech());

comment on table bulk_payment_discounts is 'Tỷ lệ giảm cho 2 hình thức đóng gộp (Combo 2 khoá / Trọn cấp độ con) — dữ liệu tĩnh, chỉnh được qua trang Database. Xem file 134.';

-- =====================================================================
-- Noi vao ham tinh gia (file 124/127) — ap dung dung ty le giam cho 2
-- hinh thuc gop, doc tu bang tren (khong con hardcode gia goc khong giam
-- nhu truoc).
-- =====================================================================
create or replace function calculate_payment_option_amount_for_course(p_course_id uuid, p_option text)
returns numeric
language plpgsql
stable
as $func$
declare
  v_course record;
  v_next_course_id uuid;
  v_next_price numeric;
  v_result numeric;
  v_bulk_rate numeric;
begin
  select price_vnd, weeks, sublevel_id, display_order into v_course
  from program_courses where id = p_course_id;

  if v_course.price_vnd is null or v_course.price_vnd <= 0 then
    raise exception 'Khoá học chưa cấu hình học phí.';
  end if;

  if p_option = 'BY_COURSE' then
    v_result := v_course.price_vnd;

  elsif p_option = 'BY_MONTH' then
    if v_course.weeks is null or v_course.weeks <= 0 then
      raise exception 'Khoá học chưa cấu hình Số tuần — không tính được giá theo tháng.';
    end if;
    v_result := round(v_course.price_vnd / (v_course.weeks / 4.0));

  elsif p_option = 'COMBO_2_COURSES' then
    v_next_course_id := get_next_course_in_sequence(p_course_id);
    if v_next_course_id is null then
      raise exception 'Đây là khoá cuối cùng của lộ trình — không có khoá liền kề để đóng combo 2 khoá.';
    end if;
    select price_vnd into v_next_price from program_courses where id = v_next_course_id;
    select discount_rate into v_bulk_rate from bulk_payment_discounts where plan_type = 'COMBO_2_COURSES';
    v_result := round((v_course.price_vnd + coalesce(v_next_price, 0)) * (1 - coalesce(v_bulk_rate, 0)));

  elsif p_option = 'FULL_SUB_LEVEL' then
    select coalesce(sum(price_vnd), 0) into v_result
    from program_courses
    where sublevel_id = v_course.sublevel_id and display_order >= v_course.display_order;
    select discount_rate into v_bulk_rate from bulk_payment_discounts where plan_type = 'FULL_SUB_LEVEL';
    v_result := round(v_result * (1 - coalesce(v_bulk_rate, 0)));

  else
    raise exception 'Hình thức đóng học phí không hợp lệ: %', p_option;
  end if;

  return v_result;
end;
$func$;

-- =====================================================================
-- Cho phep NHAN VIEN (khong chi phu huynh) chon ho hinh thuc dong cho 1
-- hoa don nhap — dung khi phu huynh den truc tiep tai quay, nhan vien
-- ho tro chon luon thay vi bat phu huynh tu vao app.
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
    status = 'unpaid'
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$func$;
