-- =====================================================================
-- File 69: 
-- 1) Them quyen xem debt_ledger (nhat ky giao dich) cho Quan ly trung
--    tam/Tu van vien - truoc day chinh sach SELECT chi cho phu huynh/
--    exec-tech/Ke toan, thieu 2 vai tro nay du can xem trang "Thu qua
--    Vi" moi de doi chieu noi bo.
-- (chay sau file 68)
-- =====================================================================
drop policy if exists debt_ledger_select on debt_ledger;
create policy debt_ledger_select on debt_ledger for select using (
  invoice_id in (select id from invoices i where is_linked_to_student(i.student_id))
  or is_executive_or_tech()
  or current_department_id() = (select id from departments where code='ACC')
  or (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and invoice_id in (
    select i.id from invoices i join students s on s.id = i.student_id where s.center_id = current_center_id()
  ))
);
