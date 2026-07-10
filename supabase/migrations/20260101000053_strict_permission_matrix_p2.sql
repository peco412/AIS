-- =====================================================================
-- File 53: AP DUNG MA TRAN PHAN QUYEN - DOT 2 (Danh sach nhan vien,
-- Luong/HDLD, Nghi phep/lich lam viec, Tai san CSVC, Phieu mua sam CSVC,
-- va dac biet Cau hinh Master Data - noi DUY NHAT TECH > BDH ve quyen)
-- (chay sau file 52)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Danh sach nhan vien & Trang thai: BDH=R, TECH=R, chi Truong/Pho
-- phong NS moi duoc GHI (them/sua/xoa).
-- ---------------------------------------------------------------------
drop policy if exists employees_manage_hr on employees;
create policy employees_manage_hr on employees for all
  using (
    current_department_id() = (select id from departments where code='HR')
    and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY')
  )
  with check (
    current_department_id() = (select id from departments where code='HR')
    and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY')
  );

-- ---------------------------------------------------------------------
-- 2. Bang luong co ban & Hop dong lao dong: BDH=R, TECH=R, chi NS ghi.
-- ---------------------------------------------------------------------
drop policy if exists base_salary_write on employee_base_salary;
create policy base_salary_write on employee_base_salary for all
  using (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'))
  with check (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'));

drop policy if exists contracts_insert on contracts;
create policy contracts_insert on contracts for insert
  with check (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'));
drop policy if exists contracts_update on contracts;
create policy contracts_update on contracts for update
  using (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'));

-- ---------------------------------------------------------------------
-- 3. Thong ke ngay nghi/phep, Lich lam viec: BDH=R, TECH=R, chi NS ghi.
-- ---------------------------------------------------------------------
drop policy if exists leave_balances_write on leave_balances;
create policy leave_balances_write on leave_balances for all
  using (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'))
  with check (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'));

drop policy if exists work_schedules_write on work_schedules;
create policy work_schedules_write on work_schedules for all
  using (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'))
  with check (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'));

-- ---------------------------------------------------------------------
-- 4. Thong ke tai san CSVC: BDH=R, TECH=R, CHI Truong phong CSVC (khong
-- tinh Pho phong - dung chu "Trưởng Phòng CSVC" so voi cot "Trưởng/Phó"
-- cua cac phong khac).
-- ---------------------------------------------------------------------
drop policy if exists facility_assets_write on facility_assets;
create policy facility_assets_write on facility_assets for all
  using (current_department_id() = (select id from departments where code='FAC') and current_role_code() = 'DEPT_HEAD')
  with check (current_department_id() = (select id from departments where code='FAC') and current_role_code() = 'DEPT_HEAD');

-- ---------------------------------------------------------------------
-- 5. Phieu mua sam/sua chua tai san CSVC: A cap cuoi chi tinh EXECUTIVE
-- (khong con TECH). Da dung ham is_executive_strict() tao o file 52.
-- ---------------------------------------------------------------------
drop policy if exists purchase_requests_update on purchase_requests;
create policy purchase_requests_update on purchase_requests for update
  using (
    (requester_id = current_employee_id() and status = 'draft')
    or (current_department_id() = (select id from departments where code='FAC') and current_role_code() = 'DEPT_HEAD')
    or is_executive_strict()
  );

drop policy if exists event_proposals_update on event_proposals;
create policy event_proposals_update on event_proposals for update
  using (
    (center_manager_id = current_employee_id() and status = 'draft')
    or (current_department_id() = (select id from departments where code='MKT') and current_role_code() = 'DEPT_HEAD')
    or is_executive_strict()
  );

-- ---------------------------------------------------------------------
-- 6. Cau hinh Master Data (San pham kho, Hang muc chi, Nha cung cap,
-- Chuong trinh/Cap do/Khoa hoc): DAO NGUOC so voi cac dong khac - TECH
-- duoc GHI (W/A), BDH chi duoc XEM (R). Day la vai tro "quan tri du lieu
-- goc he thong" dung nghia cua Ky thuat.
-- ---------------------------------------------------------------------
drop policy if exists inventory_items_write on inventory_items;
create policy inventory_items_write on inventory_items for all
  using (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='FAC'))
  with check (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='FAC'));

drop policy if exists expense_categories_write on expense_categories;
create policy expense_categories_write on expense_categories for all
  using (current_role_code() = 'TECH')
  with check (current_role_code() = 'TECH');

drop policy if exists suppliers_write on suppliers;
create policy suppliers_write on suppliers for all
  using (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'))
  with check (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'));

drop policy if exists program_courses_write on program_courses;
create policy program_courses_write on program_courses for all
  using (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'))
  with check (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'));
