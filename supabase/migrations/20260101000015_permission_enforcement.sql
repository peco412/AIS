-- =====================================================================
-- File 16: NỐI "XIN THÊM QUYỀN HẠN" VÀO RLS THẬT (chạy sau file 15)
--
-- Trước đây granted_permissions chỉ mở đúng MENU (điều hướng), dữ liệu
-- bên trong vẫn có thể bị RLS gốc chặn. File này thêm 1 hàm helper dùng
-- chung + áp dụng cho nhóm bảng thuộc các trang "báo cáo/thống kê/quản
-- trị riêng từng phòng ban" — đây là nhóm hợp lý nhất để cấp quyền chéo
-- phòng ban trong thực tế (vd: cho 1 nhân viên HR xem thêm thống kê CSVC).
--
-- module_key lưu trong granted_permissions PHẢI khớp đúng "href" của
-- trang trong app/js/navConfig.js (vd '/acc/reports.html').
--
-- LƯU Ý: đây KHÔNG phải cơ chế tự động phủ hết mọi bảng trong hệ thống —
-- chỉ áp dụng cho các bảng liệt kê dưới đây. Muốn mở thêm cho bảng khác,
-- lặp lại đúng mẫu "or has_module_permission('/duong-dan/trang.html')"
-- vào policy tương ứng.
-- =====================================================================

create or replace function has_module_permission(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from granted_permissions
    where employee_id = current_employee_id() and module_key = p_module_key
  );
$$;

-- ---------------------------------------------------------------------
-- PHẦN 1 — Kế toán: payroll, receivables, cash_flow_entries
-- ---------------------------------------------------------------------
drop policy if exists payroll_select on payroll;
create policy payroll_select on payroll for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='ACC')
    or has_module_permission('/acc/payroll.html')
    or is_executive_or_tech()
  );

drop policy if exists payroll_write on payroll;
create policy payroll_write on payroll for insert
  with check (
    current_department_id() = (select id from departments where code='ACC')
    or has_module_permission('/acc/payroll.html')
    or is_executive_or_tech()
  );

drop policy if exists payroll_update on payroll;
create policy payroll_update on payroll for update
  using (
    current_department_id() = (select id from departments where code='ACC')
    or has_module_permission('/acc/payroll.html')
    or is_executive_or_tech()
  );

drop policy if exists receivables_all on receivables;
create policy receivables_all on receivables for all
  using (
    current_department_id() = (select id from departments where code='ACC')
    or has_module_permission('/acc/reports.html')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='ACC')
    or has_module_permission('/acc/reports.html')
    or is_executive_or_tech()
  );

drop policy if exists cashflow_all on cash_flow_entries;
create policy cashflow_all on cash_flow_entries for all
  using (
    current_department_id() = (select id from departments where code='ACC')
    or has_module_permission('/acc/reports.html')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='ACC')
    or has_module_permission('/acc/reports.html')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHẦN 2 — Truyền thông: mkt_ad_expenses, internal_accounts (+ 2 RPC)
-- ---------------------------------------------------------------------
drop policy if exists mkt_ad_expenses_select on mkt_ad_expenses;
create policy mkt_ad_expenses_select on mkt_ad_expenses for select
  using (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/expense-reports.html')
    or is_executive_or_tech()
  );
drop policy if exists mkt_ad_expenses_write on mkt_ad_expenses;
create policy mkt_ad_expenses_write on mkt_ad_expenses for all
  using (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/expense-reports.html')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/expense-reports.html')
    or is_executive_or_tech()
  );

drop policy if exists internal_accounts_select on internal_accounts;
create policy internal_accounts_select on internal_accounts for select
  using (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/accounts.html')
    or is_executive_or_tech()
  );
drop policy if exists internal_accounts_write on internal_accounts;
create policy internal_accounts_write on internal_accounts for all
  using (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/accounts.html')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/accounts.html')
    or is_executive_or_tech()
  );

-- RPC mã hoá/giải mã tài khoản nội bộ cũng phải xét thêm has_module_permission,
-- nếu không nhân sự được cấp quyền vẫn không xem được mật khẩu tài khoản.
create or replace function set_internal_account_secret(p_account_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/accounts.html')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền cập nhật tài khoản nội bộ.';
  end if;

  update internal_accounts
  set secret_encrypted = encode(pgp_sym_encrypt(p_secret, current_setting('app.settings.mkt_secret_key')), 'base64'),
      updated_at = now()
  where id = p_account_id;
end;
$$;

create or replace function reveal_internal_account_secret(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encrypted text;
begin
  if not (
    current_department_id() = (select id from departments where code = 'MKT')
    or has_module_permission('/mkt/accounts.html')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền xem mật khẩu tài khoản nội bộ.';
  end if;

  select secret_encrypted into v_encrypted from internal_accounts where id = p_account_id;
  if v_encrypted is null then
    return null;
  end if;

  return pgp_sym_decrypt(decode(v_encrypted, 'base64'), current_setting('app.settings.mkt_secret_key'));
end;
$$;

-- ---------------------------------------------------------------------
-- PHẦN 3 — Cơ sở vật chất: facility_assets
-- ---------------------------------------------------------------------
drop policy if exists facility_assets_select on facility_assets;
create policy facility_assets_select on facility_assets for select using (true); -- vẫn giữ nguyên: ai cũng xem được

drop policy if exists facility_assets_write on facility_assets;
create policy facility_assets_write on facility_assets for all
  using (
    current_department_id() = (select id from departments where code = 'FAC')
    or has_module_permission('/fac/stats.html')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code = 'FAC')
    or has_module_permission('/fac/stats.html')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHẦN 4 — Nhân sự: work_schedules
-- ---------------------------------------------------------------------
drop policy if exists work_schedules_select on work_schedules;
create policy work_schedules_select on work_schedules for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or has_module_permission('/hr/work-schedule.html')
    or is_executive_or_tech()
  );

drop policy if exists work_schedules_write on work_schedules;
create policy work_schedules_write on work_schedules for all
  using (
    current_department_id() = (select id from departments where code='HR')
    or has_module_permission('/hr/work-schedule.html')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='HR')
    or has_module_permission('/hr/work-schedule.html')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHẦN 5 — positions: PHÁT HIỆN THÊM lúc làm phần này — bảng này TỪ TRƯỚC
-- ĐẾN GIỜ CHƯA HỀ CÓ RLS (enable row level security còn thiếu ở file gốc),
-- nghĩa là bất kỳ ai đăng nhập cũng sửa/xoá được trực tiếp qua API dù
-- giao diện hr/positions.html chỉ cho HR thao tác. Vá luôn trong lúc này.
-- ---------------------------------------------------------------------
alter table positions enable row level security;

create policy positions_select on positions for select
  to authenticated using (true); -- ai cũng cần đọc để hiện dropdown chức vụ

create policy positions_write on positions for all
  using (
    current_department_id() = (select id from departments where code='HR')
    or has_module_permission('/hr/positions.html')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code='HR')
    or has_module_permission('/hr/positions.html')
    or is_executive_or_tech()
  );
