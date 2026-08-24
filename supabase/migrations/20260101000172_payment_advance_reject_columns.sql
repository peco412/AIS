-- =======================================================================
-- THÊM CỘT TỪ CHỐI cho payment_requests / advance_requests (24/08/2026)
-- -----------------------------------------------------------------------
-- Trigger enforce_workflow_transition() (migration 118) đã cho phép
-- chuyển trạng thái sang 'rejected' — nhưng CHƯA có cột lưu lý do/người
-- từ chối/thời điểm, và giao diện trước đây cũng chưa từng dùng tới khả
-- năng này. Thêm cột để đồng bộ với luồng "duyệt dữ liệu tách khỏi ký
-- mẫu đơn" đã áp dụng cho leave_requests/contracts.
-- =======================================================================

alter table payment_requests add column if not exists reject_reason text;
alter table payment_requests add column if not exists rejected_by uuid references employees(id);
alter table payment_requests add column if not exists rejected_at timestamptz;

alter table advance_requests add column if not exists reject_reason text;
alter table advance_requests add column if not exists rejected_by uuid references employees(id);
alter table advance_requests add column if not exists rejected_at timestamptz;
