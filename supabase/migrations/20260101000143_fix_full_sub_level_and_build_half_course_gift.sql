-- =====================================================================
-- File 143: SỬA LẠI ĐÚNG THEO VÍ DỤ CỤ THỂ + XÂY THÊM HALF_COURSE, QUÀ
-- TẶNG, DIỆN ĐẶC BIỆT (19/07/2026)
-- =====================================================================
-- Nhờ ví dụ cụ thể (Movers 1, chương trình giảm 10%+quà gấu bông) mới
-- hiểu ĐÚNG: "Đóng trọn khoá" trong yêu cầu là TRỌN CẤP ĐỘ CON
-- (FULL_SUB_LEVEL) — KHÔNG PHẢI "combo 3/4 khoá" như file 141 đã hiểu
-- SAI. "(4 khoá)" trong ví dụ chỉ là chú thích rằng cấp độ con Movers có
-- đúng 4 khoá nhỏ, không phải 1 hình thức "combo 4" riêng.
--
-- SỬA LẠI đúng theo ví dụ:
--   - Bỏ COMBO_3_COURSES/COMBO_4_COURSES (hiểu sai, không dùng nữa)
--   - Mọi chương trình: Combo 2 khoá -5% (như cũ), Trọn cấp độ con -10%
--     (Giao tiếp riêng: Trọn cấp độ con -5%, không có combo 2 khoá)
--
-- XÂY THÊM theo đúng ví dụ:
--   - Hình thức MỚI "Đóng 1/2 khoá" (nửa khoá) — giá = nửa giá 1 khoá,
--     KHÔNG được hưởng % giảm của chương trình ưu đãi chung nhưng VẪN
--     được quà tặng (nếu chương trình đang chạy có quà) — RIÊNG Giao
--     tiếp thì "Đóng 1/2" LẠI được hưởng đầy đủ như đóng 1 khoá.
--   - Theo tháng: không hưởng gì cả (không giảm, không quà)
--   - Đóng 1 khoá trở lên: hưởng ĐẦY ĐỦ chương trình đang chạy (giảm +
--     quà), CỘNG THÊM đúng % combo riêng của hình thức đó nếu có
--   - Mầm non/Mẫu giáo/Trẻ em: KHÔNG cho chọn Theo tháng / Đóng 1/2 khoá
--     (chỉ có thể đóng từ 1 khoá trở lên)
--   - Chương trình ưu đãi giờ có thể kèm QUÀ TẶNG (lấy từ kho, tự trừ khi
--     hoá đơn được đóng đủ)
--   - Diện ưu đãi đặc biệt tự áp đúng %: Con HĐQT/Cháu HĐQT/Con Hiệu
--     trưởng = 100%, Con giáo viên = 20% (mới thêm), "Khác" vẫn nhập tay
--     theo quyết định Giám đốc.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — Chuong trinh uu dai co the kem QUA TANG.
-- =====================================================================
alter table discount_programs add column if not exists gift_item_id uuid references inventory_items(id);
alter table discount_programs add column if not exists gift_quantity int not null default 1 check (gift_quantity > 0);
comment on column discount_programs.gift_item_id is 'Quà tặng kèm theo chương trình ưu đãi này (lấy từ Danh mục sản phẩm kho) — null nếu chương trình không có quà. Xem file 143.';

-- =====================================================================
-- PHẦN 2 — Sua lai DUNG bang uu dai theo chuong trinh: chi con 2 hinh
-- thuc combo (COMBO_2_COURSES + FULL_SUB_LEVEL), bo han COMBO_3/COMBO_4
-- da hieu sai. FULL_SUB_LEVEL gio nam TRONG bang nay (theo tung chuong
-- trinh), khong con dung bulk_payment_discounts chung nua.
--
-- LUU Y THU TU: phai XOA du lieu COMBO_3/COMBO_4 (file 141 tao sai)
-- TRUOC KHI sua rang buoc CHECK chat hon — ALTER TABLE ADD CONSTRAINT tu
-- kiem tra NGAY LAP TUC toan bo du lieu dang co, con du lieu cu (khong
-- con hop le voi rang buoc moi) se lam ca cau lenh that bai.
-- =====================================================================
delete from program_plan_discounts where plan_type in ('COMBO_3_COURSES', 'COMBO_4_COURSES');

