-- =====================================================================
-- File 51: VA LOI "infinite recursion detected in policy for relation
-- meetings" - 2 policy meetings_select va meeting_participants_select
-- goi vong lan nhau (meetings can tra meeting_participants, nguoc lai
-- meeting_participants can tra meetings) - Postgres lap vo han.
--
-- Cach sua: tach phan kiem tra ra 2 ham SECURITY DEFINER rieng - ham nay
-- chay voi quyen chu so huu (postgres, tu dong bypass RLS), nen khi goi
-- tu trong policy se KHONG kich hoat lai chinh policy do, pha vo vong lap.
-- (chay sau file 50)
-- =====================================================================

create or replace function is_meeting_participant(p_meeting_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from meeting_participants mp
    where mp.meeting_id = p_meeting_id and mp.employee_id = current_employee_id()
  );
$$;

create or replace function is_meeting_creator(p_meeting_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from meetings m
    where m.id = p_meeting_id and m.created_by = current_employee_id()
  );
$$;

revoke execute on function is_meeting_participant(uuid) from public, anon;
revoke execute on function is_meeting_creator(uuid) from public, anon;
grant execute on function is_meeting_participant(uuid) to authenticated;
grant execute on function is_meeting_creator(uuid) to authenticated;

drop policy if exists meetings_select on meetings;
create policy meetings_select on meetings for select
  using (
    created_by = current_employee_id()
    or is_meeting_participant(id)
    or is_executive_or_tech()
  );

drop policy if exists meeting_participants_select on meeting_participants;
create policy meeting_participants_select on meeting_participants for select
  using (
    employee_id = current_employee_id()
    or is_meeting_creator(meeting_id)
    or is_executive_or_tech()
  );

drop policy if exists meeting_participants_insert on meeting_participants;
create policy meeting_participants_insert on meeting_participants for insert
  with check (
    is_meeting_creator(meeting_id)
    or is_executive_or_tech()
  );
