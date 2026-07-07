-- =====================================================================
-- File 24: VÁ LỖ HỔNG BẢO MẬT NGHIÊM TRỌNG — topup_wallet() chưa kiểm
-- tra người gọi (chạy sau file 23)
--
-- Vì topup_wallet() là SECURITY DEFINER (chạy với quyền cao hơn để có thể
-- tạo batch/insert log bất kể RLS), hàm PHẢI TỰ kiểm tra quyền bên trong
-- thân hàm — trước đây thiếu bước này, nghĩa là BẤT KỲ phụ huynh nào đã
-- đăng nhập cũng gọi RPC này với student_id BẤT KỲ (không cần đúng con
-- mình) đều thành công. Đây là lỗi bảo mật thật, không phải giả định.
-- =====================================================================
create or replace function topup_wallet(
  p_student_id uuid, p_coin_amount numeric, p_method text, p_created_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_center_id uuid;
  v_calc record;
  v_batch_id uuid;
begin
  -- ⚠️ KIỂM TRA QUYỀN BẮT BUỘC — chỉ cho phép:
  --   (a) Phụ huynh ĐÃ LIÊN KẾT với đúng học sinh này tự nạp qua App, HOẶC
  --   (b) Nhân viên Kế toán/Quản lý trung tâm/Ban điều hành ghi nhận nạp
  --       hộ tại quầy (p_created_by khác null).
  if p_created_by is null then
    if not is_linked_to_student(p_student_id) then
      raise exception 'Bạn không có quyền nạp ví cho học sinh này.';
    end if;
  else
    if not (
      current_department_id() = (select id from departments where code = 'ACC')
      or (current_role_code() = 'CENTER_MANAGER' and p_student_id in (select id from students where center_id = current_center_id()))
      or is_executive_or_tech()
    ) then
      raise exception 'Bạn không có quyền ghi nhận nạp ví hộ học sinh này.';
    end if;
  end if;

  select id into v_wallet_id from wallets where student_id = p_student_id;
  if v_wallet_id is null then
    insert into wallets (student_id) values (p_student_id) returning id into v_wallet_id;
  end if;

  select center_id into v_center_id from students where id = p_student_id;
  select * into v_calc from calculate_topup_conversion(p_coin_amount, v_center_id);

  insert into wallet_topup_batches (
    wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate,
    applied_program_id, amount_vnd_paid, method, created_by
  ) values (
    v_wallet_id, p_coin_amount, p_coin_amount, v_calc.discount_rate, v_calc.conversion_rate,
    v_calc.program_id, p_coin_amount * v_calc.conversion_rate, p_method, p_created_by
  ) returning id into v_batch_id;

  perform append_financial_log('WALLET', p_coin_amount * v_calc.conversion_rate, null, p_created_by, v_wallet_id, p_student_id,
    format('Nạp ví %s AIScoins (chiết khấu %s%%)', p_coin_amount, v_calc.discount_rate * 100));

  return v_batch_id;
end;
$$;

-- deduct_wallet_fifo() cũng thiếu kiểm tra người gọi — hiện tại chỉ dùng
-- khi NHÂN VIÊN xử lý thanh toán hoá đơn qua ví tại quầy/ERP, nên chốt
-- CHỈ nhân viên có thẩm quyền mới gọi được (chưa có luồng phụ huynh tự trả
-- hoá đơn qua ví trong App ở bản này — nếu sau này thêm nút "Thanh toán
-- ngay" cho phụ huynh, cần nới điều kiện is_linked_to_student tương ứng).
create or replace function deduct_wallet_fifo(p_invoice_id uuid, p_coin_to_deduct numeric, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền trừ ví cho hoá đơn này.';
  end if;

  select student_id into v_student_id from invoices where id = p_invoice_id;
  select id into v_wallet_id from wallets where student_id = v_student_id;
  if v_wallet_id is null then raise exception 'Học viên chưa có ví.'; end if;

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
    raise exception 'Số dư ví không đủ — còn thiếu % AIScoins.', v_remaining_to_deduct;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, p_invoice_id, p_actor_id, v_wallet_id, v_student_id,
    format('Thanh toán hoá đơn qua ví: %s AIScoins', p_coin_to_deduct));

  perform refresh_invoice_status(p_invoice_id);
end;
$$;
-- record_counter_payment() cũng thiếu kiểm tra — bất kỳ ai đăng nhập (kể
-- cả phụ huynh) đều có thể tự "ghi nhận đã thu tiền mặt" cho hoá đơn bất
-- kỳ nếu không chặn lại, giả mạo trạng thái đã đóng tiền.
create or replace function record_counter_payment(
  p_invoice_id uuid, p_source text, p_amount_vnd numeric, p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  if p_source not in ('CASH', 'BANK_TRANSFER') then
    raise exception 'record_counter_payment chỉ dùng cho CASH hoặc BANK_TRANSFER.';
  end if;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền ghi nhận thu tiền tại quầy.';
  end if;

  select student_id into v_student_id from invoices where id = p_invoice_id;

  insert into debt_ledger (invoice_id, source, amount_vnd) values (p_invoice_id, p_source, p_amount_vnd);
  perform append_financial_log(p_source, p_amount_vnd, p_invoice_id, p_actor_id, null, v_student_id, 'Thu học phí tại quầy');
  perform refresh_invoice_status(p_invoice_id);
end;
$$;

-- append_financial_log() CHỈ nên được gọi từ BÊN TRONG các hàm khác ở trên
-- (đều đã có kiểm tra quyền đầy đủ), KHÔNG được phép gọi trực tiếp qua RPC
-- từ frontend — nhưng theo mặc định Supabase tự cấp quyền EXECUTE cho
-- role "authenticated"/"anon" với MỌI function mới tạo trong schema public,
-- nghĩa là ai cũng gọi thẳng được append_financial_log() để tự chèn 1 dòng
-- log tài chính giả (kể cả tự bịa hash chain) nếu không thu hồi quyền này.
revoke execute on function append_financial_log(text, numeric, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function refresh_invoice_status(uuid) from public, anon, authenticated;

-- Tương tự, approve_wallet_withdrawal() phải kiểm tra người gọi là nhân
-- viên có thẩm quyền (không phải phụ huynh gọi thẳng được) — thêm chốt an
-- toàn dù RLS bảng wallet_withdrawal_requests đã chặn UPDATE, phòng trường
-- hợp gọi qua RPC trực tiếp bỏ qua kiểm tra bảng.
create or replace function approve_wallet_withdrawal(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_actual numeric;
  v_student_id uuid;
begin
  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được duyệt yêu cầu rút ví.';
  end if;

  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yêu cầu này đã được xử lý rồi.'; end if;

  v_actual := calculate_wallet_refund(v_req.wallet_id);
  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  update wallet_topup_batches set coin_remaining = 0 where wallet_id = v_req.wallet_id and coin_remaining > 0;
  update wallet_withdrawal_requests
  set status = 'approved', actual_amount_vnd = v_actual, approved_by = p_approver_id, approved_at = now()
  where id = p_request_id;

  perform append_financial_log('WALLET', -v_actual, null, p_approver_id, v_req.wallet_id, v_student_id,
    format('Hoàn tiền rút ví: %s VNĐ', v_actual));
end;
$$;