alter table program_plan_discounts drop constraint if exists program_plan_discounts_plan_type_check;
alter table program_plan_discounts add constraint program_plan_discounts_plan_type_check
  check (plan_type in ('BY_COURSE', 'COMBO_2_COURSES', 'FULL_SUB_LEVEL'));

insert into program_plan_discounts (program_id, plan_type, discount_rate)
select p.id, v.plan_type, v.rate
from programs p
cross join (values ('COMBO_2_COURSES', 0.05), ('FULL_SUB_LEVEL', 0.10)) as v(plan_type, rate)
where p.name in ('Tiếng Anh Mầm non', 'Tiếng Anh Mẫu Giáo', 'Tiếng Anh Trẻ em', 'Tiếng Anh Thiếu Nhi', 'Tiếng Anh Thanh thiếu niên', 'Tiếng Anh Học thuật')
on conflict (program_id, plan_type) do update set discount_rate = excluded.discount_rate;

insert into program_plan_discounts (program_id, plan_type, discount_rate)
select p.id, 'FULL_SUB_LEVEL', 0.05
from programs p where p.name = 'Tiếng Anh Giao tiếp'
on conflict (program_id, plan_type) do update set discount_rate = excluded.discount_rate;
-- Giao tiep KHONG co combo 2 khoa — xoa neu file 141 lo tao (khong co vi
-- file 141 chi tao cho 5 chuong trinh tren, khong dung, nhung xoa cho
-- chac).
delete from program_plan_discounts pd using programs p
where pd.program_id = p.id and p.name = 'Tiếng Anh Giao tiếp' and pd.plan_type = 'COMBO_2_COURSES';

-- =====================================================================
-- PHẦN 3 — Bang "co duoc chon hinh thuc nay khong" (Theo thang / Dong
-- 1/2 khoa CHUA CHAC co o moi chuong trinh — Mam non/Mau giao/Tre em
-- KHONG duoc chon 2 hinh thuc nay).
-- =====================================================================
create table if not exists program_plan_availability (
  program_id uuid not null references programs(id) on delete cascade,
  plan_type text not null check (plan_type in ('BY_MONTH', 'HALF_COURSE')),
  is_available boolean not null default true,
  primary key (program_id, plan_type)
);
alter table program_plan_availability enable row level security;
create policy program_plan_availability_select on program_plan_availability for select using (true);
create policy program_plan_availability_write on program_plan_availability for all
  using (is_executive_or_tech()) with check (is_executive_or_tech());

insert into program_plan_availability (program_id, plan_type, is_available)
select p.id, v.plan_type, false
from programs p
cross join (values ('BY_MONTH'), ('HALF_COURSE')) as v(plan_type)
where p.name in ('Tiếng Anh Mầm non', 'Tiếng Anh Mẫu Giáo', 'Tiếng Anh Trẻ em')
on conflict (program_id, plan_type) do update set is_available = excluded.is_available;

comment on table program_plan_availability is 'Mầm non/Mẫu giáo/Trẻ em không cho chọn Theo tháng/Đóng 1/2 khoá — chương trình khác mặc định luôn cho phép (không cần thêm dòng). Xem file 143.';

