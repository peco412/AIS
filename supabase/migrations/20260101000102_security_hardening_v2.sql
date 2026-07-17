-- =====================================================================
-- File 102: VÁ ĐỢT RÀ SOÁT BẢO MẬT + LOGIC LẦN 2 (16/07/2026)
-- Chạy sau file 101 (shared_family_wallet). Tổng hợp các lỗi phát hiện
-- khi rà soát lại toàn bộ 101 migration hiện có — xem báo cáo đầy đủ ở
-- AUDIT_ERP_AIS_2026-07-16.md để hiểu rõ bối cảnh/impact từng mục.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — SEPAY WEBHOOK: KHÔNG đối chiếu số tiền thực nhận với số tiền
-- phải trả trước khi tự động cộng Coin. LỖI TÀI CHÍNH NGHIÊM TRỌNG NHẤT
-- tìm thấy trong đợt này: bất kỳ phụ huynh nào cũng có thể tạo yêu cầu
-- nạp ví với coin_amount lớn, rồi chỉ chuyển khoản một số tiền rất nhỏ
-- (miễn đúng mã nội dung "NAP..." của chính yêu cầu đó) — hệ thống vẫn
-- tự động cộng ĐỦ số Coin đã yêu cầu vì process_sepay_webhook() chỉ so
-- khớp MÃ NỘI DUNG, không hề so khớp SỐ TIỀN.
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
  v_tx_id uuid;
  v_raw_upper text := upper(coalesce(p_raw_content, p_transfer_content));
  v_match_mode text := 'exact';
  v_center_id uuid;
  v_calc record;
  v_expected_amount numeric;
