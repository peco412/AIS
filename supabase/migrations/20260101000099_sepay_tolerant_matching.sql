-- =====================================================================
-- File 99: SUA process_sepay_webhook - "trich xuat thieu" khien doi
-- chieu tu dong that bai.
--
-- Truoc day chi so khop EXACT: transfer_content = p_transfer_content.
-- Neu ma SePay tu tach (payload.code) hoac regex fallback trong
-- index.ts bat THIEU/DU/SAI 1 ky tu (rat de xay ra khi "Cau truc ma
-- thanh toan" cau hinh ben SePay khong khop dung dinh dang thuc te
-- ma he thong sinh ra - xem giai thich trong file create_topup_request,
-- ma dang la 'NAP' + 8 ky tu hex VIET HOA), thi exact match that bai
-- ngay lap tuc -> status 'no_match', du tien da vao tai khoan that.
--
-- SUA: neu khong khop EXACT, thu buoc 2 - tim 1 yeu cau dang 'pending'
-- ma ma cua no (transfer_content, 8 ky tu gan nhu khong the trung) xuat
-- hien nhu MOT CHUOI CON trong noi dung GOC (raw_content, chua chuan
-- hoa) SePay gui ve. Cach nay khong con phu thuoc vao viec buoc trich
-- xuat phai chinh xac tuyet doi tung ky tu.
-- (chay sau file 79)
-- =====================================================================

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
  v_raw_upper text := upper(coalesce(p_raw_content, p_transfer_content));
  v_match_mode text := 'exact';
begin
  if exists (select 1 from sepay_transactions where sepay_transaction_id = p_sepay_transaction_id) then
    return jsonb_build_object('status', 'already_logged', 'transaction_id', p_sepay_transaction_id);
  end if;

  insert into sepay_transactions (sepay_transaction_id, amount_vnd, raw_content, extracted_content, raw_payload, status)
  values (p_sepay_transaction_id, p_amount_vnd, coalesce(p_raw_content, p_transfer_content), p_transfer_content, p_raw_payload, 'unmatched')
  returning id into v_tx_id;

  -- Buoc 1: so khop EXACT nhu truoc (nhanh, dung khi trich xuat dung 100%)
  select * into v_req from wallet_topup_requests
  where transfer_content = p_transfer_content and status = 'pending'
  for update;

  -- Buoc 2: neu khong khop exact, tim yeu cau pending ma MA CUA NO
  -- (8 ky tu, gan nhu khong trung nhau) xuat hien nhu chuoi con trong
  -- noi dung GOC - bao dung voi truong hop trich xuat bi thieu/du/sai
  -- vai ky tu o dau/cuoi.
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

  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  perform topup_wallet(
    v_student_id, v_req.coin_amount, 'bank_transfer', null, 0,
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
