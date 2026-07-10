-- =====================================================================
-- File 42: VA LOI NGHIEM TRONG NHAT TU TRUOC DEN GIO - "Bao cao tai
-- chinh" (acc/reports.js) hoan toan KHONG BIET GI ve he thong Vi/hoa don
-- hoc phi moi, vi trigger cu (log_tuition_to_cash_flow) gan vao bang
-- tuition_payments - bang nay KHONG CON DUOC GHI VAO NUA tu khi gop
-- sang he thong vi (da xoa trang edu/tuition.html/js). Ket qua: TOAN BO
-- doanh thu hoc phi (tien mat, chuyen khoan, vi) BI MAT KHOI bao cao tai
-- chinh tu luc do den gio.
--
-- Sua bang cach: bat cu giao dich tai chinh nao qua append_financial_log()
-- (ham duy nhat MOI noi trong he thong vi/hoa don deu goi qua) se TU
-- DONG ghi them 1 dong vao cash_flow_entries - sua 1 CHO nay la fix duoc
-- toan bo 7+ diem goi (topup_wallet, deduct_wallet_fifo,
-- record_counter_payment, confirm_topup_request, approve_wallet_withdrawal,
-- process_plan_refund, approve_tuition_refund).
-- (chay sau file 41)
-- =====================================================================
create or replace function append_financial_log(
  p_source text, p_amount numeric, p_invoice_id uuid, p_actor_id uuid,
  p_wallet_id uuid, p_student_id uuid, p_note text
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_prev_hash text;
  v_new_hash text;
  v_id uuid := uuid_generate_v4();
  v_ts timestamptz := now();
  v_center_id uuid;
  v_category text;
begin
  perform pg_advisory_xact_lock(hashtext('financial_log_chain_' || p_source));

  select hash into v_prev_hash from financial_transaction_logs
  where source = p_source order by created_at desc limit 1;

  v_new_hash := encode(digest(
    coalesce(v_prev_hash, '') || p_source || p_amount::text || coalesce(p_invoice_id::text, '') ||
    coalesce(p_actor_id::text, '') || v_ts::text, 'sha256'
  ), 'hex');

  insert into financial_transaction_logs (id, source, amount, invoice_id, actor_id, wallet_id, student_id, note, hash, prev_hash, created_at)
  values (v_id, p_source, p_amount, p_invoice_id, p_actor_id, p_wallet_id, p_student_id, p_note, v_new_hash, v_prev_hash, v_ts);

  -- MOI: tu dong bac cau sang cash_flow_entries de "Bao cao tai chinh"
  -- (acc/reports.js) thay duoc GIAO DICH THAT, khong con mu tit nhu truoc.
  if p_student_id is not null then
    select center_id into v_center_id from students where id = p_student_id;
  end if;

  v_category := case p_source
    when 'WALLET' then 'tuition_wallet'
    when 'CASH' then 'tuition_cash'
    when 'BANK_TRANSFER' then 'tuition_transfer'
    else lower(p_source)
  end;

  insert into cash_flow_entries (center_id, entry_type, category, amount, entry_date, note, created_by)
  values (
    v_center_id,
    case when p_amount >= 0 then 'inflow' else 'outflow' end,
    v_category,
    abs(p_amount),
    v_ts::date,
    coalesce(p_note, '') || ' (tu dong tu he thong Vi/hoc phi)',
    p_actor_id
  );

  return v_id;
end;
$func$;

revoke execute on function append_financial_log(text, numeric, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
