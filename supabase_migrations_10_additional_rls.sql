-- =====================================================================
-- File 10: BỔ SUNG RLS (cập nhật dần qua các giai đoạn)
-- - leave_balances: chưa có RLS ở giai đoạn 1, cần cho hr/leave-balances.html
-- - UPDATE cho contracts / payment_requests / advance_requests /
--   event_proposals / purchase_requests: giai đoạn 1 chỉ có SELECT/INSERT,
--   cần bổ sung UPDATE cho luồng ký nhiều cấp qua pdfEditor.js
-- =====================================================================

alter table leave_balances enable row level security;

create policy leave_balances_select on leave_balances for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code = 'HR')
    or is_executive_or_tech()
  );

create policy leave_balances_write on leave_balances for all
  using (
    current_department_id() = (select id from departments where code = 'HR')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code = 'HR')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- Bổ sung UPDATE cho contracts (giai đoạn 1 chỉ có SELECT/INSERT) —
-- cần cho luồng ký 3 cấp: nhân viên -> trưởng phòng NS -> ban điều hành
-- ---------------------------------------------------------------------
create policy contracts_update on contracts for update
  using (
    employee_id = current_employee_id()
    or (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

-- Tương tự cho các phiếu Kế toán / Truyền thông / CSVC — cần khi áp dụng
-- luồng ký nhiều cấp qua pdfEditor.js (giai đoạn 1 chỉ có SELECT/INSERT).
create policy payment_requests_update on payment_requests for update
  using (
    requester_id = current_employee_id()
    or (current_department_id() = (select id from departments where code='ACC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

create policy advance_requests_update on advance_requests for update
  using (
    requester_id = current_employee_id()
    or (current_department_id() = (select id from departments where code='ACC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

create policy event_proposals_update on event_proposals for update
  using (
    center_manager_id = current_employee_id()
    or (current_department_id() = (select id from departments where code='MKT') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

create policy purchase_requests_update on purchase_requests for update
  using (
    requester_id = current_employee_id()
    or (current_department_id() = (select id from departments where code='FAC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- Bổ sung INSERT/UPDATE cho classes & students (giai đoạn 1 chỉ có SELECT)
-- — Quản lý trung tâm quản lý dữ liệu trung tâm mình; HR/MKT/Executive/Tech
--   xem được toàn bộ theo yêu cầu đề bài nhưng chỉ trung tâm mình mới sửa.
-- ---------------------------------------------------------------------
create policy classes_write on classes for insert
  with check (center_id = current_center_id() or is_executive_or_tech());
create policy classes_update on classes for update
  using (center_id = current_center_id() or is_executive_or_tech());

create policy students_write on students for insert
  with check (center_id = current_center_id() or is_executive_or_tech());
create policy students_update on students for update
  using (center_id = current_center_id() or is_executive_or_tech());

-- ---------------------------------------------------------------------
-- class_attendance & student_grades: chưa có RLS ở giai đoạn 1 —
-- cần cho module Giáo viên (điểm danh, bảng điểm).
-- Giáo viên chỉ thao tác lớp mình phụ trách; trung tâm/HR/Executive/Tech xem được.
-- ---------------------------------------------------------------------
alter table class_attendance enable row level security;
alter table student_grades enable row level security;

create policy attendance_select on class_attendance for select
  using (
    exists (select 1 from classes c where c.id = class_attendance.class_id
            and (c.teacher_id = current_employee_id() or c.center_id = current_center_id()))
    or is_executive_or_tech()
  );
create policy attendance_write on class_attendance for insert
  with check (
    exists (select 1 from classes c where c.id = class_attendance.class_id and c.teacher_id = current_employee_id())
    or is_executive_or_tech()
  );
create policy attendance_update on class_attendance for update
  using (
    exists (select 1 from classes c where c.id = class_attendance.class_id and c.teacher_id = current_employee_id())
    or is_executive_or_tech()
  );

create policy grades_select on student_grades for select
  using (
    exists (select 1 from classes c where c.id = student_grades.class_id
            and (c.teacher_id = current_employee_id() or c.center_id = current_center_id()))
    or is_executive_or_tech()
  );
create policy grades_write on student_grades for insert
  with check (
    exists (select 1 from classes c where c.id = student_grades.class_id and c.teacher_id = current_employee_id())
    or is_executive_or_tech()
  );
create policy grades_update on student_grades for update
  using (
    exists (select 1 from classes c where c.id = student_grades.class_id and c.teacher_id = current_employee_id())
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- crm_leads: giai đoạn 1 chỉ có SELECT/INSERT, cần UPDATE cho tư vấn
-- cập nhật trạng thái hồ sơ khách hàng (tiềm năng/thành công/từ chối).
-- ---------------------------------------------------------------------
create policy leads_update on crm_leads for update
  using (consultant_id = current_employee_id() or is_executive_or_tech());

-- ---------------------------------------------------------------------
-- communication_requests & facility_requests: giai đoạn 1 chỉ có
-- SELECT/INSERT — cần UPDATE để phòng Truyền thông/CSVC xử lý & phản hồi.
-- ---------------------------------------------------------------------
create policy commreq_update on communication_requests for update
  using (
    requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='MKT')
    or is_executive_or_tech()
  );

create policy facreq_update on facility_requests for update
  using (
    requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='FAC')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- Cho phép MỌI nhân viên gửi thông báo CÁ NHÂN (vd. báo kết quả xử lý
-- yêu cầu truyền thông/CSVC cho người đã gửi yêu cầu) — giai đoạn 1 chỉ
-- cho phép trưởng phòng trở lên ban hành thông báo (system/center/department).
-- ---------------------------------------------------------------------
create policy notifications_insert_personal on notifications for insert
  with check (scope = 'personal');

-- ---------------------------------------------------------------------
-- employee_documents: giai đoạn 1 đã BẬT RLS nhưng CHƯA có policy nào
-- (nghĩa là đang bị chặn toàn bộ) — bổ sung để trang Hồ sơ cá nhân dùng được.
-- ---------------------------------------------------------------------
create policy employee_documents_select on employee_documents for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );
create policy employee_documents_insert on employee_documents for insert
  with check (employee_id = current_employee_id() or is_executive_or_tech());
create policy employee_documents_delete on employee_documents for delete
  using (employee_id = current_employee_id() or is_executive_or_tech());

-- ---------------------------------------------------------------------
-- meeting_participants: giai đoạn 1 đã bật RLS nhưng chưa có policy nào.
-- ---------------------------------------------------------------------
create policy meeting_participants_select on meeting_participants for select
  using (
    employee_id = current_employee_id()
    or exists (select 1 from meetings m where m.id = meeting_participants.meeting_id and m.created_by = current_employee_id())
    or is_executive_or_tech()
  );
create policy meeting_participants_insert on meeting_participants for insert
  with check (
    exists (select 1 from meetings m where m.id = meeting_participants.meeting_id and m.created_by = current_employee_id())
    or is_executive_or_tech()
  );
create policy meeting_participants_update on meeting_participants for update
  using (employee_id = current_employee_id());

-- ---------------------------------------------------------------------
-- payroll, receivables, cash_flow_entries: chưa có RLS ở giai đoạn 1 —
-- cần cho module Kế toán (Bảng lương, Báo cáo tài chính).
-- ---------------------------------------------------------------------
alter table payroll enable row level security;
alter table receivables enable row level security;
alter table cash_flow_entries enable row level security;

create policy payroll_select on payroll for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  );
create policy payroll_write on payroll for insert
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());
create policy payroll_update on payroll for update
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

create policy receivables_all on receivables for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

create policy cashflow_all on cash_flow_entries for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());
