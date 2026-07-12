-- =====================================================================
-- File 44: MO RONG KHO TRUNG TAM - san pham tu do (khong con cung 8 mon),
-- Phieu xuat kho BAN LE THAT (co khach hang, giam gia, hach toan doanh
-- thu tu dong) - dung theo dac ta moi (chay sau file 43)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - San pham tu do: them gia/DVT/nhom, bo gioi han 8 mon cu dinh
-- ---------------------------------------------------------------------
alter table inventory_items add column if not exists price_vnd numeric(14,2) not null default 0;
alter table inventory_items add column if not exists unit text not null default 'cái'; -- DVT: cai/cuon/bo...
alter table inventory_items add column if not exists product_group text not null default 'media'
  check (product_group in ('education', 'media')); -- San pham giao duc / San pham truyen thong
alter table inventory_items add column if not exists is_custom boolean not null default false; -- true = nhan vien tu tao them, khac 8 mon mac dinh

-- Đánh dấu rõ 8 mặt hàng mặc định ban đầu để phân biệt với hàng tự thêm sau
update inventory_items set product_group = 'media' where code in ('AOTHUN-HV','BALO','TAP','BUT','MOCKHOA','GAUBONG-NHO','GAUBONG-LON','AOTHUN-NV');

-- ---------------------------------------------------------------------
-- PHAN 2 - Phieu xuat kho BAN LE (khac phieu xuat/nhap noi bo don gian
-- da co) - co khach hang, chi tiet don hang nhieu dong, giam gia tung
-- dong, tu dong tru ton kho + hach toan doanh thu.
-- ---------------------------------------------------------------------
create table if not exists retail_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text unique,
  student_id uuid references students(id), -- co the null neu khach vang lai khong phai hoc vien
  customer_name text,      -- ten hoc vien hoac khach le
  parent_name text,
  phone text,
  address text,
  center_id uuid not null references centers(id),
  sale_date date not null default current_date,
  performed_by uuid not null references employees(id),
  payment_method text not null check (payment_method in ('CASH', 'BANK_TRANSFER')),
  reason text,
  total_amount numeric(14,2) not null default 0, -- tong sau giam gia tung dong, tu tinh qua trigger
  created_at timestamptz not null default now()
);

create table if not exists retail_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid not null references retail_sales(id) on delete cascade,
  item_id uuid not null references inventory_items(id),
  size text,
  quantity int not null check (quantity > 0),
  unit_price numeric(14,2) not null,
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  net_amount numeric(14,2) generated always as (quantity * unit_price * (1 - discount_percent / 100.0)) stored,
  note text
);

create trigger retail_sales_set_code before insert on retail_sales
for each row execute function trg_set_code_hr();

-- Tu dong: (1) cong tong tien vao retail_sales.total_amount, (2) tru ton
-- kho qua 1 dong inventory_transactions loai 'out', (3) hach toan doanh
-- thu vao cash_flow_entries - het trong 1 buoc "Bam Hoan thanh" dung yeu
-- cau "he thong tu dong" trong dac ta.
create or replace function finalize_retail_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_sale retail_sales%rowtype;
  v_item retail_sale_items%rowtype;
  v_total numeric := 0;
  v_current_stock numeric;
begin
  select * into v_sale from retail_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'Khong tim thay phieu xuat nay.'; end if;

  for v_item in select * from retail_sale_items where sale_id = p_sale_id loop
    select stock_quantity into v_current_stock from inventory_stock_view
    where center_id = v_sale.center_id and item_id = v_item.item_id and size = coalesce(v_item.size, '');
    if coalesce(v_current_stock, 0) < v_item.quantity then
      raise exception 'Khong du ton kho cho 1 mat hang trong don (con % , can %).', coalesce(v_current_stock,0), v_item.quantity;
    end if;

    insert into inventory_transactions (transaction_type, item_id, size, quantity, center_id, performed_by, transaction_date, note)
    values ('out', v_item.item_id, v_item.size, v_item.quantity, v_sale.center_id, v_sale.performed_by, v_sale.sale_date,
      format('Ban le - phieu %s', v_sale.code));

    v_total := v_total + v_item.net_amount;
  end loop;

  update retail_sales set total_amount = v_total where id = p_sale_id;

  insert into cash_flow_entries (center_id, entry_type, category, amount, entry_date, note, created_by)
  values (v_sale.center_id, 'inflow', 'retail_sale', v_total, v_sale.sale_date,
    format('Ban le tai quay - phieu %s (%s)', v_sale.code, v_sale.reason), v_sale.performed_by);
end;
$func$;

alter table retail_sales enable row level security;
create policy retail_sales_select on retail_sales for select
  using (center_id = current_center_id() or current_department_id() = (select id from departments where code='FAC') or is_executive_or_tech());
create policy retail_sales_insert on retail_sales for insert
  with check (center_id = current_center_id() or is_executive_or_tech());

alter table retail_sale_items enable row level security;
create policy retail_sale_items_select on retail_sale_items for select
  using (sale_id in (select id from retail_sales)); -- ke thua dieu kien qua RLS cua retail_sales khi join
create policy retail_sale_items_insert on retail_sale_items for insert
  with check (sale_id in (select id from retail_sales where center_id = current_center_id() or is_executive_or_tech()));
