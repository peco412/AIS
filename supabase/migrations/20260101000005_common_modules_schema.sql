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