-- =====================================================================
-- PHẦN 4 — Sua ham tinh gia: bo logic COMBO_N tong quat (hieu sai), quay
-- lai dung 2 gia tri combo (COMBO_2_COURSES/FULL_SUB_LEVEL, doc tu
-- program_plan_discounts) + THEM hinh thuc HALF_COURSE moi.
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
  v_rate numeric;
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
    v_result := v_course.price_vnd;

  elsif p_option = 'HALF_COURSE' then
    v_result := round(v_course.price_vnd / 2.0);

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
    select discount_rate into v_rate from program_plan_discounts where program_id = v_program_id and plan_type = 'COMBO_2_COURSES';
    if v_rate is null then raise exception 'Chương trình này chưa cấu hình ưu đãi Đóng 2 khoá liền.'; end if;
    v_result := round((v_course.price_vnd + coalesce(v_next_price, 0)) * (1 - v_rate));

  elsif p_option = 'FULL_SUB_LEVEL' then
    select coalesce(sum(price_vnd), 0) into v_result
    from program_courses
    where sublevel_id = v_course.sublevel_id and display_order >= v_course.display_order;
    select discount_rate into v_rate from program_plan_discounts where program_id = v_program_id and plan_type = 'FULL_SUB_LEVEL';
    if v_rate is null then raise exception 'Chương trình này chưa cấu hình ưu đãi Trọn cấp độ con.'; end if;
    v_result := round(v_result * (1 - v_rate));

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
language sql immutable
as $lbl$
  select case p_option
    when 'BY_MONTH' then 'Theo tháng'
    when 'HALF_COURSE' then 'Đóng 1/2 khoá'
    when 'BY_COURSE' then 'Theo khoá hiện tại'
    when 'COMBO_2_COURSES' then 'Đóng 2 khoá liền'
    when 'FULL_SUB_LEVEL' then 'Trọn cấp độ con'
    else p_option
  end;
$lbl$;

-- =====================================================================
-- PHẦN 5 — Ham TRUNG TAM sinh danh sach lua chon — gio xet DAY DU: co
-- duoc chon hinh thuc do khong (Mam non/Mau giao/Tre em an Theo thang/
-- 1-2 khoa), co duoc huong chuong trinh dang chay khong (rate+qua tang),
-- va nhet DUNG thong tin chuong trinh + qua vao tung lua chon de FE hien
-- ro rang (dung yeu cau "hien ro % giam, qua tang, chinh sach uu dai").
-- =====================================================================
create or replace function get_available_payment_options(p_student_id uuid)
returns jsonb
language plpgsql
stable
as $func$
declare
  v_course_id uuid;
  v_program_id uuid;
  v_center_id uuid;
  v_options jsonb := '[]'::jsonb;
  v_amount numeric;
  v_avail record;
  v_by_month_ok boolean := true;
  v_half_ok boolean := true;
  v_program_promo record;
  v_gift_item_name text;
  v_plan_type text;
