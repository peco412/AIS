-- =====================================================================
-- File 14: TÍNH NĂNG MỚI (chạy sau file 13)
-- - work_schedules: giờ bắt đầu/kết thúc thay vì gõ tay "ca"
-- - employees: Ban chuyên môn là 1 checkbox độc lập + "có thể dạy" linh hoạt
--   (không ép phải đổi cả phòng ban), không ảnh hưởng gì tới is_foreign_teacher
-- - Thu học phí: bảng tuition_payments + học phí dự kiến trên students
-- - Module xin thêm quyền hạn: permission_requests + granted_permissions
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Phân lịch làm việc: giờ bắt đầu/kết thúc thay vì "ca" tự do
-- ---------------------------------------------------------------------
alter table work_schedules add column if not exists start_time time;
alter table work_schedules add column if not exists end_time time;
-- Giữ lại "shift" làm nhãn hiển thị nhanh (vd "Sáng"/"Chiều"), không bắt buộc nữa.
alter table work_schedules alter column shift drop not null;

-- ---------------------------------------------------------------------
-- PHẦN 2 — Ban chuyên môn (checkbox độc lập) + vai trò giáo viên linh hoạt
-- Một nhân viên có thể: thuộc phòng ban chính (vd Nhân sự) VÀ đồng thời
-- thuộc Ban chuyên môn VÀ đồng thời dạy được — không cần đổi department_id.
-- ---------------------------------------------------------------------
alter table employees add column if not exists is_academic_board boolean not null default false;
alter table employees add column if not exists can_teach boolean not null default false;

comment on column employees.is_academic_board is 'Thành viên Ban chuyên môn (tick thêm, không thay department_id chính)';
comment on column employees.can_teach is 'Có thể đứng lớp giảng dạy dù department_id là phòng ban khác (vd Nhân sự kiêm dạy)';

-- ---------------------------------------------------------------------
-- PHẦN 3 — Thu học phí (Quản lý trung tâm)
-- ---------------------------------------------------------------------
alter table students add column if not exists monthly_fee numeric(12,2);

create table if not exists tuition_payments (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id),
  center_id uuid not null references centers(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','bank_transfer')),
  payment_date date not null default current_date,
  period_year int not null,
  period_month int not null,
  note text,
  collected_by uuid not null references employees(id),
  cash_flow_entry_id uuid references cash_flow_entries(id), -- link log dòng tiền cho kế toán
  created_at timestamptz not null default now()
);
create index if not exists idx_tuition_payments_student on tuition_payments(student_id);
create index if not exists idx_tuition_payments_center_period on tuition_payments(center_id, period_year, period_month);

alter table tuition_payments enable row level security;

create policy tuition_payments_select on tuition_payments for select
  using (
    (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or current_department_id() = (select id from departments where code = 'ACC')
    or is_executive_or_tech()
  );

create policy tuition_payments_insert on tuition_payments for insert
  with check (
    (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or is_executive_or_tech()
  );

-- Thu học phí SAI thì phải làm phiếu điều chỉnh mới (không cho sửa/xoá trực
-- tiếp) — đúng nguyên tắc "mỗi dòng tiền có 1 log cụ thể để kế toán kiểm tra".
-- Không tạo policy update/delete -> mặc định bị chặn với mọi người trừ TECH.
create policy tuition_payments_tech_manage on tuition_payments for all
  using (is_tech()) with check (is_tech());

-- Tự động ghi 1 dòng vào cash_flow_entries mỗi khi thu học phí, để kế toán
-- thấy ngay trong biểu đồ dòng tiền — đúng yêu cầu "link tự động vào dòng
-- tiền của kế toán".
create or replace function log_tuition_to_cash_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_flow_id uuid;
begin
  insert into cash_flow_entries (entry_type, amount, entry_date, center_id, category, note, created_by)
  values ('inflow', new.amount, new.payment_date, new.center_id, 'tuition',
          'Thu học phí — mã học viên ' || new.student_id::text || ' (' || new.method || ')', new.collected_by)
  returning id into v_cash_flow_id;

  update tuition_payments set cash_flow_entry_id = v_cash_flow_id where id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_tuition_to_cash_flow on tuition_payments;
create trigger trg_tuition_to_cash_flow
after insert on tuition_payments
for each row execute function log_tuition_to_cash_flow();

-- Lưu ý: cột cash_flow_entries.category là text tự do, không có check
-- constraint giới hạn giá trị -> insert category = 'tuition' ở trigger trên
-- luôn hợp lệ, không cần thao tác gì thêm.

-- ---------------------------------------------------------------------
-- PHẦN 4 — Module xin thêm quyền hạn theo yêu cầu phòng ban
-- ---------------------------------------------------------------------
create table if not exists permission_requests (
  id uuid primary key default uuid_generate_v4(),
  requested_by uuid not null references employees(id),   -- trưởng phòng đứng ra xin
  target_employee_id uuid not null references employees(id), -- nhân sự được xin quyền
  module_key text not null,        -- vd 'acc.payment_requests', 'fac.stats'...
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references employees(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_permission_requests_target on permission_requests(target_employee_id);

alter table permission_requests enable row level security;

create policy permission_requests_select on permission_requests for select
  using (
    requested_by = current_employee_id()
    or target_employee_id = current_employee_id()
    or is_dept_head_or_above()
  );

create policy permission_requests_insert on permission_requests for insert
  with check (
    requested_by = current_employee_id()
    and (is_dept_head_or_above() or is_executive_or_tech())
  );

create policy permission_requests_decide on permission_requests for update
  using (is_executive_or_tech())
  with check (is_executive_or_tech());

-- Quyền đã được duyệt cấp thêm — module_key là 1 định danh tự do do frontend
-- quy ước (vd tên trang), dùng để CHECK THÊM ở phía frontend khi hiển thị
-- menu/nút bấm cho đúng nhân sự đó, ngoài các quyền mặc định theo vai trò.
create table if not exists granted_permissions (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id),
  module_key text not null,
  granted_by uuid references employees(id),
  permission_request_id uuid references permission_requests(id),
  created_at timestamptz not null default now(),
  unique (employee_id, module_key)
);

alter table granted_permissions enable row level security;

create policy granted_permissions_select on granted_permissions for select
  using (employee_id = current_employee_id() or is_dept_head_or_above());

create policy granted_permissions_manage on granted_permissions for all
  using (is_executive_or_tech()) with check (is_executive_or_tech());

-- Tự động cấp quyền vào granted_permissions khi 1 permission_request được duyệt
create or replace function apply_approved_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into granted_permissions (employee_id, module_key, granted_by, permission_request_id)
    values (new.target_employee_id, new.module_key, new.decided_by, new.id)
    on conflict (employee_id, module_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_approved_permission on permission_requests;
create trigger trg_apply_approved_permission
after update on permission_requests
for each row execute function apply_approved_permission();
