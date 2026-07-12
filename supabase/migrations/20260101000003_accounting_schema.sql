-- =====================================================================
-- File 04: MODULE KẾ TOÁN
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHIẾU ĐỀ NGHỊ THANH TOÁN (mã ACC1-yyyy-mm-000001)
-- Quy trình: người điền ký -> đính kèm chứng từ gốc -> kế toán ký ->
-- ban điều hành ký -> gộp pdf + chứng từ gốc -> lưu kho
-- ---------------------------------------------------------------------
create table payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
