-- =====================================================================
-- File 117: TỐI ƯU KẾT NỐI — thêm chỉ mục còn thiếu (18/07/2026)
-- Theo yêu cầu "tối ưu lại các kết nối" — rà lại các cột khoá ngoại đang
-- được lọc/join thường xuyên trong các hàm mới (cron quét, tính giá theo
-- Cấp độ con/Cấp độ/Chương trình) nhưng CHƯA có chỉ mục (index) — không
-- đổi kết quả truy vấn, chỉ giúp Postgres tìm nhanh hơn khi dữ liệu tăng
-- lên theo thời gian.
-- =====================================================================
create index if not exists idx_program_courses_sublevel on program_courses(sublevel_id);
create index if not exists idx_classes_course on classes(course_id);
