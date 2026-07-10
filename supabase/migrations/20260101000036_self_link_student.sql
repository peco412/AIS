-- =====================================================================
-- File 36: PHU HUYNH TU LIEN KET VI VOI CON (khong can nhan vien lam
-- truoc) - so khop theo SDT (da dang ky) + Ho ten + Ngay sinh hoc sinh
-- (chay sau file 35)
-- =====================================================================
create or replace function self_link_student(p_full_name text, p_dob date)
returns table(success boolean, message text)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_parent_id uuid;
  v_phone text;
  v_matches uuid[];
begin
  v_parent_id := current_parent_id();
  if v_parent_id is null then
    return query select false, 'Khong tim thay ho so phu huynh - vui long dang nhap lai.';
    return;
  end if;

  v_phone := auth.jwt() ->> 'phone';
  if v_phone is null then
    return query select false, 'Phien dang nhap khong co so dien thoai xac thuc.';
    return;
  end if;

  select array_agg(id) into v_matches
  from students
  where dob = p_dob
    and trim(lower(full_name)) = trim(lower(p_full_name))
    and (
      normalize_phone_vn(phone) = normalize_phone_vn(v_phone)
      or normalize_phone_vn(backup_phone) = normalize_phone_vn(v_phone)
    );

  if v_matches is null or array_length(v_matches, 1) = 0 then
    return query select false, 'Khong tim thay hoc sinh khop thong tin (SDT dang ky + Ho ten + Ngay sinh). Vui long kiem tra lai, hoac lien he truc tiep trung tam de duoc ho tro lien ket.';
    return;
  end if;

  if array_length(v_matches, 1) > 1 then
    return query select false, 'Tim thay nhieu hoc sinh trung thong tin - vui long lien he trung tam de xac minh chinh xac.';
    return;
  end if;

  insert into parent_student_links (parent_account_id, student_id, relationship)
  values (v_parent_id, v_matches[1], 'Chưa xác định')
  on conflict (parent_account_id, student_id) do nothing;

  return query select true, 'Lien ket thanh cong!';
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAT HIEN THEM: programs/program_levels/program_sublevels CHUA TUNG
-- bat RLS tu truoc den gio (cung loai bug da vaphat hien o bang positions
-- truoc day) - bat ky ai dang nhap cung sua/xoa duoc cau truc chuong
-- trinh hoc + gia tien qua API. Va ngay trong luc lam trang bang gia.
-- ---------------------------------------------------------------------
alter table programs enable row level security;
create policy programs_select on programs for select to authenticated using (true);
create policy programs_write on programs for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

alter table program_levels enable row level security;
create policy program_levels_select on program_levels for select to authenticated using (true);
create policy program_levels_write on program_levels for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

alter table program_sublevels enable row level security;
create policy program_sublevels_select on program_sublevels for select to authenticated using (true);
create policy program_sublevels_write on program_sublevels for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());
