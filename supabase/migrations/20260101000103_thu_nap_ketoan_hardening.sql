-- =====================================================================
-- File 103: RÀ SOÁT SÂU "QUY TRÌNH THU, NẠP, NGHIỆP VỤ KẾ TOÁN" (16/07/2026)
-- Chạy sau file 102. Đây là đợt rà soát tập trung riêng vào các luồng
-- tiền thật: thu học phí tại quầy, nạp/rút Ví, và các thao tác kế toán
-- lõi (sổ cái, khoá sổ, lương) — theo đúng yêu cầu vì đây là nơi nhạy
-- cảm nhất về tiền bạc. Xem giải thích đầy đủ từng mục ở báo cáo kèm theo.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — 🔴 topup_wallet(): tham số p_system_override cho phép BỎ QUA
-- TOÀN BỘ kiểm tra quyền/liên kết phụ huynh-học sinh. Hàm này đang được
-- GRANT EXECUTE cho "authenticated" (vì trang Kế toán > Khắc phục sự cố
-- nạp ví gọi thẳng RPC này) — nghĩa là BẤT KỲ ai đã đăng nhập (nhân viên
-- bất kỳ vai trò nào, hoặc phụ huynh) đều có thể tự gọi thẳng:
--   supabase.rpc('topup_wallet', {p_student_id:'<bất kỳ>', p_coin_amount:
--     999999999, p_method:'bank_transfer', p_system_override:true})
-- và được cộng Coin tuỳ ý vào BẤT KỲ ví nào, không cần thanh toán gì cả,
-- không cần đúng vai trò gì cả — đây là lỗ hổng nghiêm trọng nhất tìm
-- được trong toàn bộ 2 đợt rà soát.
--
-- SỬA: p_system_override giờ chỉ thực sự có hiệu lực khi request GỐC
-- (không phải hàm cha SECURITY DEFINER nào, mà là request HTTP ban đầu
-- tới PostgREST) dùng service_role key thật — kiểm tra qua auth.role(),
-- vốn đọc thẳng từ request.jwt.claim.role nên KHÔNG bị ảnh hưởng bởi
-- việc hàm này được gọi lồng bên trong 1 SECURITY DEFINER khác. Webhook
-- SePay (edge function dùng SERVICE_ROLE_KEY) vẫn hoạt động y hệt như cũ;
-- mọi lệnh gọi từ trình duyệt (anon/authenticated key) sẽ luôn bị buộc
-- chạy đủ các bước kiểm tra quyền, bất kể client tự truyền gì vào
-- p_system_override. Đồng thời luôn tự suy p_created_by từ
-- current_employee_id() khi có người thật đứng sau (không phải webhook
-- tự động), chặn luôn việc giả mạo người ghi nhận nạp ví — không ảnh
-- hưởng trang "Khắc phục sự cố nạp ví" (`app/acc/wallet-recovery.js`) vì
-- trang đó vốn đã tự gửi đúng ID người dùng đang đăng nhập.
-- =====================================================================
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
  v_effective_override boolean;
begin
  v_effective_override := (p_system_override and auth.role() = 'service_role');

  if not v_effective_override then
    -- Có người dùng thật đứng sau lệnh gọi này (không phải webhook tự
    -- động) -> LUÔN ghi nhận đúng người đang gọi, bỏ qua giá trị
    -- p_created_by mà client tự gửi lên.
    p_created_by := current_employee_id();

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

  v_wallet_id := get_or_create_family_wallet(p_student_id);

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

