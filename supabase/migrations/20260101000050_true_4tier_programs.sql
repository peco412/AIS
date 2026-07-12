-- =====================================================================
-- File 50: XAY LAI DUNG 4 TANG CHUONG TRINH HOC (Chuong trinh -> Cap do
-- -> Cap do con -> Khoa) - truoc day chi co 3 tang, lam phang mat 1 lop
-- nhom quan trong (vd PRE A1 STARTERS gom ca Pre-Starters lan Starters).
-- XOA SACH du lieu chuong trinh cu, reseed lai tu dau theo dung cau truc
-- that trong dac ta (chay sau file 49).
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - Them tang thu 4: "Khoa" (program_courses) - day moi la don vi
-- CO GIA THAT (price_vnd chuyen tu program_sublevels sang day).
-- program_sublevels tu gio la "Cap do con" (khong con gia rieng nua).
-- ---------------------------------------------------------------------
create table if not exists program_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublevel_id uuid not null references program_sublevels(id) on delete cascade,
  name text not null,
  price_vnd numeric(14,2),
  display_order smallint not null default 0
);

alter table program_courses enable row level security;
create policy program_courses_select on program_courses for select to authenticated using (true);
create policy program_courses_write on program_courses for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

-- classes gio co the gan dung 1 "Khoa" cu the (chinh xac hon sublevel cu) -
-- them cot MOI, KHONG xoa level_id/sublevel_id cu (van giu de loc/bao cao
-- theo cap do rong hon khi can).
alter table classes add column if not exists course_id uuid references program_courses(id);

