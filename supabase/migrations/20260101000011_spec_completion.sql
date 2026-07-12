-- =====================================================================
-- File 12: HOÀN THIỆN SCHEMA THEO ĐỀ BÀI (chạy sau file 11)
-- - Thu hẹp đúng phạm vi RLS cho lịch trực/lịch tuần giáo viên theo đúng
--   danh sách vai trò nêu trong đề bài (không phải "ai ở trung tâm đó
--   cũng xem được", như đã tạm nới ở file 11).
-- - Bảng mới: mkt_ad_expenses (báo cáo chi phí digital marketing).
-- - RPC mã hoá/giải mã tài khoản nội bộ (internal_accounts.secret_encrypted).
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — Thu hẹp lại RLS cho center_duty_schedules / teacher_weekly_schedules
-- Đúng đề bài: "Phần chỉ quản lý trung tâm, phòng nhân sự, phòng marketing,
-- ban điều hành, nhân viên kỹ thuật thấy" — KHÔNG phải toàn bộ nhân sự
-- đang công tác tại trung tâm đó.
-- =====================================================================

drop policy if exists center_duty_select on center_duty_schedules;
create policy center_duty_select on center_duty_schedules for select
  using (
    (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or current_department_id() = (select id from departments where code = 'HR')
    or current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  );

drop policy if exists center_duty_write on center_duty_schedules;
create policy center_duty_write on center_duty_schedules for all
  using (
    (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or is_executive_or_tech()
  )
  with check (
    (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or is_executive_or_tech()
  );

drop policy if exists teacher_weekly_select on teacher_weekly_schedules;
create policy teacher_weekly_select on teacher_weekly_schedules for select
  using (
    teacher_id = current_employee_id()
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or current_department_id() = (select id from departments where code = 'HR')
    or current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  );

drop policy if exists teacher_weekly_write on teacher_weekly_schedules;
create policy teacher_weekly_write on teacher_weekly_schedules for all
  using ((current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id()) or is_executive_or_tech())
  with check ((current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id()) or is_executive_or_tech());

-- =====================================================================
-- PHẦN 2 — Thu hẹp classes_update / students_update: chỉ QUẢN LÝ TRUNG TÂM
-- của đúng trung tâm đó (không phải bất kỳ ai có center_id trùng, ví dụ
-- giáo viên/tư vấn cùng trung tâm không nên tự sửa danh sách lớp/học viên).
-- =====================================================================

drop policy if exists classes_write on classes;
create policy classes_write on classes for insert
  with check ((current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id()) or is_executive_or_tech());

drop policy if exists classes_update on classes;
create policy classes_update on classes for update
  using ((current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id()) or is_executive_or_tech());

drop policy if exists students_write on students;
create policy students_write on students for insert
  with check ((current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id()) or is_executive_or_tech());

drop policy if exists students_update on students;
create policy students_update on students for update
  using ((current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id()) or is_executive_or_tech());

-- =====================================================================
-- PHẦN 3 — Báo cáo chi phí Digital Marketing (bảng mới, đề bài yêu cầu
-- nhưng chưa có bảng lưu trữ trong schema gốc)
-- =====================================================================

create table if not exists mkt_ad_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text not null,              -- Facebook Ads, Google Ads, TikTok Ads, Zalo...
  center_id uuid references centers(id),
  amount numeric(14,2) not null,
  spend_date date not null,
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_mkt_ad_expenses_date on mkt_ad_expenses(spend_date);
create index if not exists idx_mkt_ad_expenses_center on mkt_ad_expenses(center_id);

alter table mkt_ad_expenses enable row level security;

create policy mkt_ad_expenses_select on mkt_ad_expenses for select
  using (
    current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  );
create policy mkt_ad_expenses_write on mkt_ad_expenses for all
  using (
    current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  );

-- =====================================================================
-- PHẦN 4 — Mã hoá/giải mã tài khoản nội bộ (internal_accounts.secret_encrypted)
-- Dùng pgcrypto + Supabase Vault để lưu khoá (KHÔNG dùng ALTER DATABASE vì
-- Supabase chặn quyền set custom GUC — lỗi 42501 permission denied).
--
-- Chạy 1 LẦN trước khi dùng 2 hàm dưới đây (thay khoá thật vào, giữ bí mật):
--
--   select vault.create_secret(
--     'KHOA-THAT-CUA-BAN-O-DAY',
--     'mkt_secret_key',
--     'Khoa ma hoa tai khoan noi bo - MKT'
--   );
-- =====================================================================

create or replace function set_internal_account_secret(p_account_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if not (
    current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền cập nhật tài khoản nội bộ.';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'mkt_secret_key';

  if v_key is null then
    raise exception 'Chưa cấu hình khoá mã hoá (mkt_secret_key) trong Vault.';
  end if;

  update internal_accounts
  set secret_encrypted = encode(pgp_sym_encrypt(p_secret, v_key), 'base64'),
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
  v_key text;
begin
  if not (
    current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền xem mật khẩu tài khoản nội bộ.';
  end if;

  select secret_encrypted into v_encrypted from internal_accounts where id = p_account_id;
  if v_encrypted is null then
    return null;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'mkt_secret_key';

  if v_key is null then
    raise exception 'Chưa cấu hình khoá mã hoá (mkt_secret_key) trong Vault.';
  end if;

  return pgp_sym_decrypt(decode(v_encrypted, 'base64'), v_key);
end;
$$;

-- =====================================================================
-- PHẦN 5 — facility_assets: thêm cột "Đang sử dụng tại" nếu cần liên kết
-- CSVC theo trung tâm (đã có center_id sẵn trong schema gốc, không cần đổi).
-- Chỉ bổ sung index phục vụ trang fac/stats.html.
-- =====================================================================

create index if not exists idx_facility_assets_center on facility_assets(center_id);
create index if not exists idx_facility_assets_condition on facility_assets(condition);

-- =====================================================================
-- PHẦN 6 — classes_select / students_select: đề bài ghi rõ "quản lý
-- trung tâm, phòng nhân sự, phòng marketing, ban điều hành, nhân viên kỹ
-- thuật xem toàn bộ" — tức TOÀN PHÒNG HR/MKT (không chỉ trưởng/phó phòng
-- như điều kiện DEPT_HEAD/DEPT_DEPUTY cũ), cần cho trang center-overview.html.
-- =====================================================================

drop policy if exists classes_select on classes;
create policy classes_select on classes for select
  using (
    center_id = current_center_id()
    or current_department_id() = (select id from departments where code = 'HR')
    or current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  );

drop policy if exists students_select on students;
create policy students_select on students for select
  using (
    center_id = current_center_id()
    or current_department_id() = (select id from departments where code = 'HR')
    or current_department_id() = (select id from departments where code = 'MKT')
    or is_executive_or_tech()
  );

-- =====================================================================
-- PHẦN 7 — work_schedules_select: quản lý trung tâm chỉ xem lịch làm việc
-- tại đúng trung tâm mình quản lý (file 11 tạm cho phép xem mọi trung tâm).
-- =====================================================================

drop policy if exists work_schedules_select on work_schedules;
create policy work_schedules_select on work_schedules for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or is_executive_or_tech()
  );