-- =====================================================================
-- PHẦN 2 — 🔴 post_journal_entry(): hàm ghi Sổ cái lõi, KHÔNG hề kiểm
-- tra người gọi là ai (chỉ kiểm tra kỳ đã khoá chưa + Nợ=Có). Vì không
-- có "revoke execute" nào áp dụng riêng cho hàm này (khác với
-- append_financial_log/refresh_invoice_status đã được revoke ở các file
-- trước), và mặc định mọi hàm mới đều được cấp quyền cho "authenticated"
-- (file 70_grant_fix.sql), NÊN bất kỳ nhân viên nào (kể cả vai trò thấp
-- nhất) gọi thẳng RPC này đều tự ghi được BÚT TOÁN TUỲ Ý vào Sổ cái —
-- miễn Nợ=Có là qua, không cần liên quan gì đến nghiệp vụ thật.
-- Đã xác nhận: KHÔNG có nơi nào trong frontend gọi thẳng RPC này (chỉ
-- được gọi lồng bên trong các hàm duyệt SECURITY DEFINER khác như
-- approve_mkt_expense_final, approve_advance_final, mark_payroll_paid...)
-- nên revoke ở đây AN TOÀN TUYỆT ĐỐI — các hàm gọi lồng đó vẫn chạy bình
-- thường vì SECURITY DEFINER thực thi với quyền của chủ sở hữu hàm, không
-- phụ thuộc quyền "authenticated" bị thu hồi.
-- =====================================================================
revoke execute on function post_journal_entry(date, text, text, uuid, jsonb, uuid) from public, anon, authenticated;

-- =====================================================================
-- PHẦN 3 — 🔴 debt_ledger: policy INSERT trực tiếp bỏ qua RPC chính thức
-- Bảng `debt_ledger` (nguồn xác định hoá đơn đã thu đủ tiền hay chưa) có
-- policy `debt_ledger_insert_counter` cho phép Quản lý trung tâm/Tư vấn
-- viên/Kế toán/BĐH INSERT TRỰC TIẾP qua REST API — bỏ qua hoàn toàn hàm
-- record_counter_payment(), nghĩa là bỏ qua luôn append_financial_log()
-- (khoản thu KHÔNG xuất hiện trong Nhật ký dòng tiền/Sổ cái) và
-- refresh_invoice_status() (trạng thái hoá đơn có thể không bao giờ được
-- cập nhật). Đã xác nhận KHÔNG có chỗ nào trong frontend insert trực tiếp
-- vào bảng này (chỉ SELECT) — record_counter_payment (SECURITY DEFINER)
-- không cần policy này để hoạt động, nên xoá policy này AN TOÀN, không
-- ảnh hưởng tính năng hiện có.
-- =====================================================================
drop policy if exists debt_ledger_insert_counter on debt_ledger;

