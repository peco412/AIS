-- =====================================================================
-- File 54: AP DUNG MA TRAN PHAN QUYEN - DOT 4 (CUOI CUNG) - Ho so khach
-- hang, Bang diem, Kho van hanh, va khoi Portal (De xuat noi bo, Xin
-- quyen han, Duyet don cap duoi) (chay sau file 53)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ho so khach hang: BDH/TECH chi con R, chi Tu van vien duoc ghi.
-- ---------------------------------------------------------------------
drop policy if exists leads_update on crm_leads;
create policy leads_update on crm_leads for update
  using (consultant_id = current_employee_id());

-- ---------------------------------------------------------------------
-- 2. Bang diem hoc vien: BDH/TECH chi con R, chi Giao vien duoc ghi.
-- ---------------------------------------------------------------------
drop policy if exists grades_write on student_grades;
create policy grades_write on student_grades for insert
  with check (
    exists (select 1 from classes c where c.id = student_grades.class_id and c.teacher_id = current_employee_id())
  );
drop policy if exists grades_update on student_grades;
create policy grades_update on student_grades for update
  using (
    exists (select 1 from classes c where c.id = student_grades.class_id and c.teacher_id = current_employee_id())
  );

-- ---------------------------------------------------------------------
-- 3. Kho van hanh (Phieu nhap/xuat kho): BDH/TECH chi con R, Quan ly
-- trung tam + Tu van vien duoc ghi (khong con TECH override).
-- ---------------------------------------------------------------------
drop policy if exists inventory_tx_insert on inventory_transactions;
create policy inventory_tx_insert on inventory_transactions for insert
  with check (
    center_id = current_center_id()
    and current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
  );

-- ---------------------------------------------------------------------
-- 4. Xin them quyen han: BDH=X, TECH=X (khong tu xin quyen cho chinh
-- minh) - chi Truong/Pho phong + Quan ly trung tam duoc gui.
-- ---------------------------------------------------------------------
drop policy if exists permission_requests_insert on permission_requests;
create policy permission_requests_insert on permission_requests for insert
  with check (
    requested_by = current_employee_id()
    and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY', 'CENTER_MANAGER')
  );

-- Duyet don xin quyen han (thuoc "Duyet don cap duoi") - BDH=A, TECH=X.
drop policy if exists permission_requests_decide on permission_requests;
create policy permission_requests_decide on permission_requests for update
  using (is_executive_strict())
  with check (is_executive_strict());

-- ---------------------------------------------------------------------
-- 5. De xuat noi bo: giu nguyen BDH duyet cap cuoi (da xac nhan uu tien
-- mo ta chi tiet ro rang hon o day - "Nhan vien -> QL truc tiep -> BDH
-- duyet cuoi cung" - chi doi TECH khong con duyet thay duoc, BDH van giu.
-- ---------------------------------------------------------------------
drop policy if exists proposals_update on internal_proposals;
create policy proposals_update on internal_proposals for update
  using (
    employee_id = current_employee_id()
    or (department_id = current_department_id() and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_strict()
  );
