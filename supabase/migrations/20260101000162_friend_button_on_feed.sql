-- =====================================================================
-- File 162: THEM profile_id VAO RPC LAY TEN + HAM KIEM TRA BAN BE HANG
-- LOAT (27/07/2026)
-- =====================================================================
-- Can them cot "profile_id" (id that su cua social_profiles) vao ket
-- qua tra ve, vi nut "+ Kết bạn" dat THANG tren bang tin can biet DUNG
-- profile_id de gui loi moi (khong phai parent_account_id/employee_id).
-- Doi kieu tra ve cua ham nen phai DROP truoc khi tao lai.
-- =====================================================================

drop function if exists get_social_profiles_batch(uuid[], uuid[]);

create or replace function get_social_profiles_batch(p_parent_ids uuid[], p_employee_ids uuid[])
returns table (owner_type text, owner_id uuid, profile_id uuid, display_name text, avatar_url text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with wanted as (select unnest(p_parent_ids) as pid),
  ensured as (
    insert into social_profiles (parent_account_id, display_name)
    select w.pid, coalesce(pa.full_name, 'Phụ huynh')
    from wanted w
    join parent_accounts pa on pa.id = w.pid
    where not exists (select 1 from social_profiles sp where sp.parent_account_id = w.pid)
    returning id, parent_account_id, display_name, avatar_url
  )
  select 'parent'::text, sp.parent_account_id, sp.id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.parent_account_id = any(p_parent_ids)
  union all
  select 'parent'::text, e.parent_account_id, e.id, e.display_name, e.avatar_url from ensured e;

  return query
  with wanted as (select unnest(p_employee_ids) as eid),
  ensured as (
    insert into social_profiles (employee_id, display_name)
    select w.eid, coalesce(emp.full_name, 'Nhân viên')
    from wanted w
    join employees emp on emp.id = w.eid
    where not exists (select 1 from social_profiles sp where sp.employee_id = w.eid)
    returning id, employee_id, display_name, avatar_url
  )
  select 'employee'::text, sp.employee_id, sp.id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.employee_id = any(p_employee_ids)
  union all
  select 'employee'::text, e.employee_id, e.id, e.display_name, e.avatar_url from ensured e;
end;
$$;

-- MOI — biet truoc tinh trang ket ban voi 1 nhom nguoi (dung de hien
-- dung trang thai nut "+ Kết bạn"/"Đã gửi"/"Bạn bè" ngay tren bang tin,
-- khong can tung nguoi phai vao trang rieng moi biet).
create or replace function get_friendship_statuses(p_profile_ids uuid[])
returns table (other_profile_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_my_id uuid := get_my_social_profile_id();
begin
  return query
  select
    case when f.requester_profile_id = v_my_id then f.addressee_profile_id else f.requester_profile_id end,
    f.status
  from social_friendships f
  where (f.requester_profile_id = v_my_id and f.addressee_profile_id = any(p_profile_ids))
     or (f.addressee_profile_id = v_my_id and f.requester_profile_id = any(p_profile_ids));
end;
$$;
