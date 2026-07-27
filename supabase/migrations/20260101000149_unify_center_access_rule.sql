-- =====================================================================
-- File 149: CHUAN HOA QUYEN "XEM TAT CA TRUNG TAM" (24/07/2026)
-- =====================================================================
-- Yeu cau: nhan vien cua trung tam nao chi vao duoc du lieu cua trung
-- tam do; CHI Ban dieu hanh, Ke toan, Truong phong/Pho phong (BAT KY
-- phong ban nao), va Tech moi duoc xem TAT CA trung tam.
--
-- Ra soat lai toan bo policy hien co thi thay quy tac nay dang bi AP
-- DUNG KHONG DONG NHAT giua cac bang:
--   - students/classes/attendance_checkins/center_duty/teacher_weekly:
--     cho phep TOAN BO nhan vien phong HR va MKT (moi cap bac, ke ca
--     nhan vien thuong) xem tat ca trung tam — RONG HON muc can thiet,
--     va lai KHONG cho phong Ke toan (ACC) hay Truong/Pho phong cac
--     phong khac (vd CSVC) duoc xem tat ca — THIEU so voi yeu cau.
--   - invoices/debt_ledger: co ACC nhung lai KHONG co Truong/Pho phong
--     cac phong khac ngoai Ke toan.
--
-- Sua bang 1 ham dung chung MOI — "sees_all_centers()" — de tu nay moi
-- noi ap dung DUNG 1 quy tac, khong con lech nhau giua cac bang.
-- =====================================================================

create or replace function sees_all_centers() returns boolean
language sql stable security definer as $$
  select is_dept_head_or_above() -- da bao gom EXECUTIVE, TECH, DEPT_HEAD, DEPT_DEPUTY (moi phong ban)
    or current_department_id() = (select id from departments where code = 'ACC');
$$;

-- ---------------------------------------------------------------------
-- students / classes — truoc day HR+MKT (moi cap bac) duoc xem tat ca,
-- ACC va Truong/Pho phong cac phong khac lai khong duoc — sua lai dung.
-- ---------------------------------------------------------------------
drop policy if exists students_select on students;
create policy students_select on students for select
  using (
    center_id = current_center_id()
    or sees_all_centers()
    or is_linked_to_student(id)
  );

drop policy if exists classes_select on classes;
create policy classes_select on classes for select
  using (
    center_id = current_center_id()
    or sees_all_centers()
    or exists (select 1 from students s where s.class_id = classes.id and is_linked_to_student(s.id))
  );

-- ---------------------------------------------------------------------
-- attendance_checkins — cham cong nhan vien
-- ---------------------------------------------------------------------
drop policy if exists attendance_checkins_select on attendance_checkins;
create policy attendance_checkins_select on attendance_checkins for select
  using (
    employee_id = current_employee_id()
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or sees_all_centers()
  );

-- ---------------------------------------------------------------------
-- center_duty_schedules — lich truc trung tam
-- ---------------------------------------------------------------------
drop policy if exists center_duty_select on center_duty_schedules;
create policy center_duty_select on center_duty_schedules for select
  using (
    (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or sees_all_centers()
  );

-- ---------------------------------------------------------------------
-- teacher_weekly_schedules — lich day giao vien
-- ---------------------------------------------------------------------
drop policy if exists teacher_weekly_select on teacher_weekly_schedules;
create policy teacher_weekly_select on teacher_weekly_schedules for select
  using (
    teacher_id = current_employee_id()
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or sees_all_centers()
  );

-- ---------------------------------------------------------------------
-- invoices / debt_ledger — da co ACC tu truoc, gio bo sung them
-- Truong/Pho phong cac phong khac (dung sees_all_centers() thay vi
-- ghi rieng tung dieu kien nhu truoc, de dam bao dong nhat ve sau).
-- ---------------------------------------------------------------------
drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select using (
  is_linked_to_student(student_id) or sees_all_centers()
  or (current_role_code()='CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
);

drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all
  using (sees_all_centers())
  with check (sees_all_centers());

drop policy if exists debt_ledger_select on debt_ledger;
create policy debt_ledger_select on debt_ledger for select using (
  invoice_id in (select id from invoices i where is_linked_to_student(i.student_id))
  or sees_all_centers()
  or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and invoice_id in (
    select i.id from invoices i join students s on s.id = i.student_id where s.center_id = current_center_id()
  ))
);

-- =====================================================================
-- LUU Y QUAN TRONG — pham vi da ra soat trong dot nay:
-- Da kiem tra va sua 7 bang lien quan truc tiep nhat toi du lieu hoc
-- vien/trung tam (students, classes, attendance_checkins,
-- center_duty_schedules, teacher_weekly_schedules, invoices,
-- debt_ledger). Toan bo he thong con hang chuc bang khac lien quan
-- toi trung tam (vi du: wallet_transactions, retail_sales,
-- inventory_items theo kho trung tam, class_sessions, student_grades,
-- v.v...) CHUA duoc ra soat het trong lan nay do khoi luong rat lon —
-- can 1 dot ra soat rieng, toan dien hon de dam bao KHONG bang nao con
-- sot quy tac cu (HR/MKT rong hon can thiet, hoac thieu ACC/Truong-Pho
-- phong). Ham "sees_all_centers()" da san sang de dung nhat quan cho
-- cac lan sua tiep theo.
-- =====================================================================
