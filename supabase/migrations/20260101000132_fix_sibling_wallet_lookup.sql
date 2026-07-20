-- =====================================================================
-- File 132: SỬA LỖI THẬT — "Học viên chưa có ví" khi đóng học phí qua Ví
-- dù Ví hiện đủ số dư (19/07/2026)
-- =====================================================================
-- Bạn báo đúng: màn hình hiện "Số dư ví hiện tại: 8.000 AIScoins" nhưng
-- bấm thanh toán lại báo "Học viên chưa có ví" — nguyên nhân do 2 chỗ
-- dùng 2 cách tra ví KHÁC NHAU cho cùng 1 gia đình:
--   - Ô hiện số dư: tra theo con ĐẦU TIÊN trong danh sách (luôn có ví).
--   - Nút thanh toán thật (deduct_wallet_fifo): tra CHẶT theo ĐÚNG học
--     sinh của hoá đơn đang trả — nếu học sinh đó (vd Student2, có thể là
--     em/chị em vừa được thêm vào sau) CHƯA từng được đăng ký riêng vào
--     bảng liên kết ví (dù đã dùng chung ví với anh/chị qua giao diện),
--     tra chặt trả về KHÔNG CÓ, chặn thanh toán dù ví chung có tiền.
--
-- Hệ thống ĐÃ CÓ SẴN 1 hàm tra ví "tự chữa lành" đúng cho tình huống này
-- (get_or_create_family_wallet — tự tìm ví của anh/chị em rồi đăng ký
-- luôn học sinh này vào, không tạo ví mới trùng) nhưng 2 hàm dưới đây lại
-- đang dùng bản tra CHẶT (get_wallet_id_for_student) thay vì bản tự chữa
-- lành — sửa lại đúng hàm cần dùng.
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
  v_center_id uuid;
  v_program record;
  v_boost numeric := 1;
begin
  p_actor_id := current_employee_id();

  select student_id into v_student_id from invoices where id = p_invoice_id;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
    or (p_actor_id is null and is_linked_to_student(v_student_id))
  ) then
    raise exception 'Bạn không có quyền trừ ví cho hoá đơn này.';
  end if;

  -- SUA: dung ham TU CHUA LANH — neu hoc sinh nay chua duoc dang ky rieng
  -- vao vi nhung anh/chi em da co vi chung, tu dong dang ky vao dung vi
  -- do (khong tao vi moi trung) roi tiep tuc — khong con bao "chua co vi"
  -- sai trong truong hop nay nua.
  v_wallet_id := get_or_create_family_wallet(v_student_id);
  if v_wallet_id is null then raise exception 'Học viên chưa có ví.'; end if;

  select center_id into v_center_id from students where id = v_student_id;
  select * into v_program from get_active_discount_program(v_center_id, 'wallet');
  if v_program.id is not null and v_program.discount_rate > 0 and v_program.discount_rate < 1 then
    v_boost := 1 / (1 - v_program.discount_rate);
  end if;

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
    values (p_invoice_id, 'WALLET', v_batch.id, v_take, round(v_take * v_batch.conversion_rate * v_boost), v_batch.conversion_rate);
    v_total_vnd := v_total_vnd + round(v_take * v_batch.conversion_rate * v_boost);
    v_remaining_to_deduct := v_remaining_to_deduct - v_take;
  end loop;

  if v_remaining_to_deduct > 0 then
    raise exception 'Số dư ví không đủ — còn thiếu % AIScoins.', v_remaining_to_deduct;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, p_invoice_id, p_actor_id, v_wallet_id, v_student_id,
    format('Thanh toán hoá đơn qua ví: %s AIScoins%s', p_coin_to_deduct,
      case when v_program.id is not null and v_program.discount_rate > 0
        then format(' (ưu đãi đóng học phí qua Ví %s%% — %s)', round(v_program.discount_rate * 100, 1), v_program.name)
        else '' end));
  perform refresh_invoice_status(p_invoice_id);
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
  p_confirmer_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code='FAC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan don mua hang nay.';
  end if;

  select * into v_req from wallet_purchase_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Don nay da duoc xu ly roi.'; end if;

  -- SUA: dung ham TU CHUA LANH giong deduct_wallet_fifo o tren.
  v_wallet_id := get_or_create_family_wallet(v_req.student_id);
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
