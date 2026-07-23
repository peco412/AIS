-- =====================================================================
-- File 141: CHÍNH SÁCH ƯU ĐÃI MỚI — ANH CHỊ EM + THEO TỪNG CHƯƠNG TRÌNH
-- (19/07/2026)
-- =====================================================================
-- Cập nhật lớn theo đúng chính sách mới:
--   1) Ưu đãi anh chị em: Bé thứ 2 giảm 10%, Bé thứ 3 (trở lên) giảm 20%.
--   2) Ưu đãi combo giờ KHÁC NHAU theo từng chương trình — không còn 1
--      mức chung cho "Đóng 2 khoá liền" (10% cũ) / "Trọn cấp độ con" (15%
--      cũ) nữa:
--        - Mầm non/Mẫu giáo/Trẻ em: 2 khoá -5%, 3 khoá -10%
--        - Thiếu nhi: 2 khoá -5%, 4 khoá -10% (KHÔNG có mốc 3 khoá)
--        - Thanh thiếu niên/Học thuật: 2 khoá -5%, 3 khoá -10%
--        - Giao tiếp: đóng trọn 1 khoá (BY_COURSE) -5%, không có combo
--
-- CHƯA LÀM Ở ĐỢT NÀY (cần nói rõ để bạn biết đang thiếu gì): phần "được/
-- không được hưởng ưu đãi chung + được/không được tặng quà" theo từng
-- hình thức (Theo tháng/1 khoá lẻ...) — cụm "Đóng 1/2 khoá" trong yêu
-- cầu chưa rõ nghĩa (mình hỏi lại nhưng chưa nhận được câu trả lời rõ),
-- và hệ thống cũng CHƯA CÓ cơ chế theo dõi "quà tặng" gắn với từng gói
-- (đã nói ở file 137) — 2 phần này cần làm riêng, chưa đụng vào ở đây.
-- Đợt này chỉ tập trung đúng phần TÍNH TIỀN (combo theo chương trình +
-- ưu đãi anh chị em), là phần rõ ràng, không mơ hồ.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — Uu dai anh chi em: xac dinh "con thu may" trong nha (theo
-- thoi diem duoc dang ky vao vi chung — ai vao truoc tinh la con lon
-- hon), roi tra ve % giam tuong ung.
-- =====================================================================
create or replace function get_sibling_discount_rate(p_student_id uuid)
returns numeric
language plpgsql
stable
as $func$
declare
  v_wallet_id uuid;
  v_birth_order int;
begin
  select wallet_id into v_wallet_id from wallet_students where student_id = p_student_id;
  if v_wallet_id is null then return 0; end if;

  select rank into v_birth_order
  from (
    select student_id, row_number() over (order by created_at asc) as rank
    from wallet_students where wallet_id = v_wallet_id
  ) ranked
  where ranked.student_id = p_student_id;

  return case
    when v_birth_order = 2 then 0.10
    when v_birth_order >= 3 then 0.20
    else 0
  end;
end;
$func$;

comment on function get_sibling_discount_rate(uuid) is
  'Bé thứ 2 giảm 10%, bé thứ 3 trở lên giảm 20% — xác định "con thứ mấy" theo thời điểm được ghép vào ví chung. Xem file 141.';

-- =====================================================================
-- PHẦN 2 — Bang uu dai THEO TUNG CHUONG TRINH (thay cho bulk_payment_discounts
-- 1 muc chung cu) — giu lai bulk_payment_discounts CHI cho FULL_SUB_LEVEL
-- (khong doi, van 1 muc chung 15% vi chinh sach moi khong nhac toi).
-- =====================================================================
create table if not exists program_plan_discounts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  plan_type text not null check (plan_type in ('BY_COURSE', 'COMBO_2_COURSES', 'COMBO_3_COURSES', 'COMBO_4_COURSES')),
  discount_rate numeric(5,4) not null default 0 check (discount_rate >= 0 and discount_rate <= 0.9),
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  unique (program_id, plan_type)
);
alter table program_plan_discounts enable row level security;
create policy program_plan_discounts_select on program_plan_discounts for select using (true);
create policy program_plan_discounts_write on program_plan_discounts for all
  using (is_executive_or_tech()) with check (is_executive_or_tech());

