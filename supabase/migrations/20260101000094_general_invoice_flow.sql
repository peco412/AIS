-- =====================================================================
-- File 94: LUONG HOA DON MOI theo dung so do nguoi dung ve:
-- Tao hoc vien (co "Tu van chot") -> Xep lop -> Trang tao hoa don chung
-- (dua tren Tu van chot) -> Thu tien tai trung tam / qua Vi -> tu doi
-- trang thai -> qua 30 ngay chua dong -> vao Cong no.
--
-- PHAN A: Them "Tu van chot" (agreed_payment_plan) vao students - 3 lua
-- chon: 'monthly' (theo thang), 'single_course' (theo khoa le - MOI,
-- truoc day chi co 'sublevel' tro len), 'sublevel' (theo tron cap do con).
--
-- PHAN B: Ham tao hoa don MOI cho 2 hinh thuc chua co (single_course,
-- monthly) — dung CHUNG co che voi create_payment_plan_invoice() da co
-- (kiem tra trung hoa don, tinh uu dai, ghi So cai...).
--
-- PHAN C: BO trigger tu dong am tham tao hoa don khi xep lop (truoc day
-- o file 72) — thay bang 1 VIEW liet ke "hoc sinh da xep lop nhung CHUA
-- co hoa don", de "Trang tao hoa don chung" hien ra cho nhan vien tu
-- xem xet + xac nhan tao, thay vi tu dong am tham nhu truoc.
-- (chay sau file 93)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN A
-- ---------------------------------------------------------------------
alter table students add column if not exists agreed_payment_plan text
  check (agreed_payment_plan in ('monthly', 'single_course', 'sublevel'));
comment on column students.agreed_payment_plan is 'Tu van chot luc dang ky: dong theo thang / theo khoa le / tron ca cap do con';

-- ---------------------------------------------------------------------
-- PHAN B.1 — Tao hoa don THEO KHOA LE (1 khoa cu the trong 1 cap do con,
-- KHAC voi "sublevel" la ca cap do con). Dung lai HET logic uu dai/kiem
-- tra trung/GL cua create_payment_plan_invoice(), chi khac phan tinh gia
-- (chi 1 khoa, khong cong don ca cap do con).
-- ---------------------------------------------------------------------
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

  -- "Theo khoa le" khong co bang chiet khau rieng nhu payment_plan_
  -- discounts (bang do chi dinh nghia cho sublevel/level/program) — chi
  -- ap dung uu dai He thong (Ke toan cau hinh) + uu dai tay.
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
    case when p_special_category is not null then 'special' when v_auto_discount_rate > 0 or v_manual_rate > 0 then 'course' else 'none' end,
    v_base_price - v_final_price,
    format('Theo khoá lẻ — Hệ thống %s%% + Tay %s%%', round(v_auto_discount_rate*100,1), round(v_manual_rate*100,1)),
    p_special_category
  )
  returning * into v_result;

  return v_result;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN B.2 — Tao hoa don THEO THANG (khong gan voi khoa/cap do nao ca,
-- chi la 1 khoan thu dinh ky hang thang voi so tien Ke toan/Tu van vien
-- tu nhap tay, KHONG tinh tu bang gia chuong trinh).
-- ---------------------------------------------------------------------
create or replace function create_monthly_invoice(
  p_student_id uuid, p_amount_vnd numeric, p_note text default null
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_class_id uuid;
  v_due_date date;
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
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'Vui long nhap dung so tien hoc phi thang.';
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

  select class_id into v_class_id from students where id = p_student_id;
  v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason)
  values (
    p_student_id, extract(year from current_date)::int, extract(month from current_date)::int,
    p_amount_vnd, p_amount_vnd, v_due_date, 'unpaid', 'none', 0, coalesce(p_note, 'Đóng theo tháng')
  )
  returning * into v_result;

  return v_result;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN C — Bo trigger tu dong am tham (file 72), thay bang VIEW liet ke
-- "can tao hoa don" de "Trang tao hoa don chung" hien ra cho nhan vien
-- tu xem xet + xac nhan, KHONG con tu dong am tham nhu truoc.
-- ---------------------------------------------------------------------
drop trigger if exists auto_invoice_on_class_assignment on students;

create or replace view v_pending_invoice_students with (security_invoker = true) as
select
  s.id as student_id, s.full_name, s.student_code, s.phone, s.parent_name,
  s.agreed_payment_plan, s.class_id, s.center_id, s.source_consultant_id,
  c.name as class_name, c.sublevel_id, c.start_date as class_start_date,
  cen.name as center_name,
  emp.full_name as consultant_name
from students s
join classes c on c.id = s.class_id
left join centers cen on cen.id = s.center_id
left join employees emp on emp.id = s.source_consultant_id
where s.status = 'studying'
  and s.class_id is not null
  and (
    -- "Theo thang" — dinh ky, phai kiem tra DUNG THANG NAY da co hoa
    -- don chua (lap lai moi thang, dung ban chat "dong theo thang").
    (s.agreed_payment_plan = 'monthly' and not exists (
      select 1 from invoices i
      where i.student_id = s.id
        and i.period_year = extract(year from current_date)::int
        and i.period_month = extract(month from current_date)::int
    ))
    -- "Theo khoa le" / "Tron cap do con" — mua TRON GOI 1 LAN cho nhieu
    -- thang, KHONG duoc kiem tra theo thang (se bi nhac lai sai moi
    -- thang du da dong du) — chi kiem tra "TU KHI XEP VAO LOP HIEN TAI
    -- (class_start_date) DA CO hoa don nao chua", khong quan tam thang.
    (s.agreed_payment_plan in ('single_course', 'sublevel') and not exists (
      select 1 from invoices i
      where i.student_id = s.id
        and i.created_at >= coalesce(c.start_date::timestamptz, s.created_at)
    ))
    -- Chua chot hinh thuc gi ca — VAN can hien ra de nhac Tu van vien bo
    -- sung, chu khong bi an di.
    or s.agreed_payment_plan is null
  );

-- ---------------------------------------------------------------------
-- PHAN D — Quy tac "qua 30 ngay ke tu ngay bat dau hoc ma chua dong du
-- thi tinh la Cong no can don doc" — bo sung vao view suc khoe hoa don
-- da co (invoices_health_view), them 1 cap do canh bao moi "overdue_30d"
-- rieng biet voi due_date thong thuong (co the due_date con han nhung
-- da qua 30 ngay hoc thi van can luu y).
-- ---------------------------------------------------------------------
create or replace view v_debt_with_start_date_flag with (security_invoker = true) as
select
  ihv.*,
  c.start_date as class_start_date,
  (c.start_date is not null and c.start_date + interval '30 days' < current_date and ihv.status <> 'paid') as is_overdue_30d_from_start
from invoices_health_view ihv
join students s on s.id = ihv.student_id
left join classes c on c.id = s.class_id;
