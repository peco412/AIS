-- =====================================================================
-- File 34: BANG LUONG CHI TIET + DON XIN CHAM CONG TRE (chay sau file 33)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - Luong co ban + phu cap CO DINH cho tung nhan vien (cau hinh
-- 1 lan, hang thang bang luong TU DIEN vao tu day, khong nhap lai).
-- ---------------------------------------------------------------------
create table if not exists employee_base_salary (
  employee_id uuid primary key references employees(id),
  base_salary numeric(14,2) not null default 0,
  housing_allowance numeric(14,2) not null default 0,
  transport_allowance numeric(14,2) not null default 0,
  other_allowance numeric(14,2) not null default 0,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);

alter table employee_base_salary enable row level security;
create policy base_salary_select on employee_base_salary for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  );
create policy base_salary_write on employee_base_salary for all
  using (
    current_department_id() = (select id from departments where code='HR')
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='HR')
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHAN 2 - Don xin cham cong tre - duyet 1 CAP DUY NHAT (Pho phong Nhan su)
-- ---------------------------------------------------------------------
create table if not exists late_clockin_requests (
  id uuid primary key default uuid_generate_v4(),
  code text unique,
  employee_id uuid not null references employees(id),
  late_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_late_clockin_employee on late_clockin_requests(employee_id, late_date);

create trigger late_clockin_set_code before insert on late_clockin_requests
for each row execute function trg_set_code_hr();

alter table late_clockin_requests enable row level security;
create policy late_clockin_select on late_clockin_requests for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or current_department_id() = (select id from departments where code='ACC') -- ke toan can xem de tinh luong
    or is_executive_or_tech()
  );
create policy late_clockin_insert on late_clockin_requests for insert
  with check (employee_id = current_employee_id());
-- CHI Pho phong Nhan su (hoac Truong phong/BDH/TECH thay the khi can) duoc duyet -
-- dung 1 cap theo yeu cau, khac voi luong 3 cap thong thuong.
create policy late_clockin_update on late_clockin_requests for update
  using (
    (current_department_id() = (select id from departments where code='HR') and current_role_code() = 'DEPT_DEPUTY')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHAN 3 - Bang luong hang thang: them day du cac truong theo dung cong
-- thuc BGD dua ra, doi lai cot net_salary (generated column) cho khop.
-- ---------------------------------------------------------------------
alter table payroll add column if not exists performance_bonus numeric(14,2) not null default 0;   -- Thuong hieu suat
alter table payroll add column if not exists urgent_bonus numeric(14,2) not null default 0;         -- Thuong dot xuat
alter table payroll add column if not exists housing_allowance numeric(14,2) not null default 0;    -- Tro cap nha o (dien tu dong)
alter table payroll add column if not exists transport_allowance numeric(14,2) not null default 0;  -- Tro cap xang xe (dien tu dong)
alter table payroll add column if not exists other_allowance numeric(14,2) not null default 0;      -- Tro cap khac (dien tu dong)
alter table payroll add column if not exists penalty_amount numeric(14,2) not null default 0;       -- Tien phat
alter table payroll add column if not exists advance_deduction numeric(14,2) not null default 0;    -- Tam ung (dien tu dong tu phieu tam ung)
alter table payroll add column if not exists leave_days numeric(5,2) not null default 0;             -- So ngay nghi (tu don xin nghi)
alter table payroll add column if not exists absent_days numeric(5,2) not null default 0;            -- So ngay khong cham cong

-- Doi lai net_salary theo dung cong thuc:
-- Luong thuc nhan = co ban + thuong hieu suat + thuong dot xuat + 3 tro cap
--                    - (ngay nghi + ngay khong cham cong) x (luong co ban / 26)
--                    - tien phat - tam ung
alter table payroll drop column if exists net_salary;
alter table payroll add column net_salary numeric(14,2) generated always as (
  base_salary + performance_bonus + urgent_bonus + housing_allowance + transport_allowance + other_allowance
  - (leave_days + absent_days) * (base_salary / 26.0)
  - penalty_amount - advance_deduction
) stored;

comment on column payroll.bonus is 'CU - khong dung nua, giu lai de tuong thich nguoc, thay bang performance_bonus/urgent_bonus';
comment on column payroll.deduction is 'CU - khong dung nua, giu lai de tuong thich nguoc, thay bang penalty_amount/advance_deduction';
