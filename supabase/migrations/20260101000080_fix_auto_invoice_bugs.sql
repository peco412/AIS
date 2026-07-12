-- =====================================================================
-- File 80: SUA LOI THAT gay "Tao hoa don tu dong dang gap loi" — tim ra
-- goc re: get_auto_discount_for_class() TRUY VAN NHAM cot "course_id"
-- tu bang classes, nhung bang classes KHONG HE CO cot nay (chi co
-- program_id/level_id/sublevel_id — 1 lop hoc di qua NHIEU khoa trong
-- doi cua no, khong gan co dinh voi 1 khoa cu the nao ca). Loi nay CO
-- TU GOC (migration 57), minh vo tinh mang theo khi sua lai o migration
-- 74 ma khong phat hien ra — moi lan ham nay chay (bat ke qua form
-- "Thu hoc phi" hay qua trigger tu dong xep lop) deu bao loi SQL "column
-- course_id does not exist" ngay lap tuc.
-- (chay sau file 79)
-- =====================================================================
create or replace function get_auto_discount_for_class(p_class_id uuid, p_center_id uuid)
returns numeric
language plpgsql stable
as $func$
declare
  v_sublevel_id uuid;
  v_program_id uuid;
  v_best_rate numeric := 0;
begin
  -- SUA: bo han "course_id" (khong ton tai tren bang classes) — 1 lop
  -- hoc gan voi 1 sublevel/program co dinh, khong gan voi 1 khoa cu the
  -- (hoc sinh trong lop di qua nhieu khoa theo thoi gian). Uu dai rieng
  -- theo 1 khoa cu the (applies_to='course') se KHONG tu dong ap dung
  -- duoc o cap do lop hoc nua — neu can, dung "Uu dai tay"/"Dien dac
  -- biet" khi tao hoa don thu cong thay the.
  select sublevel_id, program_id into v_sublevel_id, v_program_id
  from classes where id = p_class_id;

  select coalesce(max(discount_rate), 0) into v_best_rate
  from discount_programs
  where status = 'active'
    and now() <@ valid_range
    and applies_via in ('counter', 'both')
    and (scope = 'system' or center_id = p_center_id)
    and (
      applies_to = 'all'
      or (applies_to = 'sublevel' and sublevel_id = v_sublevel_id)
      or (applies_to = 'program' and program_id = v_program_id)
    );

  return v_best_rate;
end;
$func$;
