-- =====================================================================
-- File 163: SUA LOI 400 KHI GOI get_social_profiles_batch (27/07/2026)
-- =====================================================================
-- Nguyen nhan: ham dung tham so kieu "uuid[]" — khi 1 trong 2 mang gui
-- len BI RONG (vd 1 trang chi toan bai cua nhan vien, mang phu huynh
-- rong), PostgREST doi khi KHONG XAC DINH DUOC dung kieu du lieu cho
-- mang JSON rong do (khong biet ep thanh uuid[] hay kieu gi khac), tra
-- ve loi 400. Day la 1 gioi han/loi biet truoc cua PostgREST voi tham
-- so mang khi gia tri rong — cach khac phuc pho bien la doi tham so
-- sang kieu "jsonb" (luon ro rang, khong bi mo ho kieu du lieu), roi tu
-- chuyen doi lai thanh uuid[] BEN TRONG ham.
-- =====================================================================

drop function if exists get_social_profiles_batch(uuid[], uuid[]);

create or replace function get_social_profiles_batch(p_parent_ids jsonb, p_employee_ids jsonb)
returns table (owner_type text, owner_id uuid, profile_id uuid, display_name text, avatar_url text)
language plpgsql security definer set search_path = public as $$
declare
  v_parent_ids uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_parent_ids, '[]'::jsonb)) x), '{}');
  v_employee_ids uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_employee_ids, '[]'::jsonb)) x), '{}');
begin
  return query
  with wanted as (select unnest(v_parent_ids) as pid),
  ensured as (
    insert into social_profiles (parent_account_id, display_name)
    select w.pid, coalesce(pa.full_name, 'Phụ huynh')
    from wanted w
    join parent_accounts pa on pa.id = w.pid
    where not exists (select 1 from social_profiles sp where sp.parent_account_id = w.pid)
    returning id, parent_account_id, display_name, avatar_url
  )
  select 'parent'::text, sp.parent_account_id, sp.id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.parent_account_id = any(v_parent_ids)
  union all
  select 'parent'::text, e.parent_account_id, e.id, e.display_name, e.avatar_url from ensured e;

  return query
  with wanted as (select unnest(v_employee_ids) as eid),
  ensured as (
    insert into social_profiles (employee_id, display_name)
    select w.eid, coalesce(emp.full_name, 'Nhân viên')
    from wanted w
    join employees emp on emp.id = w.eid
    where not exists (select 1 from social_profiles sp where sp.employee_id = w.eid)
    returning id, employee_id, display_name, avatar_url
  )
  select 'employee'::text, sp.employee_id, sp.id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.employee_id = any(v_employee_ids)
  union all
  select 'employee'::text, e.employee_id, e.id, e.display_name, e.avatar_url from ensured e;
end;
$$;

-- Ap dung cung 1 cach sua cho get_friendship_statuses (cung dung tham
-- so mang, cung co the gap loi tuong tu khi danh sach rong).
drop function if exists get_friendship_statuses(uuid[]);

create or replace function get_friendship_statuses(p_profile_ids jsonb)
returns table (other_profile_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_my_id uuid := get_my_social_profile_id();
  v_profile_ids uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_profile_ids, '[]'::jsonb)) x), '{}');
begin
  return query
  select
    case when f.requester_profile_id = v_my_id then f.addressee_profile_id else f.requester_profile_id end,
    f.status
  from social_friendships f
  where (f.requester_profile_id = v_my_id and f.addressee_profile_id = any(v_profile_ids))
     or (f.addressee_profile_id = v_my_id and f.requester_profile_id = any(v_profile_ids));
end;
$$;