comment on table program_plan_discounts is 'Ưu đãi combo/đóng trọn khoá — KHÁC NHAU theo từng chương trình (Mầm non/Thiếu nhi/Thanh thiếu niên/Giao tiếp... có mức khác nhau) — thay cho mức chung cũ. Xem file 141.';

insert into program_plan_discounts (program_id, plan_type, discount_rate)
select p.id, v.plan_type, v.rate
from programs p
cross join (values
  ('COMBO_2_COURSES', 0.05), ('COMBO_3_COURSES', 0.10)
) as v(plan_type, rate)
where p.name in ('Tiếng Anh Mầm non', 'Tiếng Anh Mẫu Giáo', 'Tiếng Anh Trẻ em', 'Tiếng Anh Thanh thiếu niên', 'Tiếng Anh Học thuật')
on conflict (program_id, plan_type) do update set discount_rate = excluded.discount_rate;

insert into program_plan_discounts (program_id, plan_type, discount_rate)
select p.id, v.plan_type, v.rate
from programs p
cross join (values
  ('COMBO_2_COURSES', 0.05), ('COMBO_4_COURSES', 0.10)
) as v(plan_type, rate)
where p.name = 'Tiếng Anh Thiếu Nhi'
on conflict (program_id, plan_type) do update set discount_rate = excluded.discount_rate;

insert into program_plan_discounts (program_id, plan_type, discount_rate)
select p.id, 'BY_COURSE', 0.05
from programs p where p.name = 'Tiếng Anh Giao tiếp'
on conflict (program_id, plan_type) do update set discount_rate = excluded.discount_rate;

-- =====================================================================
-- PHẦN 3 — Tong quat hoa ham tinh gia: ho tro COMBO_N_COURSES bat ky (N
-- lay tu chinh ten plan_type, khong con hardcode dung 1 muc "2 khoa"),
-- doc dung ty le giam THEO CHUONG TRINH tu bang moi, VA nhan them uu dai
-- anh chi em vao cuoi cung.
-- =====================================================================
create or replace function calculate_payment_option_amount_for_course(p_course_id uuid, p_option text)
returns numeric
language plpgsql
stable
as $func$
declare
  v_course record;
  v_program_id uuid;
  v_next_course_id uuid;
  v_next_price numeric;
  v_result numeric;
  v_bulk_rate numeric;
  v_combo_n int;
  v_cursor_course_id uuid;
  v_sum numeric;
  i int;
begin
  select pc.price_vnd, pc.weeks, pc.sublevel_id, pc.display_order, pl.program_id
  into v_course
  from program_courses pc
  join program_sublevels ps on ps.id = pc.sublevel_id
  join program_levels pl on pl.id = ps.level_id
  where pc.id = p_course_id;

  if v_course.price_vnd is null or v_course.price_vnd <= 0 then
    raise exception 'Khoá học chưa cấu hình học phí.';
  end if;
  v_program_id := v_course.program_id;

  if p_option = 'BY_COURSE' then
    select discount_rate into v_bulk_rate from program_plan_discounts where program_id = v_program_id and plan_type = 'BY_COURSE';
    v_result := round(v_course.price_vnd * (1 - coalesce(v_bulk_rate, 0)));

  elsif p_option = 'BY_MONTH' then
    if v_course.weeks is null or v_course.weeks <= 0 then
      raise exception 'Khoá học chưa cấu hình Số tuần — không tính được giá theo tháng.';
    end if;
    v_result := round(v_course.price_vnd / (v_course.weeks / 4.0));

  elsif p_option like 'COMBO\_%\_COURSES' escape '\' then
    v_combo_n := split_part(p_option, '_', 2)::int;
    if v_combo_n < 2 then raise exception 'Hình thức combo không hợp lệ: %', p_option; end if;

    v_sum := v_course.price_vnd;
    v_cursor_course_id := p_course_id;
    for i in 2..v_combo_n loop
      v_cursor_course_id := get_next_course_in_sequence(v_cursor_course_id);
      if v_cursor_course_id is null then
        raise exception 'Không đủ % khoá liền kề trong lộ trình để đóng combo này.', v_combo_n;
      end if;
      select price_vnd into v_next_price from program_courses where id = v_cursor_course_id;
      v_sum := v_sum + coalesce(v_next_price, 0);
    end loop;

    select discount_rate into v_bulk_rate from program_plan_discounts where program_id = v_program_id and plan_type = p_option;
    if v_bulk_rate is null then
      raise exception 'Chương trình này chưa cấu hình ưu đãi cho hình thức %.', p_option;
    end if;
    v_result := round(v_sum * (1 - v_bulk_rate));

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

