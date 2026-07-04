-- =====================================================================
-- File 09: SEED DATA - Dữ liệu nền tảng theo đúng thông tin đề bài
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHÂN HỆ
-- ---------------------------------------------------------------------
insert into divisions (code, name, theme_color) values
  ('ALOHA', 'ALOHA', '#0094D9'),
  ('ILINGO', 'iLingo', '#0B6C37');

-- ---------------------------------------------------------------------
-- TRUNG TÂM (8 trung tâm)
-- ---------------------------------------------------------------------
insert into centers (division_id, code, name)
select id, 'MOCAY', 'Mỏ Cày' from divisions where code='ALOHA'
union all select id, 'DUYENHAI', 'Duyên Hải' from divisions where code='ALOHA'
union all select id, 'CANGLONG', 'Càng Long' from divisions where code='ALOHA'
union all select id, 'TRAVINH', 'Trà Vinh' from divisions where code='ALOHA'
union all select id, 'CAUNGANG', 'Cầu Ngang' from divisions where code='ALOHA'
union all select id, 'MEKONG', 'MEKONG' from divisions where code='ALOHA'
union all select id, 'TIEUCAN', 'Tiểu Cần' from divisions where code='ILINGO'
union all select id, 'CAUKE', 'Cầu Kè' from divisions where code='ILINGO';

-- ---------------------------------------------------------------------
-- PHÒNG BAN
-- ---------------------------------------------------------------------
insert into departments (code, name) values
  ('BDH', 'Ban điều hành'),
  ('BCM', 'Ban chuyên môn'),
  ('HR',  'Phòng nhân sự'),
  ('ACC', 'Phòng kế toán'),
  ('MKT', 'Phòng truyền thông'),
  ('EDU', 'Phòng học vụ'),
  ('FAC', 'Phòng cơ sở vật chất'),
  ('TECH','Hỗ trợ kỹ thuật');

-- ---------------------------------------------------------------------
-- VAI TRÒ HỆ THỐNG
-- ---------------------------------------------------------------------
insert into system_roles (code, name) values
  ('EXECUTIVE', 'Ban điều hành'),
  ('DEPT_HEAD', 'Trưởng phòng'),
  ('DEPT_DEPUTY', 'Phó phòng'),
  ('STAFF', 'Nhân viên'),
  ('CENTER_MANAGER', 'Quản lý trung tâm'),
  ('TEACHER', 'Giáo viên'),
  ('CONSULTANT', 'Nhân viên tư vấn'),
  ('TECH', 'Nhân viên kỹ thuật');

-- ---------------------------------------------------------------------
-- CHỨC VỤ THEO PHÒNG BAN
-- approval_level: 2=Ban điều hành, 1=Trưởng/Phó phòng, 0=nhân viên
-- ---------------------------------------------------------------------
-- Ban điều hành
insert into positions (department_id, name, approval_level)
select id, 'Tổng Giám đốc', 2 from departments where code='BDH'
union all select id, 'Phó Giám đốc', 2 from departments where code='BDH'
union all select id, 'Giám đốc điều hành', 2 from departments where code='BDH';

-- Ban chuyên môn
insert into positions (department_id, name, approval_level)
select id, 'Thành viên', 0 from departments where code='BCM';

-- Phòng nhân sự
insert into positions (department_id, name, approval_level)
select id, 'Trưởng phòng nhân sự', 1 from departments where code='HR'
union all select id, 'Phó phòng nhân sự', 1 from departments where code='HR'
union all select id, 'Nhân viên nhân sự', 0 from departments where code='HR';

-- Phòng kế toán
insert into positions (department_id, name, approval_level)
select id, 'Trưởng phòng kế toán', 1 from departments where code='ACC'
union all select id, 'Phó phòng kế toán', 1 from departments where code='ACC'
union all select id, 'Nhân viên kế toán', 0 from departments where code='ACC';

-- Phòng truyền thông
insert into positions (department_id, name, approval_level)
select id, 'Trưởng phòng truyền thông', 1 from departments where code='MKT'
union all select id, 'Phó phòng truyền thông', 1 from departments where code='MKT'
union all select id, 'Nhân viên truyền thông', 0 from departments where code='MKT';

-- Phòng học vụ
insert into positions (department_id, name, approval_level, is_teacher_eligible)
select id, 'Quản lý trung tâm', 1, false from departments where code='EDU'
union all select id, 'Nhân viên tư vấn', 0, false from departments where code='EDU'
union all select id, 'Giáo viên', 0, true from departments where code='EDU';

-- Phòng cơ sở vật chất
insert into positions (department_id, name, approval_level)
select id, 'Trưởng phòng cơ sở vật chất', 1 from departments where code='FAC'
union all select id, 'Phó phòng cơ sở vật chất', 1 from departments where code='FAC'
union all select id, 'Nhân viên cơ sở vật chất', 0 from departments where code='FAC';

-- Hỗ trợ kỹ thuật
insert into positions (department_id, name, approval_level)
select id, 'Nhân viên kỹ thuật', 9 from departments where code='TECH';

