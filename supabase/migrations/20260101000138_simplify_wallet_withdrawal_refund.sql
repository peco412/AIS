-- =====================================================================
-- File 138: SỬA LẠI "RÚT VÍ" — BỎ CÔNG THỨC TRỪ THEO SỐ KHOÁ ĐÃ HỌC
-- (19/07/2026)
-- =====================================================================
-- Rà lại calculate_wallet_refund() (hàm tính số tiền rút ví) để tìm lỗi
-- ở trang withdraw.html — phát hiện:
--
-- Hàm này (từ 1 đợt sửa trước, đã xác nhận với người dùng lúc đó) áp
-- dụng công thức "trừ theo số khoá đã học" cho TOÀN BỘ số dư trong ví,
-- BẤT KỂ số coin đó đến từ đâu — kể cả khi phụ huynh chỉ đơn giản nạp ví
-- để dùng linh hoạt (không hề mua gói "Đóng 2 khoá liền"/"Trọn cấp độ
-- con" nào cả), công thức vẫn tự trừ như thể họ đang rút tiền giữa chừng
-- 1 gói giảm giá — ĐÂY LÀ NGUYÊN NHÂN "quá lỗi" bạn gặp: số tiền dự kiến
-- hoàn hiện ra thường KHÔNG khớp với số dư thật đang có trong ví.
--
-- Từ khi có hệ 4 hình thức đóng học phí (BY_MONTH/BY_COURSE/
-- COMBO_2_COURSES/FULL_SUB_LEVEL) + cơ chế hoàn phí RIÊNG cho 2 hình thức
-- gộp (process_bulk_plan_refund, file 137, do Kế toán xử lý TRÊN ĐÚNG
-- HOÁ ĐƠN đã đóng gộp đó) — việc "trừ theo số khoá đã học" áp cho TOÀN
-- BỘ ví không còn hợp lý nữa, và cũng KHÔNG PHẢI việc phụ huynh tự làm
-- được (cần Kế toán xét duyệt số khoá đã học).
--
-- SỬA: "Rút ví" giờ CHỈ đơn giản là "rút lại đúng số dư đang có, chưa
-- dùng tới" — không trừ gì thêm, đúng bản chất của thao tác này (không
-- phải hoàn phí gói học, chỉ là rút tiền dư trong ví). Muốn hoàn phí gói
-- "Đóng 2 khoá liền"/"Trọn cấp độ con" khi nghỉ giữa chừng, dùng đúng nút
-- "Hoàn phí" trên hoá đơn đó (file 137) — do Kế toán xử lý, không qua
-- đường "Rút ví" tự động của phụ huynh nữa.
-- =====================================================================
create or replace function calculate_wallet_refund(p_wallet_id uuid)
returns numeric
language plpgsql
stable
as $func$
declare
  v_total numeric;
begin
  select coalesce(sum(coin_remaining * conversion_rate), 0) into v_total
  from wallet_topup_batches where wallet_id = p_wallet_id and coin_remaining > 0;

  return v_total;
end;
$func$;

comment on function calculate_wallet_refund(uuid) is
  'Số dư khả dụng CÒN LẠI trong ví (chưa dùng) — KHÔNG áp công thức trừ theo số khoá đã học nữa (đã bỏ, xem file 138). Hoàn phí gói "Đóng 2 khoá liền"/"Trọn cấp độ con" khi nghỉ giữa chừng dùng process_bulk_plan_refund (file 137) trên đúng hoá đơn, không qua hàm này.';