begin
  select cl.course_id, s.center_id into v_course_id, v_center_id from students s join classes cl on cl.id = s.class_id where s.id = p_student_id;
  if v_course_id is null then return '[]'::jsonb; end if;

  select pl.program_id into v_program_id
  from program_courses pc join program_sublevels ps on ps.id = pc.sublevel_id join program_levels pl on pl.id = ps.level_id
  where pc.id = v_course_id;

  for v_avail in select plan_type, is_available from program_plan_availability where program_id = v_program_id loop
    if v_avail.plan_type = 'BY_MONTH' then v_by_month_ok := v_avail.is_available; end if;
    if v_avail.plan_type = 'HALF_COURSE' then v_half_ok := v_avail.is_available; end if;
  end loop;

  -- Chuong trinh uu dai CHUNG dang chay (neu co) — dung ham da xay tu
  -- truoc (get_auto_discount_program_for_class), lay them ten qua tang.
  select p.*, dp.gift_item_id, dp.gift_quantity, dp.name as full_program_name
  into v_program_promo
  from get_auto_discount_program_for_class(
    (select id from classes where course_id = v_course_id limit 1), v_center_id
  ) p
  left join discount_programs dp on dp.id = p.program_id;

  if v_program_promo.gift_item_id is not null then
    select name into v_gift_item_name from inventory_items where id = v_program_promo.gift_item_id;
  end if;

  -- 1) Theo thang — khong bao gio huong chuong trinh/qua, chi kha dung
  -- neu chuong trinh nay cho phep.
  if v_by_month_ok then
    begin
      v_amount := calculate_payment_option_amount(p_student_id, 'BY_MONTH');
      v_options := v_options || jsonb_build_array(jsonb_build_object(
        'label', payment_option_label('BY_MONTH'), 'plan_type', 'BY_MONTH', 'amount_vnd', v_amount,
        'gets_program_rate', false, 'gift_item_name', null
      ));
    exception when others then null;
    end;
  end if;

  -- 2) Dong 1/2 khoa — KHONG huong % giam chuong trinh nhung VAN duoc
  -- qua (neu co) — RIENG Giao tiep thi duoc huong DAY DU (ca giam gia).
  if v_half_ok then
    begin
      v_amount := calculate_payment_option_amount(p_student_id, 'HALF_COURSE');
      declare
        v_is_giao_tiep boolean;
        v_half_gets_rate boolean := false;
      begin
        select (name = 'Tiếng Anh Giao tiếp') into v_is_giao_tiep from programs where id = v_program_id;
        v_half_gets_rate := coalesce(v_is_giao_tiep, false);
        if v_half_gets_rate and v_program_promo.discount_rate is not null then
          v_amount := round(v_amount * (1 - v_program_promo.discount_rate));
        end if;
        v_options := v_options || jsonb_build_array(jsonb_build_object(
          'label', payment_option_label('HALF_COURSE'), 'plan_type', 'HALF_COURSE', 'amount_vnd', v_amount,
          'gets_program_rate', (v_half_gets_rate and v_program_promo.discount_rate is not null),
          'gift_item_name', v_gift_item_name,
          'program_name', v_program_promo.full_program_name
        ));
      end;
    exception when others then null;
    end;
  end if;

  -- 3) Tu "Dong 1 khoa" tro len: huong DAY DU chuong trinh dang chay
  -- (giam gia + qua), CONG THEM % combo rieng cua hinh thuc do (neu co).
  foreach v_plan_type in array array['BY_COURSE', 'COMBO_2_COURSES', 'FULL_SUB_LEVEL']
  loop
    begin
      v_amount := calculate_payment_option_amount(p_student_id, v_plan_type);
      if v_program_promo.discount_rate is not null then
        v_amount := round(v_amount * (1 - v_program_promo.discount_rate));
      end if;
      v_options := v_options || jsonb_build_array(jsonb_build_object(
        'label', payment_option_label(v_plan_type), 'plan_type', v_plan_type, 'amount_vnd', v_amount,
        'gets_program_rate', (v_program_promo.discount_rate is not null),
        'gift_item_name', v_gift_item_name,
        'program_name', v_program_promo.full_program_name
      ));
    exception when others then null;
    end;
  end loop;

  return v_options;
end;
$func$;

comment on function get_available_payment_options(uuid) is
  'Sinh danh sách lựa chọn giá — xét đủ: chương trình có cho phép Theo tháng/Đóng 1/2 khoá không, chương trình ưu đãi đang chạy có áp dụng (giảm + quà) không theo đúng hình thức. Xem file 143.';

-- =====================================================================
-- PHẦN 6 — Mo rong CHECK them HALF_COURSE, bo COMBO_3/COMBO_4 (hieu sai
-- da xoa) — invoices.chosen_plan_type.
-- =====================================================================
alter table invoices drop constraint if exists invoices_chosen_plan_type_check;
alter table invoices add constraint invoices_chosen_plan_type_check
  check (chosen_plan_type in ('BY_MONTH', 'HALF_COURSE', 'BY_COURSE', 'COMBO_2_COURSES', 'FULL_SUB_LEVEL'));

