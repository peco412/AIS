-- =======================================================================
-- CHUẨN HOÁ CÔNG THỨC TÍNH LƯƠNG THEO NGÀY CHẤM CÔNG (22/08/2026)
-- -----------------------------------------------------------------------
-- VẤN ĐỀ ĐANG SỬA:
-- 1) Công thức cũ trừ lương theo "leave_days" — GỘP CHUNG cả 4 loại đơn
--    nghỉ (Nghỉ phép/Nghỉ bù/Hoán đổi ngày nghỉ/Nghỉ không lương) làm 1.
--    Theo đúng quy định: CHỈ "Nghỉ không lương" mới bị trừ lương — Nghỉ
--    phép (phép năm), Nghỉ bù (đã làm bù trước đó) và Hoán đổi ngày nghỉ
--    (chỉ đổi ngày nghỉ, không mất ngày công) đều KHÔNG được trừ lương.
--    Migration này tách riêng "unpaid_leave_days" — chỉ tính đúng những
--    ngày thuộc diện "Nghỉ không lương" (form_code balanceImpact=unpaid),
--    còn "leave_days" cũ giữ lại chỉ để BÁO CÁO (tổng ngày nghỉ mọi loại),
--    không còn dùng để trừ lương nữa.
-- 2) Thêm cột cho phép Kế toán ghi đè thủ công số ngày vắng khi hệ thống
--    tính sai (vd lịch làm việc chưa cập nhật kịp, lỗi chấm công GPS...).
-- =======================================================================

alter table payroll add column if not exists unpaid_leave_days numeric(5,2) not null default 0; -- CHỈ ngày thuộc diện Nghỉ không lương — dùng để trừ lương
comment on column payroll.leave_days is 'Tổng ngày nghỉ MỌI loại (phép/bù/hoán đổi/không lương) — CHỈ để báo cáo, KHÔNG dùng để trừ lương. Xem unpaid_leave_days để trừ lương đúng.';

-- Kế toán ghi đè thủ công khi hệ thống tính sai (vd thiếu lịch làm việc,
-- lỗi chấm công...). NULL = dùng số hệ thống tự tính (absent_days) như
-- bình thường; có giá trị = ưu tiên dùng số này thay vì tự tính.
alter table payroll add column if not exists absent_days_override numeric(5,2);
alter table payroll add column if not exists override_note text;
alter table payroll add column if not exists overridden_by uuid references employees(id);
alter table payroll add column if not exists overridden_at timestamptz;

-- Công thức trừ lương MỚI: chỉ (số ngày không chấm công thật sự + số
-- ngày nghỉ không lương) mới bị trừ — ưu tiên dùng absent_days_override
-- nếu Kế toán đã ghi đè, không thì dùng absent_days hệ thống tự tính.
alter table payroll drop column if exists net_salary;
alter table payroll add column net_salary numeric(14,2) generated always as (
  base_salary + performance_bonus + urgent_bonus + housing_allowance + transport_allowance + other_allowance
  - (coalesce(absent_days_override, absent_days) + unpaid_leave_days) * (base_salary / 26.0)
  - penalty_amount - advance_deduction - insurance_deduction - tax_deduction
) stored;
