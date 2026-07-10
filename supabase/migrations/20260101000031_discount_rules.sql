-- =====================================================================
-- File 31: DUNG LAI QUY TAC CHIET KHAU (chay sau file 30)
--
-- NAP VI: cong don CA 3 loai - Giam theo truong hop (nhap tay + note) +
-- Uu dai chuong trinh + Chiet khau theo bac so tien - toi da 40%.
-- THU HOC PHI (hoa don): CHI CHON 1 TRONG 2 - Giam theo truong hop HOAC
-- Uu dai chuong trinh, KHONG cong don.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - Nap vi: them tham so giam gia theo truong hop (case-specific),
-- cong don voi bac mac dinh + uu dai chuong trinh, toi da 40%.
-- ---------------------------------------------------------------------
drop function if exists calculate_topup_conversion(numeric, uuid);
create or replace function calculate_topup_conversion(
  p_coin_amount numeric, p_center_id uuid, p_case_discount_rate numeric default 0
) returns table (
  discount_rate numeric,
  conversion_rate numeric,
  program_id uuid,
  tier_rate numeric,
  program_rate numeric,
  program_name text,
  case_rate numeric
)
language plpgsql stable
as $func$
declare
  v_default_rate numeric;
  v_program discount_programs;
  v_base_rate numeric;
  v_final_rate numeric;
begin
  v_default_rate := get_default_discount_rate(p_coin_amount);
  v_program := get_active_discount_program(p_center_id);

  if v_program.id is not null and v_program.discount_rate > 0.20 then
    v_base_rate := v_program.discount_rate;
  else
    v_base_rate := v_default_rate + coalesce(v_program.discount_rate, 0);
  end if;

  -- Giam theo truong hop (nhap tay, co note rieng) CONG DON THEM vao tren,
  -- van gioi han tran tuyet doi 40% (muc 2.4).
  v_final_rate := least(v_base_rate + coalesce(p_case_discount_rate, 0), 0.40);

  return query select
    v_final_rate, (1 - v_final_rate), v_program.id,
    v_default_rate, coalesce(v_program.discount_rate, 0), v_program.name,
    coalesce(p_case_discount_rate, 0);
end;
$func$;

-- topup_wallet(): them tham so giam gia theo truong hop + note, dung
-- CHINH XAC ty gia da tinh (khong tinh lai) de tranh sai lech.
create or replace function topup_wallet(
  p_student_id uuid, p_coin_amount numeric, p_method text, p_created_by uuid default null,
  p_case_discount_rate numeric default 0, p_case_discount_note text default null
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
begin
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
  end if;

  select id into v_wallet_id from wallets where student_id = p_student_id;
  if v_wallet_id is null then
    insert into wallets (student_id) values (p_student_id) returning id into v_wallet_id;
  end if;

  select center_id into v_center_id from students where id = p_student_id;
  select * into v_calc from calculate_topup_conversion(p_coin_amount, v_center_id, p_case_discount_rate);

  insert into wallet_topup_batches (
    wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate,
    applied_program_id, amount_vnd_paid, method, created_by, case_discount_note
  ) values (
    v_wallet_id, p_coin_amount, p_coin_amount, v_calc.discount_rate, v_calc.conversion_rate,
    v_calc.program_id, p_coin_amount * v_calc.conversion_rate, p_method, p_created_by, p_case_discount_note
  ) returning id into v_batch_id;

  perform append_financial_log('WALLET', p_coin_amount * v_calc.conversion_rate, null, p_created_by, v_wallet_id, p_student_id,
    format('Nap vi %s AIScoins (chiet khau tong %s%%)', p_coin_amount, v_calc.discount_rate * 100));

  return v_batch_id;
end;
$func$;

alter table wallet_topup_batches add column if not exists case_discount_note text;

-- confirm_topup_request(): cho phep Ke toan them giam gia theo truong hop
-- NGAY LUC XAC NHAN da nhan duoc chuyen khoan (khac voi so coin/VND phu
-- huynh da yeu cau ban dau qua QR) - vd thuong them coin cho truong hop
-- dac biet duoc duyet rieng.
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
  v_student_id uuid;
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

  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  perform topup_wallet(v_student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, p_case_discount_rate, p_case_discount_note);

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN 2 - Hoa don hoc phi: CHI CHON 1 TRONG 2 (giam theo truong hop HOAC
-- uu dai chuong trinh), khong cong don. Them cot phan biet loai giam gia
-- da ap dung de UI hien dung, tranh nham voi manual_discount_vnd cu (gio
-- dung chung cho ca 2 truong hop, phan biet bang discount_type).
-- ---------------------------------------------------------------------
alter table invoices add column if not exists discount_type text check (discount_type in ('none', 'case', 'program'));
update invoices set discount_type = case when manual_discount_vnd > 0 then 'case' else 'none' end where discount_type is null;

-- Ham tinh sang uu dai chuong trinh cho 1 hoa don cu the (theo dung trung
-- tam cua hoc sinh, dung LAI logic discount_programs da co - khong tao
-- bang rieng, dam bao 1 nguon su that duy nhat cho quy tac loai tru lan
-- nhau giua Toan he thong/Trung tam).
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
    or current_role_code() = 'CENTER_MANAGER'
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

-- Giam gia theo truong hop cho hoa don (nhap tay so tien + note) - neu
-- truoc do da ap dung uu dai chuong trinh thi bi GHI DE (chi 1 trong 2).
create or replace function apply_case_discount_to_invoice(p_invoice_id uuid, p_amount_vnd numeric, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
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

revoke execute on function refresh_invoice_status(uuid) from public, anon, authenticated;
