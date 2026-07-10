-- =====================================================================
-- File 47: RESEED DUNG 8 CHUONG TRINH HOC theo dac ta moi nhat (chay
-- sau file 46)
--
-- LUU Y QUAN TRONG: KHONG xoa du lieu chuong trinh cu (10 chuong trinh
-- da seed truoc day o file 09_seed_data.sql) vi co the da co lop hoc/hoa
-- don thuc te tham chieu toi. Migration nay CHI THEM MOI 8 chuong trinh
-- dung theo dac ta. Ban tu kiem tra bang sau, neu du lieu cu khong con
-- lop/hoc sinh nao tham chieu thi tu xoa thu cong:
--   select p.name, count(c.id) as so_lop
--   from programs p left join classes c on c.program_id = p.id
--   group by p.name;
-- =====================================================================
do $$
declare
  p_id uuid; l_id uuid;
begin
  -- 1. Tieng Anh Mam non -> Tiny Explorer -> 1.1/1.2/1.3
  insert into programs (code, name, display_order) values ('TIENGANH_MAMNON','Tiếng Anh Mầm non',1)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'Tiny Explorer',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Tiny Explorer 1.1',1),(l_id,'Tiny Explorer 1.2',2),(l_id,'Tiny Explorer 1.3',3);
  end if;

  -- 2. Tieng Anh Mau Giao -> Pre-School 1/2/3, moi cap 3 khoa
  insert into programs (code, name, display_order) values ('TIENGANH_MAUGIAO','Tiếng Anh Mẫu Giáo',2)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'Pre-School 1',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Pre-School 1.1',1),(l_id,'Pre-School 1.2',2),(l_id,'Pre-School 1.3',3);
    insert into program_levels (program_id, name, display_order) values (p_id,'Pre-School 2',2) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Pre-School 2.1',1),(l_id,'Pre-School 2.2',2),(l_id,'Pre-School 2.3',3);
    insert into program_levels (program_id, name, display_order) values (p_id,'Pre-School 3',3) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Pre-School 3.1',1),(l_id,'Pre-School 3.2',2),(l_id,'Pre-School 3.3',3);
  end if;

  -- 3. Tieng Anh Tre em -> KIDS 1/2, moi cap 3 khoa
  insert into programs (code, name, display_order) values ('TIENGANH_TREEM','Tiếng Anh Trẻ em',3)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'KIDS 1',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Kids 1.1',1),(l_id,'Kids 1.2',2),(l_id,'Kids 1.3',3);
    insert into program_levels (program_id, name, display_order) values (p_id,'KIDS 2',2) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Kids 2.1',1),(l_id,'Kids 2.2',2),(l_id,'Kids 2.3',3);
  end if;

  -- 4. Tieng Anh Thieu Nhi -> Pre-Starters(2)/Starters(4)/Movers(4)/Flyers(4)
  insert into programs (code, name, display_order) values ('TIENGANH_THIEUNHI','Tiếng Anh Thiếu Nhi',4)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'Pre-Starters',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-Starters 1',1),(l_id,'Pre-Starters 2',2);

    insert into program_levels (program_id, name, display_order) values (p_id,'Starters',2) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Starters 1',1),(l_id,'Starters 2',2),(l_id,'Starters 3',3),(l_id,'Starters 4',4);

    insert into program_levels (program_id, name, display_order) values (p_id,'Movers',3) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Movers 1',1),(l_id,'Movers 2',2),(l_id,'Movers 3',3),(l_id,'Movers 4',4);

    insert into program_levels (program_id, name, display_order) values (p_id,'Flyers',4) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Flyers 1',1),(l_id,'Flyers 2',2),(l_id,'Flyers 3',3),(l_id,'Flyers 4',4);
  end if;

  -- 5. Tieng Anh Thanh thieu nien -> Pre-KET/KET/PET/Pre-FCE/FCE, moi cap 3 khoa
  insert into programs (code, name, display_order) values ('TIENGANH_THANHTHIEUNIEN','Tiếng Anh Thanh thiếu niên',5)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'Pre-KET',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-KET 1',1),(l_id,'Pre-KET 2',2),(l_id,'Pre-KET 3',3);

    insert into program_levels (program_id, name, display_order) values (p_id,'KET',2) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values (l_id,'KET 1',1),(l_id,'KET 2',2),(l_id,'KET 3',3);

    insert into program_levels (program_id, name, display_order) values (p_id,'PET',3) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values (l_id,'PET 1',1),(l_id,'PET 2',2),(l_id,'PET 3',3);

    insert into program_levels (program_id, name, display_order) values (p_id,'Pre-FCE',4) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-FCE 1',1),(l_id,'Pre-FCE 2',2),(l_id,'Pre-FCE 3',3);

    insert into program_levels (program_id, name, display_order) values (p_id,'FCE',5) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values (l_id,'FCE 1',1),(l_id,'FCE 2',2),(l_id,'FCE 3',3);
  end if;

  -- 6. Tieng Anh Hoc thuat -> IELTS -> Foundation/Speed Up 1/Speed Up 2/Destination
  insert into programs (code, name, display_order) values ('TIENGANH_HOCTHUAT','Tiếng Anh Học thuật',6)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'IELTS',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Foundation',1),(l_id,'Speed Up 1',2),(l_id,'Speed Up 2',3),(l_id,'Destination',4);
  end if;

  -- 7. Tieng Anh Giao tiep -> Beginners/Elementary/Pre-Intermediate/Intermediate/Advanced
  insert into programs (code, name, display_order) values ('TIENGANH_GIAOTIEP','Tiếng Anh Giao tiếp',7)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'Giao tiếp',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values
      (l_id,'Beginners',1),(l_id,'Elementary',2),(l_id,'Pre-Intermediate',3),(l_id,'Intermediate',4),(l_id,'Advanced',5);
  end if;

  -- 8. Tieng Anh theo nhu cau one-on-one
  insert into programs (code, name, display_order) values ('TIENGANH_ONEONONE','Tiếng Anh theo nhu cầu one-on-one',8)
    on conflict (code) do nothing returning id into p_id;
  if p_id is not null then
    insert into program_levels (program_id, name, display_order) values (p_id,'One-on-one',1) returning id into l_id;
    insert into program_sublevels (level_id, name, display_order) values (l_id,'Tiếng Anh theo nhu cầu one-on-one',1);
  end if;
end $$;
