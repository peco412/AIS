-- =====================================================================
-- File 17: CẬP NHẬT THEO YÊU CẦU MỚI (chạy sau file 16)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Học viên: 4 trạng thái đúng theo yêu cầu (học thử/đang học/
-- bảo lưu/đã nghỉ) thay vì 3 trạng thái cũ (đang học/tạm nghỉ/đã nghỉ).
-- LƯU Ý: nếu Postgres báo lỗi khi ALTER TYPE ... ADD VALUE nằm chung
-- transaction với các câu lệnh dùng ngay giá trị đó — chạy riêng 3 dòng
-- dưới đây thành 1 lượt Run riêng trước, rồi chạy tiếp phần còn lại của
-- file cũng không sao.
-- ---------------------------------------------------------------------
alter type student_status rename value 'paused' to 'reserved';
alter type student_status rename value 'dropped' to 'withdrawn';
alter type student_status add value if not exists 'trial' before 'studying';

-- ---------------------------------------------------------------------
-- PHẦN 2 — Kế toán: thêm loại phiếu "Đề nghị thanh toán công tác phí"
-- KHÔNG cần thêm gì ở đây — hệ thống tạo biểu mẫu bằng cách UPLOAD file
-- qua giao diện (Kho lưu trữ > Biểu mẫu), code được lấy tự động từ TÊN
-- FILE lúc upload. Chỉ cần: tải file PDF mẫu lên, đặt tên file đúng
-- "01.phieudenghithanhtoancongtacphi.pdf" — hệ thống sẽ tự nhận diện,
-- không cần chạy SQL cho bước này.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- PHẦN 3 — Truyền thông: kết quả yêu cầu là link Drive thay vì upload file
-- ---------------------------------------------------------------------
alter table communication_requests add column if not exists result_drive_link text;
comment on column communication_requests.result_drive_link is 'Link Google Drive chứa kết quả bàn giao (thay cho upload file trực tiếp)';
