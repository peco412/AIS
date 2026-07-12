-- =====================================================================
-- File 75: SUA 2 LOI THAT tu bao cao thuc te:
-- A) discount_programs_view CHUA CO cot applies_via (moi them vao bang
--    goc o file 74) - view khong tu dong theo bang goc, phai dinh nghia
--    lai moi lan them cot, gay loi 400 khi frontend truy van cot nay.
-- B) create_topup_request bi 404 khi goi tu app - phat hanh lai (idempotent,
--    an toan neu da ton tai) de dam bao chac chan co tren database that,
--    phong truong hop migration 27 truoc day chua duoc ap dung day du.
-- (chay sau file 74)
-- =====================================================================

drop view if exists discount_programs_view;
create view discount_programs_view as
select
  id, code, name, scope, center_id, discount_rate,
  applies_to, applies_via, program_id, sublevel_id, course_id,
  lower(valid_range) as valid_from, upper(valid_range) as valid_to,
  status, created_by, created_at, updated_at
from discount_programs;
alter view discount_programs_view set (security_invoker = true);

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

  select id into v_wallet_id from wallets where student_id = p_student_id;
  if v_wallet_id is null then
    insert into wallets (student_id) values (p_student_id) returning id into v_wallet_id;
  end if;

  select * into v_bank from bank_settings
  where is_active and (center_id is null or center_id = (select center_id from students where id = p_student_id))
  order by center_id nulls last limit 1;
  if v_bank.id is null then raise exception 'Chưa cấu hình tài khoản ngân hàng nhận tiền — liên hệ trung tâm.'; end if;

  v_content := 'NAP' || upper(substring(replace(uuid_generate_v4()::text, '-', '') from 1 for 8));

  insert into wallet_topup_requests (wallet_id, requested_by, coin_amount, transfer_content, bank_setting_id, status)
  values (v_wallet_id, current_parent_id(), p_coin_amount, v_content, v_bank.id, 'pending')
  returning * into v_result;

  return v_result;
end;
$func$;

grant execute on function create_topup_request(uuid, numeric) to authenticated;

-- Phong truong hop file 71 (topup_wallet 7 tham so) chua duoc ap dung
-- day du tren database that (cung dang nghi ngo giong create_topup_request
-- o tren) - phat hanh lai cho chac chan, dam bao dung 7 tham so dang
-- dung that trong code frontend hien tai.
drop function if exists topup_wallet(uuid, numeric, text, uuid);
drop function if exists topup_wallet(uuid, numeric, text, uuid, numeric, text);

create or replace function topup_wallet(
  p_student_id uuid, p_coin_amount numeric, p_method text, p_created_by uuid default null,
  p_case_discount_rate numeric default 0, p_case_discount_note text default null,
  p_reason text default null
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

  v_note := format('Nạp ví %s AIScoins (chiết khấu tổng %s%%)', p_coin_amount, v_calc.discount_rate * 100);
  if p_reason is not null then
    v_note := v_note || ' — Lý do: ' || p_reason;
  end if;
  perform append_financial_log('WALLET', p_coin_amount * v_calc.conversion_rate, null, p_created_by, v_wallet_id, p_student_id, v_note);

  return v_batch_id;
end;
$func$;

grant execute on function topup_wallet(uuid, numeric, text, uuid, numeric, text, text) to authenticated;

-- Phong truong hop tuong tu - phat hanh lai calculate_topup_conversion
-- (3 tham so, ban dang dung that trong topup_wallet o tren).
drop function if exists calculate_topup_conversion(numeric, uuid);
drop function if exists calculate_topup_conversion(numeric, uuid, numeric);

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

  v_final_rate := least(v_base_rate + coalesce(p_case_discount_rate, 0), 0.40);

  return query select
    v_final_rate, (1 - v_final_rate), v_program.id,
    v_default_rate, coalesce(v_program.discount_rate, 0), v_program.name,
    coalesce(p_case_discount_rate, 0);
end;
$func$;

grant execute on function calculate_topup_conversion(numeric, uuid, numeric) to authenticated;
