-- =====================================================================
-- File 33: MO QUYEN CHO NHAN VIEN TU VAN THAO TAC THU HOC PHI
-- (chay sau file 32)
--
-- Giao dien da cho phep Tu van vien dung trang Thu hoc phi, nhung cac
-- ham RPC/RLS phia sau CHUA duoc mo tuong ung - neu khong sua, tu van
-- vien se THAY nut nhung bam vao bao loi tu choi quyen. Vá dong bo.
-- =====================================================================

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
  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tru vi cho hoa don nay.';
  end if;

  select student_id into v_student_id from invoices where id = p_invoice_id;
  select id into v_wallet_id from wallets where student_id = v_student_id;
  if v_wallet_id is null then raise exception 'Hoc vien chua co vi.'; end if;

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
    raise exception 'So du vi khong du - con thieu % AIScoins.', v_remaining_to_deduct;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, p_invoice_id, p_actor_id, v_wallet_id, v_student_id,
    format('Thanh toan hoa don qua vi: %s AIScoins', p_coin_to_deduct));
  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

create or replace function record_counter_payment(
  p_invoice_id uuid, p_source text, p_amount_vnd numeric, p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
begin
  if p_source not in ('CASH', 'BANK_TRANSFER') then
    raise exception 'record_counter_payment chi dung cho CASH hoac BANK_TRANSFER.';
  end if;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen ghi nhan thu tien tai quay.';
  end if;

  select student_id into v_student_id from invoices where id = p_invoice_id;
  insert into debt_ledger (invoice_id, source, amount_vnd) values (p_invoice_id, p_source, p_amount_vnd);
  perform append_financial_log(p_source, p_amount_vnd, p_invoice_id, p_actor_id, null, v_student_id, 'Thu hoc phi tai quay');
  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

create or replace function create_payment_plan_invoice(
  p_student_id uuid, p_plan_type text, p_scope_id uuid
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_discount_rate numeric;
  v_base_price numeric;
  v_course_count int;
  v_final_price numeric;
  v_due_date date;
  v_result invoices;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tao hoa don.';
  end if;

  select discount_rate into v_discount_rate from payment_plan_discounts where plan_type = p_plan_type;

  if p_plan_type = 'sublevel' then
    select price_vnd into v_base_price from program_sublevels where id = p_scope_id;
    v_course_count := 1;
  elsif p_plan_type = 'level' then
    select coalesce(sum(price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_sublevels where level_id = p_scope_id;
  elsif p_plan_type = 'program' then
    select coalesce(sum(ps.price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_sublevels ps join program_levels pl on pl.id = ps.level_id
    where pl.program_id = p_scope_id;
  else
    raise exception 'plan_type khong hop le.';
  end if;

  if v_base_price is null or v_base_price <= 0 then
    raise exception 'Chua cau hinh hoc phi cho cap do/chuong trinh nay.';
  end if;

  v_final_price := v_base_price * (1 - coalesce(v_discount_rate, 0));
  v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason)
  values (
    p_student_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when v_discount_rate > 0 then 'program' else 'none' end,
    v_base_price - v_final_price,
    case when v_discount_rate > 0 then format('Giam gia hinh thuc dong "%s" (%s%%)', p_plan_type, v_discount_rate * 100) else null end
  )
  returning * into v_result;

  if p_plan_type in ('level', 'program') then
    insert into payment_plan_purchases (student_id, plan_type, level_id, program_id, total_courses, discount_rate_applied, total_amount_vnd, invoice_id)
    values (
      p_student_id, p_plan_type,
      case when p_plan_type = 'level' then p_scope_id else null end,
      case when p_plan_type = 'program' then p_scope_id else null end,
      v_course_count, coalesce(v_discount_rate, 0), v_final_price, v_result.id
    );
  end if;

  return v_result;
end;
$func$;

create or replace function apply_program_discount_to_invoice(p_invoice_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_center_id uuid;
  v_program discount_programs;
  v_discount_vnd numeric;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen dieu chinh hoa don nay.';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  select center_id into v_center_id from students where id = v_invoice.student_id;
  select * into v_program from get_active_discount_program(v_center_id);

  if v_program.id is null then
    raise exception 'Hien khong co chuong trinh uu dai nao dang hoat dong cho trung tam nay.';
  end if;

  v_discount_vnd := v_invoice.amount_vnd * v_program.discount_rate;

  update invoices set
    manual_discount_vnd = v_discount_vnd,
    manual_discount_reason = format('Ap dung uu dai chuong trinh "%s" (%s%%)', v_program.name, v_program.discount_rate * 100),
    discount_type = 'program'
  where id = p_invoice_id;

  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

create or replace function apply_case_discount_to_invoice(p_invoice_id uuid, p_amount_vnd numeric, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen dieu chinh hoa don nay.';
  end if;

  update invoices set
    manual_discount_vnd = p_amount_vnd,
    manual_discount_reason = p_note,
    discount_type = case when p_amount_vnd > 0 then 'case' else 'none' end
  where id = p_invoice_id;

  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

-- RLS bang invoices: mo them cho Tu van vien (chi hoc sinh trong dung
-- trung tam cua ho, giong dieu kien Quan ly trung tam).
drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all
  using (
    is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
  )
  with check (
    is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
  );

-- LUU Y: process_plan_refund() (hoan phi) KHONG mo cho Tu van vien - chi
-- Ke toan/Ban dieu hanh, vi day la nghiep vu hoan tien that, can kiem
-- soat chat hon thu tien thong thuong.
