-- =======================================================================
-- CHI TIẾT ĐƠN NGHỈ THEO TỪNG LOẠI (22/08/2026)
-- -----------------------------------------------------------------------
-- VẤN ĐỀ ĐANG SỬA: trước đây leave_requests chỉ có các trường chung
-- (start_date/days/return_date/reason_note) — không đủ để cấp trên duyệt
-- dựa trên dữ liệu thật, PHẢI mở file PDF đính kèm mới biết được nội dung
-- bàn giao công việc/lớp dạy, hoặc ngày hoán đổi cụ thể là ngày nào. Theo
-- đúng yêu cầu: "đơn là nơi chứa thông tin để có thể duyệt, đơn [PDF]
-- chỉ là 1 phần trong cái đơn đó" — bổ sung detail_items lưu đúng bảng
-- chi tiết theo từng loại đơn (xem DETAIL_SCHEMAS trong leaveFormFlow.js
-- để biết cấu trúc từng loại), để cấp trên duyệt được NGAY trên dữ liệu,
-- không bắt buộc phải mở PDF.
-- =======================================================================

alter table leave_requests add column if not exists detail_items jsonb;
comment on column leave_requests.detail_items is 'Bảng chi tiết theo loại đơn — vd bàn giao công việc/lớp dạy, hoán đổi ngày nghỉ/lịch dạy. Cấu trúc từng hàng tuỳ form_code, xem DETAIL_SCHEMAS trong js/leaveFormFlow.js. NULL với loại đơn không cần bảng chi tiết (vd Nghỉ bù).';

-- MỚI — trước đây hệ thống chỉ có luồng duyệt tiến (submitted -> approved_1
-- -> approved_2 -> approved_3), CHƯA từng có cách từ chối đơn dù enum
-- workflow_status đã có sẵn giá trị 'rejected'. Thêm cột lưu lý do +
-- người từ chối + thời điểm, cho hành động "Từ chối" mới (tách riêng
-- khỏi "Duyệt", theo đúng yêu cầu 2 hành động độc lập).
alter table leave_requests add column if not exists reject_reason text;
alter table leave_requests add column if not exists rejected_by uuid references employees(id);
alter table leave_requests add column if not exists rejected_at timestamptz;
