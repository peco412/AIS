-- =====================================================================
-- File 46: NHA CUNG CAP + PHIEU MUA HANG + nguyen tac "Chi tieu phai co
-- goc" (Phieu de nghi thanh toan bat buoc tham chieu Phieu mua hang da
-- duyet, cam nhap tay tu do) - chay sau file 45
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - Danh muc Nha cung cap
-- ---------------------------------------------------------------------
create table if not exists suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text unique,
  name text not null,
  category text, -- hang muc cung cap (vd: Van phong pham, Thiet bi dien tu...)
  phone text,
  email text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger suppliers_set_code before insert on suppliers
for each row execute function trg_set_code_acc1();

alter table suppliers enable row level security;
create policy suppliers_select on suppliers for select to authenticated using (true);
create policy suppliers_write on suppliers for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

-- ---------------------------------------------------------------------
-- PHAN 2 - Hang muc chi (co san 5 muc theo dac ta + cho phep them tay)
-- ---------------------------------------------------------------------
create table if not exists expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text unique not null,
  name text not null,
  display_order smallint not null default 0,
  is_custom boolean not null default false
);
insert into expense_categories (code, name, display_order) values
  ('BOARD_OUTSIDE', 'HĐQT: Chi ngoài ngân sách', 1),
  ('CAT_A', 'Mục A: Thường xuyên', 2),
  ('CAT_B', 'Mục B: Truyền thông', 3),
  ('CAT_C', 'Mục C: Kế hoạch khác', 4),
  ('CAT_D', 'Mục D: Đầu tư HĐQT', 5)
on conflict (code) do nothing;

alter table expense_categories enable row level security;
create policy expense_categories_select on expense_categories for select to authenticated using (true);
create policy expense_categories_write on expense_categories for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

-- ---------------------------------------------------------------------
-- PHAN 3 - Phieu mua hang: duyet 3 cap (Quan ly truc tiep -> Ke toan ->
-- BDH), sau khi approved_3 thi KHOA du lieu (khong cho sua nua).
-- ---------------------------------------------------------------------
create table if not exists purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text unique,
  supplier_id uuid not null references suppliers(id),
  requester_id uuid not null references employees(id),
  department_id uuid references departments(id),
  center_id uuid references centers(id),
  expense_category_id uuid not null references expense_categories(id),
  purchase_date date not null default current_date,
  note text,
  total_amount numeric(14,2) not null default 0, -- tu tinh tu purchase_order_items
  status workflow_status not null default 'draft',
  manager_signed_by uuid references employees(id),
  manager_signed_at timestamptz,
  accountant_signed_by uuid references employees(id),
  accountant_signed_at timestamptz,
  executive_signed_by uuid references employees(id),
  executive_signed_at timestamptz,
  locked boolean not null default false, -- true khi approved_3 - khoa toan bo du lieu
  created_at timestamptz not null default now()
);
create trigger purchase_orders_set_code before insert on purchase_orders
for each row execute function trg_set_code_acc1();

create table if not exists purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid not null references purchase_orders(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  line_total numeric(14,2) generated always as (quantity * unit_price) stored
);

-- Tu dong cong tong tien don hang moi khi them/sua/xoa dong chi tiet
create or replace function recalc_purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update purchase_orders set total_amount = (
    select coalesce(sum(line_total), 0) from purchase_order_items where order_id = v_order_id
  ) where id = v_order_id;
  return null;
end;
$func$;

drop trigger if exists trg_recalc_po_total on purchase_order_items;
create trigger trg_recalc_po_total
after insert or update or delete on purchase_order_items
for each row execute function recalc_purchase_order_total();

-- Khoa du lieu khi da duyet xong (approved_3) - khong cho sua/xoa dong
-- chi tiet nua, dung yeu cau "khoa du lieu don hang".
create or replace function block_locked_po_items_edit()
returns trigger
language plpgsql
as $func$
declare
  v_locked boolean;
begin
  select locked into v_locked from purchase_orders where id = coalesce(new.order_id, old.order_id);
  if v_locked then
    raise exception 'Phiếu mua hàng này đã được duyệt xong — không thể sửa chi tiết đơn hàng nữa.';
  end if;
  return coalesce(new, old);
end;
$func$;

drop trigger if exists trg_block_locked_po_items on purchase_order_items;
create trigger trg_block_locked_po_items
before insert or update or delete on purchase_order_items
for each row execute function block_locked_po_items_edit();

alter table purchase_orders enable row level security;
create policy purchase_orders_select on purchase_orders for select
  using (
    requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
    or is_direct_manager_of(requester_id)
  );
create policy purchase_orders_insert on purchase_orders for insert
  with check (requester_id = current_employee_id());
create policy purchase_orders_update on purchase_orders for update
  using (
    (requester_id = current_employee_id() and status = 'draft')
    or is_direct_manager_of(requester_id)
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  );

alter table purchase_order_items enable row level security;
create policy po_items_select on purchase_order_items for select
  using (order_id in (select id from purchase_orders));
create policy po_items_write on purchase_order_items for all
  using (order_id in (select id from purchase_orders where requester_id = current_employee_id() and status = 'draft'))
  with check (order_id in (select id from purchase_orders where requester_id = current_employee_id() and status = 'draft'));

-- Khi approved_3 (BDH ky xong) -> tu dong khoa (locked = true)
create or replace function lock_purchase_order_on_final_approval()
returns trigger
language plpgsql
as $func$
begin
  if new.status = 'approved_3' and old.status <> 'approved_3' then
    new.locked := true;
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_lock_po on purchase_orders;
create trigger trg_lock_po
before update on purchase_orders
for each row execute function lock_purchase_order_on_final_approval();

-- ---------------------------------------------------------------------
-- PHAN 4 - "Chi tieu phai co goc": payment_requests BAT BUOC tham chieu
-- 1 purchase_order DA DUYET XONG, so tien TU DONG LIEN THONG, cam sua.
-- ---------------------------------------------------------------------
alter table payment_requests add column if not exists purchase_order_id uuid references purchase_orders(id);

create or replace function enforce_payment_request_has_source()
returns trigger
language plpgsql
as $func$
declare
  v_po purchase_orders%rowtype;
begin
  -- Chi ap dung cho hoa don MOI tao co gan purchase_order_id (khong hoi
  -- to du lieu cu de tranh gay loi cho cac phieu da ton tai truoc do).
  if new.purchase_order_id is not null then
    select * into v_po from purchase_orders where id = new.purchase_order_id;
    if v_po.id is null then raise exception 'Không tìm thấy phiếu mua hàng gốc.'; end if;
    if v_po.status <> 'approved_3' then
      raise exception 'Phiếu mua hàng gốc phải được duyệt xong (Ban điều hành ký) mới tạo được phiếu thanh toán.';
    end if;
    -- Cam nhap de so tien khac voi phieu mua hang goc
    new.amount := v_po.total_amount;
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_enforce_payment_source on payment_requests;
create trigger trg_enforce_payment_source
before insert or update on payment_requests
for each row execute function enforce_payment_request_has_source();