alter table invoices add column if not exists gift_item_id uuid references inventory_items(id);
alter table invoices add column if not exists gift_quantity int;
alter table invoices add column if not exists gift_deducted boolean not null default false;
comment on column invoices.gift_item_id is 'Quà tặng đi kèm hoá đơn này (nếu được hưởng chương trình ưu đãi lúc tạo) — trừ kho khi hoá đơn được đóng đủ. Xem file 143.';

-- =====================================================================
-- PHẦN 7 — Tu dong tru kho qua tang khi hoa don duoc dong DU (goi tu
-- refresh_invoice_status, noi da tinh trang thai 'paid').
-- =====================================================================
create or replace function deduct_gift_if_eligible(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_center_id uuid;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if v_invoice.status <> 'paid' or v_invoice.gift_item_id is null or v_invoice.gift_deducted then
    return;
  end if;

  select center_id into v_center_id from students where id = v_invoice.student_id;

  insert into inventory_transactions (transaction_type, item_id, quantity, center_id, transaction_date, note)
  values ('out', v_invoice.gift_item_id, coalesce(v_invoice.gift_quantity, 1), v_center_id, current_date,
    format('Quà tặng chương trình ưu đãi — hoá đơn %s', coalesce(v_invoice.invoice_code, p_invoice_id::text)));

  update invoices set gift_deducted = true where id = p_invoice_id;
exception when others then
  -- Het hang hoac loi khac: KHONG chan viec dong hoc phi vi thieu qua —
  -- chi bo qua, nhan vien tu bu qua sau neu can (uu tien tien hoc phi).
  null;
end;
$func$;

comment on function deduct_gift_if_eligible(uuid) is
  'Tự trừ kho quà tặng khi hoá đơn đóng đủ — không chặn việc đóng học phí nếu hết hàng, chỉ âm thầm bỏ qua (nhân viên bù sau). Xem file 143.';

-- =====================================================================
-- PHẦN 8 — Dien uu dai dac biet tu ap DUNG % (100% cho Con/Chau HDQT +
-- Con Hieu truong, 20% cho Con giao vien MOI them, "Khac" van nhap tay).
-- =====================================================================
create or replace function get_special_category_rate(p_category text) returns numeric
language sql immutable
as $$
  select case p_category
    when 'board_child' then 1.0
    when 'board_grandchild' then 1.0
    when 'principal_child' then 1.0
    when 'teacher_child' then 0.20
    else null -- 'other' hoac null: khong tu ap, dung dung % nhan vien nhap tay
  end;
$$;

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
  v_special_rate numeric;
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

  -- SUA: dien dac biet (Con HDQT/Chau HDQT/Con Hieu truong/Con giao vien)
  -- gio TU AP DUNG dung %, khong con phai nhan vien tu go tay them nua —
  -- "Khac" van giu nguyen nhap tay theo quyet dinh Giam doc.
  v_special_rate := get_special_category_rate(p_special_category);
  v_manual_rate := coalesce(v_special_rate, greatest(least(coalesce(p_manual_discount_rate, 0), 1), 0));

  v_base_price := calculate_payment_option_amount(p_student_id, p_option);
  v_final_price := v_base_price * (1 - v_manual_rate) * (1 - coalesce(v_auto_program.discount_rate, 0));

  select end_date into v_due_date from classes where id = v_class_id;
  if v_due_date is null then
    v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason, special_category, applied_discount_program_id, chosen_plan_type, gift_item_id, gift_quantity)
  values (
    p_student_id, v_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when p_special_category is not null then 'special' when v_auto_program.program_id is not null then 'program' when v_manual_rate > 0 then 'case' else 'none' end,
    v_base_price - v_final_price,
    case when v_special_rate is not null
      then format('%s — Diện đặc biệt: %s%%', payment_option_label(p_option), round(v_special_rate*100,1))
      when v_auto_program.program_id is not null
      then format('%s — %s (-%s%%)%s', payment_option_label(p_option), v_auto_program.program_name, round(v_auto_program.discount_rate*100,1),
        case when v_manual_rate > 0 then format(' + Tay %s%%', round(v_manual_rate*100,1)) else '' end)
      else format('%s — Ưu đãi tay %s%%', payment_option_label(p_option), round(v_manual_rate*100,1))
    end,
    p_special_category, v_auto_program.program_id, p_option,
    (select gift_item_id from discount_programs where id = v_auto_program.program_id),
    (select gift_quantity from discount_programs where id = v_auto_program.program_id)
  )
  returning * into v_result;

  return v_result;
