-- =======================================================================
-- THÊM CỘT TỪ CHỐI cho purchase_requests / event_proposals (24/08/2026)
-- -----------------------------------------------------------------------
-- Đồng bộ với luồng "duyệt dữ liệu tách khỏi ký mẫu đơn" đã áp dụng cho
-- leave_requests/contracts/payment_requests/advance_requests — 2 bảng
-- này trước đây cũng KHÔNG có cách từ chối (dù trigger
-- enforce_workflow_transition() đã hỗ trợ sẵn trạng thái 'rejected').
-- =======================================================================

alter table purchase_requests add column if not exists reject_reason text;
alter table purchase_requests add column if not exists rejected_by uuid references employees(id);
alter table purchase_requests add column if not exists rejected_at timestamptz;

alter table event_proposals add column if not exists reject_reason text;
alter table event_proposals add column if not exists rejected_by uuid references employees(id);
alter table event_proposals add column if not exists rejected_at timestamptz;
