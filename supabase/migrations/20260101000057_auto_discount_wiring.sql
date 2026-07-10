-- =====================================================================
-- File 57: NOI "Uu dai tu dong dien" (He thong uu dai Ke toan cau hinh)
-- VAO luong "Thu hoc phi tai cho" - truoc day hoan toan khong tra cuu
-- discount_programs khi tao hoa don thu tien thuc te. (chay sau file 56)
-- =====================================================================

-- Tim uu dai TOT NHAT (rate cao nhat) dang con hieu luc, dung cho dung
-- trung tam + khop dung pham vi ap dung (applies_to = 'all' luon khop,
-- hoac khop chinh xac course/sublevel/program cua lop hoc sinh dang hoc).
create or replace function get_auto_discount_for_class(p_class_id uuid, p_center_id uuid)
returns numeric
language plpgsql stable
as $func$
declare
  v_course_id uuid;
  v_sublevel_id uuid;
  v_program_id uuid;
  v_best_rate numeric := 0;
begin
  select course_id, sublevel_id, program_id into v_course_id, v_sublevel_id, v_program_id
  from classes where id = p_class_id;

  select coalesce(max(discount_rate), 0) into v_best_rate
  from discount_programs
  where status = 'active'
    and now() <@ valid_range
    and (scope = 'system' or center_id = p_center_id)
    and (
      applies_to = 'all'
      or (applies_to = 'course' and course_id = v_course_id)
      or (applies_to = 'sublevel' and sublevel_id = v_sublevel_id)
      or (applies_to = 'program' and program_id = v_program_id)
    );

  return v_best_rate;
end;
$func$;
