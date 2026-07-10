-- =====================================================================
-- File 45: PHU HUYNH MUA HANG TU VI (sach/ao thun/qua tang...) + THU KHO
-- XAC NHAN - noi tiep truc tiep he thong Kho + Vi da xay (chay sau file 44)
-- =====================================================================

create table if not exists wallet_purchase_requests (
  id uuid primary key default uuid_generate_v4(),
  code text unique,
  student_id uuid not null references students(id),
  center_id uuid not null references centers(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  requested_by uuid not null references parent_accounts(id),
  confirmed_by uuid references employees(id),
  confirmed_at timestamptz,
  reject_reason text,
  total_coin_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create trigger wallet_purchase_set_code before insert on wallet_purchase_requests
for each row execute function trg_set_code_hr();

create table if not exists wallet_purchase_items (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid not null references wallet_purchase_requests(id) on delete cascade,
  item_id uuid not null references inventory_items(id),
  size text,
  quantity int not null check (quantity > 0),
  unit_price_coin numeric(14,2) not null -- gia quy uoc 1 coin = 1 VND cho hang hoa (khac ty gia chiet khau nap vi)
);

alter table wallet_purchase_requests enable row level security;
create policy wallet_purchase_req_select on wallet_purchase_requests for select
  using (
    is_linked_to_student(student_id)
    or center_id = current_center_id()
    or current_department_id() = (select id from departments where code='FAC')
    or is_executive_or_tech()
  );
create policy wallet_purchase_req_insert on wallet_purchase_requests for insert
  with check (is_linked_to_student(student_id) and requested_by = current_parent_id());

alter table wallet_purchase_items enable row level security;
create policy wallet_purchase_items_select on wallet_purchase_items for select
  using (request_id in (select id from wallet_purchase_requests));
create policy wallet_purchase_items_insert on wallet_purchase_items for insert
  with check (request_id in (select id from wallet_purchase_requests where requested_by = current_parent_id()));

-- Tao yeu cau mua hang - tinh san tong tien coin, CHUA tru gi ca (cho
-- thu kho xac nhan that su co hang moi tru).
create or replace function create_wallet_purchase_request(p_student_id uuid, p_items jsonb)
returns wallet_purchase_requests
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_center_id uuid;
  v_result wallet_purchase_requests;
  v_item jsonb;
  v_total numeric := 0;
  v_price numeric;
begin
  if not is_linked_to_student(p_student_id) then
    raise exception 'Ban khong co quyen mua hang cho hoc sinh nay.';
  end if;
  select center_id into v_center_id from students where id = p_student_id;

  insert into wallet_purchase_requests (student_id, center_id, requested_by, status)
  values (p_student_id, v_center_id, current_parent_id(), 'pending')
  returning * into v_result;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select price_vnd into v_price from inventory_items where id = (v_item->>'item_id')::uuid;
    insert into wallet_purchase_items (request_id, item_id, size, quantity, unit_price_coin)
    values (v_result.id, (v_item->>'item_id')::uuid, v_item->>'size', (v_item->>'quantity')::int, coalesce(v_price, 0));
    v_total := v_total + coalesce(v_price, 0) * (v_item->>'quantity')::int;
  end loop;

  update wallet_purchase_requests set total_coin_amount = v_total where id = v_result.id;
  select * into v_result from wallet_purchase_requests where id = v_result.id;
  return v_result;
end;
$func$;

-- Tru vi KHONG gan voi hoa don (khac deduct_wallet_fifo) - dung cho mua
-- hang hoa thay vi dong hoc phi.
create or replace function deduct_wallet_fifo_generic(p_wallet_id uuid, p_coin_amount numeric, p_actor_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
  v_remaining numeric := p_coin_amount;
  v_batch record;
  v_take numeric;
  v_total_vnd numeric := 0;
begin
  select student_id into v_student_id from wallets where id = p_wallet_id;

  for v_batch in
    select * from wallet_topup_batches where wallet_id = p_wallet_id and coin_remaining > 0 order by created_at asc for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_batch.coin_remaining, v_remaining);
    update wallet_topup_batches set coin_remaining = coin_remaining - v_take where id = v_batch.id;
    v_total_vnd := v_total_vnd + (v_take * v_batch.conversion_rate);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Số dư ví không đủ — còn thiếu % AIScoins.', v_remaining;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, null, p_actor_id, p_wallet_id, v_student_id, p_note);
end;
$func$;

-- Thu kho xac nhan: kiem tra ton kho that, tru kho + tru vi cung luc.
create or replace function confirm_wallet_purchase(p_request_id uuid, p_confirmer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_purchase_requests%rowtype;
  v_wallet_id uuid;
  v_item record;
  v_current_stock numeric;
begin
  if not (
    current_department_id() = (select id from departments where code='FAC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan don mua hang nay.';
  end if;

  select * into v_req from wallet_purchase_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Don nay da duoc xu ly roi.'; end if;

  select id into v_wallet_id from wallets where student_id = v_req.student_id;
  if v_wallet_id is null then raise exception 'Hoc sinh chua co vi.'; end if;

  for v_item in select * from wallet_purchase_items where request_id = p_request_id loop
    select stock_quantity into v_current_stock from inventory_stock_view
    where center_id = v_req.center_id and item_id = v_item.item_id and size = coalesce(v_item.size, '');
    if coalesce(v_current_stock, 0) < v_item.quantity then
      raise exception 'Khong du ton kho cho 1 mat hang trong don (con %, can %).', coalesce(v_current_stock,0), v_item.quantity;
    end if;
  end loop;

  perform deduct_wallet_fifo_generic(v_wallet_id, v_req.total_coin_amount, p_confirmer_id,
    format('Mua hang tu vi - phieu %s', v_req.code));

  for v_item in select * from wallet_purchase_items where request_id = p_request_id loop
    insert into inventory_transactions (transaction_type, item_id, size, quantity, center_id, performed_by, transaction_date, note)
    values ('out', v_item.item_id, v_item.size, v_item.quantity, v_req.center_id, p_confirmer_id, current_date,
      format('Mua tu vi - phieu %s', v_req.code));
  end loop;

  update wallet_purchase_requests set status = 'confirmed', confirmed_by = p_confirmer_id, confirmed_at = now() where id = p_request_id;
end;
$func$;

create or replace function reject_wallet_purchase(p_request_id uuid, p_confirmer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not (
    current_department_id() = (select id from departments where code='FAC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tu choi don nay.';
  end if;
  update wallet_purchase_requests set status = 'rejected', confirmed_by = p_confirmer_id, confirmed_at = now(), reject_reason = p_reason
  where id = p_request_id and status = 'pending';
end;
$func$;

revoke execute on function deduct_wallet_fifo_generic(uuid, numeric, uuid, text) from public, anon, authenticated;
