-- =====================================================================
-- File 08: ROW LEVEL SECURITY (RLS)
-- Vai trò hệ thống (system_roles.code) dùng trong toàn bộ policy:
--   EXECUTIVE      - Ban điều hành (Tổng GĐ, Phó GĐ, GĐ điều hành)
--   DEPT_HEAD      - Trưởng phòng (mọi phòng ban)
--   DEPT_DEPUTY    - Phó phòng
--   STAFF          - Nhân viên thường trong phòng ban
--   CENTER_MANAGER - Quản lý trung tâm
--   TEACHER        - Giáo viên
--   CONSULTANT     - Nhân viên tư vấn
--   TECH           - Nhân viên kỹ thuật (toàn quyền + xem log)
-- =====================================================================

-- ---------------------------------------------------------------------
-- HÀM HELPER (SECURITY DEFINER để tránh đệ quy RLS)
-- ---------------------------------------------------------------------
create or replace function current_employee_id() returns uuid
language sql stable security definer as $$
  select id from employees where auth_user_id = auth.uid();
$$;

create or replace function current_role_code() returns text
language sql stable security definer as $$
  select sr.code from employees e
  join system_roles sr on sr.id = e.role_id
  where e.auth_user_id = auth.uid();
$$;

create or replace function current_department_id() returns uuid
language sql stable security definer as $$
  select department_id from employees where auth_user_id = auth.uid();
$$;

create or replace function current_center_id() returns uuid
language sql stable security definer as $$
  select center_id from employees where auth_user_id = auth.uid();
$$;

create or replace function is_tech() returns boolean
language sql stable security definer as $$
  select current_role_code() = 'TECH';
$$;

create or replace function is_executive_or_tech() returns boolean
language sql stable security definer as $$
  select current_role_code() in ('EXECUTIVE','TECH');
$$;

create or replace function is_dept_head_or_above() returns boolean
language sql stable security definer as $$
  select current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY','EXECUTIVE','TECH');
$$;

-- ---------------------------------------------------------------------
-- BẬT RLS CHO TOÀN BỘ BẢNG NGHIỆP VỤ
-- ---------------------------------------------------------------------
alter table employees enable row level security;
alter table employee_documents enable row level security;
alter table archive_files enable row level security;
alter table activity_logs enable row level security;
alter table notifications enable row level security;
alter table notification_reads enable row level security;
alter table internal_proposals enable row level security;
alter table contracts enable row level security;
alter table leave_requests enable row level security;
alter table business_trips enable row level security;
alter table payment_requests enable row level security;
alter table advance_requests enable row level security;
alter table event_proposals enable row level security;
alter table purchase_requests enable row level security;
alter table communication_requests enable row level security;
alter table facility_requests enable row level security;
alter table task_assignments enable row level security;
alter table classes enable row level security;
alter table students enable row level security;
alter table crm_leads enable row level security;
alter table internal_accounts enable row level security;
alter table meetings enable row level security;
alter table meeting_participants enable row level security;

-- ---------------------------------------------------------------------
-- EMPLOYEES: ai cũng xem được danh sách cơ bản (cho chọn người mời họp,
-- gán việc...), nhưng chỉ HR/Executive/Tech mới sửa; tự sửa profile mình.
-- ---------------------------------------------------------------------
create policy employees_select_all on employees for select using (true);

create policy employees_update_self on employees for update
  using (auth_user_id = auth.uid());

