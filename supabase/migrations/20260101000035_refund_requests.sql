-- =====================================================================
-- File 35: YEU CAU HOAN PHI (tien mat/CK + vi qua duyet trung tam truoc)
-- + DIEN UU DAI DAC BIET (chay sau file 34)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - Yeu cau hoan phi TIEN MAT/CHUYEN KHOAN (khac vi - khong co
-- san "lo nap" nen dung cong thuc rieng theo dung yeu cau BGD):
--   So tien hoan = So tien thuc nap - (So khoa da hoc x Hoc phi don khoa
--                  goc x (1 - % khuyen mai))
-- Trung tam TAO YEU CAU (chua hoan ngay), Ke toan duyet xong moi that su
-- xu ly hoan tien.
-- ---------------------------------------------------------------------
create table if not exists tuition_refund_requests (
  id uuid primary key default uuid_generate_v4(),
  code text unique,
  student_id uuid not null references students(id),
  source text not null check (source in ('CASH', 'BANK_TRANSFER')),
  amount_paid numeric(14,2) not null,      -- so tien thuc da nap/dong
  courses_completed int not null default 0,
  course_fee numeric(14,2) not null,       -- hoc phi don khoa GOC (chua giam)
  promo_rate numeric(5,4) not null default 0, -- % khuyen mai da ap dung luc dong
  refund_amount numeric(14,2) not null,    -- tinh san luc tao yeu cau, luu lai de doi chieu
  reason text,
  requested_by uuid not null references employees(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create trigger tuition_refund_set_code before insert on tuition_refund_requests
for each row execute function trg_set_code_acc1();

alter table tuition_refund_requests enable row level security;
create policy tuition_refund_select on tuition_refund_requests for select
  using (
    requested_by = current_employee_id()
    or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
    or is_executive_or_tech()
  );
create policy tuition_refund_insert on tuition_refund_requests for insert
  with check (
    current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  );
create policy tuition_refund_update on tuition_refund_requests for update
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

-- Ke toan duyet -> ghi nhan hoan (khong tu dong chuyen tien - giong cach
-- da lam voi hoan phi goi, chi ghi so).
create or replace function approve_tuition_refund(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req tuition_refund_requests%rowtype;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc duyet hoan phi.';
  end if;

  select * into v_req from tuition_refund_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nay da duoc xu ly roi.'; end if;

  update tuition_refund_requests set status = 'approved', approved_by = p_approver_id, approved_at = now() where id = p_request_id;

  perform append_financial_log(v_req.source, -v_req.refund_amount, null, p_approver_id, null, v_req.student_id,
    format('Hoan phi tai quay: da hoc %s khoa', v_req.courses_completed));
end;
$func$;

create or replace function reject_tuition_refund(p_request_id uuid, p_approver_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc tu choi.';
  end if;
  update tuition_refund_requests set status = 'rejected', approved_by = p_approver_id, approved_at = now(), reject_reason_note = p_reason
  where id = p_request_id and status = 'pending';
end;
$func$;
alter table tuition_refund_requests add column if not exists reject_reason_note text;

-- ---------------------------------------------------------------------
-- PHAN 2 - Yeu cau hoan phi VI: them buoc Quan ly trung tam/Tu van vien
-- XAC NHAN truoc khi chuyen sang Ke toan duyet (truoc day di thang tu
-- phu huynh -> Ke toan, thieu 1 buoc trung gian theo dung yeu cau moi).
-- ---------------------------------------------------------------------
alter table wallet_withdrawal_requests add column if not exists center_confirmed_by uuid references employees(id);
alter table wallet_withdrawal_requests add column if not exists center_confirmed_at timestamptz;
alter table wallet_withdrawal_requests drop constraint if exists wallet_withdrawal_requests_status_check;
alter table wallet_withdrawal_requests add constraint wallet_withdrawal_requests_status_check
  check (status in ('pending', 'center_confirmed', 'approved', 'rejected'));

create or replace function center_confirm_withdrawal(p_request_id uuid, p_confirmer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_student_id uuid;
begin
  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;
  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  if not (
    (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and v_student_id in (select id from students where center_id = current_center_id()))
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan yeu cau nay.';
  end if;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nay da qua buoc xac nhan roi.'; end if;

  update wallet_withdrawal_requests set status = 'center_confirmed', center_confirmed_by = p_confirmer_id, center_confirmed_at = now()
  where id = p_request_id;
end;
$func$;

-- approve_wallet_withdrawal() gio chi duyet duoc yeu cau da qua buoc
-- center_confirmed (khong duyet thang tu pending nua).
create or replace function approve_wallet_withdrawal(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_actual numeric;
  v_student_id uuid;
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
  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  update wallet_topup_batches set coin_remaining = 0 where wallet_id = v_req.wallet_id and coin_remaining > 0;
  update wallet_withdrawal_requests
  set status = 'approved', actual_amount_vnd = v_actual, approved_by = p_approver_id, approved_at = now()
  where id = p_request_id;

  perform append_financial_log('WALLET', -v_actual, null, p_approver_id, v_req.wallet_id, v_student_id,
    format('Hoan tien rut vi: %s VND', v_actual));
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN 3 - Dien uu dai dac biet (con HDQT, chau HDQT, con hieu truong,
-- khac) - mo rong discount_type cua invoices them 1 gia tri nua.
-- ---------------------------------------------------------------------
alter table invoices drop constraint if exists invoices_discount_type_check;
alter table invoices add constraint invoices_discount_type_check
  check (discount_type in ('none', 'case', 'program', 'special'));
alter table invoices add column if not exists special_category text
  check (special_category in ('child_of_board', 'grandchild_of_board', 'child_of_principal', 'other'));

-- Mo rong apply_case_discount_to_invoice them tham so dien uu dai dac
-- biet (con HDQT/chau HDQT/con hieu truong/khac) - khong bat buoc, mac
-- dinh van la giam gia thuong neu khong truyen.
-- XOA ham cu (3 tham so) truoc - neu khong Postgres se giu CA 2 ham do
-- khac chu ky (overload), gay nham lan chu khong tu thay the.
drop function if exists apply_case_discount_to_invoice(uuid, numeric, text);

create or replace function apply_case_discount_to_invoice(
  p_invoice_id uuid, p_amount_vnd numeric, p_note text, p_special_category text default null
)
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
    discount_type = case when p_amount_vnd <= 0 then 'none' when p_special_category is not null then 'special' else 'case' end,
    special_category = p_special_category
  where id = p_invoice_id;

  perform refresh_invoice_status(p_invoice_id);
end;
$func$;