end;
$func$;

-- =====================================================================
-- PHẦN 9 — SỬA LỖI THẬT phát hiện khi rà: ràng buộc special_category cũ
-- (file 35) dùng tên KHÁC hẳn với giao diện đang gửi lên
-- ('child_of_board' vs 'board_child' frontend đang dùng) — nghĩa là chọn
-- "Con HĐQT"/"Cháu HĐQT"/"Con Hiệu trưởng" trên giao diện từ trước tới
-- giờ LUÔN BÁO LỖI ràng buộc dữ liệu (chỉ mỗi "Khác" chạy được vì trùng
-- tên). Sửa lại đúng theo tên giao diện đang dùng, thêm "teacher_child"
-- (Con giáo viên) mới.
-- =====================================================================
alter table invoices drop constraint if exists invoices_special_category_check;
alter table invoices add constraint invoices_special_category_check
  check (special_category in ('board_child', 'board_grandchild', 'principal_child', 'teacher_child', 'other'));

-- =====================================================================
-- PHẦN 10 — Noi deduct_gift_if_eligible() VAO refresh_invoice_status() —
-- truoc gio ham qua tang chi dinh nghia xong, CHUA co cho nao thuc su
-- goi no ca. Goi ngay khi hoa don vua chuyen sang 'paid'.
-- =====================================================================
create or replace function refresh_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_paid_vnd numeric;
  v_net_owed numeric;
  v_course record;
  v_already_purchased boolean;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  select coalesce(sum(amount_vnd), 0) into v_paid_vnd from debt_ledger where invoice_id = p_invoice_id;

  v_net_owed := v_invoice.amount_vnd - coalesce(v_invoice.manual_discount_vnd, 0);

  update invoices set status = case
    when v_paid_vnd >= v_net_owed then 'paid'
    when v_paid_vnd > 0 then 'partially_paid'
    else 'unpaid'
  end
  where id = p_invoice_id;

  if v_paid_vnd > 0 and v_invoice.class_id is not null then
    select exists(
      select 1 from student_lesson_transactions
      where invoice_id = p_invoice_id and transaction_type = 'purchase'
    ) into v_already_purchased;

    if not v_already_purchased then
      select pc.id, pc.name, pc.total_sessions into v_course
      from classes c join program_courses pc on pc.id = c.course_id
      where c.id = v_invoice.class_id;

      if v_course.id is not null and v_course.total_sessions is not null then
        insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, invoice_id, note)
        values (v_invoice.student_id, 'purchase', v_course.total_sessions, v_invoice.class_id, p_invoice_id,
          format('Tự động cộng buổi học từ hoá đơn %s/%s — %s buổi (%s)', v_invoice.period_month, v_invoice.period_year, v_course.total_sessions, v_course.name));

        update students set total_purchased_lessons = total_purchased_lessons + v_course.total_sessions
        where id = v_invoice.student_id;
      end if;
    end if;
  end if;

  -- MOI (file 143) — hoa don vua dong DU thi tu tru kho qua tang di kem
  -- (neu co, va chua tru lan nao).
  if v_paid_vnd >= v_net_owed then
    perform deduct_gift_if_eligible(p_invoice_id);
  end if;
end;
$func$;

