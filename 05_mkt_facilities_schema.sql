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
