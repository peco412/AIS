-- =====================================================================
-- File 160: SUA LOI "hien chu Nhan vien/Phu huynh chung chung thay ten
-- that" (27/07/2026)
-- =====================================================================
-- Nguyen nhan: ho so mang xa hoi (social_profiles) chi duoc TU DONG TAO
-- khi chinh nguoi do goi ensure_social_profile() — tuc la khi HO TU
-- VAO trang Cong dong/Tin nhan it nhat 1 lan SAU KHI tinh nang nay duoc
-- trien khai. Nguoi da dang bai TRUOC DO (hoac chua quay lai) se CHUA
-- CO ho so, khien nguoi XEM bai cua ho thay chu du phong chung chung
-- "Nhân viên"/"Phụ huynh" thay vi ten that — va vi khong biet ten that,
-- khong ket ban duoc.
--
-- Sua tan goc: tao 1 ham RPC MOI, goi boi NGUOI XEM (khong phai nguoi
-- dang bai) — tu dong LAY TEN THAT tu bang goc (employees luon mo doc
-- san; parent_accounts dung quyen SECURITY DEFINER de doc duoc ngay ca
-- khi RLS thuong khong cho) cho BAT KY ai CHUA CO ho so mang xa hoi, va
-- NHAN TIEN TAO LUON ho so do — nhung lan xem sau se khong con can
-- "vay tam" nua.
-- =====================================================================

create or replace function get_social_profiles_batch(p_parent_ids uuid[], p_employee_ids uuid[])
returns table (owner_type text, owner_id uuid, display_name text, avatar_url text)
language plpgsql security definer set search_path = public as $$
begin
  -- Phu huynh: tra ve ho so co san, HOAC tao moi tu ten that neu chua co.
  return query
  with wanted as (select unnest(p_parent_ids) as pid),
  ensured as (
    insert into social_profiles (parent_account_id, display_name)
    select w.pid, coalesce(pa.full_name, 'Phụ huynh')
    from wanted w
    join parent_accounts pa on pa.id = w.pid
    where not exists (select 1 from social_profiles sp where sp.parent_account_id = w.pid)
    returning parent_account_id, display_name, avatar_url
  )
  select 'parent'::text, sp.parent_account_id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.parent_account_id = any(p_parent_ids)
  union all
  select 'parent'::text, e.parent_account_id, e.display_name, e.avatar_url from ensured e;

  -- Nhan vien: tuong tu, tra ve ho so co san hoac tao moi tu ten that.
  return query
  with wanted as (select unnest(p_employee_ids) as eid),
  ensured as (
    insert into social_profiles (employee_id, display_name)
    select w.eid, coalesce(emp.full_name, 'Nhân viên')
    from wanted w
    join employees emp on emp.id = w.eid
    where not exists (select 1 from social_profiles sp where sp.employee_id = w.eid)
    returning employee_id, display_name, avatar_url
  )
  select 'employee'::text, sp.employee_id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.employee_id = any(p_employee_ids)
  union all
  select 'employee'::text, e.employee_id, e.display_name, e.avatar_url from ensured e;
end;
$$;

-- =====================================================================
-- BACKFILL 1 LAN — tao san ho so cho TAT CA phu huynh + nhan vien HIEN
-- CO trong he thong, khong con phai doi ho tu vao trang moi co ten —
-- day chinh la ly do "kết bạn" khong tim ra nguoi: tim kiem dua vao
-- social_profiles.display_name, ai CHUA CO dong nao trong bang nay se
-- KHONG XUAT HIEN trong ket qua tim kiem, du ho co dang bai/nhan tin.
-- =====================================================================
insert into social_profiles (parent_account_id, display_name)
select pa.id, pa.full_name
from parent_accounts pa
where not exists (select 1 from social_profiles sp where sp.parent_account_id = pa.id);

insert into social_profiles (employee_id, display_name)
select e.id, e.full_name
from employees e
where not exists (select 1 from social_profiles sp where sp.employee_id = e.id);
