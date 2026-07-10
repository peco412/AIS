-- =====================================================================
-- File 59: THEM Tru bao hiem + Tru thue vao Bang tinh luong (chay sau
-- file 58)
--
-- Tru bao hiem = 10.5% x 5.310.000 = 557.550 VND CO DINH cho moi nhan
-- vien (khong tinh theo luong co ban thuc te cua tung nguoi) - dung 1
-- muc luong tham chieu chung, giong huong dan BGD dua ra. De o dang cot
-- thuong (co gia tri mac dinh) thay vi hang cung trong cong thuc, de
-- sau nay neu muc tham chieu doi thi Ke toan tu sua duoc, khong can sua
-- code.
-- Tru thue = nhap tay hoan toan (khong tu tinh).
-- =====================================================================
alter table payroll add column if not exists insurance_deduction numeric(14,2) not null default 557550;
alter table payroll add column if not exists tax_deduction numeric(14,2) not null default 0;

alter table payroll drop column if exists net_salary;
alter table payroll add column net_salary numeric(14,2) generated always as (
  base_salary + performance_bonus + urgent_bonus + housing_allowance + transport_allowance + other_allowance
  - (leave_days + absent_days) * (base_salary / 26.0)
  - penalty_amount - advance_deduction - insurance_deduction - tax_deduction
) stored;