create or replace function calculate_payment_option_amount(p_student_id uuid, p_option text)
returns numeric
language plpgsql
stable
as $func$
declare
  v_course_id uuid;
  v_base numeric;
begin
  select cl.course_id into v_course_id
  from students s join classes cl on cl.id = s.class_id
  where s.id = p_student_id;

  if v_course_id is null then
    raise exception 'Học sinh chưa được xếp lớp, hoặc lớp chưa gắn Khoá học cụ thể.';
  end if;

  v_base := calculate_payment_option_amount_for_course(v_course_id, p_option);
  return round(v_base * (1 - get_sibling_discount_rate(p_student_id)));
end;
$func$;

create or replace function payment_option_label(p_option text) returns text
language plpgsql immutable
as $lbl$
declare
  v_n int;
begin
  if p_option like 'COMBO\_%\_COURSES' escape '\' then
    v_n := split_part(p_option, '_', 2)::int;
    return format('Đóng %s khoá liền', v_n);
  end if;
  return case p_option
    when 'BY_MONTH' then 'Theo tháng'
    when 'BY_COURSE' then 'Theo khoá hiện tại'
    when 'FULL_SUB_LEVEL' then 'Trọn cấp độ con'
    else p_option
  end;
end;
$lbl$;

-- =====================================================================
-- PHẦN 4 — Ham TRUNG TAM tao danh sach lua chon gia.
-- =====================================================================
create or replace function get_available_payment_options(p_student_id uuid)
returns jsonb
language plpgsql
stable
as $func$
declare
  v_course_id uuid;
  v_program_id uuid;
  v_options jsonb := '[]'::jsonb;
  v_combo record;
  v_amount numeric;
begin
  select cl.course_id into v_course_id from students s join classes cl on cl.id = s.class_id where s.id = p_student_id;
  if v_course_id is null then return '[]'::jsonb; end if;

  select pl.program_id into v_program_id
  from program_courses pc join program_sublevels ps on ps.id = pc.sublevel_id join program_levels pl on pl.id = ps.level_id
  where pc.id = v_course_id;

  begin
    v_amount := calculate_payment_option_amount(p_student_id, 'BY_MONTH');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('BY_MONTH'), 'plan_type', 'BY_MONTH', 'amount_vnd', v_amount));
  exception when others then null;
  end;

  begin
    v_amount := calculate_payment_option_amount(p_student_id, 'BY_COURSE');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('BY_COURSE'), 'plan_type', 'BY_COURSE', 'amount_vnd', v_amount));
  exception when others then null;
  end;

  for v_combo in
    select plan_type from program_plan_discounts
    where program_id = v_program_id and plan_type like 'COMBO\_%\_COURSES' escape '\'
    order by plan_type
  loop
    begin
      v_amount := calculate_payment_option_amount(p_student_id, v_combo.plan_type);
      v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label(v_combo.plan_type), 'plan_type', v_combo.plan_type, 'amount_vnd', v_amount));
    exception when others then null;
    end;
  end loop;

  begin
    v_amount := calculate_payment_option_amount(p_student_id, 'FULL_SUB_LEVEL');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('FULL_SUB_LEVEL'), 'plan_type', 'FULL_SUB_LEVEL', 'amount_vnd', v_amount));
  exception when others then null;
  end;

  return v_options;
end;
$func$;

