-- =====================================================================
-- File 124: 4 CÔNG THỨC LỰA CHỌN THANH TOÁN MỚI — THAY THẾ HẲN 3 LỰA
-- CHỌN CŨ (19/07/2026)
-- =====================================================================
-- GIAI ĐOẠN 2 của "big update" (sau file 122/123 — sơ đồ dữ liệu Trình
-- tự chương trình + trạng thái VOID). Theo đúng bạn xác nhận: 4 công thức
-- mới này THAY THẾ HẲN 3 lựa chọn cũ (dựa theo payment_plan_discounts),
-- không chạy song song.
--
-- GIẢ ĐỊNH CẦN BẠN XÁC NHẬN: "Theo tháng" cần biết 1 khoá học kéo dài bao
-- nhiêu tháng — hệ thống hiện có sẵn "Số tuần" (thêm ở đợt Ví buổi học),
-- CHƯA có cột "Số tháng" riêng. Mình quy đổi tạm 4 tuần = 1 tháng (quy ước
-- phổ biến cho lịch học cố định hàng tuần). Nếu trung tâm dùng quy ước
-- khác (vd tháng dương lịch thật ~4.33 tuần), báo lại để đổi hằng số này
-- — chỉ sửa đúng 1 chỗ.
-- =====================================================================

-- =====================================================================
-- Hàm phụ — tìm "khoá học liền kề tiếp theo" trong LỘ TRÌNH TỰ NHIÊN:
-- trước tiên tìm trong cùng Cấp độ con; hết thì sang Cấp độ con tiếp theo
-- (lấy khoá đầu tiên); hết thì sang Cấp độ tiếp theo (lấy khoá đầu tiên
-- của cấp độ con đầu tiên) — đều trong cùng 1 Chương trình. Dùng cho công
-- thức "Đóng 2 khoá liền".
-- =====================================================================
create or replace function get_next_course_in_sequence(p_course_id uuid)
returns uuid
language plpgsql
stable
as $func$
declare
  v_course record;
  v_next_course_id uuid;
begin
  select pc.display_order as course_order, pc.sublevel_id,
         ps.display_order as sublevel_order, ps.level_id,
         pl.display_order as level_order, pl.program_id
  into v_course
  from program_courses pc
  join program_sublevels ps on ps.id = pc.sublevel_id
  join program_levels pl on pl.id = ps.level_id
  where pc.id = p_course_id;

  if v_course is null then
    return null;
  end if;

  -- 1) Khoa tiep theo trong CUNG cap do con
  select id into v_next_course_id from program_courses
  where sublevel_id = v_course.sublevel_id and display_order > v_course.course_order
  order by display_order asc limit 1;
  if v_next_course_id is not null then return v_next_course_id; end if;

  -- 2) Cap do con TIEP THEO trong cung Cap do — lay khoa DAU TIEN
  select pc2.id into v_next_course_id
  from program_sublevels ps2
  join program_courses pc2 on pc2.sublevel_id = ps2.id
  where ps2.level_id = v_course.level_id and ps2.display_order > v_course.sublevel_order
  order by ps2.display_order asc, pc2.display_order asc limit 1;
  if v_next_course_id is not null then return v_next_course_id; end if;

  -- 3) Cap do TIEP THEO trong cung Chuong trinh — lay khoa DAU TIEN cua
  -- cap do con dau tien. Neu day la khoa cuoi cung cua ca chuong trinh,
  -- ket qua se la NULL — ham goi no phai tu xu ly (bao loi/canh bao).
  select pc3.id into v_next_course_id
  from program_levels pl2
  join program_sublevels ps3 on ps3.level_id = pl2.id
  join program_courses pc3 on pc3.sublevel_id = ps3.id
  where pl2.program_id = v_course.program_id and pl2.display_order > v_course.level_order
  order by pl2.display_order asc, ps3.display_order asc, pc3.display_order asc limit 1;

  return v_next_course_id;
end;
$func$;

-- =====================================================================
-- Hàm chính — tính số tiền hoá đơn theo 1 trong 4 hình thức, dựa trên
-- Khoá học học sinh ĐANG học (qua lớp hiện tại). Dùng STABLE (không ghi
-- gì) để có thể gọi xem trước giá bất kỳ lúc nào, không chỉ lúc tạo hoá
-- đơn thật.
-- =====================================================================
create or replace function calculate_payment_option_amount(p_student_id uuid, p_option text)
returns numeric
language plpgsql
stable
as $func$
declare
  v_course_id uuid;
  v_course record;
  v_next_course_id uuid;
  v_next_price numeric;
  v_result numeric;
