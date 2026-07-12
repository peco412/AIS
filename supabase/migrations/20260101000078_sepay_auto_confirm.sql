-- =====================================================================
-- File 78: TU DONG XAC NHAN NAP VI qua SePay Webhook - giu nguyen QR
-- VietQR dang dung (khong doi gi ca phia phu huynh), chi them lop
-- "nghe" giao dich ngan hang that qua SePay, tu dong cong Coin khi khop
-- dung ma noi dung chuyen khoan (transfer_content).
--
-- Luong: SePay phat hien tien vao -> goi webhook toi Edge Function ->
-- Edge Function xac thuc + goi RPC nay (bang service_role) de xu ly.
-- (chay sau file 77)
-- =====================================================================

alter table wallet_topup_requests add column if not exists sepay_transaction_id text unique;
alter table wallet_topup_requests add column if not exists confirmed_amount_vnd numeric(14,2);

-- QUAN TRONG: topup_wallet() va confirm_topup_request() ban goc deu kiem
-- tra quyen dua tren PHIEN DANG NHAP (current_department_id()/
-- current_role_code()/current_parent_id()) - webhook chay bang
-- service_role KHONG CO phien dang nhap nao, se bi chan boi ca 2 kiem
-- tra do. Them tham so "p_system_override" CHI dung NOI BO (khong grant
-- execute cho authenticated/anon o day, chi goi duoc qua 1 ham SECURITY
-- DEFINER khac trong cung transaction) de bo qua kiem tra quyen dung
-- cho DUNG 1 truong hop nay.
-- Xoa han chu ky cu (7 tham so, tu file 75) truoc khi tao ban 8 tham so,
-- tranh Postgres hieu nham thanh 2 ham chong lap - da tung gap loi nay
-- nhieu lan truoc do voi cac ham khac.
drop function if exists topup_wallet(uuid, numeric, text, uuid, numeric, text, text);

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

-- KHONG grant them p_system_override cho authenticated - chi nguoi dung
-- thuong van goi ham nay theo dung 7 tham so cu (khong co override), an
-- toan tuyet doi.
grant execute on function topup_wallet(uuid, numeric, text, uuid, numeric, text, text, boolean) to service_role;

-- Ham xu ly webhook chinh - nhan du lieu tu SePay, tim dung yeu cau, tu
-- dong cong Coin.
create or replace function process_sepay_webhook(
  p_transfer_content text, p_amount_vnd numeric, p_sepay_transaction_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_topup_requests%rowtype;
  v_student_id uuid;
begin
  -- Chong xu ly TRUNG: SePay co the gui lai webhook nhieu lan cho CUNG 1
  -- giao dich (co chinh sach retry tu dong theo tai lieu SePay).
  if exists (select 1 from wallet_topup_requests where sepay_transaction_id = p_sepay_transaction_id) then
    return jsonb_build_object('status', 'already_processed', 'transaction_id', p_sepay_transaction_id);
  end if;

  select * into v_req from wallet_topup_requests
  where transfer_content = p_transfer_content and status = 'pending'
  for update;

  if v_req.id is null then
    return jsonb_build_object('status', 'no_match', 'transfer_content', p_transfer_content, 'amount_vnd', p_amount_vnd);
  end if;

  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  perform topup_wallet(
    v_student_id, v_req.coin_amount, 'bank_transfer', null, 0,
    null, 'Tự động xác nhận qua SePay webhook', true -- p_system_override = true
  );

  update wallet_topup_requests
  set status = 'confirmed', confirmed_at = now(),
      sepay_transaction_id = p_sepay_transaction_id, confirmed_amount_vnd = p_amount_vnd
  where id = v_req.id;

  return jsonb_build_object('status', 'confirmed', 'request_id', v_req.id, 'transfer_content', p_transfer_content);
end;
$func$;

grant execute on function process_sepay_webhook(text, numeric, text) to service_role;

-- Bat Supabase Realtime cho bang nay — can thiet de frontend (topup.js)
-- subscribe duoc thay doi trang thai (status -> 'confirmed'/'rejected')
-- va tu dong doi giao dien, khong can phu huynh tu lam moi trang.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'wallet_topup_requests'
  ) then
    alter publication supabase_realtime add table wallet_topup_requests;
  end if;
end $$;
