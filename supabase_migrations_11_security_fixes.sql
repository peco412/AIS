-- =====================================================================
-- File 11: VÁ LỖI BẢO MẬT + LOGIC (chạy sau supabase_migrations_10_additional_rls.sql)
-- Tổng hợp toàn bộ lỗi phát hiện khi rà soát bảo mật + đối chiếu đề bài gốc.
-- Chạy toàn bộ file này 1 lần trong SQL Editor.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — EMPLOYEES: chặn lộ PII + chặn tự nâng quyền
-- =====================================================================

-- 1.1 Chỉ user đã đăng nhập mới SELECT được employees (trước đây "using (true)"
-- áp dụng cho cả role chưa xác thực).
drop policy if exists employees_select_all on employees;
create policy employees_select_all on employees for select
  to authenticated
  using (true);

-- 1.2 Chặn nhân viên tự đổi role_id/department_id/center_id/status/employee_code/
-- temp_password_flag của chính mình khi tự sửa hồ sơ (employees_update_self).
-- Postgres RLS là row-level, không chặn được theo cột -> phải dùng trigger.
create or replace function prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_hr_admin boolean;
begin
  -- Người có quyền quản trị nhân sự thật sự (HR head/deputy, Executive, Tech)
  -- được phép đổi các trường này bình thường, kể cả khi họ đang sửa hồ sơ chính mình.
  select
    is_executive_or_tech()
    or (current_department_id() = (select id from departments where code = 'HR')
        and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
  into is_hr_admin;

  if not is_hr_admin and auth.uid() = old.auth_user_id then
    if new.role_id       is distinct from old.role_id
    or new.department_id is distinct from old.department_id
    or new.center_id     is distinct from old.center_id
    or new.status        is distinct from old.status
    or new.employee_code is distinct from old.employee_code
    or new.temp_password_flag is distinct from old.temp_password_flag
    or new.auth_user_id  is distinct from old.auth_user_id
    then
      raise exception 'Không được phép tự thay đổi các trường phân quyền/trạng thái tài khoản.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists employees_guard_self_update on employees;
create trigger employees_guard_self_update
before update on employees
for each row execute function prevent_self_privilege_escalation();

-- =====================================================================
-- PHẦN 2 — CONTRACTS: sửa insert mở toang + chặn tự duyệt qua update
-- =====================================================================

drop policy if exists contracts_insert on contracts;
create policy contracts_insert on contracts for insert
  with check (
    employee_id = current_employee_id()
    or (current_department_id() = (select id from departments where code='HR')
        and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

-- Chặn người không có thẩm quyền set thẳng workflow_status / các cột *_signed_*
-- Áp dụng chung 1 trigger cho 5 bảng phiếu ký nhiều cấp.
create or replace function enforce_workflow_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_col_val uuid;
  dept_code text;
  is_owner boolean;
  is_dept_approver boolean;
  is_exec boolean;
begin
  is_exec := is_executive_or_tech();

  if tg_table_name = 'contracts' then
    owner_col_val := old.employee_id; dept_code := 'HR';
  elsif tg_table_name = 'payment_requests' then
    owner_col_val := old.requester_id; dept_code := 'ACC';
  elsif tg_table_name = 'advance_requests' then
    owner_col_val := old.requester_id; dept_code := 'ACC';
  elsif tg_table_name = 'event_proposals' then
    owner_col_val := old.center_manager_id; dept_code := 'MKT';
  elsif tg_table_name = 'purchase_requests' then
    owner_col_val := old.requester_id; dept_code := 'FAC';
  end if;

  is_owner := (owner_col_val = current_employee_id());
  is_dept_approver := (
    current_department_id() = (select id from departments where code = dept_code)
    and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY')
  );

  if is_exec then
    return new; -- Executive/Tech luôn được phép, kể cả sửa chữa dữ liệu khi cần
  end if;

  if new.status is distinct from old.status then
    -- Chỉ cho đi đúng 1 bước tới trong workflow, đúng người ở đúng bước
    if old.status = 'draft' and new.status = 'submitted' and is_owner then
      -- ok: chủ phiếu nộp phiếu
    elsif old.status = 'submitted' and new.status = 'approved_1' and is_dept_approver then
      -- ok: trưởng/phó phòng phụ trách duyệt cấp 1
    elsif old.status = 'approved_1' and new.status = 'approved_2' and is_exec then
      -- không tới được đây vì is_exec đã return ở trên, giữ lại cho rõ ràng
    elsif new.status = 'rejected' and (is_owner or is_dept_approver) then
      -- ok: từ chối
    else
      raise exception 'Không được phép chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  elsif is_owner and old.status not in ('draft','submitted') then
    -- Chủ phiếu chỉ được sửa nội dung khi phiếu còn ở draft/submitted (trước khi có người duyệt)
    raise exception 'Phiếu đã được duyệt, không thể tự chỉnh sửa.';
  elsif not is_owner and not is_dept_approver then
    raise exception 'Bạn không có quyền sửa phiếu này.';
  end if;

  return new;
end;
$$;

drop trigger if exists contracts_guard_update on contracts;
create trigger contracts_guard_update
before update on contracts
for each row execute function enforce_workflow_transition();

drop trigger if exists payment_requests_guard_update on payment_requests;
create trigger payment_requests_guard_update
before update on payment_requests
for each row execute function enforce_workflow_transition();

drop trigger if exists advance_requests_guard_update on advance_requests;
create trigger advance_requests_guard_update
before update on advance_requests
for each row execute function enforce_workflow_transition();

drop trigger if exists event_proposals_guard_update on event_proposals;
create trigger event_proposals_guard_update
before update on event_proposals
for each row execute function enforce_workflow_transition();

drop trigger if exists purchase_requests_guard_update on purchase_requests;
create trigger purchase_requests_guard_update
before update on purchase_requests
for each row execute function enforce_workflow_transition();

-- LƯU Ý: trigger trên chỉ chặn *trạng thái workflow* nhảy sai bước / sai người.
-- Nó KHÔNG tự động chặn việc chủ phiếu sửa số tiền/nội dung trong lúc còn 'draft'
-- (đúng ý đồ vì họ cần được sửa nháp trước khi nộp). Khi cần khoá cứng thêm cột
-- (ví dụ không cho sửa "amount" sau khi đã 'submitted'), báo lại để bổ sung riêng
-- theo từng bảng vì tên cột số tiền khác nhau ở mỗi bảng.

-- =====================================================================
-- PHẦN 3 — LEAVE_REQUESTS / BUSINESS_TRIPS: thiếu hẳn policy UPDATE
-- (nút "Duyệt" hiện đang không làm gì cả trên production)
-- =====================================================================

drop policy if exists leave_update on leave_requests;
create policy leave_update on leave_requests for update
  using (
    (employee_id = current_employee_id() and status = 'draft')
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );

drop policy if exists trips_update on business_trips;
create policy trips_update on business_trips for update
  using (
    (employee_id = current_employee_id() and status = 'draft')
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );

-- =====================================================================
-- PHẦN 4 — Trừ ngày phép ATOMIC bằng RPC, thay vì đọc-rồi-ghi ở frontend
-- =====================================================================

create or replace function approve_leave_request(p_leave_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leave leave_requests%rowtype;
begin
  select * into v_leave from leave_requests where id = p_leave_id for update;
  if not found then
    raise exception 'Không tìm thấy đơn nghỉ phép.';
  end if;

  if not (
    current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền duyệt đơn này.';
  end if;

  update leave_requests
  set status = 'approved_2', approved_by = current_employee_id(), approved_at = now()
  where id = p_leave_id;

  if v_leave.leave_type = 'annual' then
    insert into leave_balances (employee_id, year, month, annual_leave_accrued, annual_leave_used, compensatory_leave)
    values (v_leave.employee_id, extract(year from v_leave.start_date)::int, extract(month from v_leave.start_date)::int, 0, v_leave.days, 0)
    on conflict (employee_id, year, month)
    do update set annual_leave_used = leave_balances.annual_leave_used + v_leave.days;
  end if;
end;
$$;

-- Lưu ý: cần có unique constraint (employee_id, year, month) trên leave_balances
-- để "on conflict" hoạt động — kiểm tra lại constraint hiện có trước khi chạy,
-- thêm nếu thiếu:
-- alter table leave_balances add constraint leave_balances_emp_year_month_uniq unique (employee_id, year, month);

-- =====================================================================
-- PHẦN 5 — Đếm thông báo chưa đọc đúng công thức, 1 round-trip thay vì 2
-- =====================================================================

create or replace function unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from notifications n
  where (
    n.scope = 'system'
    or (n.scope = 'center' and n.center_id = current_center_id())
    or (n.scope = 'department' and n.department_id = current_department_id())
    or (n.scope = 'personal' and n.target_employee_id = current_employee_id())
  )
  and not exists (
    select 1 from notification_reads r
    where r.notification_id = n.id and r.employee_id = current_employee_id()
  );
$$;

-- =====================================================================
-- PHẦN 6 — Các bảng ĐANG HOÀN TOÀN KHÔNG CÓ RLS (mở toang cho mọi user
-- đã đăng nhập đọc/ghi/xoá tự do) — phát hiện khi đối chiếu lại toàn bộ đề bài.
-- =====================================================================

-- 6.1 signature_logs: log ký số — bằng chứng pháp lý ai ký gì, khi nào.
-- Phải là "chỉ ghi, không sửa/xoá" (append-only) với người thường.
alter table signature_logs enable row level security;

create policy signature_logs_select on signature_logs for select
  using (
    employee_id = current_employee_id()
    or is_executive_or_tech()
    or is_dept_head_or_above()
  );

create policy signature_logs_insert on signature_logs for insert
  with check (employee_id = current_employee_id());

-- Cố tình KHÔNG tạo policy update/delete cho ai ngoài is_tech() -> mặc định
-- bị chặn hoàn toàn (đúng ý nghĩa "append-only" của log ký số).
create policy signature_logs_tech_manage on signature_logs for all
  using (is_tech()) with check (is_tech());

-- 6.2 work_schedules / center_duty_schedules / teacher_weekly_schedules
alter table work_schedules enable row level security;
alter table center_duty_schedules enable row level security;
alter table teacher_weekly_schedules enable row level security;

create policy work_schedules_select on work_schedules for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );
create policy work_schedules_write on work_schedules for all
  using (
    current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );

create policy center_duty_select on center_duty_schedules for select
  using (
    center_id = current_center_id()
    or current_department_id() = (select id from departments where code='HR')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );
create policy center_duty_write on center_duty_schedules for all
  using (
    (center_id = current_center_id() and current_role_code() = 'CENTER_MANAGER')
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  )
  with check (
    (center_id = current_center_id() and current_role_code() = 'CENTER_MANAGER')
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );

create policy teacher_weekly_select on teacher_weekly_schedules for select
  using (
    teacher_id = current_employee_id()
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );
create policy teacher_weekly_write on teacher_weekly_schedules for all
  using (current_role_code() = 'CENTER_MANAGER' or is_executive_or_tech())
  with check (current_role_code() = 'CENTER_MANAGER' or is_executive_or_tech());

-- 6.3 facility_assets: chỉ CSVC + Executive/Tech quản lý, người khác xem được
alter table facility_assets enable row level security;
create policy facility_assets_select on facility_assets for select using (true);
create policy facility_assets_write on facility_assets for all
  using (
    current_department_id() = (select id from departments where code='FAC')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='FAC')
    or is_executive_or_tech()
  );

-- 6.4 document_templates: ai cũng cần đọc (dùng làm nền PDF form),
-- nhưng chỉ HR/Tech mới được sửa field_map/thay file mẫu (tránh bị chèn sai
-- vị trí chữ ký hoặc thay file mẫu độc hại).
alter table document_templates enable row level security;
create policy document_templates_select on document_templates for select
  to authenticated using (true);
create policy document_templates_write on document_templates for all
  using (
    current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );

-- 6.5 document_code_counters: chỉ backend (trigger sinh mã) mới cần ghi,
-- người dùng thường không cần truy cập trực tiếp bảng này.
--
-- QUAN TRỌNG: generate_document_code() (định nghĩa ở file 07) được gọi từ
-- trigger BEFORE INSERT trên contracts/leave_requests/payment_requests/...
-- và chạy với quyền của NGƯỜI DÙNG ĐANG GỌI (không phải security definer).
-- Nếu khoá bảng đếm này lại chỉ cho TECH mà không sửa hàm, MỌI nhân viên
-- khác sẽ không insert được bất kỳ phiếu nào nữa (lỗi RLS ngay khi trigger
-- chạy). Phải đổi hàm sang SECURITY DEFINER trước khi khoá bảng.
create or replace function generate_document_code(p_prefix text) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now());
  v_month int := extract(month from now());
  v_next int;
begin
  insert into document_code_counters (prefix, year, month, last_number)
  values (p_prefix, v_year, v_month, 1)
  on conflict (prefix, year, month)
  do update set last_number = document_code_counters.last_number + 1
  returning last_number into v_next;

  return p_prefix || '-' || v_year::text || '-' || lpad(v_month::text, 2, '0')
         || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- Tương tự, generate_employee_code() dùng sequence riêng (không phải bảng
-- có RLS) nên không bị ảnh hưởng, nhưng đổi luôn cho nhất quán + an toàn.
create or replace function generate_employee_code() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  n := nextval('employee_code_seq');
  return 'AIS-' || lpad(n::text, 4, '0');
end;
$$;

alter table document_code_counters enable row level security;
create policy document_code_counters_tech on document_code_counters for all
  using (is_tech()) with check (is_tech());

-- 6.6 internal_accounts: đã bật RLS ở file 08 nhưng CHƯA có policy nào
-- (đang bị chặn hoàn toàn) -> trang "Thông tin tài khoản nội bộ" (MKT) không dùng được.
create policy internal_accounts_select on internal_accounts for select
  using (
    current_department_id() = (select id from departments where code='MKT')
    or is_executive_or_tech()
  );
create policy internal_accounts_write on internal_accounts for all
  using (
    current_department_id() = (select id from departments where code='MKT')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='MKT')
    or is_executive_or_tech()
  );

-- =====================================================================
-- PHẦN 7 — Index còn thiếu trên các cột khoá ngoại hay dùng để lọc/join
-- (Postgres không tự tạo index cho FK)
-- =====================================================================

create index if not exists idx_leave_requests_employee on leave_requests(employee_id);
create index if not exists idx_business_trips_employee on business_trips(employee_id);
create index if not exists idx_payment_requests_requester on payment_requests(requester_id);
create index if not exists idx_advance_requests_requester on advance_requests(requester_id);
create index if not exists idx_notifications_center on notifications(center_id);
create index if not exists idx_notifications_department on notifications(department_id);
create index if not exists idx_notifications_target_employee on notifications(target_employee_id);
create index if not exists idx_notification_reads_employee on notification_reads(employee_id);
create index if not exists idx_classes_center on classes(center_id);
create index if not exists idx_classes_teacher on classes(teacher_id);
create index if not exists idx_students_center on students(center_id);
create index if not exists idx_meeting_participants_employee on meeting_participants(employee_id);
create index if not exists idx_meeting_participants_meeting on meeting_participants(meeting_id);
create index if not exists idx_signature_logs_signed_by on signature_logs(employee_id);
create index if not exists idx_archive_files_department on archive_files(department_id);

-- =====================================================================
-- PHẦN 8 — Cộng dồn 1 ngày phép/tháng tự động (đúng yêu cầu đề bài)
-- Cần bật extension pg_cron (Supabase Dashboard -> Database -> Extensions)
-- rồi lên lịch gọi hàm này vào 00:05 ngày 1 mỗi tháng.
-- =====================================================================

create or replace function accrue_monthly_leave()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_month int := extract(month from now())::int;
begin
  insert into leave_balances (employee_id, year, month, annual_leave_accrued, annual_leave_used, compensatory_leave)
  select id, v_year, v_month, 1, 0, 0
  from employees
  where status = 'active'
  on conflict (employee_id, year, month)
  do update set annual_leave_accrued = leave_balances.annual_leave_accrued + 1;
end;
$$;

-- Sau khi bật pg_cron:
-- select cron.schedule('accrue-monthly-leave', '5 0 1 * *', 'select accrue_monthly_leave();');
