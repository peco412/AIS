-- =====================================================================
-- File 164: SUA LOI "column reference display_name is ambiguous"
-- (27/07/2026)
-- =====================================================================
-- Nguyen nhan: ham get_social_profiles_batch() khai bao
-- "returns table (..., display_name text, avatar_url text)" — dieu nay
-- tu dong tao ra 2 "bien ngam" ten display_name/avatar_url ben trong
-- ham. O doan "insert into social_profiles (...) ... returning id,
-- parent_account_id, display_name, avatar_url" — vi KHONG ghi ro
-- display_name/avatar_url la lay tu bang nao, Postgres khong biet la
-- muon lay CONG cua bang vua insert hay la BIEN NGAM cung ten — bao
-- loi "ambiguous". Sua bang cach dat ten (alias) cho bang dich trong
-- INSERT roi ghi ro nguon trong RETURNING.
-- =====================================================================

drop function if exists get_social_profiles_batch(jsonb, jsonb);

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
    insert into social_profiles as sp (parent_account_id, display_name)
    select w.pid, coalesce(pa.full_name, 'Phụ huynh')
    from wanted w
    join parent_accounts pa on pa.id = w.pid
    where not exists (select 1 from social_profiles sp2 where sp2.parent_account_id = w.pid)
    returning sp.id, sp.parent_account_id, sp.display_name, sp.avatar_url
  )
  select 'parent'::text, sp.parent_account_id, sp.id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.parent_account_id = any(v_parent_ids)
  union all
  select 'parent'::text, e.parent_account_id, e.id, e.display_name, e.avatar_url from ensured e;

  return query
  with wanted as (select unnest(v_employee_ids) as eid),
  ensured as (
    insert into social_profiles as sp (employee_id, display_name)
    select w.eid, coalesce(emp.full_name, 'Nhân viên')
    from wanted w
    join employees emp on emp.id = w.eid
    where not exists (select 1 from social_profiles sp2 where sp2.employee_id = w.eid)
    returning sp.id, sp.employee_id, sp.display_name, sp.avatar_url
  )
  select 'employee'::text, sp.employee_id, sp.id, sp.display_name, sp.avatar_url
  from social_profiles sp where sp.employee_id = any(v_employee_ids)
  union all
  select 'employee'::text, e.employee_id, e.id, e.display_name, e.avatar_url from ensured e;
end;
$$;
