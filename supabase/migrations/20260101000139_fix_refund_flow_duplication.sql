-- =====================================================================
-- File 139: SỬA LỖI THIẾT KẾ — HOÀN PHÍ PHẢI ĐI QUA ĐÚNG LUỒNG YÊU CẦU +
-- DUYỆT ĐÃ CÓ SẴN, KHÔNG PHẢI NÚT THAO TÁC TRỰC TIẾP MỚI (19/07/2026)
-- =====================================================================
-- Bạn hỏi đúng chỗ — rà lại phát hiện: hệ thống ĐÃ CÓ SẴN 1 trang "Yêu
-- cầu hoàn phí" (refund-requests.html) với luồng Yêu cầu → Duyệt đàng
-- hoàng (Ví: Quản lý trung tâm/Tư vấn viên xác nhận trước → Kế toán
-- duyệt cuối; Tiền mặt/CK: Kế toán duyệt trực tiếp) — VÀ ĐÃ CÓ SẴN đúng
-- công thức chống trục lợi mục V.2 tài liệu gốc, chỉ THIẾU đúng 1 phần
-- "Giá trị quà tặng đã dùng" bạn mới bổ sung.
--
-- File 137 (đợt trước) mình đã KHÔNG rà thấy trang này — tự dựng riêng 1
-- nút "Hoàn phí" thao tác TRỰC TIẾP (huỷ hoá đơn ngay, không qua duyệt)
-- trên trang Thu học phí — tạo ra 2 luồng hoàn phí song song, chồng chéo,
-- và luồng mới lại THIẾU hẳn bước duyệt mà luồng cũ đã có. Đây là lỗi
-- thiết kế thật của mình, xin lỗi vì rà chưa đủ kỹ.
--
-- SỬA: gộp lại đúng 1 luồng DUY NHẤT — nối phần "Giá trị quà tặng đã
-- dùng" + khả năng hoàn qua Ví (trước đây trang cũ chỉ hoàn được Tiền
-- mặt/CK) vào ĐÚNG trang "Yêu cầu hoàn phí" đã có sẵn, đi qua đúng bước
-- duyệt như thiết kế ban đầu. Bỏ nút "Hoàn phí" thao tác trực tiếp mới
-- thêm ở trang Thu học phí.
-- =====================================================================
alter table tuition_refund_requests add column if not exists gift_value_used numeric(14,2) not null default 0;
comment on column tuition_refund_requests.gift_value_used is 'Giá trị quà tặng/khuyến mãi đã dùng, trừ thêm vào công thức hoàn phí — bổ sung theo đúng công thức mới. Xem file 139.';

alter table tuition_refund_requests drop constraint if exists tuition_refund_requests_source_check;
alter table tuition_refund_requests add constraint tuition_refund_requests_source_check
  check (source in ('CASH', 'BANK_TRANSFER', 'WALLET'));

-- =====================================================================
-- Chan gia mao nguoi gui yeu cau (requested_by dang lay tu client) —
-- dung mau da ap dung nhieu lan truoc do (archive_files_guard_identity,
-- cashflow_guard_identity...).
-- =====================================================================
create or replace function tuition_refund_requests_guard_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  new.requested_by := current_employee_id();
  return new;
end;
$func$;

drop trigger if exists tuition_refund_requests_guard_identity on tuition_refund_requests;
create trigger tuition_refund_requests_guard_identity
before insert on tuition_refund_requests
for each row execute function tuition_refund_requests_guard_identity();

-- =====================================================================
-- approve_tuition_refund(): xu ly dung theo nguon — WALLET thi cong lai
-- vao vi (khong chi ghi so am nhu CASH/BANK_TRANSFER).
-- =====================================================================
create or replace function approve_tuition_refund(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req tuition_refund_requests%rowtype;
  v_wallet_id uuid;
begin
  p_approver_id := current_employee_id();

  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc duyet hoan phi.';
  end if;

  select * into v_req from tuition_refund_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yeu cau nay da duoc xu ly roi.'; end if;

  update tuition_refund_requests set status = 'approved', approved_by = p_approver_id, approved_at = now() where id = p_request_id;

  if v_req.source = 'WALLET' then
    v_wallet_id := get_or_create_family_wallet(v_req.student_id);
    insert into wallet_topup_batches (wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate, amount_vnd_paid, method, created_by)
    values (v_wallet_id, v_req.refund_amount, v_req.refund_amount, 0, 1.0, v_req.refund_amount, 'class_transfer_credit', p_approver_id);
    perform append_financial_log('WALLET', -v_req.refund_amount, null, p_approver_id, v_wallet_id, v_req.student_id,
      format('Hoàn phí vào ví: đã học %s khoá, quà tặng đã dùng %s đ.', v_req.courses_completed, v_req.gift_value_used));
  else
    perform append_financial_log(v_req.source, -v_req.refund_amount, null, p_approver_id, null, v_req.student_id,
      format('Hoàn phí tại quầy: đã học %s khoá, quà tặng đã dùng %s đ.', v_req.courses_completed, v_req.gift_value_used));
  end if;
end;
$func$;
