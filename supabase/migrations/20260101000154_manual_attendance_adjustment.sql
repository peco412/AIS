-- =====================================================================
-- File 154: KE TOAN + NHAN SU DIEU CHINH TAY CHAM CONG (27/07/2026)
-- =====================================================================
-- Ly do: he thong cham cong hien tai CHI ghi nhan qua GPS luc bam "Chấm
-- công vào/ra" — nhan vien vang mat CA THANG (khong bam lan nao) se
-- KHONG CO DONG DU LIEU NAO CA, dan toi HO TU DONG BIEN MAT khoi bao
-- cao cham cong (bao cao chi liet ke nhan vien co it nhat 1 lan cham
-- cong), khien Ke toan khong biet de xu ly luong cho dung — chinh la
-- nguyen nhan "khong di luong duoc". Sua bang cach cho phep Nhan su va
-- Ke toan TU NHAP TAY 1 dong cham cong (hoac sua/xoa dong da co) cho
-- BAT KY nhan vien nao, co ghi lai NGUOI DIEU CHINH + LY DO de doi
-- soat sau nay.
-- =====================================================================

-- latitude/longitude/distance_m von bat buoc (dung cho GPS that) —
-- doi voi dong nhap tay thi khong co GPS that, nen phai cho phep de
-- trong.
alter table attendance_checkins alter column latitude drop not null;
alter table attendance_checkins alter column longitude drop not null;
alter table attendance_checkins alter column distance_m drop not null;

alter table attendance_checkins add column if not exists is_manual boolean not null default false;
alter table attendance_checkins add column if not exists adjusted_by uuid references employees(id);
alter table attendance_checkins add column if not exists note text;

-- ---------------------------------------------------------------------
-- RLS — cho phep Nhan su (Truong/Pho phong) va Ke toan (moi cap bac)
-- them/sua/xoa cham cong cua NGUOI KHAC, ngoai quyen tu cham cong cho
-- CHINH MINH da co san tu truoc.
-- ---------------------------------------------------------------------
create or replace function can_adjust_attendance() returns boolean
language sql stable security definer as $$
  select (current_department_id() = (select id from departments where code = 'HR') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'))
    or current_department_id() = (select id from departments where code = 'ACC')
    or is_executive_or_tech();
$$;

drop policy if exists attendance_checkins_insert on attendance_checkins;
create policy attendance_checkins_insert on attendance_checkins for insert
  with check (employee_id = current_employee_id() or can_adjust_attendance());

drop policy if exists attendance_checkins_update on attendance_checkins;
create policy attendance_checkins_update on attendance_checkins for update
  using (can_adjust_attendance())
  with check (can_adjust_attendance());

drop policy if exists attendance_checkins_delete on attendance_checkins;
create policy attendance_checkins_delete on attendance_checkins for delete
  using (can_adjust_attendance());
