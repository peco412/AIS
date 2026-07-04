-- =====================================================================
-- ERP AIS - SUPABASE SCHEMA
-- File 01: CORE - Phân hệ, Trung tâm, Phòng ban, Chức vụ, Vai trò, Nhân viên
-- =====================================================================
-- Quy ước: mọi bảng nghiệp vụ đều có created_at/updated_at.
-- Mọi bảng "phiếu" (workflow) dùng chung enum workflow_status.
-- RLS (Row Level Security) được bật cho toàn bộ bảng, chính sách mẫu ở file 08.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type workflow_status as enum (
  'draft', 'submitted', 'approved_1', 'approved_2', 'archived', 'rejected'
);

create type employee_status as enum ('active', 'probation', 'inactive', 'resigned');

create type contract_type as enum ('full_time', 'part_time', 'service', 'probation');

create type notification_scope as enum ('system', 'center', 'department', 'personal');

create type language_pref as enum ('vi', 'en');

create type doc_category as enum (
  'labor_contract', 'service_contract', 'admin_paper', 'internal_proposal', 'other',
  'payment_request', 'advance_request', 'event_proposal', 'purchase_request',
  'communication_request', 'facility_request', 'template'
);

create type leave_type as enum ('unpaid', 'annual', 'social_insurance');

create type leave_reason as enum (
  'work_swap', 'personal_family', 'sick', 'maternity', 'ceremony', 'funeral'
);

create type comm_request_type as enum ('design', 'print', 'ads', 'event', 'photo_video');

create type fac_request_type as enum ('repair', 'new_supply', 'purchase');

create type student_status as enum ('studying', 'paused', 'dropped');

create type lead_status as enum ('potential', 'success', 'rejected');

create type meeting_kind as enum ('offline', 'online');

