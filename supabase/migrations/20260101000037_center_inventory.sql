-- =====================================================================
-- File 37: KHO TRUNG TAM (nhap/xuat merchandise) - module moi hoan toan
-- (chay sau file 36)
-- =====================================================================

create table if not exists inventory_items (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  has_size boolean not null default false, -- true cho ao thun (can chon size)
  display_order smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into inventory_items (code, name, has_size, display_order) values
  ('AOTHUN-HV', 'Áo thun học viên', true, 1),
  ('BALO', 'Ba lô', false, 2),
  ('TAP', 'Tập', false, 3),
  ('BUT', 'Bút', false, 4),
  ('MOCKHOA', 'Móc khoá', false, 5),
  ('GAUBONG-NHO', 'Gấu bông nhỏ', false, 6),
  ('GAUBONG-LON', 'Gấu bông lớn', false, 7),
  ('AOTHUN-NV', 'Áo thun nhân viên', true, 8)
on conflict (code) do nothing;

create table if not exists inventory_transactions (
  id uuid primary key default uuid_generate_v4(),
  code text unique,
  transaction_type text not null check (transaction_type in ('in', 'out')), -- nhap / xuat
  item_id uuid not null references inventory_items(id),
  size text, -- chi ap dung cho ao thun: 1-8 (tre em) hoac S/M/L/XL/XXL/XXXL (nguoi lon)
  quantity int not null check (quantity > 0),
  center_id uuid not null references centers(id),
  performed_by uuid not null references employees(id),
  transaction_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_tx_center_item on inventory_transactions(center_id, item_id);

create trigger inventory_tx_set_code before insert on inventory_transactions
for each row execute function trg_set_code_hr(); -- dung chung bo dem tai lieu, prefix "HR" khong quan trong voi ma kho

alter table inventory_items enable row level security;
create policy inventory_items_select on inventory_items for select to authenticated using (true);
create policy inventory_items_write on inventory_items for all
  using (current_department_id() = (select id from departments where code='FAC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='FAC') or is_executive_or_tech());

alter table inventory_transactions enable row level security;
create policy inventory_tx_select on inventory_transactions for select
  using (
    center_id = current_center_id()
    or current_department_id() = (select id from departments where code='FAC')
    or is_executive_or_tech()
  );
create policy inventory_tx_insert on inventory_transactions for insert
  with check (
    center_id = current_center_id()
    or current_department_id() = (select id from departments where code='FAC')
    or is_executive_or_tech()
  );
-- Khong cho sua/xoa phieu da tao (giong nguyen tac da ap dung cho thu hoc
-- phi/dong tien) - nhap sai thi tao phieu dieu chinh moi, giu du vet.

-- View ton kho hien tai: Nhap - Xuat, gom theo trung tam + mat hang + size
create or replace view inventory_stock_view as
select
  center_id, item_id, coalesce(size, '') as size,
  sum(case when transaction_type = 'in' then quantity else -quantity end) as stock_quantity
from inventory_transactions
group by center_id, item_id, coalesce(size, '');

alter view inventory_stock_view set (security_invoker = true);
