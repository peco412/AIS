-- =====================================================================
-- File 32: 3 HINH THUC DONG HOC PHI + HOAN PHI THEO GOI (da sua logic)
-- (chay sau file 31)
--
-- 3 hinh thuc:
--   sublevel = dong tung cap do con, hoc toi dau dong toi do (mac dinh,
--              chinh la luong hien tai qua auto_create_invoice_on_enrollment)
--   level    = dong tron 1 cap do (gom nhieu cap do con)
--   program  = dong tron ca chuong trinh (gom nhieu cap do)
-- Moi hinh thuc co % giam gia RIENG, nhap tay chinh duoc.
--
-- CONG THUC HOAN PHI DA SUA (logic goc bi tinh chiet khau 2 lan, xem giai
-- thich chi tiet da gui):
--   gia_tri_1_khoa_thuc = tong_tien_da_thu / tong_so_khoa_trong_goi
--   thuc_hoan = tong_tien_da_thu - (so_khoa_da_hoc x gia_tri_1_khoa_thuc)
-- KHONG nhan lai bat ky ty gia chiet khau nao them - vi tong_tien_da_thu
-- da la so tien THAT phu huynh bo ra roi (da tinh chiet khau 1 lan roi).
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - Gia tung cap do con (don vi gia goc, chua giam) + cau hinh %
-- giam gia rieng cho tung hinh thuc dong (nhap tay chinh duoc).
-- ---------------------------------------------------------------------
alter table program_sublevels add column if not exists price_vnd numeric(14,2);
comment on column program_sublevels.price_vnd is 'Hoc phi goc 1 cap do con (chua giam gia) - don vi tinh gia cho ca 3 hinh thuc dong';

create table if not exists payment_plan_discounts (
  plan_type text primary key check (plan_type in ('sublevel', 'level', 'program')),
  discount_rate numeric(5,4) not null default 0 check (discount_rate >= 0 and discount_rate <= 0.9),
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);
insert into payment_plan_discounts (plan_type, discount_rate) values
  ('sublevel', 0), ('level', 0.05), ('program', 0.15)
on conflict (plan_type) do nothing;

alter table payment_plan_discounts enable row level security;
create policy payment_plan_discounts_select on payment_plan_discounts for select using (true);
create policy payment_plan_discounts_write on payment_plan_discounts for all
  using (is_executive_or_tech() or (current_department_id() = (select id from departments where code='ACC') and current_role_code() = 'DEPT_HEAD'))
  with check (is_executive_or_tech() or (current_department_id() = (select id from departments where code='ACC') and current_role_code() = 'DEPT_HEAD'));

-- ---------------------------------------------------------------------
-- PHAN 2 - Goi da mua theo cap do / chuong trinh (chi ap dung cho 2 hinh
-- thuc level/program - hinh thuc sublevel dung dung luong hoa don tung
-- ky nhu hien tai, khong can bang rieng).
-- ---------------------------------------------------------------------
create table if not exists payment_plan_purchases (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id),
  plan_type text not null check (plan_type in ('level', 'program')),
  level_id uuid references program_levels(id),
  program_id uuid references programs(id),
  total_courses int not null,           -- tong so cap do con duoc bao gom trong goi
  discount_rate_applied numeric(5,4) not null,
  total_amount_vnd numeric(14,2) not null, -- SO TIEN THAT da thu (sau giam gia) - dung de tinh hoan phi
  invoice_id uuid references invoices(id),
  status text not null default 'active' check (status in ('active', 'refunded')),
  created_at timestamptz not null default now()
);
create index if not exists idx_plan_purchases_student on payment_plan_purchases(student_id, status);

alter table payment_plan_purchases enable row level security;
create policy plan_purchases_select on payment_plan_purchases for select
  using (
    is_linked_to_student(student_id) or is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
  );
create policy plan_purchases_write on payment_plan_purchases for all
  using (
    is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
  )
  with check (
    is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
  );

