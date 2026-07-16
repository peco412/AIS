-- =====================================================================
-- File 101: VI CHUNG THAT SU cho nhieu con cung 1 phu huynh (theo yeu
-- cau: "Gop that: 1 so du chung, dung cho con nao cung duoc").
--
-- Truoc day `wallets.student_id` la 1-1 (unique) - moi hoc sinh dung
-- DUNG 1 vi rieng, khong the chia se. Migration nay:
--
--   A) Them bang noi `wallet_students` (wallet_id <-> student_id, MOI
--      hoc sinh van chi thuoc DUNG 1 vi, nhung 1 vi co the co NHIEU hoc
--      sinh) - day la lop thay the cho cot `wallets.student_id` cu.
--   B) Them `student_id` truc tiep vao wallet_topup_requests VA
--      wallet_withdrawal_requests - vi truoc day 2 bang nay chi luu
--      wallet_id roi "doan nguoc" ra 1 hoc sinh duy nhat tu wallets -
--      voi vi dung chung, buoc doan nguoc do KHONG CON DUNG NUA (1 vi
--      co the co nhieu hoc sinh). Gio moi YEU CAU nap/rut vi luu san
--      DUNG hoc sinh ma phu huynh dang thao tac cho, du tien cuoi cung
--      van vao/ra 1 quy chung.
--   C) Ham get_or_create_family_wallet(): khi 1 hoc sinh CHUA co vi,
--      tu dong gan vao vi CHUNG cua anh/chi/em (neu da co, qua cung 1
--      phu huynh) thay vi tao vi rieng moi.
--   D) Trigger TREN parent_student_links: moi lan co lien ket MOI (tu
--      dong theo SDT, tu nhap Ho ten+Ngay sinh, hay nhan vien lien ket
--      thu cong) - neu hoc sinh vua duoc lien ket DA CO san 1 vi rieng
--      (co so du that tu truoc), va gia dinh (qua phu huynh nay) da co
--      1 vi chung khac - TU DONG GOP 2 vi lam 1 (chuyen het cac lo nap
--      con du sang vi chung, xoa vi rieng cu).
--   E) Viet lai TOAN BO ham/RLS dang gia dinh "wallets.student_id" la
--      duy nhat: topup_wallet, deduct_wallet_fifo, deduct_wallet_fifo_generic,
--      calculate_wallet_refund, approve_wallet_withdrawal,
--      center_confirm_withdrawal, confirm_topup_request,
--      reprocess_rejected_topup, confirm_wallet_purchase,
--      process_sepay_webhook, reconcile_sepay_transaction, + RLS cua
--      wallets/wallet_topup_batches/wallet_withdrawal_requests.
--
-- (chay sau file 100)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN A - Bang noi wallet_students + backfill tu du lieu cu
-- ---------------------------------------------------------------------
create table if not exists wallet_students (
  wallet_id uuid not null references wallets(id) on delete cascade,
  student_id uuid not null unique references students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wallet_id, student_id)
);
create index if not exists idx_wallet_students_wallet on wallet_students(wallet_id);

insert into wallet_students (wallet_id, student_id)
select id, student_id from wallets
where student_id is not null
on conflict (student_id) do nothing;

alter table wallet_students enable row level security;
create policy wallet_students_select on wallet_students for select using (
  is_linked_to_student(student_id) or is_executive_or_tech()
  or current_department_id() = (select id from departments where code='ACC')
  or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
);

-- ---------------------------------------------------------------------
-- PHAN B - Them student_id truc tiep vao 2 bang yeu cau (khong con dua
-- vao "doan nguoc" tu wallets nua)
-- ---------------------------------------------------------------------
alter table wallet_topup_requests add column if not exists student_id uuid references students(id);
update wallet_topup_requests t set student_id = w.student_id
from wallets w where w.id = t.wallet_id and t.student_id is null;

alter table wallet_withdrawal_requests add column if not exists student_id uuid references students(id);
update wallet_withdrawal_requests t set student_id = w.student_id
from wallets w where w.id = t.wallet_id and t.student_id is null;