-- ---------------------------------------------------------------------
-- PHÂN HỆ (Division): ALOHA / iLingo
-- ---------------------------------------------------------------------
create table divisions (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,          -- 'ALOHA' | 'ILINGO'
  name text not null,
  theme_color text not null,          -- #0094D9 ALOHA | #0B6C37 iLingo
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- TRUNG TÂM (8 trung tâm, thuộc 1 trong 2 phân hệ)
-- ---------------------------------------------------------------------
create table centers (
  id uuid primary key default uuid_generate_v4(),
  division_id uuid not null references divisions(id),
  code text not null unique,          -- ví dụ MOCAY, DUYENHAI...
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PHÒNG BAN
-- ---------------------------------------------------------------------
create table departments (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,          -- BDH, BCM, HR, ACC, MKT, EDU, FAC, TECH
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CHỨC VỤ (gắn với phòng ban, có cấp bậc để xác định người duyệt)
-- approval_level: 0=nhân viên thường, 1=trưởng/phó phòng (duyệt cấp 1),
--                 2=ban điều hành (duyệt cấp 2), 9=nhân viên kỹ thuật (toàn quyền)
-- ---------------------------------------------------------------------
create table positions (
  id uuid primary key default uuid_generate_v4(),
  department_id uuid not null references departments(id),
  name text not null,                  -- 'Trưởng phòng nhân sự', 'Giáo viên', ...
  approval_level smallint not null default 0,
  is_teacher_eligible boolean not null default false, -- có thể kiêm giáo viên
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- VAI TRÒ HỆ THỐNG (dùng cho phân quyền UI/RLS, độc lập với chức vụ)
-- ---------------------------------------------------------------------
create table system_roles (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique, -- 'EXECUTIVE','DEPT_HEAD','DEPT_DEPUTY','STAFF',
                              -- 'CENTER_MANAGER','TEACHER','CONSULTANT','TECH'
  name text not null
);

-- ---------------------------------------------------------------------
-- NHÂN VIÊN (liên kết auth.users của Supabase)
-- Mã nhân viên tự sinh: AIS-0001 (xem function ở file 07)
-- ---------------------------------------------------------------------
create table employees (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  employee_code text not null unique,      -- AIS-0001
  full_name text not null,
  avatar_url text,
  phone text,
  email text,
  -- Cơ cấu tổ chức
  department_id uuid references departments(id),
  position_id uuid references positions(id),
  center_id uuid references centers(id),   -- trung tâm chính (null nếu khối văn phòng)
  role_id uuid references system_roles(id),
  is_foreign_teacher boolean not null default false,
  -- Thông tin hệ thống
  contract_type contract_type,
  hire_date date,
  status employee_status not null default 'active',
  -- Thông tin cá nhân
  dob date,
  hometown text,
  id_card_number text,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  -- Chữ ký số
  signature_url text,                      -- file png chữ ký cá nhân
  -- Khác
  language_preference language_pref not null default 'vi',
  note text,
  temp_password_flag boolean not null default true, -- bắt đổi mật khẩu lần đầu
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_employees_department on employees(department_id);
create index idx_employees_center on employees(center_id);
create index idx_employees_status on employees(status);

-- Bằng cấp / chứng chỉ / CV (nhiều file, tất cả PDF)
create table employee_documents (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id) on delete cascade,
  doc_type text not null check (doc_type in ('degree','certificate','cv')),
  file_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);
create index idx_emp_docs_employee on employee_documents(employee_id);
-- =====================================================================
-- File 02: MODULE HỌC VỤ - Chương trình học, Lớp, Học viên, Giáo viên, Tư vấn
-- =====================================================================

-- Chương trình học lớn: PRE-SCHOOL, KIDS, PRE A1 STARTERS, A1 MOVERS,
-- A2 FLYERS, A2 KET, B1 PET, B2 FCE, IELTS, COMMUNICATION
create table programs (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  display_order smallint not null default 0
);

-- Cấp độ (Pre-School 1, Kids 1, Movers, Foundation...)
create table program_levels (
  id uuid primary key default uuid_generate_v4(),
  program_id uuid not null references programs(id) on delete cascade,
  name text not null,
  display_order smallint not null default 0
);

-- Cấp độ con / khoá cụ thể (Pre-School 1.1, Movers 1, Speed Up 1...)
create table program_sublevels (
  id uuid primary key default uuid_generate_v4(),
  level_id uuid not null references program_levels(id) on delete cascade,
  name text not null,
  display_order smallint not null default 0
);

-- ---------------------------------------------------------------------
-- LỚP HỌC
-- ---------------------------------------------------------------------
create table classes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  center_id uuid not null references centers(id),
  program_id uuid not null references programs(id),
  level_id uuid references program_levels(id),
  sublevel_id uuid references program_sublevels(id),
  teacher_id uuid references employees(id),
  schedule_note text,               -- mô tả lịch học (ví dụ: T2-4-6, 18h-19h30)
  student_count int not null default 0, -- tự cập nhật qua trigger khi thêm/xoá học viên
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_classes_center on classes(center_id);
create index idx_classes_teacher on classes(teacher_id);

-- ---------------------------------------------------------------------
-- HỌC VIÊN
-- ---------------------------------------------------------------------
create table students (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  dob date,
  current_school text,
  entry_level_id uuid references program_levels(id), -- trình độ đầu vào khi test
  class_id uuid references classes(id),               -- tự điền từ phân lớp
  parent_name text,
  phone text,
  backup_phone text,
  email text,
  enrollment_date date not null default current_date,
  status student_status not null default 'studying',
  center_id uuid not null references centers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_students_class on students(class_id);
create index idx_students_center on students(center_id);

-- Trigger: cập nhật sĩ số lớp khi học viên được gán/xoá khỏi lớp
create or replace function trg_update_class_count() returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.class_id is not null) then
    update classes set student_count = student_count + 1 where id = new.class_id;
  elsif (tg_op = 'DELETE' and old.class_id is not null) then
    update classes set student_count = greatest(student_count - 1, 0) where id = old.class_id;
  elsif (tg_op = 'UPDATE' and old.class_id is distinct from new.class_id) then
    if old.class_id is not null then
      update classes set student_count = greatest(student_count - 1, 0) where id = old.class_id;
    end if;
    if new.class_id is not null then
      update classes set student_count = student_count + 1 where id = new.class_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger students_class_count
after insert or update or delete on students
for each row execute function trg_update_class_count();

-- ---------------------------------------------------------------------
-- BẢNG ĐIỂM HỌC VIÊN (điền tự động từ Bảng điểm lớp học của giáo viên)
-- ---------------------------------------------------------------------
create table student_grades (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  class_id uuid not null references classes(id),
  level_id uuid references program_levels(id),
  term text,                          -- kỳ / khoá học
  score numeric(5,2),
  ranking text,                       -- xếp loại
  final_status text check (final_status in ('graduated','not_passed')),
  entered_by uuid references employees(id), -- giáo viên nhập
  created_at timestamptz not null default now()
);
create index idx_grades_student on student_grades(student_id);

-- Điểm danh theo buổi
create table class_attendance (
  id uuid primary key default uuid_generate_v4(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  session_date date not null,
  present boolean not null default true,
  note text,
  taken_by uuid references employees(id),
  created_at timestamptz not null default now(),
  unique (class_id, student_id, session_date)
);

-- ---------------------------------------------------------------------
-- LỊCH TRỰC TRUNG TÂM & PHÂN LỊCH TUẦN GIÁO VIÊN
-- ---------------------------------------------------------------------
create table center_duty_schedules (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id),
  employee_id uuid not null references employees(id),
  duty_date date not null,
  shift text,                         -- sáng/chiều/tối hoặc giờ cụ thể
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_duty_center_date on center_duty_schedules(center_id, duty_date);

create table teacher_weekly_schedules (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references employees(id),
  class_id uuid references classes(id),
  center_id uuid not null references centers(id),
  week_start_date date not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time time,
  end_time time,
  is_substitute boolean not null default false,
  substitute_for_teacher_id uuid references employees(id), -- dạy thay ai
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_teacher_sched_teacher on teacher_weekly_schedules(teacher_id, week_start_date);

-- Phân lịch làm việc nhân sự hành chính (trừ phòng học vụ), tại các trung tâm
create table work_schedules (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id),
  center_id uuid not null references centers(id),
  work_date date not null,
  shift text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_work_sched_employee on work_schedules(employee_id, work_date);

-- ---------------------------------------------------------------------
-- TƯ VẤN - HỒ SƠ KHÁCH HÀNG (CRM)
-- ---------------------------------------------------------------------
create table crm_leads (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  dob date,
  current_school text,
  parent_name text,
  phone text,
  backup_phone text,
  email text,
  status lead_status not null default 'potential',
  center_id uuid not null references centers(id),
  consultant_id uuid references employees(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_leads_center on crm_leads(center_id);
create index idx_leads_consultant on crm_leads(consultant_id);
-- =====================================================================
-- File 03: MODULE NHÂN SỰ - Hợp đồng, Nghỉ phép, Công tác, Ngày phép
-- =====================================================================

-- ---------------------------------------------------------------------
-- BIỂU MẪU HỆ THỐNG (dùng chung, xem trong Kho lưu trữ > Biểu mẫu)
-- 01.Hopdonglaodong, 02.Phieudenghithanhtoan, 03.Phieudenghitamung,
-- 04.Phieutrinhsukien, 05.Phieudenghimuasam
-- ---------------------------------------------------------------------
create table document_templates (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,      -- '01.Hopdonglaodong'
  name text not null,
  file_url text not null,         -- PDF gốc (dùng làm nền cho PDF Form Viewer)
  field_map jsonb,                -- vị trí/loại field trên PDF (x,y,page,type) cho pdf-lib
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- HỢP ĐỒNG LAO ĐỘNG (mã HR-yyyy-mm-000001)
-- Quy trình ký: nhân viên -> trưởng phòng nhân sự -> ban điều hành -> lưu trữ
-- ---------------------------------------------------------------------
create table contracts (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  employee_id uuid not null references employees(id),
  template_id uuid references document_templates(id),
  filled_data jsonb,                    -- dữ liệu điền vào form
  draft_file_url text,                  -- pdf sau khi điền, trước khi ký
  employee_signed_at timestamptz,
  employee_signed_by uuid references employees(id),
  hr_head_signed_at timestamptz,
  hr_head_signed_by uuid references employees(id),
  executive_signed_at timestamptz,
  executive_signed_by uuid references employees(id),
  final_file_url text,                  -- pdf hoàn chỉnh, đã ký đủ, lưu vào kho
  status workflow_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_contracts_employee on contracts(employee_id);

-- ---------------------------------------------------------------------
-- SỐ NGÀY PHÉP (tự cộng 1 ngày/tháng, trừ khi nghỉ phép, có thể chỉnh tay)
-- ---------------------------------------------------------------------
create table leave_balances (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id),
  year int not null,
  month int not null,
  annual_leave_accrued numeric(4,1) not null default 1, -- cộng tự động mỗi tháng
  annual_leave_used numeric(4,1) not null default 0,
  compensatory_leave numeric(4,1) not null default 0,   -- nghỉ bù, thêm/xoá thủ công
  adjusted_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  unique (employee_id, year, month)
);

-- ---------------------------------------------------------------------
-- ĐƠN NGHỈ PHÉP (mã HR-yyyy-mm-000001 - dùng chung dãy số với hợp đồng
-- theo prefix HR, hoặc tách riêng tuỳ cấu hình generate_document_code)
-- ---------------------------------------------------------------------
create table leave_requests (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  employee_id uuid not null references employees(id),
  leave_type leave_type not null,
  leave_reason leave_reason,
  start_date date not null,
  days numeric(4,1) not null,
  return_date date,
  reason_note text,
  attachment_url text,
  status workflow_status not null default 'draft',
  approved_by uuid references employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_leave_employee on leave_requests(employee_id);

-- ---------------------------------------------------------------------
-- ĐƠN CÔNG TÁC
-- ---------------------------------------------------------------------
create table business_trips (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  employee_id uuid not null references employees(id),
  title text not null,
  content text,
  origin_address text,
  origin_lat numeric(9,6),
  origin_lng numeric(9,6),
  destination_address text,
  destination_lat numeric(9,6),
  destination_lng numeric(9,6),
  distance_km numeric(6,2),           -- tính tự động qua Maps Distance API
  trip_date date not null,
  days numeric(4,1) not null default 1,
  attachment_url text,
  status workflow_status not null default 'draft',
  approved_by uuid references employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_trip_employee on business_trips(employee_id);
-- =====================================================================
-- File 04: MODULE KẾ TOÁN
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHIẾU ĐỀ NGHỊ THANH TOÁN (mã ACC1-yyyy-mm-000001)
-- Quy trình: người điền ký -> đính kèm chứng từ gốc -> kế toán ký ->
-- ban điều hành ký -> gộp pdf + chứng từ gốc -> lưu kho
-- ---------------------------------------------------------------------
create table payment_requests (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  requester_id uuid not null references employees(id),
  department_id uuid references departments(id),
  center_id uuid references centers(id),
  template_id uuid references document_templates(id),
  filled_data jsonb,
  amount numeric(14,2),
  content text,
  requester_signed_at timestamptz,
  draft_file_url text,
  original_document_urls text[],       -- chứng từ gốc (nhiều file pdf)
  accountant_signed_at timestamptz,
  accountant_signed_by uuid references employees(id),
  executive_signed_at timestamptz,
  executive_signed_by uuid references employees(id),
  final_file_url text,
  status workflow_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payreq_requester on payment_requests(requester_id);

-- ---------------------------------------------------------------------
-- PHIẾU TẠM ỨNG (mã ACC2-yyyy-mm-000001)
-- ---------------------------------------------------------------------
create table advance_requests (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  requester_id uuid not null references employees(id),
  department_id uuid references departments(id),
  center_id uuid references centers(id),
  template_id uuid references document_templates(id),
  filled_data jsonb,
  amount numeric(14,2),
  reason text,
  requester_signed_at timestamptz,
  draft_file_url text,
  accountant_signed_at timestamptz,
  accountant_signed_by uuid references employees(id),
  executive_signed_at timestamptz,
  executive_signed_by uuid references employees(id),
  final_file_url text,
  status workflow_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_advreq_requester on advance_requests(requester_id);

-- ---------------------------------------------------------------------
-- CÔNG NỢ / DÒNG TIỀN / BÁO CÁO TÀI CHÍNH (dữ liệu tổng hợp cho biểu đồ)
-- ---------------------------------------------------------------------
create table receivables (                -- quản lý công nợ
  id uuid primary key default uuid_generate_v4(),
  center_id uuid references centers(id),
  partner_name text not null,             -- đối tác / phụ huynh / nhà cung cấp
  amount numeric(14,2) not null,
  due_date date,
  status text not null default 'open' check (status in ('open','partial','paid','overdue')),
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cash_flow_entries (          -- quản lý dòng tiền
  id uuid primary key default uuid_generate_v4(),
  center_id uuid references centers(id),
  entry_type text not null check (entry_type in ('inflow','outflow')),
  category text,
  amount numeric(14,2) not null,
  entry_date date not null,
  related_payment_request_id uuid references payment_requests(id),
  related_advance_request_id uuid references advance_requests(id),
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_cashflow_center_date on cash_flow_entries(center_id, entry_date);

-- ---------------------------------------------------------------------
-- BẢNG LƯƠNG NHÂN VIÊN
-- ---------------------------------------------------------------------
create table payroll (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id),
  year int not null,
  month int not null,
  base_salary numeric(14,2) not null default 0,
  bonus numeric(14,2) not null default 0,
  deduction numeric(14,2) not null default 0,
  net_salary numeric(14,2) generated always as (base_salary + bonus - deduction) stored,
  note text,
  finalized_by uuid references employees(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (employee_id, year, month)
);

-- ---------------------------------------------------------------------
-- PHÂN VIỆC XỬ LÝ YÊU CẦU (dùng chung Kế toán / Truyền thông / CSVC)
-- department_id xác định module đang dùng bảng này cho phòng nào
-- ---------------------------------------------------------------------
create table task_assignments (
  id uuid primary key default uuid_generate_v4(),
  department_id uuid not null references departments(id),
  assigned_by uuid not null references employees(id),   -- trưởng phòng
  assigned_to uuid not null references employees(id),   -- có thể là chính mình
  related_table text,             -- 'payment_requests','communication_requests',...
  related_id uuid,
  title text not null,
  description text,
  due_date date,
  status text not null default 'pending' check (status in ('pending','in_progress','done','overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_task_assigned_to on task_assignments(assigned_to);
create index idx_task_department on task_assignments(department_id);
-- =====================================================================
-- File 05: MODULE TRUYỀN THÔNG & CƠ SỞ VẬT CHẤT
-- =====================================================================

-- ---------------------------------------------------------------------
-- YÊU CẦU TRUYỀN THÔNG (phòng ban khác gửi yêu cầu hỗ trợ)
-- ---------------------------------------------------------------------
create table communication_requests (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  requester_id uuid not null references employees(id),
  department_id uuid references departments(id),
  center_id uuid references centers(id),
  request_type comm_request_type not null,
  title text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  deadline date,
  brief_file_url text,
  status text not null default 'pending' check (status in ('pending','in_progress','done','rejected')),
  result_note text,
  result_file_urls text[],
  handled_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_commreq_requester on communication_requests(requester_id);

-- ---------------------------------------------------------------------
-- TRÌNH SỰ KIỆN (mã MKT-yyyy-mm-000001)
-- Quản lý trung tâm điền -> ký -> phòng truyền thông duyệt cấp 1 + ký ->
-- ban điều hành duyệt cấp 2 + ký -> lưu kho
-- ---------------------------------------------------------------------
create table event_proposals (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  center_manager_id uuid not null references employees(id),
  center_id uuid not null references centers(id),
  template_id uuid references document_templates(id),
  filled_data jsonb,
  draft_file_url text,
  manager_signed_at timestamptz,
  mkt_approved_by uuid references employees(id),
  mkt_approved_at timestamptz,
  executive_approved_by uuid references employees(id),
  executive_approved_at timestamptz,
  final_file_url text,
  status workflow_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_eventprop_center on event_proposals(center_id);

-- ---------------------------------------------------------------------
-- THÔNG TIN TÀI KHOẢN NỘI BỘ (mạng xã hội / quảng cáo)
-- lưu ý: password nên mã hoá phía ứng dụng, KHÔNG lưu plaintext
-- ---------------------------------------------------------------------
create table internal_accounts (
  id uuid primary key default uuid_generate_v4(),
  platform text not null,             -- Facebook, Google Ads, Zalo OA...
  account_name text not null,
  username text,
  secret_encrypted text,              -- mã hoá bằng pgcrypto (pgp_sym_encrypt)
  managed_by uuid references employees(id),
  center_id uuid references centers(id),
  note text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- YÊU CẦU CƠ SỞ VẬT CHẤT (phòng ban khác gửi yêu cầu hỗ trợ)
-- ---------------------------------------------------------------------
create table facility_requests (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  requester_id uuid not null references employees(id),
  department_id uuid references departments(id),
  center_id uuid references centers(id),
  request_type fac_request_type not null,
  title text not null,
  current_state_file_url text,
  status text not null default 'pending' check (status in ('pending','approved','in_progress','done','rejected')),
  result_note text,
  handled_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_facreq_requester on facility_requests(requester_id);

-- ---------------------------------------------------------------------
-- PHIẾU ĐỀ NGHỊ MUA SẮM (mã FAC-yyyy-mm-000001)
-- Quy trình: người điền ký -> trưởng phòng CSVC duyệt+ký -> ban điều hành ký -> lưu kho
-- ---------------------------------------------------------------------
create table purchase_requests (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  requester_id uuid not null references employees(id),
  center_id uuid references centers(id),
  template_id uuid references document_templates(id),
  filled_data jsonb,
  draft_file_url text,
  requester_signed_at timestamptz,
  fac_head_signed_at timestamptz,
  fac_head_signed_by uuid references employees(id),
  executive_signed_at timestamptz,
  executive_signed_by uuid references employees(id),
  final_file_url text,
  status workflow_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_purchasereq_requester on purchase_requests(requester_id);

-- ---------------------------------------------------------------------
-- HỆ THỐNG THỐNG KÊ CSVC (kiểm kê tài sản, tuỳ chọn mở rộng)
-- ---------------------------------------------------------------------
create table facility_assets (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id),
  asset_name text not null,
  category text,
  quantity int not null default 1,
  condition text check (condition in ('good','needs_repair','broken','disposed')),
  purchased_date date,
  note text,
  updated_at timestamptz not null default now()
);
-- =====================================================================
-- File 06: ĐỀ XUẤT NỘI BỘ, KHO LƯU TRỮ, THÔNG BÁO, LỊCH HỌP, LOG
-- =====================================================================

-- ---------------------------------------------------------------------
-- ĐỀ XUẤT NỘI BỘ (đề xuất/cải tiến/xin mua sắm - duyệt 2 mức)
-- File PDF có thể mở popup để ký số kéo-thả tại chỗ (lưu đè bản cũ)
-- ---------------------------------------------------------------------
create table internal_proposals (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  center_id uuid references centers(id),
  title text not null,
  content text,
  file_url text,                      -- pdf hiện hành (được ghi đè khi ký thêm)
  level1_approver_id uuid references employees(id),   -- trưởng phòng
  level1_approved_at timestamptz,
  level2_approver_id uuid references employees(id),   -- ban điều hành
  level2_approved_at timestamptz,
  status workflow_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_proposal_department on internal_proposals(department_id);
create index idx_proposal_employee on internal_proposals(employee_id);

-- ---------------------------------------------------------------------
-- KHO LƯU TRỮ HỆ THỐNG (metadata dùng chung cho mọi phòng ban)
-- category quyết định phân quyền xem theo phòng ban (RLS ở file 08)
-- ---------------------------------------------------------------------
create table archive_files (
  id uuid primary key default uuid_generate_v4(),
  department_id uuid not null references departments(id),
  center_id uuid references centers(id),
  category doc_category not null,
  year int not null,
  month int not null,
  file_name text not null,
  file_url text not null,
  related_table text,                 -- ví dụ 'contracts','payment_requests'
  related_id uuid,
  uploaded_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_archive_dept_year_month on archive_files(department_id, year, month);
create index idx_archive_category on archive_files(category);

-- ---------------------------------------------------------------------
-- KÝ SỐ HỒ SƠ - LOG (mọi thao tác ký, kể cả "tự nhập file rồi ký")
-- ---------------------------------------------------------------------
create table signature_logs (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id),  -- người ký
  source_file_url text not null,
  signed_file_url text not null,
  position_x numeric,
  position_y numeric,
  page_number int,
  related_table text,
  related_id uuid,
  saved_to_archive_id uuid references archive_files(id),
  signed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- THÔNG BÁO
-- ---------------------------------------------------------------------
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  scope notification_scope not null,
  center_id uuid references centers(id),        -- khi scope='center'
  department_id uuid references departments(id),-- khi scope='department'
  target_employee_id uuid references employees(id), -- khi scope='personal'
  title text not null,
  content text,
  attachment_url text,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);
create index idx_notif_scope on notifications(scope);

create table notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, employee_id)
);

-- ---------------------------------------------------------------------
-- LỊCH HỌP (offline hoặc online qua Google Calendar)
-- ---------------------------------------------------------------------
create table meetings (
  id uuid primary key default uuid_generate_v4(),
  kind meeting_kind not null,
  title text not null,
  description text,
  meeting_date date not null,
  start_time time not null,
  end_time time not null,
  location text,                       -- khi kind='offline'
  google_meet_link text,               -- khi kind='online', tự sinh qua Google Calendar API
  google_event_id text,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);

create table meeting_participants (
  meeting_id uuid not null references meetings(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  invited_at timestamptz not null default now(),
  rsvp_status text not null default 'pending' check (rsvp_status in ('pending','accepted','declined')),
  primary key (meeting_id, employee_id)
);

-- ---------------------------------------------------------------------
-- LOG HOẠT ĐỘNG HỆ THỐNG (chỉ nhân viên kỹ thuật xem được - RLS file 08)
-- ---------------------------------------------------------------------
create table activity_logs (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid references employees(id),
  action text not null,                -- 'login','create_contract','sign_document',...
  entity_type text,
  entity_id uuid,
  detail jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index idx_activitylog_employee on activity_logs(employee_id, created_at desc);
-- =====================================================================
-- File 07: SINH MÃ TỰ ĐỘNG
-- Nhân viên: AIS-0001, AIS-0002, ... (tăng dần, không reset theo năm)
-- Phiếu:     {Mã}-{yyyy}-{mm}-000001 (reset về 000001 mỗi tháng, theo prefix)
--   HR   -> Hợp đồng / đơn nghỉ phép / đơn công tác
--   ACC1 -> Phiếu đề nghị thanh toán
--   ACC2 -> Phiếu tạm ứng
--   MKT  -> Trình sự kiện
--   FAC  -> Phiếu đề nghị mua sắm
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mã nhân viên: dùng 1 sequence toàn cục
-- ---------------------------------------------------------------------
create sequence employee_code_seq start 1;

create or replace function generate_employee_code() returns text as $$
declare
  n int;
begin
  n := nextval('employee_code_seq');
  return 'AIS-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_employee_code() returns trigger as $$
begin
  if new.employee_code is null or new.employee_code = '' then
    new.employee_code := generate_employee_code();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger employees_set_code
before insert on employees
for each row execute function trg_set_employee_code();

-- ---------------------------------------------------------------------
-- Mã phiếu: bảng đếm riêng theo (prefix, năm, tháng) để đảm bảo reset
-- đúng theo tháng và an toàn khi nhiều người tạo phiếu cùng lúc.
-- ---------------------------------------------------------------------
create table document_code_counters (
  prefix text not null,
  year int not null,
  month int not null,
  last_number int not null default 0,
  primary key (prefix, year, month)
);

create or replace function generate_document_code(p_prefix text) returns text as $$
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
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- Trigger tự gán mã cho từng bảng phiếu
-- ---------------------------------------------------------------------
create or replace function trg_set_code_hr() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('HR');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger contracts_set_code before insert on contracts
for each row execute function trg_set_code_hr();
create trigger leave_requests_set_code before insert on leave_requests
for each row execute function trg_set_code_hr();
create trigger business_trips_set_code before insert on business_trips
for each row execute function trg_set_code_hr();

create or replace function trg_set_code_acc1() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('ACC1');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger payment_requests_set_code before insert on payment_requests
for each row execute function trg_set_code_acc1();

create or replace function trg_set_code_acc2() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('ACC2');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger advance_requests_set_code before insert on advance_requests
for each row execute function trg_set_code_acc2();

create or replace function trg_set_code_mkt() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('MKT');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger event_proposals_set_code before insert on event_proposals
for each row execute function trg_set_code_mkt();
create trigger communication_requests_set_code before insert on communication_requests
for each row execute function trg_set_code_mkt();

create or replace function trg_set_code_fac() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('FAC');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger purchase_requests_set_code before insert on purchase_requests
for each row execute function trg_set_code_fac();
create trigger facility_requests_set_code before insert on facility_requests
for each row execute function trg_set_code_fac();

-- Đề xuất nội bộ dùng mã riêng theo phòng ban gửi đề xuất, prefix 'DX'
create or replace function trg_set_code_proposal() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('DX');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger internal_proposals_set_code before insert on internal_proposals
for each row execute function trg_set_code_proposal();

-- ---------------------------------------------------------------------
-- Trigger updated_at chung (áp dụng cho các bảng có cột updated_at)
-- ---------------------------------------------------------------------
create or replace function trg_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
  tables text[] := array[
    'employees','classes','students','contracts','payment_requests',
    'advance_requests','event_proposals','purchase_requests',
    'communication_requests','facility_requests','internal_proposals',
    'crm_leads','document_templates'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create trigger %I_touch_updated_at before update on %I
       for each row execute function trg_touch_updated_at();', t, t);
  end loop;
end $$;
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
