-- =====================================================================
-- File 20b: TÁCH ĐƠN NGHỈ THÀNH 8 LOẠI, 2 MODULE, DUYỆT 3 CẤP
-- (chạy sau file 19 VÀ sau file 20a_add_enum_value.sql)
--
-- 2 module: Cán bộ khối văn phòng (4 loại) / Giáo viên tại trung tâm (4 loại)
-- 3 cấp duyệt: Trưởng phòng (hoặc Quản lý trung tâm với giáo viên) -> Nhân
-- sự -> Ban điều hành.
--
-- Các mã biểu mẫu (đặt tên file PDF khi upload lên Kho lưu trữ > Biểu mẫu
-- cho ĐÚNG các mã này, hệ thống sẽ tự nhận theo tên file):
--   06.Donxinhoandoingaynghi              — Cán bộ: hoán đổi ngày nghỉ hàng tuần
--   07.Donxinnghiphepcanbo                — Cán bộ: nghỉ phép
--   08.Donxinnghibu                       — Cán bộ: nghỉ bù
--   09.Donxinnghikhongluongcanbo          — Cán bộ: nghỉ không lương
--   10.Donxinhoandoilichdaydaybu          — Giáo viên: hoán đổi lịch dạy/dạy bù
--   11.Donxinnghiphep                     — Giáo viên: nghỉ phép
--   12.Donxinnghibu                       — Giáo viên: nghỉ bù
--   13.Donxinnghikhongluonggiaovien       — Giáo viên: nghỉ không lương
-- =====================================================================

-- =====================================================================
-- ⚠️ BẮT BUỘC chạy file supabase_migrations_20a_add_enum_value.sql TRƯỚC
-- (một mình, riêng 1 lượt Run) rồi mới chạy file này — Postgres không cho
-- dùng giá trị enum mới thêm ('approved_3') trong CÙNG 1 transaction với
-- lúc thêm nó.
-- =====================================================================

alter table leave_requests add column if not exists form_code text;
alter table leave_requests add column if not exists staff_group text check (staff_group in ('office', 'teacher'));
alter table leave_requests add column if not exists template_id uuid references document_templates(id);
alter table leave_requests add column if not exists file_url text;
alter table leave_requests add column if not exists level1_approver_id uuid references employees(id);
alter table leave_requests add column if not exists level1_approved_at timestamptz;
alter table leave_requests add column if not exists level2_approver_id uuid references employees(id);
alter table leave_requests add column if not exists level2_approved_at timestamptz;
alter table leave_requests add column if not exists level3_approver_id uuid references employees(id);
alter table leave_requests add column if not exists level3_approved_at timestamptz;

comment on column leave_requests.form_code is 'Mã biểu mẫu cụ thể trong 8 loại (06-13), khớp document_templates.code';

-- ---------------------------------------------------------------------
-- Hoàn tất đơn ở cấp duyệt cuối (Ban điều hành, approved_3) — trừ ngày
-- phép/nghỉ bù đúng loại, atomic trong 1 transaction giống RPC cũ.
-- "Hoán đổi ngày nghỉ / hoán đổi lịch dạy" KHÔNG trừ ngày phép nào cả —
-- chỉ là đổi lịch, không tiêu tốn quỹ phép.
-- ---------------------------------------------------------------------
create or replace function finalize_leave_request_v2(p_leave_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leave leave_requests%rowtype;
begin
  select * into v_leave from leave_requests where id = p_leave_id for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;

  if not is_executive_or_tech() then
    raise exception 'Chỉ Ban điều hành mới duyệt được cấp cuối.';
  end if;

  update leave_requests
  set status = 'approved_3', level3_approver_id = current_employee_id(), level3_approved_at = now()
  where id = p_leave_id;

  -- Đơn "nghỉ phép" (07/11) trừ vào annual_leave_used; "nghỉ bù" (08/12) trừ
  -- vào compensatory_leave; "nghỉ không lương" (09/13) không trừ quỹ phép
  -- (được xử lý riêng ở bảng lương qua leave_type='unpaid'); "hoán đổi"
  -- (06/10) không trừ gì cả.
  if v_leave.form_code in ('07.Donxinnghiphepcanbo', '11.Donxinnghiphep') then
    insert into leave_balances (employee_id, year, month, annual_leave_accrued, annual_leave_used, compensatory_leave)
    values (v_leave.employee_id, extract(year from v_leave.start_date)::int, extract(month from v_leave.start_date)::int, 0, v_leave.days, 0)
    on conflict (employee_id, year, month) do update set annual_leave_used = leave_balances.annual_leave_used + v_leave.days;
  elsif v_leave.form_code in ('08.Donxinnghibu', '12.Donxinnghibu') then
    insert into leave_balances (employee_id, year, month, annual_leave_accrued, annual_leave_used, compensatory_leave)
    values (v_leave.employee_id, extract(year from v_leave.start_date)::int, extract(month from v_leave.start_date)::int, 0, 0, v_leave.days)
    on conflict (employee_id, year, month) do update set compensatory_leave = leave_balances.compensatory_leave - v_leave.days;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Cập nhật RLS: Kế toán xem đơn đã duyệt XONG (nay là approved_3, trước
-- là approved_2) để tính khấu trừ lương tự động — vá lại theo đúng cấp
-- cuối mới.
-- ---------------------------------------------------------------------
drop policy if exists leave_select on leave_requests;
create policy leave_select on leave_requests for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or (current_department_id() = (select id from departments where code='ACC') and status = 'approved_3')
    or (current_role_code() = 'CENTER_MANAGER' and current_center_id() = (select center_id from employees where id = leave_requests.employee_id))
    or is_executive_or_tech()
  );