-- Siet lai RLS insert cua wallet_withdrawal_requests - truoc day CHI
-- kiem tra requested_by = current_parent_id(), KHONG he kiem tra
-- wallet_id/student_id co thuoc ve phu huynh do khong (lo hong that,
-- phat hien trong luc sua). Gio bat buoc them dieu kien is_linked_to_student.
drop policy if exists withdrawal_insert on wallet_withdrawal_requests;
create policy withdrawal_insert on wallet_withdrawal_requests for insert
  with check (requested_by = current_parent_id() and (student_id is null or is_linked_to_student(student_id)));

-- ---------------------------------------------------------------------
-- PHAN C - Ham loi: tim / tao vi CHUNG cho 1 hoc sinh
-- ---------------------------------------------------------------------
create or replace function get_wallet_id_for_student(p_student_id uuid)
returns uuid
language sql stable
as $$
  select wallet_id from wallet_students where student_id = p_student_id;
$$;

-- Tim vi cua "gia dinh" (bat ky hoc sinh nao khac dang chia se it nhat 1
-- phu huynh voi p_student_id, ma da co vi) - dung khi p_student_id CHUA
-- co vi, de gan vao DUNG vi chung thay vi tao vi rieng moi.
create or replace function get_sibling_wallet_id(p_student_id uuid)
returns uuid
language sql stable
as $$
  select ws.wallet_id
  from wallet_students ws
  where ws.student_id in (
    select psl2.student_id
    from parent_student_links psl1
    join parent_student_links psl2 on psl2.parent_account_id = psl1.parent_account_id
    where psl1.student_id = p_student_id and psl2.student_id <> p_student_id
  )
  order by ws.created_at asc
  limit 1;
$$;