create policy employees_manage_hr on employees for all
  using (current_role_code() in ('TECH') or
         (current_department_id() = (select id from departments where code='HR')
          and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
         or is_executive_or_tech());

-- ---------------------------------------------------------------------
-- ACTIVITY LOGS: chỉ nhân viên kỹ thuật xem được (yêu cầu đề bài)
-- ---------------------------------------------------------------------
create policy activity_logs_tech_only on activity_logs for select
  using (is_tech());
create policy activity_logs_insert_system on activity_logs for insert
  with check (true); -- ghi log do backend/service role thực hiện

-- ---------------------------------------------------------------------
-- KHO LƯU TRỮ HỆ THỐNG: phân quyền theo phòng ban sở hữu tài liệu.
-- Executive/Tech xem toàn bộ. Phòng khác bấm vào sẽ được ứng dụng hiển thị
-- "bạn không có quyền thực hiện thao tác" (chặn ở RLS, xử lý thông báo ở FE).
-- ---------------------------------------------------------------------
create policy archive_select_own_dept on archive_files for select
  using (
    department_id = current_department_id()
    or is_executive_or_tech()
  );

create policy archive_insert_own_dept on archive_files for insert
  with check (
    department_id = current_department_id()
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- THÔNG BÁO: xem theo scope tương ứng với người dùng
-- ---------------------------------------------------------------------
create policy notifications_select on notifications for select
  using (
    scope = 'system'
    or (scope = 'center' and center_id = current_center_id())
    or (scope = 'department' and department_id = current_department_id())
    or (scope = 'personal' and target_employee_id = current_employee_id())
    or is_executive_or_tech()
  );

create policy notifications_insert on notifications for insert
  with check (is_dept_head_or_above());

-- ---------------------------------------------------------------------
-- ĐỀ XUẤT NỘI BỘ: người tạo + trưởng phòng liên quan + ban điều hành + tech
-- ---------------------------------------------------------------------
create policy proposals_select on internal_proposals for select
  using (
    employee_id = current_employee_id()
    or department_id = current_department_id()
    or is_executive_or_tech()
  );

create policy proposals_insert on internal_proposals for insert
  with check (employee_id = current_employee_id());

create policy proposals_update on internal_proposals for update
  using (
    employee_id = current_employee_id()
    or (department_id = current_department_id() and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- CÁC PHIẾU CÁ NHÂN (hợp đồng, nghỉ phép, công tác, thanh toán, tạm ứng,
-- trình sự kiện, mua sắm): người tạo xem/sửa phiếu của mình; phòng ban
-- phụ trách xử lý + ban điều hành/tech xem toàn bộ. Áp dụng cùng 1 mẫu
-- cho tất cả các bảng dưới đây (đổi tên bảng và cột phụ trách tương ứng).
-- ---------------------------------------------------------------------
create policy contracts_select on contracts for select
  using (employee_id = current_employee_id()
         or current_department_id() = (select id from departments where code='HR')
         or is_executive_or_tech());
create policy contracts_insert on contracts for insert
  with check (true); -- mọi nhân viên có thể khởi tạo hợp đồng cho chính mình/người khác qua HR

create policy leave_select on leave_requests for select
  using (employee_id = current_employee_id()
         or current_department_id() = (select id from departments where code='HR')
         or is_executive_or_tech());
create policy leave_insert on leave_requests for insert
  with check (employee_id = current_employee_id());

create policy trips_select on business_trips for select
  using (employee_id = current_employee_id()
         or current_department_id() = (select id from departments where code='HR')
         or is_executive_or_tech());
create policy trips_insert on business_trips for insert
  with check (employee_id = current_employee_id());

create policy payreq_select on payment_requests for select
  using (requester_id = current_employee_id()
         or current_department_id() = (select id from departments where code='ACC')
         or is_executive_or_tech());
create policy payreq_insert on payment_requests for insert
  with check (requester_id = current_employee_id());

create policy advreq_select on advance_requests for select
  using (requester_id = current_employee_id()
         or current_department_id() = (select id from departments where code='ACC')
         or is_executive_or_tech());
create policy advreq_insert on advance_requests for insert
  with check (requester_id = current_employee_id());

create policy eventprop_select on event_proposals for select
  using (center_manager_id = current_employee_id()
         or current_department_id() = (select id from departments where code='MKT')
         or is_executive_or_tech());
create policy eventprop_insert on event_proposals for insert
  with check (center_manager_id = current_employee_id());

create policy purchasereq_select on purchase_requests for select
  using (requester_id = current_employee_id()
         or current_department_id() = (select id from departments where code='FAC')
         or is_executive_or_tech());
create policy purchasereq_insert on purchase_requests for insert
  with check (requester_id = current_employee_id());

-- Yêu cầu hỗ trợ liên phòng ban: người gửi + phòng xử lý + tech
create policy commreq_select on communication_requests for select
  using (requester_id = current_employee_id()
         or current_department_id() = (select id from departments where code='MKT')
         or is_executive_or_tech());
create policy commreq_insert on communication_requests for insert
  with check (requester_id = current_employee_id());

create policy facreq_select on facility_requests for select
  using (requester_id = current_employee_id()
         or current_department_id() = (select id from departments where code='FAC')
         or is_executive_or_tech());
create policy facreq_insert on facility_requests for insert
  with check (requester_id = current_employee_id());

-- ---------------------------------------------------------------------
-- PHÂN VIỆC: trưởng phòng giao và người được giao xem được
-- ---------------------------------------------------------------------
create policy tasks_select on task_assignments for select
  using (assigned_to = current_employee_id()
         or assigned_by = current_employee_id()
         or is_executive_or_tech());
create policy tasks_manage on task_assignments for all
  using (assigned_by = current_employee_id() or is_dept_head_or_above());

-- ---------------------------------------------------------------------
-- HỌC VỤ: quản lý trung tâm/giáo viên chỉ thấy dữ liệu trung tâm mình,
-- HR/Marketing/Executive/Tech xem toàn bộ theo yêu cầu đề bài.
-- ---------------------------------------------------------------------
create policy classes_select on classes for select
  using (center_id = current_center_id()
         or current_role_code() in ('EXECUTIVE','TECH','DEPT_HEAD','DEPT_DEPUTY'));

create policy students_select on students for select
  using (center_id = current_center_id()
         or current_role_code() in ('EXECUTIVE','TECH','DEPT_HEAD','DEPT_DEPUTY'));

-- ---------------------------------------------------------------------
-- CRM (hồ sơ khách hàng): chỉ tư vấn phụ trách + quản lý trung tâm + tech
-- ---------------------------------------------------------------------
create policy leads_select on crm_leads for select
  using (consultant_id = current_employee_id()
         or center_id = current_center_id()
         or is_executive_or_tech());
create policy leads_insert on crm_leads for insert
  with check (consultant_id = current_employee_id());

-- ---------------------------------------------------------------------
-- LỊCH HỌP: người tạo + người được mời xem được
-- ---------------------------------------------------------------------
create policy meetings_select on meetings for select
  using (
    created_by = current_employee_id()
    or exists (select 1 from meeting_participants mp
               where mp.meeting_id = meetings.id and mp.employee_id = current_employee_id())
    or is_executive_or_tech()
  );
create policy meetings_insert on meetings for insert
  with check (created_by = current_employee_id());

-- =====================================================================
-- GHI CHÚ: các bảng còn lại (leave_balances, work_schedules,
-- center_duty_schedules, teacher_weekly_schedules, class_attendance,
-- student_grades, receivables, cash_flow_entries, payroll,
-- internal_accounts, facility_assets, document_templates,
-- document_code_counters, employee_documents) áp dụng cùng nguyên tắc:
--   1) is_tech() luôn có toàn quyền,
--   2) phòng ban/trung tâm phụ trách được đọc/ghi trong phạm vi của mình,
--   3) cá nhân chỉ đọc dữ liệu liên quan trực tiếp đến mình.
-- Bật RLS và viết policy tương tự mẫu ở trên khi triển khai chi tiết
-- từng module trong các giai đoạn tiếp theo.
-- =====================================================================