begin
  select cl.course_id into v_course_id
  from students s join classes cl on cl.id = s.class_id
  where s.id = p_student_id;

  if v_course_id is null then
    raise exception 'Học sinh chưa được xếp lớp, hoặc lớp chưa gắn Khoá học cụ thể.';
  end if;

  select price_vnd, weeks, sublevel_id, display_order into v_course
  from program_courses where id = v_course_id;

  if v_course.price_vnd is null or v_course.price_vnd <= 0 then
    raise exception 'Khoá học hiện tại chưa cấu hình học phí.';
  end if;

  if p_option = 'BY_COURSE' then
    v_result := v_course.price_vnd;

  elsif p_option = 'BY_MONTH' then
    if v_course.weeks is null or v_course.weeks <= 0 then
      raise exception 'Khoá học chưa cấu hình Số tuần — không tính được giá theo tháng (vào trang Chương trình & Bảng giá khoá học để điền).';
    end if;
    v_result := round(v_course.price_vnd / (v_course.weeks / 4.0));

  elsif p_option = 'COMBO_2_COURSES' then
    v_next_course_id := get_next_course_in_sequence(v_course_id);
    if v_next_course_id is null then
      raise exception 'Khoá hiện tại là khoá cuối cùng của lộ trình — không có khoá liền kề để đóng combo 2 khoá.';
    end if;
    select price_vnd into v_next_price from program_courses where id = v_next_course_id;
    v_result := v_course.price_vnd + coalesce(v_next_price, 0);

  elsif p_option = 'FULL_SUB_LEVEL' then
    select coalesce(sum(price_vnd), 0) into v_result
    from program_courses
    where sublevel_id = v_course.sublevel_id and display_order >= v_course.display_order;

  else
    raise exception 'Hình thức đóng học phí không hợp lệ: %', p_option;
  end if;

  return v_result;
end;
$func$;

comment on function calculate_payment_option_amount(uuid, text) is 'Tính giá hoá đơn theo 1 trong 4 hình thức: BY_MONTH/BY_COURSE/COMBO_2_COURSES/FULL_SUB_LEVEL — thay thế hẳn hệ 3 lựa chọn cũ (payment_plan_discounts). Xem file 124.';

-- =====================================================================
-- Nối vào cron quét đã xây (file 115) — đổi từ 3 lựa chọn cũ sang đúng 4
-- lựa chọn mới, dùng lại toàn bộ phần quét/tạo hoá đơn nháp/gửi thông báo
-- đã có, chỉ thay phần TÍNH GIÁ.
-- =====================================================================
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
  v_amount numeric;
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

    v_options := '[]'::jsonb;

    -- Moi lua chon co the that bai rieng le (vd chua cau hinh so tuan
    -- cho BY_MONTH, hoac dang o khoa cuoi cho COMBO_2) — bo qua lua chon
    -- loi, KHONG lam hong ca hoa don, chi thieu 1 lua chon trong 4.
    begin
      v_amount := calculate_payment_option_amount(v_student.id, 'BY_MONTH');
      v_options := v_options || jsonb_build_array(jsonb_build_object('label', 'Theo tháng', 'plan_type', 'BY_MONTH', 'amount_vnd', v_amount));
    exception when others then null;
    end;

    begin
      v_amount := calculate_payment_option_amount(v_student.id, 'BY_COURSE');
      v_options := v_options || jsonb_build_array(jsonb_build_object('label', 'Theo khoá hiện tại', 'plan_type', 'BY_COURSE', 'amount_vnd', v_amount));
    exception when others then null;
    end;

    begin
      v_amount := calculate_payment_option_amount(v_student.id, 'COMBO_2_COURSES');
      v_options := v_options || jsonb_build_array(jsonb_build_object('label', 'Đóng 2 khoá liền', 'plan_type', 'COMBO_2_COURSES', 'amount_vnd', v_amount));
    exception when others then null;
    end;

    begin
      v_amount := calculate_payment_option_amount(v_student.id, 'FULL_SUB_LEVEL');
      v_options := v_options || jsonb_build_array(jsonb_build_object('label', 'Trọn cấp độ con', 'plan_type', 'FULL_SUB_LEVEL', 'amount_vnd', v_amount));
    exception when others then null;
    end;

    if jsonb_array_length(v_options) = 0 then
      continue; -- khong tinh duoc lua chon nao ca (vd khoa chua co gia) -> bo qua, khong tao hoa don rong
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

-- =====================================================================
-- Nối vào hàm phụ huynh chọn hình thức (file 120) — đổi tra cứu theo
-- plan_type MỚI (BY_MONTH/BY_COURSE/COMBO_2_COURSES/FULL_SUB_LEVEL) thay
-- vì mấy giá trị cũ — logic tra cứu bên trong GIỮ NGUYÊN (đọc đúng lựa
-- chọn từ draft_options, không tin số tiền phía client gửi lên).
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
  if not is_linked_to_student(v_invoice.student_id) then
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