create or replace function get_or_create_family_wallet(p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_wallet_id uuid;
begin
  v_wallet_id := get_wallet_id_for_student(p_student_id);
  if v_wallet_id is not null then return v_wallet_id; end if;

  v_wallet_id := get_sibling_wallet_id(p_student_id);
  if v_wallet_id is not null then
    insert into wallet_students (wallet_id, student_id) values (v_wallet_id, p_student_id)
    on conflict (student_id) do nothing;
    return v_wallet_id;
  end if;

  insert into wallets default values returning id into v_wallet_id;
  insert into wallet_students (wallet_id, student_id) values (v_wallet_id, p_student_id);
  return v_wallet_id;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN D - Tu dong GOP vi khi co lien ket MOI (parent_student_links)
-- Neu hoc sinh vua lien ket DA CO vi rieng (so du that), va gia dinh
-- (qua phu huynh nay) DA CO vi chung khac -> chuyen het cac lo nap con
-- du + cac yeu cau dang cho tu vi rieng SANG vi chung, roi xoa vi rieng.
-- ---------------------------------------------------------------------
create or replace function merge_wallet_on_new_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_own_wallet uuid;
  v_family_wallet uuid;
begin
  v_own_wallet := get_wallet_id_for_student(new.student_id);
  v_family_wallet := get_sibling_wallet_id(new.student_id);

  if v_family_wallet is null then
    return new;
  end if;

  if v_own_wallet is null then
    return new;
  end if;

  if v_own_wallet = v_family_wallet then
    return new;
  end if;

  update wallet_topup_batches set wallet_id = v_family_wallet where wallet_id = v_own_wallet;
  update wallet_topup_requests set wallet_id = v_family_wallet where wallet_id = v_own_wallet;
  update wallet_withdrawal_requests set wallet_id = v_family_wallet where wallet_id = v_own_wallet;

  delete from wallet_students where wallet_id = v_own_wallet and student_id = new.student_id;
  insert into wallet_students (wallet_id, student_id) values (v_family_wallet, new.student_id)
  on conflict (student_id) do nothing;

  delete from wallets where id = v_own_wallet
    and not exists (select 1 from wallet_students where wallet_id = v_own_wallet);

  perform append_financial_log('WALLET', 0, null, null, v_family_wallet, new.student_id,
    format('Tu dong gop vi rieng vao vi chung gia dinh (lien ket phu huynh moi, hoc sinh %s)', new.student_id));

  return new;
end;
$func$;

drop trigger if exists trg_merge_wallet_on_new_link on parent_student_links;
create trigger trg_merge_wallet_on_new_link
  after insert on parent_student_links
  for each row execute function merge_wallet_on_new_link();

-- ---------------------------------------------------------------------
-- PHAN E1 - topup_wallet (ban cuoi cung, 8 tham so tu file 78) - dung
-- get_or_create_family_wallet() thay vi tu tim/tao truc tiep tren wallets.
-- ---------------------------------------------------------------------
create or replace function topup_wallet(
  p_student_id uuid, p_coin_amount numeric, p_method text, p_created_by uuid default null,
  p_case_discount_rate numeric default 0, p_case_discount_note text default null,
  p_reason text default null, p_system_override boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_wallet_id uuid;
  v_center_id uuid;
  v_calc record;
  v_batch_id uuid;
  v_note text;
begin
  if not p_system_override then
    if p_created_by is null then
      if not is_linked_to_student(p_student_id) then
        raise exception 'Ban khong co quyen nap vi cho hoc sinh nay.';
      end if;
      if p_case_discount_rate > 0 then
        raise exception 'Giam gia theo truong hop chi Ke toan/Quan ly trung tam duoc ap dung.';
      end if;
    else
      if not (
        current_department_id() = (select id from departments where code = 'ACC')
        or (current_role_code() = 'CENTER_MANAGER' and p_student_id in (select id from students where center_id = current_center_id()))
        or is_executive_or_tech()
      ) then
        raise exception 'Ban khong co quyen ghi nhan nap vi ho hoc sinh nay.';
      end if;
      if p_reason is null or trim(p_reason) = '' then
        raise exception 'Bat buoc ghi ro ly do khi nap vi ho tai quay (vd "Thu tien mat tai su kien khai giang 20/8").';
      end if;
    end if;
  end if;

  v_wallet_id := get_or_create_family_wallet(p_student_id);

  select center_id into v_center_id from students where id = p_student_id;
  select * into v_calc from calculate_topup_conversion(p_coin_amount, v_center_id, p_case_discount_rate);

  insert into wallet_topup_batches (
    wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate,
    applied_program_id, amount_vnd_paid, method, created_by, case_discount_note
  ) values (
    v_wallet_id, p_coin_amount, p_coin_amount, v_calc.discount_rate, v_calc.conversion_rate,
    v_calc.program_id, p_coin_amount * v_calc.conversion_rate, p_method, p_created_by, p_case_discount_note
  ) returning id into v_batch_id;

  v_note := format('Nạp ví %s AIScoins (chiết khấu tổng %s%%)', p_coin_amount, v_calc.discount_rate * 100);
  if p_reason is not null then
    v_note := v_note || ' — Lý do: ' || p_reason;
  end if;
  perform append_financial_log('WALLET', p_coin_amount * v_calc.conversion_rate, null, p_created_by, v_wallet_id, p_student_id, v_note);

  return v_batch_id;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN E2 - deduct_wallet_fifo (tru hoc phi) - CHI TIM vi (khong tao
-- moi - neu hoc sinh chua tung nap dong nao thi dung la chua co vi that).
-- ---------------------------------------------------------------------
create or replace function deduct_wallet_fifo(p_invoice_id uuid, p_coin_to_deduct numeric, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
  v_wallet_id uuid;
  v_remaining_to_deduct numeric := p_coin_to_deduct;
  v_batch record;
  v_take numeric;
  v_total_vnd numeric := 0;
begin
  select student_id into v_student_id from invoices where id = p_invoice_id;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
    or (p_actor_id is null and is_linked_to_student(v_student_id))
  ) then
    raise exception 'Bạn không có quyền trừ ví cho hoá đơn này.';
  end if;

  v_wallet_id := get_wallet_id_for_student(v_student_id);
  if v_wallet_id is null then raise exception 'Học viên chưa có ví.'; end if;

  for v_batch in
    select * from wallet_topup_batches
    where wallet_id = v_wallet_id and coin_remaining > 0
    order by created_at asc
    for update
  loop
    exit when v_remaining_to_deduct <= 0;
    v_take := least(v_batch.coin_remaining, v_remaining_to_deduct);
    update wallet_topup_batches set coin_remaining = coin_remaining - v_take where id = v_batch.id;
    insert into debt_ledger (invoice_id, source, batch_id, amount_coin, amount_vnd, conversion_rate_used)
    values (p_invoice_id, 'WALLET', v_batch.id, v_take, v_take * v_batch.conversion_rate, v_batch.conversion_rate);
    v_total_vnd := v_total_vnd + (v_take * v_batch.conversion_rate);
    v_remaining_to_deduct := v_remaining_to_deduct - v_take;
  end loop;

  if v_remaining_to_deduct > 0 then
    raise exception 'Số dư ví không đủ — còn thiếu % AIScoins.', v_remaining_to_deduct;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, p_invoice_id, p_actor_id, v_wallet_id, v_student_id,
    format('Thanh toán hoá đơn qua ví: %s AIScoins', p_coin_to_deduct));
  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN E3 - deduct_wallet_fifo_generic (mua sam) - them p_student_id
-- RIENG (khong con doan nguoc tu wallets duoc nua vi 1 vi co the nhieu
-- hoc sinh) de ghi dung log ai la nguoi mua.
-- ---------------------------------------------------------------------
drop function if exists deduct_wallet_fifo_generic(uuid, numeric, uuid, text);

create or replace function deduct_wallet_fifo_generic(p_wallet_id uuid, p_coin_amount numeric, p_actor_id uuid, p_note text, p_student_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_remaining numeric := p_coin_amount;
  v_batch record;
  v_take numeric;
  v_total_vnd numeric := 0;
begin
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

  perform append_financial_log('WALLET', v_total_vnd, null, p_actor_id, p_wallet_id, p_student_id, p_note);
end;
$func$;

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

  v_wallet_id := get_wallet_id_for_student(v_req.student_id);
  if v_wallet_id is null then raise exception 'Hoc sinh chua co vi.'; end if;

  for v_item in select * from wallet_purchase_items where request_id = p_request_id loop
    select stock_quantity into v_current_stock from inventory_stock_view
    where center_id = v_req.center_id and item_id = v_item.item_id and size = coalesce(v_item.size, '');
    if coalesce(v_current_stock, 0) < v_item.quantity then
      raise exception 'Khong du ton kho cho 1 mat hang trong don (con %, can %).', coalesce(v_current_stock,0), v_item.quantity;
    end if;
  end loop;

  perform deduct_wallet_fifo_generic(v_wallet_id, v_req.total_coin_amount, p_confirmer_id,
    format('Mua hang tu vi - phieu %s', v_req.code), v_req.student_id);

  for v_item in select * from wallet_purchase_items where request_id = p_request_id loop
    insert into inventory_transactions (transaction_type, item_id, size, quantity, center_id, performed_by, transaction_date, note)
    values ('out', v_item.item_id, v_item.size, v_item.quantity, v_req.center_id, p_confirmer_id, current_date,
      format('Mua tu vi - phieu %s', v_req.code));
  end loop;

  update wallet_purchase_requests set status = 'confirmed', confirmed_by = p_confirmer_id, confirmed_at = now() where id = p_request_id;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN E4 - calculate_wallet_refund: vi CHUNG nen "so khoa da hoc" phai
-- CONG DON qua TAT CA hoc sinh dang dung chung vi nay (khong chi 1 em),
-- van giu tran = tien thuc con trong vi (da sua o file 98).
-- ---------------------------------------------------------------------
create or replace function calculate_wallet_refund(p_wallet_id uuid)
returns numeric
language plpgsql stable
as $func$
declare
  v_original_coins numeric := 0;
  v_weighted_discount_rate numeric := 0;
  v_weighted_conversion_rate numeric := 0;
  v_consumed_vnd numeric := 0;
  v_student record;
  v_course_id uuid;
  v_course_price numeric;
  v_courses_completed int;
  v_formula_refund numeric;
  v_actual_remaining_vnd numeric := 0;
begin
  select coalesce(sum(coin_amount), 0) into v_original_coins
  from wallet_topup_batches where wallet_id = p_wallet_id;

  if v_original_coins = 0 then return 0; end if;

  select
    coalesce(sum(discount_rate * coin_amount) / nullif(sum(coin_amount), 0), 0),
    coalesce(sum(conversion_rate * coin_amount) / nullif(sum(coin_amount), 0), 0)
  into v_weighted_discount_rate, v_weighted_conversion_rate
  from wallet_topup_batches where wallet_id = p_wallet_id;

  for v_student in select student_id from wallet_students where wallet_id = p_wallet_id loop
    select c.course_id into v_course_id from students s join classes c on c.id = s.class_id where s.id = v_student.student_id;
    if v_course_id is not null then
      select price_vnd, display_order into v_course_price, v_courses_completed from program_courses where id = v_course_id;
      v_consumed_vnd := v_consumed_vnd + (coalesce(v_courses_completed, 0) * coalesce(v_course_price, 0) * v_weighted_discount_rate);
    end if;
  end loop;

  v_formula_refund := greatest((v_original_coins * v_weighted_conversion_rate) - v_consumed_vnd, 0);

  select coalesce(sum(coin_remaining * conversion_rate), 0) into v_actual_remaining_vnd
  from wallet_topup_batches where wallet_id = p_wallet_id and coin_remaining > 0;

  return least(v_formula_refund, v_actual_remaining_vnd);
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN E5 - approve_wallet_withdrawal / center_confirm_withdrawal: dung
-- v_req.student_id (da luu san tren request) thay vi doan nguoc tu vi.
-- ---------------------------------------------------------------------
create or replace function center_confirm_withdrawal(p_request_id uuid, p_confirmer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
begin
  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;

  if not (
    (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
      and (
        v_req.student_id in (select id from students where center_id = current_center_id())
        or exists (
          select 1 from wallet_students ws join students s on s.id = ws.student_id
          where ws.wallet_id = v_req.wallet_id and s.center_id = current_center_id()
        )
      ))
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan yeu cau nay.';
  end if;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nay da qua buoc xac nhan roi.'; end if;

  update wallet_withdrawal_requests set status = 'center_confirmed', center_confirmed_by = p_confirmer_id, center_confirmed_at = now()
  where id = p_request_id;
end;
$func$;

create or replace function approve_wallet_withdrawal(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_actual numeric;
begin
  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc duyet yeu cau rut vi.';
  end if;

  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;
  if v_req.status <> 'center_confirmed' then
    raise exception 'Yeu cau nay can Quan ly trung tam/Tu van vien xac nhan truoc khi Ke toan duyet.';
  end if;

  v_actual := calculate_wallet_refund(v_req.wallet_id);

  update wallet_topup_batches set coin_remaining = 0 where wallet_id = v_req.wallet_id and coin_remaining > 0;
  update wallet_withdrawal_requests
  set status = 'approved', actual_amount_vnd = v_actual, approved_by = p_approver_id, approved_at = now()
  where id = p_request_id;

  perform append_financial_log('WALLET', -v_actual, null, p_approver_id, v_req.wallet_id, v_req.student_id,
    format('Hoàn tiền rút ví: %s VNĐ', v_actual));
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN E6 - create_topup_request / confirm_topup_request / reprocess:
-- dung get_or_create_family_wallet() + luu student_id truc tiep tren
-- request, bo han chu ky 2-tham-so cu (tranh ambiguous overload).
-- ---------------------------------------------------------------------
drop function if exists confirm_topup_request(uuid, uuid);

create or replace function create_topup_request(p_student_id uuid, p_coin_amount numeric)
returns wallet_topup_requests
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_wallet_id uuid;
  v_bank bank_settings;
  v_content text;
  v_result wallet_topup_requests;
begin
  if not is_linked_to_student(p_student_id) then
    raise exception 'Bạn không có quyền nạp ví cho học sinh này.';
  end if;

  v_wallet_id := get_or_create_family_wallet(p_student_id);

  select * into v_bank from bank_settings
  where is_active and (center_id is null or center_id = (select center_id from students where id = p_student_id))
  order by center_id nulls last limit 1;
  if v_bank.id is null then raise exception 'Chưa cấu hình tài khoản ngân hàng nhận tiền — liên hệ trung tâm.'; end if;

  v_content := 'NAP' || upper(substring(replace(uuid_generate_v4()::text, '-', '') from 1 for 8));

  insert into wallet_topup_requests (wallet_id, student_id, requested_by, coin_amount, transfer_content, bank_setting_id, status)
  values (v_wallet_id, p_student_id, current_parent_id(), p_coin_amount, v_content, v_bank.id, 'pending')
  returning * into v_result;

  return v_result;
end;
$func$;

create or replace function confirm_topup_request(
  p_request_id uuid, p_approver_id uuid,
  p_case_discount_rate numeric default 0, p_case_discount_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_topup_requests%rowtype;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan nap vi.';
  end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nay da duoc xu ly roi.'; end if;

  perform topup_wallet(v_req.student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, p_case_discount_rate, p_case_discount_note);

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
end;
$func$;

create or replace function reprocess_rejected_topup(p_request_id uuid, p_approver_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_topup_requests%rowtype;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc xu ly lai yeu cau da tu choi.';
  end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'rejected' then
    raise exception 'Chi xu ly lai duoc yeu cau dang o trang thai "Da tu choi". Yeu cau nay hien dang: %', v_req.status;
  end if;

  perform topup_wallet(v_req.student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, 0, null,
    coalesce(p_note, 'Xử lý lại yêu cầu đã từ chối nhầm trước đó — đã xác minh tiền đã về'));

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN E7 - SePay: dung v_req.student_id truc tiep, khong doan nguoc.
-- ---------------------------------------------------------------------
create or replace function process_sepay_webhook(
  p_transfer_content text, p_amount_vnd numeric, p_sepay_transaction_id text, p_raw_content text default null, p_raw_payload jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_topup_requests%rowtype;
  v_tx_id uuid;
  v_raw_upper text := upper(coalesce(p_raw_content, p_transfer_content));
  v_match_mode text := 'exact';
begin
  if exists (select 1 from sepay_transactions where sepay_transaction_id = p_sepay_transaction_id) then
    return jsonb_build_object('status', 'already_logged', 'transaction_id', p_sepay_transaction_id);
  end if;

  insert into sepay_transactions (sepay_transaction_id, amount_vnd, raw_content, extracted_content, raw_payload, status)
  values (p_sepay_transaction_id, p_amount_vnd, coalesce(p_raw_content, p_transfer_content), p_transfer_content, p_raw_payload, 'unmatched')
  returning id into v_tx_id;

  select * into v_req from wallet_topup_requests
  where transfer_content = p_transfer_content and status = 'pending'
  for update;

  if v_req.id is null then
    v_match_mode := 'contains_raw';
    select * into v_req from wallet_topup_requests
    where status = 'pending' and v_raw_upper like '%' || transfer_content || '%'
    order by created_at desc
    limit 1
    for update;
  end if;

  if v_req.id is null then
    return jsonb_build_object('status', 'no_match', 'transaction_log_id', v_tx_id, 'transfer_content', p_transfer_content, 'amount_vnd', p_amount_vnd);
  end if;

  perform topup_wallet(
    v_req.student_id, v_req.coin_amount, 'bank_transfer', null, 0,
    null, format('Tự động xác nhận qua SePay webhook (khớp: %s)', v_match_mode), true
  );

  update wallet_topup_requests
  set status = 'confirmed', confirmed_at = now(),
      sepay_transaction_id = p_sepay_transaction_id, confirmed_amount_vnd = p_amount_vnd
  where id = v_req.id;

  update sepay_transactions set status = 'matched', matched_request_id = v_req.id where id = v_tx_id;

  return jsonb_build_object('status', 'confirmed', 'request_id', v_req.id, 'transaction_log_id', v_tx_id, 'transfer_content', p_transfer_content, 'match_mode', v_match_mode);
end;
$func$;

grant execute on function process_sepay_webhook(text, numeric, text, text, jsonb) to service_role;

create or replace function reconcile_sepay_transaction(p_transaction_id uuid, p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_tx sepay_transactions%rowtype;
  v_req wallet_topup_requests%rowtype;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi doi chieu duoc.';
  end if;

  select * into v_tx from sepay_transactions where id = p_transaction_id for update;
  if v_tx.status = 'matched' then raise exception 'Giao dich nay da duoc doi chieu roi.'; end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nap vi nay da duoc xu ly roi.'; end if;

  perform topup_wallet(v_req.student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, 0, null,
    format('Đối chiếu thủ công với giao dịch SePay #%s (số tiền %s VNĐ)', v_tx.sepay_transaction_id, v_tx.amount_vnd));

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
  update sepay_transactions set status = 'matched', matched_request_id = p_request_id, reconciled_by = p_approver_id, reconciled_at = now() where id = p_transaction_id;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN F - RLS: chuyen tu "wallets.student_id" sang "wallet_students"
-- ---------------------------------------------------------------------
drop policy if exists wallets_select on wallets;
create policy wallets_select on wallets for select using (
  id in (select wallet_id from wallet_students ws where is_linked_to_student(ws.student_id))
  or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
  or (current_role_code()='CENTER_MANAGER' and id in (
    select ws.wallet_id from wallet_students ws join students s on s.id = ws.student_id where s.center_id = current_center_id()
  ))
);

drop policy if exists wallet_topup_batches_select on wallet_topup_batches;
create policy wallet_topup_batches_select on wallet_topup_batches for select using (
  wallet_id in (select wallet_id from wallet_students ws where is_linked_to_student(ws.student_id))
  or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
);

drop policy if exists withdrawal_select on wallet_withdrawal_requests;
create policy withdrawal_select on wallet_withdrawal_requests for select using (
  requested_by = current_parent_id()
  or is_executive_or_tech()
  or current_department_id() = (select id from departments where code='ACC')
  or (current_role_code() in ('CENTER_MANAGER','CONSULTANT') and (
    student_id in (select id from students where center_id = current_center_id())
    or wallet_id in (select ws.wallet_id from wallet_students ws join students s on s.id = ws.student_id where s.center_id = current_center_id())
  ))
);

drop policy if exists topup_requests_select on wallet_topup_requests;
create policy topup_requests_select on wallet_topup_requests for select using (
  requested_by = current_parent_id() or is_executive_or_tech()
  or current_department_id() = (select id from departments where code='ACC')
  or (current_role_code() = 'CENTER_MANAGER' and (
    student_id in (select id from students where center_id = current_center_id())
    or wallet_id in (select ws.wallet_id from wallet_students ws join students s on s.id = ws.student_id where s.center_id = current_center_id())
  ))
);

-- ---------------------------------------------------------------------
-- PHAN H - Cho phep phu huynh TU GO lien ket sai (vd tu dong lien ket
-- nham do trung SDT voi hoc sinh khac) - dung RPC rieng (khong mo RLS
-- delete truc tiep) de kiem soat chat: chi duoc go DUNG lien ket cua
-- CHINH minh, khong dung duoc de go lien ket cua phu huynh khac.
-- ---------------------------------------------------------------------
create or replace function parent_unlink_student(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_parent_id uuid;
begin
  v_parent_id := current_parent_id();
  if v_parent_id is null then
    raise exception 'Không xác định được tài khoản phụ huynh.';
  end if;

  delete from parent_student_links
  where parent_account_id = v_parent_id and student_id = p_student_id;

  if not found then
    raise exception 'Không tìm thấy liên kết này trong tài khoản của bạn.';
  end if;
end;
$func$;

grant execute on function parent_unlink_student(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- PHAN G - Don cot cu (chi bay gio, SAU KHI toan bo ham/RLS o tren da
-- duoc viet lai KHONG con dung wallets.student_id nua).
-- ---------------------------------------------------------------------
alter table wallets drop column if exists student_id;
