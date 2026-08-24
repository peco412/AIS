-- =======================================================================
-- SỬA LỖI THẬT NGHIÊM TRỌNG: RLS contracts chỉ cho HR cập nhật (24/08/2026)
-- -----------------------------------------------------------------------
-- VẤN ĐỀ: policy contracts_update CHỈ cho phép HR (DEPT_HEAD/DEPT_DEPUTY)
-- cập nhật — trong khi actionFor() ở hr/contracts.js hiện nút "Ký hợp
-- đồng" cho CHÍNH NHÂN VIÊN (bước draft->submitted) và nút "Ban điều hành
-- ký" cho EXECUTIVE (bước approved_1->approved_2). Cả 2 nhóm này bấm vào
-- sẽ bị RLS ÂM THẦM CHẶN (0 dòng cập nhật, không báo lỗi — cùng lớp lỗi
-- với is_direct_manager_of() đã sửa) — nhân viên không tự ký được hợp
-- đồng của mình, Ban điều hành cũng không duyệt được cấp cuối.
--
-- SỬA: cho phép thêm (1) chính nhân viên cập nhật hợp đồng CỦA MÌNH, và
-- (2) EXECUTIVE cập nhật (mọi cấp, đúng vai trò duyệt cấp cuối xuyên
-- suốt hệ thống).
-- =======================================================================

drop policy if exists contracts_update on contracts;
create policy contracts_update on contracts for update
  using (
    (current_department_id() = (select id from departments where code='HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'))
    or employee_id = current_employee_id()
    or current_role_code() = 'EXECUTIVE'
  );

-- MỚI — theo đúng luồng "duyệt dữ liệu tách khỏi ký mẫu đơn" đã áp dụng
-- cho leave_requests, cần thêm khả năng từ chối hợp đồng (trước đây
-- KHÔNG có, dù trạng thái 'rejected' đã có sẵn trong workflow_status).
alter table contracts add column if not exists reject_reason text;
alter table contracts add column if not exists rejected_by uuid references employees(id);
alter table contracts add column if not exists rejected_at timestamptz;
