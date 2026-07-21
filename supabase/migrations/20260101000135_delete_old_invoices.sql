-- =====================================================================
-- File 135: XOÁ TOÀN BỘ HOÁ ĐƠN CŨ ĐỂ LÀM MỚI (19/07/2026)
-- =====================================================================
-- THEO ĐÚNG YÊU CẦU: xoá sạch dữ liệu hoá đơn cũ (thường là dữ liệu thử
-- nghiệm/demo tích luỹ trong lúc phát triển) để bắt đầu sạch với hệ
-- thống 4 hình thức đóng học phí mới.
--
-- ⚠️ CẢNH BÁO QUAN TRỌNG: đây là hành động XOÁ VĨNH VIỄN, KHÔNG HOÀN TÁC
-- ĐƯỢC. Migration này xoá TOÀN BỘ dữ liệu GẮN VỚI hoá đơn, không chỉ
-- riêng bảng invoices — rà theo đúng các khoá ngoại đang tham chiếu tới
-- invoices trong toàn hệ thống để không bị chặn bởi lỗi ràng buộc dữ
-- liệu, gồm:
--   - Mọi hoá đơn (invoices) — kể cả đã thanh toán, đang nợ, nháp, đã huỷ
--   - Mọi dòng đối soát thanh toán gắn với hoá đơn (debt_ledger)
--   - Mọi giao dịch buổi học gắn với hoá đơn (student_lesson_transactions)
--   - Nhật ký tài chính gắn với hoá đơn (financial_transaction_logs)
--   - Nhật ký nhắc nợ (debt_reminder_logs)
--   - Gói mua trọn cấp độ/chương trình cũ (payment_plan_purchases)
--   - ⚠️ HOA HỒNG TƯ VẤN VIÊN đã tính trên các hoá đơn này (commissions)
--     — đây là dữ liệu có ý nghĩa nghiệp vụ thật (tiền hoa hồng), không
--     chỉ là dữ liệu kỹ thuật — CÂN NHẮC KỸ trước khi chạy nếu tư vấn
--     viên đã có hoa hồng thật tính trên các hoá đơn này.
--
-- KHÔNG đụng tới: Ví AIScoins (wallet_topup_batches), lịch sử nạp ví,
-- dữ liệu học sinh/lớp/chương trình.
--
-- Nếu trung tâm ĐÃ CÓ hoá đơn thật (không phải dữ liệu thử) cần giữ lại
-- để đối chiếu kế toán/thuế/hoa hồng, KHÔNG chạy migration này — báo lại
-- để mình đổi thành "chỉ xoá hoá đơn tạo trước ngày X" thay vì xoá sạch
-- toàn bộ.
-- =====================================================================
delete from student_lesson_transactions where invoice_id is not null;
delete from debt_ledger where invoice_id is not null;
delete from financial_transaction_logs where invoice_id is not null;
delete from debt_reminder_logs where invoice_id is not null;
delete from payment_plan_purchases where invoice_id is not null;
delete from commissions where invoice_id is not null;
delete from invoices;
