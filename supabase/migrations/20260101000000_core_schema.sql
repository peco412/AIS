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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text not null unique,          -- 'ALOHA' | 'ILINGO'
  name text not null,
  theme_color text not null,          -- #0094D9 ALOHA | #0B6C37 iLingo
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- TRUNG TÂM (8 trung tâm, thuộc 1 trong 2 phân hệ)
-- ---------------------------------------------------------------------
create table centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text not null unique, -- 'EXECUTIVE','DEPT_HEAD','DEPT_DEPUTY','STAFF',
                              -- 'CENTER_MANAGER','TEACHER','CONSULTANT','TECH'
  name text not null
);

-- ---------------------------------------------------------------------
-- NHÂN VIÊN (liên kết auth.users của Supabase)
-- Mã nhân viên tự sinh: AIS-0001 (xem function ở file 07)
-- ---------------------------------------------------------------------
create table employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  doc_type text not null check (doc_type in ('degree','certificate','cv')),
  file_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);
create index idx_emp_docs_employee on employee_documents(employee_id);