-- =====================================================================
-- PHẦN 4 — 🔴 apply_case_discount_to_invoice(): không giới hạn mức giảm,
-- có thể giảm NHIỀU HƠN giá trị hoá đơn -> refresh_invoice_status() tính
-- "số tiền còn phải thu" ra ÂM -> hoá đơn tự động hiện "Đã thanh toán"
-- dù CHƯA THU ĐỒNG NÀO. Quản lý trung tâm/Tư vấn viên (không chỉ Kế
-- toán/BĐH) đang được phép gọi hàm này.
-- SỬA: bắt buộc 0 <= số tiền giảm <= giá trị gốc hoá đơn.
-- =====================================================================
create or replace function apply_case_discount_to_invoice(
  p_invoice_id uuid, p_amount_vnd numeric, p_note text, p_special_category text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen dieu chinh hoa don nay.';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Khong tim thay hoa don nay.'; end if;

  if p_amount_vnd is null or p_amount_vnd < 0 or p_amount_vnd > v_invoice.amount_vnd then
    raise exception 'So tien giam gia phai tu 0 den toi da % (gia tri hoa don goc).', v_invoice.amount_vnd;
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

-- =====================================================================
-- PHẦN 5 — record_counter_payment(): (a) giả mạo người ghi nhận thu tiền
-- (p_actor_id do client gửi lên), (b) không kiểm tra p_amount_vnd > 0 —
-- có thể ghi số 0/âm, làm sai lệch Nhật ký dòng tiền và trạng thái hoá đơn.
-- =====================================================================
create or replace function record_counter_payment(
  p_invoice_id uuid, p_source text, p_amount_vnd numeric, p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_id uuid;
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if p_source not in ('CASH', 'BANK_TRANSFER') then
    raise exception 'record_counter_payment chi dung cho CASH hoac BANK_TRANSFER.';
  end if;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen ghi nhan thu tien tai quay.';
  end if;

  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'So tien thu phai lon hon 0.';
  end if;

  select student_id into v_student_id from invoices where id = p_invoice_id;
  insert into debt_ledger (invoice_id, source, amount_vnd) values (p_invoice_id, p_source, p_amount_vnd);
  perform append_financial_log(p_source, p_amount_vnd, p_invoice_id, p_actor_id, null, v_student_id, 'Thu hoc phi tai quay');
  perform refresh_invoice_status(p_invoice_id);
end;
$func$;

-- =====================================================================
-- PHẦN 6 — deduct_wallet_fifo(): giả mạo người thực hiện trừ ví (khi
-- nhân viên gọi hộ). Không ảnh hưởng luồng phụ huynh tự thanh toán qua
-- pay_invoice_via_wallet() (luôn truyền NULL, current_employee_id() của
-- phụ huynh cũng luôn là NULL nên hành vi giữ nguyên).
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
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên (NULL với phụ huynh, đúng ID với nhân viên)

  select student_id into v_student_id from invoices where id = p_invoice_id;

  if not (
    current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
    or (p_actor_id is null and is_linked_to_student(v_student_id))
  ) then
    raise exception 'Bạn không có quyền trừ ví cho hoá đơn này.';
  end if;

  v_wallet_id := get_wallet_id_for_student(v_student_id);
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
$func$;

-- =====================================================================
-- PHẦN 7 — 🔴 close_period() / reopen_period(): giả mạo người khoá/mở
-- khoá sổ kế toán — theo đúng comment gốc trong code, đây là "thao tác
-- nhạy cảm nhất trong toàn bộ hệ thống kế toán", nên càng cần đúng người.
-- =====================================================================
create or replace function close_period(p_year int, p_month int, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được khoá sổ.';
  end if;

  if exists (select 1 from closed_periods where period_year = p_year and period_month = p_month and is_closed) then
    raise exception 'Kỳ %/% đã được khoá từ trước rồi.', p_month, p_year;
  end if;

  insert into closed_periods (period_year, period_month, is_closed, closed_by, closed_at)
  values (p_year, p_month, true, p_actor_id, now())
  on conflict (period_year, period_month)
  do update set is_closed = true, closed_by = p_actor_id, closed_at = now(),
    reopened_by = null, reopened_at = null, reopen_reason = null;
end;
$func$;

create or replace function reopen_period(p_year int, p_month int, p_actor_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not is_executive_or_tech() then
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được mở khoá kỳ đã đóng — đây là thao tác nhạy cảm cần cấp cao nhất phê duyệt.';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Bắt buộc ghi rõ lý do khi mở khoá lại 1 kỳ đã đóng.';
  end if;

  if not exists (select 1 from closed_periods where period_year = p_year and period_month = p_month and is_closed) then
    raise exception 'Kỳ %/% hiện không ở trạng thái khoá.', p_month, p_year;
  end if;

  update closed_periods
  set is_closed = false, reopened_by = p_actor_id, reopened_at = now(), reopen_reason = p_reason
  where period_year = p_year and period_month = p_month;
end;
$func$;

-- =====================================================================
-- PHẦN 8 — mark_payroll_paid(): giả mạo người xác nhận chi lương (khoản
-- chi lớn nhất định kỳ của công ty). mark_payroll_paid_bulk() gọi lại
-- hàm này nên tự động được vá theo, không cần sửa riêng.
-- =====================================================================
create or replace function mark_payroll_paid(p_payroll_id uuid, p_actor_id uuid, p_method text default 'BANK_TRANSFER')
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pr payroll%rowtype;
  v_emp_name text;
  v_cash_account text;
  v_gross_expense numeric;
  v_lines jsonb := '[]'::jsonb;
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được xác nhận chi lương.';
  end if;

  select * into v_pr from payroll where id = p_payroll_id for update;
  if v_pr.id is null then raise exception 'Không tìm thấy bảng lương này.'; end if;
  if v_pr.paid_at is not null then raise exception 'Khoản lương này đã được xác nhận chi trả rồi (lúc %).', v_pr.paid_at; end if;
  if v_pr.finalized_by is null then raise exception 'Bảng lương chưa được chốt số liệu — vui lòng lưu/chốt trước khi xác nhận chi.'; end if;

  select full_name into v_emp_name from employees where id = v_pr.employee_id;
  v_cash_account := case p_method when 'CASH' then '111' else '112' end;

  v_gross_expense := v_pr.net_salary + coalesce(v_pr.advance_deduction, 0) + coalesce(v_pr.insurance_deduction, 0) + coalesce(v_pr.tax_deduction, 0);
  if v_gross_expense <= 0 then raise exception 'Không có khoản lương thực nhận nào > 0 để ghi sổ.'; end if;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '642', 'debit', v_gross_expense, 'credit', 0));

  if v_pr.net_salary > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', v_cash_account, 'debit', 0, 'credit', v_pr.net_salary));
  end if;
  if coalesce(v_pr.advance_deduction, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_pr.advance_deduction));
  end if;
  if coalesce(v_pr.insurance_deduction, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '3383', 'debit', 0, 'credit', v_pr.insurance_deduction));
  end if;
  if coalesce(v_pr.tax_deduction, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '3335', 'debit', 0, 'credit', v_pr.tax_deduction));
  end if;

  perform post_journal_entry(
    current_date, format('Chi lương tháng %s/%s — %s', v_pr.month, v_pr.year, coalesce(v_emp_name, '—')),
    'payroll', p_payroll_id, v_lines, p_actor_id
  );

  update payroll set paid_by = p_actor_id, paid_at = now() where id = p_payroll_id;