-- ---------------------------------------------------------------------
-- BIỂU MẪU HỆ THỐNG (file_url cần cập nhật sau khi upload PDF gốc lên Storage)
-- ---------------------------------------------------------------------
insert into document_templates (code, name, file_url) values
  ('01.Hopdonglaodong', 'Hợp đồng lao động', 'https://TODO-storage-url/01.Hopdonglaodong.pdf'),
  ('02.Phieudenghithanhtoan', 'Phiếu đề nghị thanh toán', 'https://TODO-storage-url/02.Phieudenghithanhtoan.pdf'),
  ('03.Phieudenghitamung', 'Phiếu đề nghị tạm ứng', 'https://TODO-storage-url/03.Phieudenghitamung.pdf'),
  ('04.Phieutrinhsukien', 'Phiếu trình sự kiện', 'https://TODO-storage-url/04.Phieutrinhsukien.pdf'),
  ('05.Phieudenghimuasam', 'Phiếu đề nghị mua sắm', 'https://TODO-storage-url/05.Phieudenghimuasam.pdf');

-- ---------------------------------------------------------------------
-- CHƯƠNG TRÌNH HỌC
-- ---------------------------------------------------------------------
do $$
declare
  p_id uuid;
  l_id uuid;
begin
  -- PRE-SCHOOL
  insert into programs (code, name, display_order) values ('PRESCHOOL','PRE-SCHOOL',1) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Pre-School 1',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Pre-School 1.1',1),(l_id,'Pre-School 1.2',2),(l_id,'Pre-School 1.3',3);
  insert into program_levels (program_id, name, display_order) values (p_id,'Pre-School 2',2) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Pre-School 2.1',1),(l_id,'Pre-School 2.2',2),(l_id,'Pre-School 2.3',3);
  insert into program_levels (program_id, name, display_order) values (p_id,'Pre-School 3',3) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Pre-School 3.1',1),(l_id,'Pre-School 3.2',2),(l_id,'Pre-School 3.3',3);

  -- KIDS
  insert into programs (code, name, display_order) values ('KIDS','KIDS',2) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Kids 1',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Kids 1.1',1),(l_id,'Kids 1.2',2),(l_id,'Kids 1.3',3);
  insert into program_levels (program_id, name, display_order) values (p_id,'Kids 2',2) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Kids 2.1',1),(l_id,'Kids 2.2',2),(l_id,'Kids 2.3',3);

  -- PRE A1 STARTERS
  insert into programs (code, name, display_order) values ('PREA1STARTERS','PRE A1 STARTERS',3) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Pre-Starters',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Pre-Starters 1',1),(l_id,'Pre-Starters 2',2);
  insert into program_levels (program_id, name, display_order) values (p_id,'Starters',2) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Starters 1',1),(l_id,'Starters 2',2),(l_id,'Starters 3',3),(l_id,'Starters 4',4);

  -- A1 MOVERS
  insert into programs (code, name, display_order) values ('A1MOVERS','A1 MOVERS',4) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Movers',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Movers 1',1),(l_id,'Movers 2',2),(l_id,'Movers 3',3),(l_id,'Movers 4',4);

  -- A2 FLYERS
  insert into programs (code, name, display_order) values ('A2FLYERS','A2 FLYERS',5) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Flyers',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Flyers 1',1),(l_id,'Flyers 2',2),(l_id,'Flyers 3',3),(l_id,'Flyers 4',4);

  -- A2 KET
  insert into programs (code, name, display_order) values ('A2KET','A2 KET',6) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Pre-KET',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Pre-KET 1',1),(l_id,'Pre-KET 2',2),(l_id,'Pre-KET 3',3);
  insert into program_levels (program_id, name, display_order) values (p_id,'KET',2) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'KET 1',1),(l_id,'KET 2',2),(l_id,'KET 3',3);

  -- B1 PET
  insert into programs (code, name, display_order) values ('B1PET','B1 PET',7) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'PET',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'PET 1',1),(l_id,'PET 2',2),(l_id,'PET 3',3);

  -- B2 FCE
  insert into programs (code, name, display_order) values ('B2FCE','B2 FCE',8) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Pre-FCE',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'Pre-FCE 1',1),(l_id,'Pre-FCE 2',2),(l_id,'Pre-FCE 3',3);
  insert into program_levels (program_id, name, display_order) values (p_id,'FCE',2) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values
    (l_id,'FCE 1',1),(l_id,'FCE 2',2),(l_id,'FCE 3',3);

  -- IELTS
  insert into programs (code, name, display_order) values ('IELTS','IELTS',9) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values
    (p_id,'Foundation',1),(p_id,'Speed Up 1',2),(p_id,'Speed Up 2',3),(p_id,'Destination',4);

  -- COMMUNICATION
  insert into programs (code, name, display_order) values ('COMMUNICATION','COMMUNICATION',10);
end $$;

-- =====================================================================
-- TÀI KHOẢN MẪU (VMTDTP / 123456)
-- LƯU Ý QUAN TRỌNG: auth.users do Supabase Auth quản lý, KHÔNG insert
-- trực tiếp bằng SQL thường. Cần tạo qua Supabase Admin API hoặc Dashboard:
--
--   supabase.auth.admin.createUser({
--     email: "vmtdtp@ais.local",
--     password: "123456",
--     user_metadata: { username: "VMTDTP" }
--   })
--
-- Sau khi có auth_user_id trả về, insert dòng employees tương ứng:
--
--   insert into employees (auth_user_id, full_name, department_id, position_id,
--     role_id, status, temp_password_flag)
--   values ('<auth_user_id>', 'Tài khoản mẫu VMTDTP',
--     (select id from departments where code='TECH'),
--     (select id from positions where name='Nhân viên kỹ thuật'),
--     (select id from system_roles where code='TECH'),
--     'active', true);
--
-- (employee_code sẽ tự sinh AIS-0001 qua trigger ở file 07)
-- =====================================================================
