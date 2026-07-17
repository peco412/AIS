-- =====================================================================
-- File 104: RÀ SOÁT LẠI LẦN NỮA — vá tiếp các lỗi còn sót (17/07/2026)
-- Chạy sau file 103. Đợt này rà lại toàn bộ để tìm các hàm/bảng còn sót
-- chưa được vá ở 2 đợt trước — tìm thêm 1 lỗi sổ sách thật (mục 6) và
-- thêm 1 lớp bảo vệ mới (trigger chặn insert/update trực tiếp bỏ qua
-- RPC) áp dụng rộng hơn cho nhiều bảng cùng lúc.
-- =====================================================================

-- =====================================================================
-- PHẦN 1-5 — 5 hàm RPC còn sót chưa vá ở 2 đợt trước (cùng lỗi giả mạo
-- người xử lý: p_approver_id/p_confirmer_id/p_actor_id do client gửi lên).
-- =====================================================================

create or replace function reject_topup_request(p_request_id uuid, p_approver_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  p_approver_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền từ chối yêu cầu nạp ví.';
  end if;

  update wallet_topup_requests
  set status = 'rejected', confirmed_by = p_approver_id, confirmed_at = now(), reject_reason = p_reason
  where id = p_request_id and status = 'pending';
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
  p_confirmer_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (
    current_department_id() = (select id from departments where code='FAC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen xac nhan don mua hang nay.';
  end if;

  select * into v_req from wallet_purchase_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Don nay da duoc xu ly roi.'; end if;

  v_wallet_id := get_wallet_id_for_student(v_req.student_id);
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

create or replace function reject_wallet_purchase(p_request_id uuid, p_confirmer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  p_confirmer_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (
    current_department_id() = (select id from departments where code='FAC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tu choi don nay.';
  end if;
  update wallet_purchase_requests set status = 'rejected', confirmed_by = p_confirmer_id, confirmed_at = now(), reject_reason = p_reason
  where id = p_request_id and status = 'pending';
end;
$func$;

create or replace function post_prepaid_allocation(p_allocation_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_alloc prepaid_expense_allocations%rowtype;
  v_prepaid prepaid_expenses%rowtype;
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được ghi nhận phân bổ.';
  end if;

  select * into v_alloc from prepaid_expense_allocations where id = p_allocation_id for update;
  if v_alloc.posted then raise exception 'Kỳ này đã được ghi nhận rồi.'; end if;
  select * into v_prepaid from prepaid_expenses where id = v_alloc.prepaid_expense_id;

  insert into cash_flow_entries (center_id, entry_type, category, amount, entry_date, note, created_by)
  values (v_prepaid.center_id, 'outflow', 'prepaid_242', v_alloc.amount, current_date,
    format('Phân bổ TK 242 — kỳ %s/%s', v_alloc.period_month, v_alloc.period_year), p_actor_id);

  update prepaid_expense_allocations set posted = true, posted_at = now(), posted_by = p_actor_id where id = p_allocation_id;
end;
$func$;

create or replace function settle_advance(p_request_id uuid, p_actual_spent numeric, p_receipt_notes text, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req advance_requests%rowtype;
  v_diff numeric;
  v_employee_name text;
  v_lines jsonb;
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được xác nhận hoàn ứng.';
  end if;

  select * into v_req from advance_requests where id = p_request_id for update;
  if v_req.status <> 'approved_3' then
    raise exception 'Chỉ hoàn ứng được cho khoản tạm ứng ĐÃ chi tiền (approved_3).';
  end if;
  if exists (select 1 from advance_settlements where advance_request_id = p_request_id) then
    raise exception 'Khoản tạm ứng này đã được hoàn ứng rồi.';
  end if;

  v_diff := v_req.amount - p_actual_spent;
  select full_name into v_employee_name from employees where id = v_req.requester_id;

  insert into advance_settlements (advance_request_id, actual_spent_amount, receipt_notes, settled_by)
  values (p_request_id, p_actual_spent, p_receipt_notes, p_actor_id);

  if v_diff = 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', p_actual_spent, 'credit', 0),
      jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_req.amount)
    );
  elsif v_diff > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', p_actual_spent, 'credit', 0),
      jsonb_build_object('account_code', '111', 'debit', v_diff, 'credit', 0),
      jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_req.amount)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', p_actual_spent, 'credit', 0),
      jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_req.amount),
      jsonb_build_object('account_code', '334', 'debit', 0, 'credit', abs(v_diff))
    );
  end if;

  perform post_journal_entry(
    current_date, format('Hoàn ứng — %s (mã %s, chênh lệch %s)', coalesce(v_employee_name, '—'), v_req.code, v_diff),
    'advance_settlement', p_request_id, v_lines, p_actor_id
  );

  return jsonb_build_object('difference', v_diff, 'status', case when v_diff > 0 then 'refund_due' when v_diff < 0 then 'company_owes' else 'exact_match' end);
end;
$func$;

-- =====================================================================
-- PHẦN 6 — 🔴 mark_commissions_paid(): LỖI SỔ SÁCH THẬT — nút bấm ghi rõ
-- "Xác nhận đã trả (ghi sổ kế toán)" và đổi trạng thái hoa hồng thành
-- "paid", nhưng bút toán ghi ra lại là Nợ 642 / Có 334 (GHI NHẬN CÔNG NỢ
-- PHẢI TRẢ, không phải chi tiền thật). Không có bước nào khác trong toàn
-- hệ thống tất toán lại tài khoản 334 này cho hoa hồng (khác lương —
-- payroll co buoc rieng). Nghĩa là: mỗi lần Kế toán bấm "Đã trả", sổ sách
-- chỉ ghi nhận THÊM NỢ PHẢI TRẢ, không bao giờ ghi nhận tiền mặt/ngân
-- hàng đã thực sự chi ra — số dư 334 sẽ tăng dần mãi mãi dù ứng dụng vẫn
-- báo "đã trả" đầy đủ. Sửa: ghi thẳng Có vào tài khoản tiền mặt/ngân hàng
-- (111/112) đúng như các hàm chi tiền khác trong hệ thống (mark_payroll_paid,
-- approve_advance_final...), thêm tham số p_method để Kế toán chọn hình
-- thức chi giống các nơi khác.
-- =====================================================================
create or replace function mark_commissions_paid(p_consultant_id uuid, p_year int, p_month int, p_actor_id uuid, p_method text default 'BANK_TRANSFER')
returns numeric
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_total numeric;
  v_name text;
  v_cash_account text;
begin
  p_actor_id := current_employee_id(); -- MỚI: bỏ qua giá trị client gửi lên

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được xác nhận trả hoa hồng.';
  end if;

  select coalesce(sum(commission_amount), 0) into v_total from commissions
  where consultant_id = p_consultant_id and period_year = p_year and period_month = p_month and status = 'pending';

  if v_total = 0 then return 0; end if;

  select full_name into v_name from employees where id = p_consultant_id;
  v_cash_account := case p_method when 'CASH' then '111' else '112' end;

  perform post_journal_entry(
    current_date, format('Chi hoa hồng — %s (kỳ %s/%s)', coalesce(v_name, '—'), p_month, p_year),
    'commission', p_consultant_id,
    jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', v_total, 'credit', 0),
      jsonb_build_object('account_code', v_cash_account, 'debit', 0, 'credit', v_total)
    ),
    p_actor_id
  );

  update commissions set status = 'paid', paid_at = now()
  where consultant_id = p_consultant_id and period_year = p_year and period_month = p_month and status = 'pending';

  return v_total;
end;
$func$;

-- =====================================================================
-- PHẦN 7 — Vài policy RLS "for all" cho phép ghi TRỰC TIẾP vào bảng kết
-- quả của 1 nghiệp vụ có RPC riêng xử lý (tính toán + ghi sổ), giống hệt
-- lớp lỗi debt_ledger đã vá ở file 103 — bỏ qua RPC là bỏ qua luôn tính
-- toán/ghi sổ kế toán tương ứng. Xác nhận KHÔNG nơi nào trong frontend
-- ghi trực tiếp (insert/update/delete) vào 2 bảng dưới đây (chỉ SELECT),
-- nên siết lại an toàn, không ảnh hưởng tính năng hiện có.
-- =====================================================================
drop policy if exists advance_settlements_write on advance_settlements;
drop policy if exists advance_settlements_select on advance_settlements;
create policy advance_settlements_select on advance_settlements for select using (
  current_department_id() = (select id from departments where code='ACC')
  or is_executive_or_tech()
  or advance_request_id in (select id from advance_requests where requester_id = current_employee_id())
);

drop policy if exists plan_purchases_write on payment_plan_purchases;
drop policy if exists plan_purchases_select on payment_plan_purchases;
create policy plan_purchases_select on payment_plan_purchases for select using (
  is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
  or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
);

-- =====================================================================
-- PHẦN 8 — 🔴 invoices: chưa có ràng buộc nào chặn manual_discount_vnd
-- vượt quá amount_vnd ở TẦNG BẢNG — file 102 đã vá hàm
-- apply_case_discount_to_invoice(), nhưng RLS bảng invoices vẫn cho phép
-- ACC/Quản lý trung tâm/Tư vấn viên UPDATE trực tiếp (cần thiết cho tính
-- năng "tự gõ số tiền cuối cùng cần thu" ở trang Thu học phí — xem
-- app/edu/wallet-invoices.js), nên bản vá ở hàm không có tác dụng nếu ai
-- đó (hoặc 1 tính năng khác sau này) update trực tiếp mà không qua hàm
-- đó. Thêm trigger chặn NGAY TẦNG BẢNG, áp dụng cho MỌI đường ghi (kể cả
-- qua RPC lẫn update trực tiếp) — không đổi hành vi tính năng hợp lệ hiện
-- có vì tính năng đó vốn đã tính đúng trong khoảng cho phép.
-- =====================================================================
create or replace function enforce_invoice_discount_bounds()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if new.manual_discount_vnd is not null and (new.manual_discount_vnd < 0 or new.manual_discount_vnd > new.amount_vnd) then
    raise exception 'Số tiền giảm giá phải từ 0 đến tối đa % (giá trị hoá đơn gốc).', new.amount_vnd;
  end if;
  return new;
end;
$func$;

drop trigger if exists invoices_guard_discount on invoices;
create trigger invoices_guard_discount
before insert or update on invoices
for each row execute function enforce_invoice_discount_bounds();

-- =====================================================================
-- PHẦN 9 — cash_flow_entries: trang Báo cáo kế toán
-- (app/acc/reports.js) cho phép Kế toán tự thêm 1 dòng thu/chi thủ công
-- (vd tiền lẻ, điều chỉnh) — insert TRỰC TIẾP từ frontend (không qua RPC,
-- hợp lý vì đây là nhập liệu đơn giản, không cần tính toán gì thêm).
-- Nhưng cột created_by lại lấy thẳng từ client (PROFILE.id gửi lên) —
-- cùng lỗi giả mạo người ghi nhận như các hàm RPC khác. Thêm trigger tự
-- điền đúng người đang đăng nhập, không đổi cách dùng tính năng hiện có.
-- =====================================================================
create or replace function enforce_cashflow_entry_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  new.created_by := current_employee_id();
  return new;
end;
$func$;

drop trigger if exists cashflow_guard_identity on cash_flow_entries;
create trigger cashflow_guard_identity
before insert on cash_flow_entries
for each row execute function enforce_cashflow_entry_identity();

-- =====================================================================
-- PHẦN 10 — receivables: không có nơi nào trong frontend ghi trực tiếp
-- (chỉ SELECT ở acc/reports.js, exec/reports.js), nên siết policy "for
-- all" hiện có lại thành chỉ đọc, phòng ngừa — không ảnh hưởng gì vì
-- không có tính năng nào hiện tại cần ghi trực tiếp vào bảng này.
-- =====================================================================
drop policy if exists receivables_all on receivables;
drop policy if exists receivables_select on receivables;
create policy receivables_select on receivables for select using (
  current_department_id() = (select id from departments where code='ACC')
  or has_module_permission('/acc/reports.html')
  or is_executive_or_tech()
);