end;
$func$;

-- =====================================================================
-- PHẦN 9 — 6 hàm RPC "nạp/rút Ví" còn lại chưa vá ở đợt trước (báo cáo
-- 2026-07-16 mục B.3) — cùng 1 lỗi giả mạo người xử lý.
-- =====================================================================

create or replace function reject_wallet_withdrawal(p_request_id uuid, p_rejector_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_student_id uuid;
begin
  p_rejector_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Bắt buộc ghi rõ lý do từ chối.';
  end if;

  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Không tìm thấy yêu cầu này.'; end if;
  if v_req.status not in ('pending', 'center_confirmed') then
    raise exception 'Yêu cầu này đã được xử lý xong rồi (trạng thái hiện tại: %), không thể từ chối nữa.', v_req.status;
  end if;

  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  if v_req.status = 'pending' then
    if not (
      (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and v_student_id in (select id from students where center_id = current_center_id()))
      or is_executive_or_tech()
    ) then
      raise exception 'Bạn không có quyền từ chối yêu cầu này.';
    end if;
  else
    if not (
      current_department_id() = (select id from departments where code = 'ACC')
      or is_executive_or_tech()
    ) then
      raise exception 'Bạn không có quyền từ chối yêu cầu này.';
    end if;
  end if;

  update wallet_withdrawal_requests
  set status = 'rejected', reject_reason = p_reason, rejected_by = p_rejector_id, rejected_at = now()
  where id = p_request_id;
end;
$func$;

create or replace function center_confirm_withdrawal(p_request_id uuid, p_confirmer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
begin
  p_confirmer_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;

  if not (
    (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
      and (
        v_req.student_id in (select id from students where center_id = current_center_id())
        or exists (
          select 1 from wallet_students ws join students s on s.id = ws.student_id
          where ws.wallet_id = v_req.wallet_id and s.center_id = current_center_id()
        )
      ))
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan yeu cau nay.';
  end if;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nay da qua buoc xac nhan roi.'; end if;

  update wallet_withdrawal_requests set status = 'center_confirmed', center_confirmed_by = p_confirmer_id, center_confirmed_at = now()
  where id = p_request_id;
end;
$func$;

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
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan nap vi.';
  end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nay da duoc xu ly roi.'; end if;

  perform topup_wallet(v_req.student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, p_case_discount_rate, p_case_discount_note);

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
end;
$func$;

create or replace function reprocess_rejected_topup(p_request_id uuid, p_approver_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_topup_requests%rowtype;
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (
    current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc xu ly lai yeu cau da tu choi.';
  end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'rejected' then
    raise exception 'Chi xu ly lai duoc yeu cau dang o trang thai "Da tu choi". Yeu cau nay hien dang: %', v_req.status;
  end if;

  perform topup_wallet(v_req.student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, 0, null,
    coalesce(p_note, 'Xử lý lại yêu cầu đã từ chối nhầm trước đó — đã xác minh tiền đã về'));

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
end;
$func$;

create or replace function reject_tuition_refund(p_request_id uuid, p_approver_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc tu choi.';
  end if;
  update tuition_refund_requests set status = 'rejected', approved_by = p_approver_id, approved_at = now(), reject_reason_note = p_reason
  where id = p_request_id and status = 'pending';
end;
$func$;

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
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
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

create or replace function process_plan_refund(p_purchase_id uuid, p_courses_completed int, p_approver_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_purchase payment_plan_purchases%rowtype;
  v_refund numeric;
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (
    current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc xu ly hoan phi.';
  end if;

  select * into v_purchase from payment_plan_purchases where id = p_purchase_id for update;
  if v_purchase.status <> 'active' then raise exception 'Goi nay da duoc hoan phi truoc do roi.'; end if;

  v_refund := calculate_plan_refund(p_purchase_id, p_courses_completed);

  update payment_plan_purchases set status = 'refunded' where id = p_purchase_id;

  perform append_financial_log('CASH', -v_refund, v_purchase.invoice_id, p_approver_id, null, v_purchase.student_id,
    format('Hoan phi goi %s: da hoc %s/%s khoa', v_purchase.plan_type, p_courses_completed, v_purchase.total_courses));

  return v_refund;
end;
$func$;

-- =====================================================================
-- PHẦN 10 — wallet_withdrawal_requests: policy UPDATE hiện chỉ giới hạn
-- theo AI được sửa (ACC/Executive), không giới hạn ĐƯỢC SỬA GÌ — 1 Kế
-- toán viên có thể gọi thẳng .update({status:'center_confirmed',...})
-- để bỏ qua bước Quản lý trung tâm/Tư vấn viên xác nhận trước, rồi tự
-- duyệt luôn. Thêm trigger tương tự mkt_ad_expenses (file 102) để chặn
-- nhảy bước/giả chữ ký, không đổi hành vi của các RPC hợp lệ hiện có.
-- =====================================================================
create or replace function enforce_wallet_withdrawal_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  is_center boolean;
  is_acc boolean;
begin
  if is_executive_or_tech() then
    return new;
  end if;

  is_acc := (current_department_id() = (select id from departments where code = 'ACC'));
  is_center := (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT'));

  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status = 'center_confirmed' and is_center then
      if new.center_confirmed_by is distinct from current_employee_id() then
        raise exception 'Chữ ký xác nhận phải là chính người đang thao tác.';
      end if;
    elsif old.status = 'center_confirmed' and new.status = 'approved' and is_acc then
      if new.approved_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
    elsif new.status = 'rejected' and old.status = 'pending' and is_center then
      if new.rejected_by is distinct from current_employee_id() then
        raise exception 'Chữ ký từ chối phải là chính người đang thao tác.';
      end if;
    elsif new.status = 'rejected' and old.status = 'center_confirmed' and is_acc then
      if new.rejected_by is distinct from current_employee_id() then
        raise exception 'Chữ ký từ chối phải là chính người đang thao tác.';
      end if;
    else
      raise exception 'Không được phép tự chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  else
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được chỉnh sửa trực tiếp yêu cầu rút ví ở trạng thái hiện tại.';
  end if;

  return new;
end;
$func$;

drop trigger if exists wallet_withdrawal_guard_update on wallet_withdrawal_requests;
create trigger wallet_withdrawal_guard_update
before update on wallet_withdrawal_requests
for each row execute function enforce_wallet_withdrawal_transition();
