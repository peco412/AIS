-- =====================================================================
-- File 158: SUA LOI THAT — THIEU QUYEN "CONSULTANT" TREN BANG invoices
-- (27/07/2026)
-- =====================================================================
-- Loi: trang Thu hoc phi (wallet-invoices.js) GHI RO trong code — va
-- ngay trong comment cua chinh file do — rang "Thu hoc phi tai cho la
-- nghiep vu hang ngay cua Quan ly trung tam/Ke toan/Tu van vien"
-- (CONSULTANT). Nhung khi viet lai chinh sach RLS cho bang invoices o
-- migration 149, vo tinh CHI dua CENTER_MANAGER vao dieu kien theo
-- trung tam, BO SOT CONSULTANT — trong khi bang debt_ledger (sua CUNG
-- luc, cung file) lai dua dung ca 2 vai tro. Ket qua: nhan vien
-- Tu van vien khong xem/xu ly hoa don duoc, dung y nhu bao cao — day
-- la LOI CUA CHINH MINH TU LAN SUA TRUOC, khong phai loi moi phat sinh.
-- =====================================================================

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select using (
  is_linked_to_student(student_id) or sees_all_centers()
  or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
);

drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all
  using (
    sees_all_centers()
    or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
  )
  with check (
    sees_all_centers()
    or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and student_id in (select id from students where center_id = current_center_id()))
  );