-- ---------------------------------------------------------------------
-- PHAN 3 - Tao hoa don theo dung 1 trong 3 hinh thuc, tu tinh gia theo
-- dung % giam gia rieng cua hinh thuc do.
-- ---------------------------------------------------------------------
create or replace function create_payment_plan_invoice(
  p_student_id uuid, p_plan_type text, p_scope_id uuid -- scope_id = sublevel_id/level_id/program_id tuy plan_type
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_discount_rate numeric;
  v_base_price numeric;
  v_course_count int;
  v_final_price numeric;
  v_due_date date;
  v_result invoices;
  v_purchase_id uuid;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tao hoa don.';
  end if;

  select discount_rate into v_discount_rate from payment_plan_discounts where plan_type = p_plan_type;

  if p_plan_type = 'sublevel' then
    select price_vnd into v_base_price from program_sublevels where id = p_scope_id;
    v_course_count := 1;
  elsif p_plan_type = 'level' then
    select coalesce(sum(price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_sublevels where level_id = p_scope_id;
  elsif p_plan_type = 'program' then
    select coalesce(sum(ps.price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_sublevels ps join program_levels pl on pl.id = ps.level_id
    where pl.program_id = p_scope_id;
  else
    raise exception 'plan_type khong hop le.';
  end if;

  if v_base_price is null or v_base_price <= 0 then
    raise exception 'Chua cau hinh hoc phi cho cap do/chuong trinh nay.';
  end if;

  v_final_price := v_base_price * (1 - coalesce(v_discount_rate, 0));
  v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason)
  values (
    p_student_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when v_discount_rate > 0 then 'program' else 'none' end,
    v_base_price - v_final_price,
    case when v_discount_rate > 0 then format('Giam gia hinh thuc dong "%s" (%s%%)', p_plan_type, v_discount_rate * 100) else null end
  )
  returning * into v_result;

  if p_plan_type in ('level', 'program') then
    insert into payment_plan_purchases (student_id, plan_type, level_id, program_id, total_courses, discount_rate_applied, total_amount_vnd, invoice_id)
    values (
      p_student_id, p_plan_type,
      case when p_plan_type = 'level' then p_scope_id else null end,
      case when p_plan_type = 'program' then p_scope_id else null end,
      v_course_count, coalesce(v_discount_rate, 0), v_final_price, v_result.id
    );
  end if;

  return v_result;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN 4 - Hoan phi theo goi da mua (level/program) - CONG THUC DA SUA,
-- so_khoa_da_hoc do NHAN VIEN xac nhan nhap tay (he thong hien tai chua
-- co bang luu lich su lop hoc de tu dem chinh xac tuyet doi).
-- ---------------------------------------------------------------------
create or replace function calculate_plan_refund(p_purchase_id uuid, p_courses_completed int)
returns numeric
language plpgsql stable
as $func$
declare
  v_purchase payment_plan_purchases%rowtype;
  v_per_course numeric;
begin
  select * into v_purchase from payment_plan_purchases where id = p_purchase_id;
  if v_purchase.id is null then raise exception 'Khong tim thay goi da mua nay.'; end if;
  if p_courses_completed < 0 or p_courses_completed > v_purchase.total_courses then
    raise exception 'So khoa da hoc khong hop le (phai tu 0 den %).', v_purchase.total_courses;
  end if;

  v_per_course := v_purchase.total_amount_vnd / v_purchase.total_courses;
  return v_purchase.total_amount_vnd - (p_courses_completed * v_per_course);
end;
$func$;

-- Xu ly hoan phi that: ghi nhan hoan tra (khong tu dong chuyen tien, chi
-- ghi so + cap nhat trang thai - viec xuat tien thuc te van thu cong nhu
-- quy trinh rut vi hien co).
create or replace function process_plan_refund(p_purchase_id uuid, p_courses_completed int, p_approver_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_purchase payment_plan_purchases%rowtype;
  v_refund numeric;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc xu ly hoan phi.';
  end if;

  select * into v_purchase from payment_plan_purchases where id = p_purchase_id for update;
  if v_purchase.status <> 'active' then raise exception 'Goi nay da duoc hoan phi truoc do roi.'; end if;

  v_refund := calculate_plan_refund(p_purchase_id, p_courses_completed);

  update payment_plan_purchases set status = 'refunded' where id = p_purchase_id;

  perform append_financial_log('CASH', -v_refund, v_purchase.invoice_id, p_approver_id, null, v_purchase.student_id,
    format('Hoan phi goi %s: da hoc %s/%s khoa', v_purchase.plan_type, p_courses_completed, v_purchase.total_courses));

  return v_refund;
end;
$func$;
