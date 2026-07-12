-- =====================================================================
-- File 48: TK 242 PHAN BO CHI PHI TRA TRUOC + DINH MUC TRAN CHI PHI VAN
-- HANH THEO TRUNG TAM (chay sau file 47)
--
-- GIA DINH DA TU CHON (chua duoc xac nhan lai, sua sau neu can):
-- - TK 242: ap dung TUY CHON (tick chon luc tao Phieu thanh toan), mac
--   dinh phan bo deu 12 thang, KHONG tu dong ghi so hang thang bang cron
--   (tranh qua phuc tap khi chua ro quy trinh ke toan that) - thay vao
--   do co 1 trang de Ke toan tu bam "Ghi nhan" dung thang phat sinh.
-- - Dinh muc tran: cau hinh theo TUNG TRUNG TAM + TUNG HANG MUC CHI
--   (dung lai expense_categories da co), CANH BAO (khong chan cung) neu
--   vuot, dung dung chu "canh bao do" trong dac ta (khong noi "cam").
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - TK 242: Chi phi tra truoc phan bo dan
-- ---------------------------------------------------------------------
create table if not exists prepaid_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid not null references payment_requests(id),
  total_amount numeric(14,2) not null,
  start_date date not null,
  months int not null default 12 check (months > 0),
  center_id uuid references centers(id),
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create table if not exists prepaid_expense_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prepaid_expense_id uuid not null references prepaid_expenses(id) on delete cascade,
  period_year int not null,
  period_month int not null,
  amount numeric(14,2) not null,
  posted boolean not null default false,
  posted_at timestamptz,
  posted_by uuid references employees(id),
  unique (prepaid_expense_id, period_year, period_month)
);

-- Tao lich phan bo N thang deu nhau ngay khi dang ky TK 242 cho 1 phieu
-- thanh toan (chua ghi so ngay - chi tao "lich hen" cho tung thang).
create or replace function create_prepaid_expense(p_payment_request_id uuid, p_months int)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payment payment_requests%rowtype;
  v_prepaid_id uuid;
  v_monthly numeric;
  v_date date;
  i int;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được đăng ký phân bổ TK 242.';
  end if;

  select * into v_payment from payment_requests where id = p_payment_request_id;
  if v_payment.id is null then raise exception 'Không tìm thấy phiếu thanh toán.'; end if;

  v_monthly := round(v_payment.amount / p_months, 2);
  v_date := current_date;

  insert into prepaid_expenses (payment_request_id, total_amount, start_date, months, center_id, created_by)
  values (p_payment_request_id, v_payment.amount, v_date, p_months, v_payment.center_id, current_employee_id())
  returning id into v_prepaid_id;

  for i in 0..(p_months - 1) loop
    insert into prepaid_expense_allocations (prepaid_expense_id, period_year, period_month, amount)
    values (
      v_prepaid_id,
      extract(year from (v_date + (i || ' months')::interval))::int,
      extract(month from (v_date + (i || ' months')::interval))::int,
      v_monthly
    );
  end loop;

  return v_prepaid_id;
end;
$func$;

-- Ke toan bam "Ghi nhan" dung thang phat sinh -> ghi 1 dong outflow vao
-- cash_flow_entries (KHONG tu dong bang cron, tranh phuc tap khi chua ro
-- quy trinh doi soat that cua ke toan).
create or replace function post_prepaid_allocation(p_allocation_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_alloc prepaid_expense_allocations%rowtype;
  v_prepaid prepaid_expenses%rowtype;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được ghi nhận phân bổ.';
  end if;

  select * into v_alloc from prepaid_expense_allocations where id = p_allocation_id for update;
  if v_alloc.posted then raise exception 'Kỳ này đã được ghi nhận rồi.'; end if;
  select * into v_prepaid from prepaid_expenses where id = v_alloc.prepaid_expense_id;

  insert into cash_flow_entries (center_id, entry_type, category, amount, entry_date, note, created_by)
  values (v_prepaid.center_id, 'outflow', 'prepaid_242', v_alloc.amount, current_date,
    format('Phân bổ TK 242 — kỳ %s/%s', v_alloc.period_month, v_alloc.period_year), p_actor_id);

  update prepaid_expense_allocations set posted = true, posted_at = now(), posted_by = p_actor_id where id = p_allocation_id;
end;
$func$;

alter table prepaid_expenses enable row level security;
create policy prepaid_expenses_select on prepaid_expenses for select
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());
alter table prepaid_expense_allocations enable row level security;
create policy prepaid_allocations_select on prepaid_expense_allocations for select
  using (prepaid_expense_id in (select id from prepaid_expenses));