comment on function get_available_payment_options(uuid) is
  'Trả về đúng danh sách lựa chọn giá (kèm combo đúng theo chương trình của học sinh, đã gồm ưu đãi anh chị em) — dùng chung 1 chỗ này thay vì lặp lại code sinh lựa chọn ở nhiều nơi. Xem file 141.';

-- =====================================================================
-- PHẦN 5 — Mo rong rang buoc chosen_plan_type de nhan them cac gia tri
-- combo moi.
-- =====================================================================
alter table invoices drop constraint if exists invoices_chosen_plan_type_check;
alter table invoices add constraint invoices_chosen_plan_type_check
  check (chosen_plan_type in ('BY_MONTH', 'BY_COURSE', 'COMBO_2_COURSES', 'COMBO_3_COURSES', 'COMBO_4_COURSES', 'FULL_SUB_LEVEL'));

-- =====================================================================
-- PHẦN 6 — Noi lai 3 noi dang tu sinh lua chon hardcode sang dung ham
-- trung tam get_available_payment_options() o tren.
-- =====================================================================
create or replace function auto_create_draft_invoice_on_class_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_options jsonb;
  v_already_has_invoice boolean;
  v_invoice_id uuid;
  v_system_actor_id uuid;
begin
  if tg_op = 'UPDATE' and (old.class_id is not null or new.class_id is null) then
    return new;
  end if;
  if tg_op = 'INSERT' and new.class_id is null then
    return new;
  end if;

  select exists(select 1 from invoices where student_id = new.id and status <> 'void') into v_already_has_invoice;
  if v_already_has_invoice then
    return new;
  end if;

  v_options := get_available_payment_options(new.id);
  if jsonb_array_length(v_options) = 0 then
    return new;
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date, draft_options)
  values (
    new.id, new.class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    (v_options->0->>'amount_vnd')::numeric, (v_options->0->>'amount_vnd')::numeric, 'draft', current_date + 7, v_options
  )
  returning id into v_invoice_id;

  select e.id into v_system_actor_id
  from employees e join system_roles sr on sr.id = e.role_id
  where sr.code in ('EXECUTIVE', 'TECH') and e.status = 'active'
  order by e.created_at asc limit 1;

  insert into notifications (scope, center_id, title, content, link_url, created_by, notification_type)
  select
    'personal', new.center_id,
    format('Bé %s đã được xếp lớp — cần chọn hình thức đóng học phí', new.full_name),
    format('Học sinh %s vừa được xếp vào lớp mới — vui lòng vào Ví AIScoins để chọn hình thức đóng học phí phù hợp.', new.full_name),
    '/edu/wallet-invoices.html', v_system_actor_id, 'system'
  where v_system_actor_id is not null;

  return new;
end;
$func$;

