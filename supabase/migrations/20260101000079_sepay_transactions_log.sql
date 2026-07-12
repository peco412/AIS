-- =====================================================================
-- File 79: SUA LOI THIET KE THIEU SOT - truoc day webhook SePay chi co
-- GANG khop truc tiep voi wallet_topup_requests, neu KHONG khop duoc thi
-- DU LIEU GOC BI MAT LUON, khong luu lai o dau ca de doi chieu sau. Dung
-- theo dung so do nguoi dung ve co san "Bang Trans" rieng — them bang
-- nay lam NHAT KY DAY DU moi giao dich SePay bao ve (khop hay khong
-- khop deu luu), roi moi doi chieu tiep vao wallet_topup_requests.
-- (chay sau file 78)
-- =====================================================================

create table if not exists sepay_transactions (
  id uuid primary key default uuid_generate_v4(),
  sepay_transaction_id text not null unique, -- ma giao dich phia SePay, dung chong trung
  amount_vnd numeric(14,2) not null,
  raw_content text, -- noi dung goc SePay gui ve (chua qua xu ly trich xuat)
  extracted_content text, -- ma da trich xuat de doi chieu (vd "NAPA1B2C3D4")
  matched_request_id uuid references wallet_topup_requests(id),
  status text not null default 'unmatched' check (status in ('matched', 'unmatched', 'duplicate')),
  raw_payload jsonb, -- luu nguyen payload webhook, phong khi can tra cuu lai chi tiet
  received_at timestamptz not null default now(),
  reconciled_by uuid references employees(id), -- Ke toan tu tay doi chieu sau, neu co
  reconciled_at timestamptz
);
create index if not exists idx_sepay_tx_status on sepay_transactions(status, received_at);

alter table sepay_transactions enable row level security;
create policy sepay_transactions_select on sepay_transactions for select using (
  current_department_id() = (select id from departments where code='ACC')
  or is_executive_or_tech()
);
-- CHI service_role (Edge Function) duoc ghi truc tiep — khong ai khac
-- INSERT duoc tu client, dam bao du lieu nhat ky nay luon dang tin cay
-- (khop dung that su tu SePay, khong bi gia mao qua goi API thuong).
create policy sepay_transactions_write on sepay_transactions for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (false); -- client khong insert/update truc tiep duoc, chi qua RPC SECURITY DEFINER

-- Viet lai process_sepay_webhook — LUON ghi vao nhat ky nay TRUOC, du
-- khop hay khong khop, roi moi tiep tuc cong Coin neu khop duoc. Xoa han
-- chu ky cu (3 tham so, tu file 78) truoc de tranh Postgres hieu nham
-- thanh ham chong lap.
drop function if exists process_sepay_webhook(text, numeric, text);

create or replace function process_sepay_webhook(
  p_transfer_content text, p_amount_vnd numeric, p_sepay_transaction_id text, p_raw_content text default null, p_raw_payload jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_topup_requests%rowtype;
  v_student_id uuid;
  v_tx_id uuid;
begin
  -- Chong xu ly TRUNG mot lan nua o dung cap do nhat ky (khong chi o
  -- wallet_topup_requests nhu truoc) — SePay co the gui lai webhook
  -- nhieu lan cho CUNG 1 giao dich that.
  if exists (select 1 from sepay_transactions where sepay_transaction_id = p_sepay_transaction_id) then
    return jsonb_build_object('status', 'already_logged', 'transaction_id', p_sepay_transaction_id);
  end if;

  -- GHI NHAT KY TRUOC TIEN — dam bao KHONG BAO GIO mat du lieu giao dich
  -- goc, bat ke co khop duoc yeu cau nao hay khong.
  insert into sepay_transactions (sepay_transaction_id, amount_vnd, raw_content, extracted_content, raw_payload, status)
  values (p_sepay_transaction_id, p_amount_vnd, coalesce(p_raw_content, p_transfer_content), p_transfer_content, p_raw_payload, 'unmatched')
  returning id into v_tx_id;

  select * into v_req from wallet_topup_requests
  where transfer_content = p_transfer_content and status = 'pending'
  for update;

  if v_req.id is null then
    -- Khong khop duoc — DA CO SAN trong nhat ky roi (buoc tren), Ke toan
    -- se tu vao trang doi chieu thu cong sau, khong mat gi ca.
    return jsonb_build_object('status', 'no_match', 'transaction_log_id', v_tx_id, 'transfer_content', p_transfer_content, 'amount_vnd', p_amount_vnd);
  end if;

  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  perform topup_wallet(
    v_student_id, v_req.coin_amount, 'bank_transfer', null, 0,
    null, 'Tự động xác nhận qua SePay webhook', true
  );

  update wallet_topup_requests
  set status = 'confirmed', confirmed_at = now(),
      sepay_transaction_id = p_sepay_transaction_id, confirmed_amount_vnd = p_amount_vnd
  where id = v_req.id;

  update sepay_transactions set status = 'matched', matched_request_id = v_req.id where id = v_tx_id;

  return jsonb_build_object('status', 'confirmed', 'request_id', v_req.id, 'transaction_log_id', v_tx_id, 'transfer_content', p_transfer_content);
end;
$func$;

grant execute on function process_sepay_webhook(text, numeric, text, text, jsonb) to service_role;

-- Cho phep Ke toan/BDH TU TAY doi chieu 1 giao dich "khong khop" voi 1
-- yeu cau nap vi cu the (VD phu huynh ghi sai noi dung chuyen khoan
-- nhung Ke toan xac minh dung la khoan nay).
create or replace function reconcile_sepay_transaction(p_transaction_id uuid, p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_tx sepay_transactions%rowtype;
  v_req wallet_topup_requests%rowtype;
  v_student_id uuid;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi doi chieu duoc.';
  end if;

  select * into v_tx from sepay_transactions where id = p_transaction_id for update;
  if v_tx.status = 'matched' then raise exception 'Giao dich nay da duoc doi chieu roi.'; end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nap vi nay da duoc xu ly roi.'; end if;

  select student_id into v_student_id from wallets where id = v_req.wallet_id;
  perform topup_wallet(v_student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, 0, null,
    format('Đối chiếu thủ công với giao dịch SePay #%s (số tiền %s VNĐ)', v_tx.sepay_transaction_id, v_tx.amount_vnd));

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
  update sepay_transactions set status = 'matched', matched_request_id = p_request_id, reconciled_by = p_approver_id, reconciled_at = now() where id = p_transaction_id;
end;
$func$;