-- ---------------------------------------------------------------------
-- PHAN 2 - Dinh muc tran chi phi van hanh theo Trung tam + Hang muc chi
-- ---------------------------------------------------------------------
create table if not exists center_expense_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid not null references centers(id),
  expense_category_id uuid not null references expense_categories(id),
  monthly_cap numeric(14,2) not null default 0,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  unique (center_id, expense_category_id)
);

alter table center_expense_budgets enable row level security;
create policy center_budgets_select on center_expense_budgets for select to authenticated using (true);
create policy center_budgets_write on center_expense_budgets for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

-- Kiem tra neu 1 khoan chi moi se lam VUOT dinh muc thang cua trung
-- tam+hang muc do khong - tra ve da chi, han muc, co vuot hay khong (de
-- frontend tu hien canh bao do, KHONG chan cung viec tao phieu).
create or replace function check_budget_cap(p_center_id uuid, p_expense_category_id uuid, p_new_amount numeric)
returns table (already_spent numeric, monthly_cap numeric, would_exceed boolean)
language plpgsql stable
as $func$
declare
  v_cap numeric;
  v_spent numeric;
begin
  select monthly_cap into v_cap from center_expense_budgets
  where center_id = p_center_id and expense_category_id = p_expense_category_id;
  if v_cap is null then
    return query select 0::numeric, 0::numeric, false;
    return;
  end if;

  select coalesce(sum(pr.amount), 0) into v_spent
  from payment_requests pr
  join purchase_orders po on po.id = pr.purchase_order_id
  where po.center_id = p_center_id and po.expense_category_id = p_expense_category_id
    and pr.status in ('approved_1', 'approved_2', 'approved_3')
    and date_trunc('month', pr.created_at) = date_trunc('month', current_date);

  return query select v_spent, v_cap, (v_spent + p_new_amount) > v_cap;
end;
$func$;

-- Sua lai: create_prepaid_expense() truoc do chi cho ACC/exec goi, nhung
-- thuc te NGUOI TAO phieu thanh toan (co the la nhan vien bat ky phong
-- ban nao) la nguoi tick chon TK 242 ngay luc tao phieu - can cho ho goi
-- duoc luon, khong chi rieng ACC.
create or replace function create_prepaid_expense(p_payment_request_id uuid, p_months int)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payment payment_requests%rowtype;
  v_prepaid_id uuid;
  v_monthly numeric;
  v_date date;
  i int;
begin
  select * into v_payment from payment_requests where id = p_payment_request_id;
  if v_payment.id is null then raise exception 'Không tìm thấy phiếu thanh toán.'; end if;

  if not (
    v_payment.requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền đăng ký phân bổ TK 242 cho phiếu này.';
  end if;

  v_monthly := round(v_payment.amount / p_months, 2);
  v_date := current_date;

  insert into prepaid_expenses (payment_request_id, total_amount, start_date, months, center_id, created_by)
  values (p_payment_request_id, v_payment.amount, v_date, p_months, v_payment.center_id, current_employee_id())
  returning id into v_prepaid_id;

  for i in 0..(p_months - 1) loop
    insert into prepaid_expense_allocations (prepaid_expense_id, period_year, period_month, amount)
    values (
      v_prepaid_id,
      extract(year from (v_date + (i || ' months')::interval))::int,
      extract(month from (v_date + (i || ' months')::interval))::int,
      v_monthly
    );
  end loop;

  return v_prepaid_id;
end;
$func$;

drop policy if exists prepaid_expenses_select on prepaid_expenses;
create policy prepaid_expenses_select on prepaid_expenses for select
  using (
    created_by = current_employee_id()
    or current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  );
