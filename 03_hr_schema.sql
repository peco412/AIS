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
