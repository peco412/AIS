-- =====================================================================
-- File 64: "Chiet khau theo hinh thuc dong hoc phi" (payment_plan_discounts)
-- TRUOC DAY CHUA TUNG CO GIAO DIEN chinh sua - chi sua duoc qua SQL truc
-- tiep. Vua xay xong trang moi trong Master Data, dong bo lai RLS cho
-- dung mau chung (TECH + ACC duoc ghi, BDH chi xem). (chay sau file 63)
-- =====================================================================
drop policy if exists payment_plan_discounts_write on payment_plan_discounts;
create policy payment_plan_discounts_write on payment_plan_discounts for all
  using (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'))
  with check (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'));
