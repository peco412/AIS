-- =====================================================================
-- File 29: MO QUYEN DOC CHO PHU HUYNH TREN students/classes/student_grades
-- (chay sau file 28)
--
-- Phat hien khi lam phan "lich hoc + bang diem" trong App phu huynh:
-- ca 3 bang nay CHUA TUNG co policy cho phu huynh xem, chi co nhan vien.
-- Vi PostgREST embedding (join) van ap dung RLS cua bang duoc join, ngay
-- ca cac cho DA CHAY TU TRUOC (vd bootParentShell() join sang students)
-- co the da bi loc mat du lieu ma khong bao loi gi ca - can va ngay.
-- =====================================================================

drop policy if exists students_select on students;
create policy students_select on students for select
  using (
    center_id = current_center_id()
    or current_department_id() = (select id from departments where code = 'HR')
    or current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
    or is_linked_to_student(id)
  );

drop policy if exists classes_select on classes;
create policy classes_select on classes for select
  using (
    center_id = current_center_id()
    or current_department_id() = (select id from departments where code = 'HR')
    or current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
    or exists (select 1 from students s where s.class_id = classes.id and is_linked_to_student(s.id))
  );

drop policy if exists grades_select on student_grades;
create policy grades_select on student_grades for select
  using (
    exists (select 1 from classes c where c.id = student_grades.class_id
            and (c.teacher_id = current_employee_id() or c.center_id = current_center_id()))
    or is_executive_or_tech()
    or is_linked_to_student(student_grades.student_id)
  );
