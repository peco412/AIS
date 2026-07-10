-- =====================================================================
-- File 49: 3 LOI NGHIEM TRONG PHAT HIEN KHI DOI CHIEU VOI FILE VA TAY
-- CUA NGUOI DUNG (untitle.sql) - CHUA TUNG DUOC DUA VAO MIGRATION CHINH
-- THUC (chay sau file 48)
-- =====================================================================

-- ---------------------------------------------------------------------
-- LOI 1 - "Bat doi mat khau lap lai moi lan dang nhap": trigger
-- prevent_self_privilege_escalation() (file 11) chan TUYET DOI moi thay
-- doi temp_password_flag cua chinh minh - ke ca chieu HOP LE (tat co
-- true -> false ngay sau khi doi mat khau thanh cong). Nhan vien khong
-- bao gio tat duoc co nay, bi bat doi lai vinh vien.
-- ---------------------------------------------------------------------
create or replace function prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_hr_admin boolean;
begin
  select
    is_executive_or_tech()
    or (current_department_id() = (select id from departments where code = 'HR')
        and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
  into is_hr_admin;

  if not is_hr_admin and auth.uid() = old.auth_user_id then
    if new.role_id       is distinct from old.role_id
    or new.department_id is distinct from old.department_id
    or new.center_id     is distinct from old.center_id
    or new.status        is distinct from old.status
    or new.employee_code is distinct from old.employee_code
    or new.auth_user_id  is distinct from old.auth_user_id
    -- CHO PHEP tu tat temp_password_flag (true -> false) - day la thao
    -- tac HOP LE ngay sau khi doi mat khau lan dau. Chi chan neu co ai
    -- co tinh tu BAT LAI co nay (false -> true).
    or (new.temp_password_flag is distinct from old.temp_password_flag and new.temp_password_flag = true)
    then
      raise exception 'Không được phép tự thay đổi các trường phân quyền/trạng thái tài khoản.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- LOI 2 - centers/departments/divisions/system_roles CHUA TUNG bat RLS
-- (giong dung loai bug da tim thay o positions/programs truoc day) - moi
-- API request doc/GHI DUOC tu do vao 4 bang nay, khong ai chan ca.
-- ---------------------------------------------------------------------
alter table centers enable row level security;
drop policy if exists centers_select on centers;
create policy centers_select on centers for select to authenticated using (true);
drop policy if exists centers_write on centers;
create policy centers_write on centers for all
  using (is_executive_or_tech())
  with check (is_executive_or_tech());

alter table departments enable row level security;
drop policy if exists departments_select on departments;
create policy departments_select on departments for select to authenticated using (true);
drop policy if exists departments_write on departments;
create policy departments_write on departments for all
  using (is_executive_or_tech())
  with check (is_executive_or_tech());

alter table divisions enable row level security;
drop policy if exists divisions_select on divisions;
create policy divisions_select on divisions for select to authenticated using (true);
drop policy if exists divisions_write on divisions;
create policy divisions_write on divisions for all
  using (is_executive_or_tech())
  with check (is_executive_or_tech());

alter table system_roles enable row level security;
drop policy if exists system_roles_select on system_roles;
create policy system_roles_select on system_roles for select to authenticated using (true);
drop policy if exists system_roles_write on system_roles;
create policy system_roles_write on system_roles for all
  using (is_executive_or_tech())
  with check (is_executive_or_tech());

-- ---------------------------------------------------------------------
-- LOI 3 - Ma hoa tai khoan noi bo MKT (set/reveal_internal_account_secret)
-- tham chieu current_setting('app.settings.mkt_secret_key') - 1 CAU HINH
-- POSTGRES CHUA TUNG DUOC THIET LAP O BAT KY DAU -> tinh nang nay CHUA
-- TUNG hoat dong duoc tu luc xay, luon bao loi "unrecognized configuration
-- parameter" moi lan luu/xem mat khau tai khoan noi bo.
--
-- Sua sang dung dung Supabase Vault (vault.decrypted_secrets) - ban da
-- tu tao secret ten "mkt_secret_key" qua vault.create_secret() roi, chi
-- can doi ham doc dung tu Vault thay vi current_setting().
-- ---------------------------------------------------------------------
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
    or has_module_permission('/mkt/accounts.html')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền cập nhật tài khoản nội bộ.';
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'mkt_secret_key';
  if v_key is null then
    raise exception 'Chưa cấu hình khoá mã hoá "mkt_secret_key" trong Supabase Vault — liên hệ kỹ thuật.';
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
    or has_module_permission('/mkt/accounts.html')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền xem mật khẩu tài khoản nội bộ.';
  end if;

  select secret_encrypted into v_encrypted from internal_accounts where id = p_account_id;
  if v_encrypted is null then
    return null;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'mkt_secret_key';
  if v_key is null then
    raise exception 'Chưa cấu hình khoá mã hoá "mkt_secret_key" trong Supabase Vault — liên hệ kỹ thuật.';
  end if;

  return pgp_sym_decrypt(decode(v_encrypted, 'base64'), v_key);
end;
$$;