-- ---------------------------------------------------------------------
-- PHAN 2 - XOA SACH du lieu chuong trinh hoc cu (theo yeu cau "xoa du
-- lieu cu, reseed lai") - CASCADE se tu xoa theo ca program_levels/
-- program_sublevels/program_courses lien quan. KHONG dung neu da co lop
-- hoc/hoa don THAT tham chieu toi chuong trinh cu (se bao loi khoa ngoai
-- neu co rang buoc con tro toi) - kiem tra truoc neu can.
-- ---------------------------------------------------------------------
truncate table programs cascade;

-- ---------------------------------------------------------------------
-- PHAN 3 - Xoa cot gia cu tren program_sublevels (chuyen sang program_courses)
-- ---------------------------------------------------------------------
alter table program_sublevels drop column if exists price_vnd;

-- ---------------------------------------------------------------------
-- PHAN 4 - RESEED DUNG 4 TANG cho ca 8 chuong trinh
-- ---------------------------------------------------------------------
do $$
declare
  p_id uuid; l_id uuid; sl_id uuid;
begin
  -- 1. Tieng Anh Mam non -> Cap do: Tiny Explorer -> Cap do con: Tiny Explorer (goi ten trung, chi co 1) -> Khoa 1.1/1.2/1.3
  insert into programs (code, name, display_order) values ('TIENGANH_MAMNON','Tiếng Anh Mầm non',1) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Tiny Explorer',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Tiny Explorer',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Tiny Explorer 1.1',1),(sl_id,'Tiny Explorer 1.2',2),(sl_id,'Tiny Explorer 1.3',3);

  -- 2. Tieng Anh Mau Giao -> Cap do: PRE-SCHOOL -> Cap do con: Pre-School 1/2/3 -> moi cap 3 khoa
  insert into programs (code, name, display_order) values ('TIENGANH_MAUGIAO','Tiếng Anh Mẫu Giáo',2) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'PRE-SCHOOL',1) returning id into l_id;

  insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-School 1',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Pre-School 1.1',1),(sl_id,'Pre-School 1.2',2),(sl_id,'Pre-School 1.3',3);
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-School 2',2) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Pre-School 2.1',1),(sl_id,'Pre-School 2.2',2),(sl_id,'Pre-School 2.3',3);
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-School 3',3) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Pre-School 3.1',1),(sl_id,'Pre-School 3.2',2),(sl_id,'Pre-School 3.3',3);

  -- 3. Tieng Anh Tre em -> Cap do: KIDS -> Cap do con: KIDS 1/2 -> moi cap 3 khoa
  insert into programs (code, name, display_order) values ('TIENGANH_TREEM','Tiếng Anh Trẻ em',3) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'KIDS',1) returning id into l_id;

  insert into program_sublevels (level_id, name, display_order) values (l_id,'KIDS 1',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Kids 1.1',1),(sl_id,'Kids 1.2',2),(sl_id,'Kids 1.3',3);
  insert into program_sublevels (level_id, name, display_order) values (l_id,'KIDS 2',2) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Kids 2.1',1),(sl_id,'Kids 2.2',2),(sl_id,'Kids 2.3',3);

  -- 4. Tieng Anh Thieu Nhi -> DUNG 4 TANG THAT:
  --    Cap do PRE A1 STARTERS -> Cap do con Pre-Starters(2 khoa) + Starters(4 khoa)
  --    Cap do A1 MOVERS       -> Cap do con Movers (4 khoa)
  --    Cap do FLYERS          -> Cap do con Flyers (4 khoa)
  insert into programs (code, name, display_order) values ('TIENGANH_THIEUNHI','Tiếng Anh Thiếu Nhi',4) returning id into p_id;

  insert into program_levels (program_id, name, display_order) values (p_id,'PRE A1 STARTERS',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-Starters',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values (sl_id,'Pre-Starters 1',1),(sl_id,'Pre-Starters 2',2);
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Starters',2) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Starters 1',1),(sl_id,'Starters 2',2),(sl_id,'Starters 3',3),(sl_id,'Starters 4',4);

  insert into program_levels (program_id, name, display_order) values (p_id,'A1 MOVERS',2) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Movers',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Movers 1',1),(sl_id,'Movers 2',2),(sl_id,'Movers 3',3),(sl_id,'Movers 4',4);

  insert into program_levels (program_id, name, display_order) values (p_id,'FLYERS',3) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Flyers',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Flyers 1',1),(sl_id,'Flyers 2',2),(sl_id,'Flyers 3',3),(sl_id,'Flyers 4',4);

  -- 5. Tieng Anh Thanh thieu nien -> DUNG 4 TANG THAT:
  --    Cap do A2 KET -> Cap do con Pre-KET(3) + KET(3)
  --    Cap do PET    -> Cap do con PET(3)
  --    Cap do B2 FCE -> Cap do con Pre-FCE(3) + FCE(3)
  insert into programs (code, name, display_order) values ('TIENGANH_THANHTHIEUNIEN','Tiếng Anh Thanh thiếu niên',5) returning id into p_id;

  insert into program_levels (program_id, name, display_order) values (p_id,'A2 KET',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-KET',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values (sl_id,'Pre-KET 1',1),(sl_id,'Pre-KET 2',2),(sl_id,'Pre-KET 3',3);
  insert into program_sublevels (level_id, name, display_order) values (l_id,'KET',2) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values (sl_id,'KET 1',1),(sl_id,'KET 2',2),(sl_id,'KET 3',3);

  insert into program_levels (program_id, name, display_order) values (p_id,'PET',2) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'PET',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values (sl_id,'PET 1',1),(sl_id,'PET 2',2),(sl_id,'PET 3',3);

  insert into program_levels (program_id, name, display_order) values (p_id,'B2 FCE',3) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Pre-FCE',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values (sl_id,'Pre-FCE 1',1),(sl_id,'Pre-FCE 2',2),(sl_id,'Pre-FCE 3',3);
  insert into program_sublevels (level_id, name, display_order) values (l_id,'FCE',2) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values (sl_id,'FCE 1',1),(sl_id,'FCE 2',2),(sl_id,'FCE 3',3);

  -- 6. Tieng Anh Hoc thuat -> Cap do IELTS -> Cap do con IELTS -> Foundation/Speed Up 1/2/Destination
  insert into programs (code, name, display_order) values ('TIENGANH_HOCTHUAT','Tiếng Anh Học thuật',6) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'IELTS',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'IELTS',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Foundation',1),(sl_id,'Speed Up 1',2),(sl_id,'Speed Up 2',3),(sl_id,'Destination',4);

  -- 7. Tieng Anh Giao tiep -> Cap do Giao tiep -> Cap do con Giao tiep -> Beginners..Advanced
  insert into programs (code, name, display_order) values ('TIENGANH_GIAOTIEP','Tiếng Anh Giao tiếp',7) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'Giao tiếp',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'Giao tiếp',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values
    (sl_id,'Beginners',1),(sl_id,'Elementary',2),(sl_id,'Pre-Intermediate',3),(sl_id,'Intermediate',4),(sl_id,'Advanced',5);

  -- 8. One-on-one
  insert into programs (code, name, display_order) values ('TIENGANH_ONEONONE','Tiếng Anh theo nhu cầu one-on-one',8) returning id into p_id;
  insert into program_levels (program_id, name, display_order) values (p_id,'One-on-one',1) returning id into l_id;
  insert into program_sublevels (level_id, name, display_order) values (l_id,'One-on-one',1) returning id into sl_id;
  insert into program_courses (sublevel_id, name, display_order) values (sl_id,'Tiếng Anh theo nhu cầu one-on-one',1);
end $$;

-- =====================================================================
-- PHAN 5 - Sua create_payment_plan_invoice() de tinh gia dung qua 4 tang
-- moi (truoc day doc thang price_vnd tu program_sublevels - cot nay da
-- bi xoa o Phan 3, gio phai cong don tu program_courses).
--
-- Y NGHIA MOI cua 3 hinh thuc dong (dieu chinh lai cho dung 4 tang):
--   sublevel = dong 1 "Cap do con" cu the (cong tat ca Khoa trong do)
--   level    = dong tron 1 "Cap do" (cong tat ca Khoa cua moi Cap do con ben trong)
--   program  = dong tron ca chuong trinh (cong tat ca Khoa cua toan bo)
-- =====================================================================
create or replace function create_payment_plan_invoice(
  p_student_id uuid, p_plan_type text, p_scope_id uuid
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_discount_rate numeric;
  v_base_price numeric;
  v_course_count int;
  v_final_price numeric;
  v_due_date date;
  v_result invoices;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tao hoa don.';
  end if;

  select discount_rate into v_discount_rate from payment_plan_discounts where plan_type = p_plan_type;

  if p_plan_type = 'sublevel' then
    -- p_scope_id o day la id cua 1 "Cap do con" (program_sublevels.id)
    select coalesce(sum(price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_courses where sublevel_id = p_scope_id;
  elsif p_plan_type = 'level' then
    -- p_scope_id la id cua 1 "Cap do" (program_levels.id) - cong tat ca
    -- Khoa cua MOI Cap do con thuoc Cap do nay.
    select coalesce(sum(pc.price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_courses pc
    join program_sublevels ps on ps.id = pc.sublevel_id
    where ps.level_id = p_scope_id;
  elsif p_plan_type = 'program' then
    -- p_scope_id la id cua 1 Chuong trinh (programs.id) - cong tat ca
    -- Khoa cua toan bo cay ben duoi.
    select coalesce(sum(pc.price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_courses pc
    join program_sublevels ps on ps.id = pc.sublevel_id
    join program_levels pl on pl.id = ps.level_id
    where pl.program_id = p_scope_id;
  else
    raise exception 'plan_type khong hop le.';
  end if;

  if v_base_price is null or v_base_price <= 0 then
    raise exception 'Chua cau hinh hoc phi cho pham vi nay.';
  end if;

  v_final_price := v_base_price * (1 - coalesce(v_discount_rate, 0));
  v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason)
  values (
    p_student_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when v_discount_rate > 0 then 'program' else 'none' end,
    v_base_price - v_final_price,
    case when v_discount_rate > 0 then format('Giam gia hinh thuc dong "%s" (%s%%)', p_plan_type, v_discount_rate * 100) else null end
  )
  returning * into v_result;

  if p_plan_type in ('level', 'program') then
    insert into payment_plan_purchases (student_id, plan_type, level_id, program_id, total_courses, discount_rate_applied, total_amount_vnd, invoice_id)
    values (
      p_student_id, p_plan_type,
      case when p_plan_type = 'level' then p_scope_id else null end,
      case when p_plan_type = 'program' then p_scope_id else null end,
      v_course_count, coalesce(v_discount_rate, 0), v_final_price, v_result.id
    );
  end if;

  return v_result;
end;
$func$;
