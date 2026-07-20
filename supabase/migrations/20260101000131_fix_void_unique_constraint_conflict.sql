-- =====================================================================
-- File 131: SỬA LỖI THẬT — "duplicate key value violates unique
-- constraint invoices_student_id_period_year_period_month_key"
-- (19/07/2026)
-- =====================================================================
-- NGUYÊN NHÂN: ràng buộc UNIQUE(student_id, period_year, period_month)
-- có từ trước (file 21) — lúc đó KHÔNG có khái niệm trạng thái "Đã huỷ"
-- (void), nên ràng buộc chỉ cho phép ĐÚNG 1 hoá đơn/học sinh/tháng, bất
-- kể trạng thái gì.
--
-- Từ khi thêm trạng thái VOID (file 122, dùng cho luồng Đổi lớp — huỷ
-- hoá đơn cũ chứ KHÔNG xoá hẳn, để giữ lịch sử đối soát) — 1 học sinh có
-- thể có NHIỀU hoá đơn cùng tháng: 1-2 cái đã huỷ (do đổi lớp nhiều lần
-- trong cùng tháng) + đúng 1 cái đang hoạt động thật. Nhưng ràng buộc cũ
-- vẫn tính CẢ hoá đơn đã huỷ vào, nên hễ tạo hoá đơn mới cho học sinh đã
-- từng bị huỷ 1 hoá đơn trong đúng tháng đó là báo trùng khoá ngay — dù
-- hoá đơn cũ không còn hiệu lực gì cả.
--
-- SỬA: đổi ràng buộc UNIQUE thường thành CHỈ MỤC DUY NHẤT CÓ ĐIỀU KIỆN —
-- chỉ áp dụng cho hoá đơn CHƯA huỷ, hoá đơn đã huỷ được phép trùng
-- tháng/năm với nhau thoải mái (đúng bản chất "không còn hiệu lực").
-- =====================================================================
alter table invoices drop constraint if exists invoices_student_id_period_year_period_month_key;

create unique index if not exists invoices_student_period_active_unique
  on invoices (student_id, period_year, period_month)
  where status <> 'void';

comment on index invoices_student_period_active_unique is
  'Thay cho ràng buộc UNIQUE thường (đã xoá) — chỉ tính hoá đơn CHƯA huỷ, cho phép nhiều hoá đơn đã huỷ (void) trùng tháng/năm khi đổi lớp nhiều lần. Xem file 131.';
