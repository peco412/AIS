-- =====================================================================
-- File 159: SUA THEM 2 CHO CUNG LOI "THIEU CONSULTANT" (27/07/2026)
-- =====================================================================
-- Sau khi sua invoices (file 158), ra soat tiep CAC BANG KHAC ma DUNG
-- trang Thu hoc phi (wallet-invoices.js) co dung toi — phat hien them
-- 2 bang bi dung y het loi truoc: wallet_students va
-- payment_plan_purchases chi co CENTER_MANAGER, thieu CONSULTANT.
--
-- Bang chung cang chac chan day la loi can sua: 1 ghi chu CU trong du
-- an (file 104, tu truoc khi minh dung vao sua RLS lan nay) da GHI RO
-- "RLS bảng invoices vẫn cho phép ACC/Quản lý trung tâm/Tư vấn viên
-- UPDATE trực tiếp" — xac nhan Tu van vien VON DA duoc thiet ke co
-- quyen nay tu lau, khong phai minh tu y mo rong them.
-- =====================================================================

drop policy if exists wallet_students_select on wallet_students;
create policy wallet_students_select on wallet_students for select using (
  is_linked_to_student(student_id) or sees_all_centers()
  or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
);

drop policy if exists plan_purchases_select on payment_plan_purchases;
create policy plan_purchases_select on payment_plan_purchases for select using (
  sees_all_centers()
  or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
);

-- MOI — bo sung not: sau khi sua SELECT o tren, GHI (write) van chi co
-- CENTER_MANAGER se tao ra tinh trang xem duoc nhung khong luu duoc —
-- sua dong bo ca 2 chieu cho Tu van vien, dung 1 mau hinh voi invoices.
drop policy if exists plan_purchases_write on payment_plan_purchases;
create policy plan_purchases_write on payment_plan_purchases for all
  using (
    sees_all_centers()
    or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
  )
  with check (
    sees_all_centers()
    or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
  );
