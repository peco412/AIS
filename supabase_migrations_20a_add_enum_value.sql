-- =====================================================================
-- File 20a: CHẠY FILE NÀY TRƯỚC — MỘT MÌNH, KHÔNG GỘP CHUNG VỚI FILE KHÁC
--
-- Postgres bắt buộc "ALTER TYPE ... ADD VALUE" phải được commit riêng
-- trước khi dùng giá trị mới đó ở bất kỳ câu lệnh nào khác trong CÙNG 1
-- lượt chạy — nên phải tách thành 1 file độc lập như thế này.
--
-- Chạy xong file này -> mới chạy tiếp file 20b_leave_forms.sql.
-- =====================================================================
alter type workflow_status add value if not exists 'approved_3';
