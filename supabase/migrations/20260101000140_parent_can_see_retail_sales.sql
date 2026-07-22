-- =====================================================================
-- File 140: ĐỒNG BỘ LỊCH SỬ — HỌC PHÍ/PHIẾU BÁN LẺ ĐÓNG TẠI QUẦY CŨNG
-- PHẢI HIỆN TRONG "LỊCH SỬ MUA HÀNG & CHI TIÊU" CỦA PHỤ HUYNH (19/07/2026)
-- =====================================================================
-- Đúng như bạn chỉ ra: "Lịch sử mua hàng & chi tiêu" (app AISCenter)
-- trước đây CHỈ hiện giao dịch qua VÍ — học phí đóng tiền mặt/chuyển
-- khoản tại quầy, hoặc Phiếu bán lẻ mua tại quầy, hoàn toàn KHÔNG hiện ra
-- — phụ huynh nhìn vào tưởng như chưa từng đóng/mua gì nếu lần đó đóng
-- trực tiếp thay vì qua ví.
--
-- Đã sửa phần code (bỏ lọc source='WALLET', thêm nguồn Phiếu bán lẻ) —
-- nhưng rà thêm thì phát hiện: dù sửa code, PHỤ HUYNH VẪN KHÔNG XEM ĐƯỢC
-- vì bảng retail_sales chỉ cho phép NHÂN VIÊN xem (theo đúng trung tâm),
-- chưa có quyền nào cho phụ huynh xem phiếu bán lẻ của CON MÌNH — bổ
-- sung ngay ở đây.
-- =====================================================================
create policy retail_sales_select_parent on retail_sales for select
  using (student_id is not null and is_linked_to_student(student_id));