begin
  if exists (select 1 from sepay_transactions where sepay_transaction_id = p_sepay_transaction_id) then
    return jsonb_build_object('status', 'already_logged', 'transaction_id', p_sepay_transaction_id);
  end if;

  insert into sepay_transactions (sepay_transaction_id, amount_vnd, raw_content, extracted_content, raw_payload, status)
  values (p_sepay_transaction_id, p_amount_vnd, coalesce(p_raw_content, p_transfer_content), p_transfer_content, p_raw_payload, 'unmatched')
  returning id into v_tx_id;

  select * into v_req from wallet_topup_requests
  where transfer_content = p_transfer_content and status = 'pending'
  for update;

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

  -- MỚI: tính lại đúng số tiền PHẢI thu cho v_req.coin_amount (theo đúng
  -- công thức chiết khấu tại thời điểm đối chiếu — giống hệt logic bên
  -- trong topup_wallet()), rồi so với số tiền THỰC NHẬN (p_amount_vnd).
  -- Cho phép sai lệch làm tròn ±1đ, KHÔNG cho phép thiếu nhiều hơn thế.
  select center_id into v_center_id from students where id = v_req.student_id;
  select * into v_calc from calculate_topup_conversion(v_req.coin_amount, v_center_id, 0);
  v_expected_amount := round(v_req.coin_amount * v_calc.conversion_rate);

  if p_amount_vnd < v_expected_amount - 1 then
    -- KHÔNG tự động cộng Coin. Cố tình GIỮ NGUYÊN sepay_transactions.status
    -- = 'unmatched' (không đổi sang giá trị khác) để nút "Đối chiếu" ở
    -- trang Kế toán > Giao dịch SePay hiện ra bình thường như mọi giao
    -- dịch unmatched khác — chỉ gán sẵn matched_request_id làm GỢI Ý yêu
    -- cầu nào có khả năng liên quan, Kế toán tự quyết định qua
    -- reconcile_sepay_transaction() sau khi đối chiếu thủ công (ví dụ:
    -- phụ huynh chuyển thiếu, chuyển nhiều lần nhỏ lẻ, hoặc cố tình gian
    -- lận). Yêu cầu nạp ví vẫn ở trạng thái 'pending', CHƯA bị đóng.
    update sepay_transactions set matched_request_id = v_req.id where id = v_tx_id;
    return jsonb_build_object(
      'status', 'amount_mismatch', 'transaction_log_id', v_tx_id, 'request_id', v_req.id,
      'transfer_content', p_transfer_content, 'amount_received', p_amount_vnd, 'amount_required', v_expected_amount
    );
  end if;

  perform topup_wallet(
    v_req.student_id, v_req.coin_amount, 'bank_transfer', null, 0,
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

-- =====================================================================
-- PHẦN 2 — mkt_ad_expenses: RLS UPDATE hiện cho phép Trưởng/phó phòng
-- Truyền thông HOẶC Kế toán HOẶC BĐH/Tech ghi ĐƯỢC BẤT KỲ CỘT NÀO (không
-- có "with check", không có trigger) — nghĩa là 1 Trưởng phòng Truyền
-- thông có thể tự set thẳng status='approved_3' + executive_signed_by =
-- chính mình, NHẢY CÓC qua cả 2 bước duyệt còn lại (Kế toán, Ban điều
-- hành) chỉ bằng 1 lệnh UPDATE gọi thẳng REST API — lặp lại đúng lớp lỗi
-- đã vá ở file 10 (mục "tự duyệt phiếu tài chính") nhưng cho 1 bảng phiếu
-- MỚI được thêm sau đó (file 87) nên không được kế thừa bản vá cũ.
-- =====================================================================
create or replace function enforce_mkt_expense_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  is_head boolean;
  is_acc boolean;
begin
  if is_executive_or_tech() then
    return new; -- Ban điều hành/Kỹ thuật được toàn quyền, kể cả sửa lại khi cần
  end if;

  is_head := (current_department_id() = (select id from departments where code = 'MKT')
              and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'));
  is_acc := (current_department_id() = (select id from departments where code = 'ACC'));

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'approved_1' and is_head then
      if new.dept_head_signed_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
      if new.accountant_signed_by is distinct from old.accountant_signed_by
        or new.executive_signed_by is distinct from old.executive_signed_by then
        raise exception 'Không được tự ghi chữ ký của cấp duyệt khác.';
      end if;
    elsif old.status = 'approved_1' and new.status = 'approved_2' and is_acc then
      if new.accountant_signed_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
      if new.dept_head_signed_by is distinct from old.dept_head_signed_by
        or new.executive_signed_by is distinct from old.executive_signed_by then
        raise exception 'Không được tự ghi chữ ký của cấp duyệt khác.';
      end if;
    elsif new.status = 'rejected' and old.status in ('draft', 'approved_1', 'approved_2') and (is_head or is_acc) then
      null; -- ok: từ chối được phép ở bước 1/2
    else
      raise exception 'Không được phép tự chuyển trạng thái % -> % ở bước này — chỉ Ban điều hành/Kỹ thuật mới xử lý được bước này.', old.status, new.status;
    end if;
  else
    -- Trạng thái không đổi: Head/ACC không được sửa nội dung khoản chi
    -- ngoài luồng duyệt chính thức ở trên (Executive/Tech đã return ở trên).
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được chỉnh sửa trực tiếp khoản chi ở trạng thái hiện tại.';
  end if;

  return new;
end;
$func$;

drop trigger if exists mkt_ad_expenses_guard_update on mkt_ad_expenses;
create trigger mkt_ad_expenses_guard_update
before update on mkt_ad_expenses
for each row execute function enforce_mkt_expense_transition();

-- =====================================================================
-- PHẦN 3 — Một số bảng "using (true)" nhưng QUÊN giới hạn "to
-- authenticated" (khác với đa số bảng tham chiếu khác đã làm đúng) —
-- nghĩa là user CHƯA ĐĂNG NHẬP (chỉ cần anon key public) vẫn SELECT được.
-- Đáng chú ý nhất: mkt_ad_expenses (số tiền/nền tảng quảng cáo/ghi chú
-- chi phí nội bộ) và bank_settings (thông tin tài khoản ngân hàng nhận
-- tiền) — không nên lộ ra ngoài mà không cần đăng nhập.
-- =====================================================================
drop policy if exists facility_assets_select on facility_assets;
create policy facility_assets_select on facility_assets for select
  to authenticated using (true);

drop policy if exists discount_programs_select on discount_programs;
create policy discount_programs_select on discount_programs for select
  to authenticated using (true);

drop policy if exists bank_settings_select on bank_settings;
create policy bank_settings_select on bank_settings for select
  to authenticated using (true);

drop policy if exists payment_plan_discounts_select on payment_plan_discounts;
create policy payment_plan_discounts_select on payment_plan_discounts for select
  to authenticated using (true);

drop policy if exists wallet_tier_discounts_select on wallet_tier_discounts;
create policy wallet_tier_discounts_select on wallet_tier_discounts for select
  to authenticated using (true);

drop policy if exists commission_rules_select on commission_rules;
create policy commission_rules_select on commission_rules for select
  to authenticated using (true);

drop policy if exists mkt_ad_expenses_select on mkt_ad_expenses;
create policy mkt_ad_expenses_select on mkt_ad_expenses for select
  to authenticated using (true);

drop policy if exists size_charts_select on size_charts;
create policy size_charts_select on size_charts for select
  to authenticated using (true);

-- =====================================================================
-- PHẦN 4 — "Giả mạo người duyệt": các hàm RPC duyệt cấp cuối dưới đây
-- nhận p_approver_id là THAM SỐ DO CLIENT TRUYỀN LÊN, rồi ghi thẳng giá
-- trị đó vào approved_by/executive_signed_by/financial log — thay vì tự
-- suy ra từ current_employee_id() (người ĐANG thực sự gọi hàm, xác định
-- qua JWT). Hàm vẫn kiểm tra ĐÚNG quyền hạn của người gọi thật (is ACC/
-- Executive...), nhưng KHÔNG kiểm tra p_approver_id có trùng người gọi
-- không — 1 Kế toán viên hợp lệ có thể tự ý điền employee_id của người
-- khác (ví dụ Kế toán trưởng, hoặc BĐH) vào ô "người duyệt", làm sai lệch
-- nhật ký kiểm toán/sổ cái. Đây là mẫu lặp lại ở ~15 hàm; 5 hàm dưới đây
-- là các hàm CHỐT (tiền thực sự di chuyển/ghi sổ) được vá trong đợt này.
-- Các hàm còn lại (confirm_topup_request, reprocess_rejected_topup,
-- reject_tuition_refund, reject_wallet_withdrawal, center_confirm_withdrawal,
-- apply_program_discount_to_invoice, process_plan_refund...) nên được vá
-- theo ĐÚNG mẫu này ở đợt sau (xem báo cáo mục B.3).
-- =====================================================================

create or replace function approve_wallet_withdrawal(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_actual numeric;
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên, luôn dùng chính người đang gọi

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

  update wallet_topup_batches set coin_remaining = 0 where wallet_id = v_req.wallet_id and coin_remaining > 0;
  update wallet_withdrawal_requests
  set status = 'approved', actual_amount_vnd = v_actual, approved_by = p_approver_id, approved_at = now()
  where id = p_request_id;

  perform append_financial_log('WALLET', -v_actual, null, p_approver_id, v_req.wallet_id, v_req.student_id,
    format('Hoàn tiền rút ví: %s VNĐ', v_actual));
end;
$func$;

create or replace function approve_tuition_refund(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req tuition_refund_requests%rowtype;
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

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

create or replace function approve_mkt_expense_final(p_id uuid, p_approver_id uuid, p_method text default 'BANK_TRANSFER')
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_exp mkt_ad_expenses%rowtype;
  v_account text;
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not is_executive_or_tech() then
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được phê duyệt cấp cuối.';
  end if;

  select * into v_exp from mkt_ad_expenses where id = p_id for update;
  if v_exp.status <> 'approved_2' then
    raise exception 'Khoản chi này chưa qua đủ 2 cấp duyệt trước (Trưởng phòng Truyền thông + Kế toán).';
  end if;

  update mkt_ad_expenses set status = 'approved_3', executive_signed_by = p_approver_id, executive_signed_at = now() where id = p_id;

  v_account := case p_method when 'CASH' then '111' else '112' end;

  perform post_journal_entry(
    current_date, format('Chi phí quảng cáo %s — %s (%s)', v_exp.platform, v_exp.code, coalesce(v_exp.note, '')),
    'mkt_expense', p_id,
    jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', v_exp.amount, 'credit', 0),
      jsonb_build_object('account_code', v_account, 'debit', 0, 'credit', v_exp.amount)
    ),
    p_approver_id
  );
end;
$func$;

create or replace function approve_advance_final(p_request_id uuid, p_approver_id uuid, p_method text default 'BANK_TRANSFER')
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req advance_requests%rowtype;
  v_employee_name text;
  v_account text;
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not is_executive_or_tech() then
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được phê duyệt cấp cuối.';
  end if;

  select * into v_req from advance_requests where id = p_request_id for update;
  if v_req.status <> 'approved_2' then
    raise exception 'Yêu cầu này chưa qua đủ 2 cấp duyệt trước (Quản lý trực tiếp + Kế toán).';
  end if;

  update advance_requests set status = 'approved_3', executive_signed_by = p_approver_id, executive_signed_at = now() where id = p_request_id;

  select full_name into v_employee_name from employees where id = v_req.requester_id;
  v_account := case p_method when 'CASH' then '111' else '112' end;

  perform post_journal_entry(
    current_date, format('Chi tạm ứng — %s (mã %s)', coalesce(v_employee_name, '—'), v_req.code),
    'advance_request', p_request_id,
    jsonb_build_array(
      jsonb_build_object('account_code', '141', 'debit', v_req.amount, 'credit', 0),
      jsonb_build_object('account_code', v_account, 'debit', 0, 'credit', v_req.amount)
    ),
    p_approver_id
  );
end;
$func$;

create or replace function reconcile_sepay_transaction(p_transaction_id uuid, p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_tx sepay_transactions%rowtype;
  v_req wallet_topup_requests%rowtype;
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi doi chieu duoc.';
  end if;

  select * into v_tx from sepay_transactions where id = p_transaction_id for update;
  if v_tx.status = 'matched' then raise exception 'Giao dich nay da duoc doi chieu roi.'; end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nap vi nay da duoc xu ly roi.'; end if;

  perform topup_wallet(v_req.student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, 0, null,
    format('Đối chiếu thủ công với giao dịch SePay #%s (số tiền %s VNĐ)', v_tx.sepay_transaction_id, v_tx.amount_vnd));

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
  update sepay_transactions set status = 'matched', matched_request_id = p_request_id, reconciled_by = p_approver_id, reconciled_at = now() where id = p_transaction_id;
end;
$func$;

-- =====================================================================
-- PHẦN 5 — Đảm bảo is_dept_head_or_above() gọi được trực tiếp qua RPC
-- (dùng cho edge function send-push bản vá kèm theo — xem báo cáo).
-- =====================================================================
grant execute on function is_dept_head_or_above() to authenticated;