create or replace function transfer_student_class(
  p_student_id uuid, p_new_class_id uuid,
  p_actor_id uuid default null, p_override_sequence boolean default false
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_old_invoice invoices%rowtype;
  v_paid_a numeric := 0;
  v_new_invoice invoices%rowtype;
  v_center_id uuid;
  v_old_course_id uuid;
  v_new_course_id uuid;
  v_is_valid boolean;
  v_can_override boolean;
  v_student_name text;
  v_options jsonb;
  v_system_actor_id uuid;
begin
  p_actor_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code = 'EDU')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền thực hiện đổi lớp.';
  end if;

  v_can_override := is_executive_or_tech() or current_role_code() = 'CENTER_MANAGER';
  select course_id into v_old_course_id from classes where id = (select class_id from students where id = p_student_id);
  select course_id into v_new_course_id from classes where id = p_new_class_id;

  v_is_valid := is_valid_class_progression(v_old_course_id, v_new_course_id);
  if not v_is_valid then
    if p_override_sequence and v_can_override then
      null;
    else
      raise exception 'Lộ trình học không hợp lệ - Vượt cấp bắt buộc.';
    end if;
  end if;

  select * into v_old_invoice from invoices
  where student_id = p_student_id and status <> 'void'
  order by created_at desc limit 1
  for update;

  if v_old_invoice.id is not null then
    select coalesce(sum(amount_vnd), 0) into v_paid_a from debt_ledger where invoice_id = v_old_invoice.id;
    update invoices set status = 'void' where id = v_old_invoice.id;
  end if;

  update students set class_id = p_new_class_id where id = p_student_id;
  select center_id into v_center_id from students where id = p_student_id;

  v_options := get_available_payment_options(p_student_id);
  if jsonb_array_length(v_options) = 0 then
    raise exception 'Lớp mới chưa cấu hình đủ dữ liệu giá — không tạo được hoá đơn. Kiểm tra lại Khoá học/giá của lớp.';
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date, draft_options, carried_over_credit_vnd)
  values (
    p_student_id, p_new_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    (v_options->0->>'amount_vnd')::numeric, (v_options->0->>'amount_vnd')::numeric, 'draft', current_date + 7, v_options, v_paid_a
  )
  returning * into v_new_invoice;

  select full_name into v_student_name from students where id = p_student_id;
  select e.id into v_system_actor_id from employees e join system_roles sr on sr.id = e.role_id
  where sr.code in ('EXECUTIVE', 'TECH') and e.status = 'active' order by e.created_at asc limit 1;

  insert into notifications (scope, center_id, title, content, link_url, created_by, notification_type)
  select
    'personal', v_center_id,
    format('Bé %s đã đổi lớp — cần chọn hình thức đóng học phí', v_student_name),
    case when v_paid_a > 0
      then format('Học sinh %s vừa đổi sang lớp mới — số tiền %s đ đã đóng ở lớp cũ sẽ được cộng bù khi chọn hình thức đóng học phí lớp mới.', v_student_name, to_char(v_paid_a, 'FM999,999,999'))
      else format('Học sinh %s vừa đổi sang lớp mới — vui lòng vào Ví AIScoins để chọn hình thức đóng học phí.', v_student_name)
    end,
    '/edu/wallet-invoices.html', v_system_actor_id, 'system'
  where v_system_actor_id is not null;

  return v_new_invoice;
end;
$func$;

create or replace function scan_low_lesson_balance_and_create_draft_invoices()
returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student record;
  v_options jsonb;
  v_invoice_id uuid;
  v_created_count int := 0;
  v_already_has_draft boolean;
  v_system_actor_id uuid;
begin
  select e.id into v_system_actor_id
  from employees e join system_roles sr on sr.id = e.role_id
  where sr.code in ('EXECUTIVE', 'TECH') and e.status = 'active'
  order by e.created_at asc limit 1;

  for v_student in
    select s.id, s.full_name, s.class_id, s.center_id, s.total_purchased_lessons
    from students s
    where s.total_purchased_lessons <= 4
      and s.class_id is not null
      and s.status = 'studying'
  loop
    select exists(
      select 1 from invoices where student_id = v_student.id and status = 'draft'
    ) into v_already_has_draft;
    if v_already_has_draft then
      continue;
    end if;

    v_options := get_available_payment_options(v_student.id);
    if jsonb_array_length(v_options) = 0 then
      continue;
    end if;

    insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date, draft_options)
    values (
      v_student.id, v_student.class_id, extract(year from current_date)::int, extract(month from current_date)::int,
      (v_options->0->>'amount_vnd')::numeric, (v_options->0->>'amount_vnd')::numeric, 'draft', current_date + 7, v_options
    )
    returning id into v_invoice_id;

    insert into notifications (scope, center_id, title, content, link_url, created_by, notification_type)
    select
      'personal', v_student.center_id,
      format('Bé %s sắp hết buổi học', v_student.full_name),
      format('Học sinh %s chỉ còn %s buổi học trong ví — vui lòng vào Ví AIScoins để chọn hình thức đóng học phí kỳ mới.', v_student.full_name, v_student.total_purchased_lessons),
      '/edu/wallet-invoices.html',
      v_system_actor_id, 'system'
    where v_system_actor_id is not null;

    v_created_count := v_created_count + 1;
  end loop;

  return v_created_count;
end;
$func$;
