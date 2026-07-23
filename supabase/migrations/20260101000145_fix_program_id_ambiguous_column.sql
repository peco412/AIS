-- =====================================================================
-- File 145: SỬA LỖI THẬT — "column reference program_id is ambiguous"
-- (19/07/2026)
-- =====================================================================
-- Hàm get_auto_discount_program_for_class() (từ file 133) khai báo
-- "returns table(program_id uuid, ...)" — Postgres tự tạo 1 biến ẩn tên
-- program_id bên trong hàm để chứa kết quả trả về. Nhưng NGAY TRONG THÂN
-- HÀM lại có dòng lấy program_id THẲNG từ bảng classes (bảng classes có
-- sẵn cột program_id riêng của nó) mà KHÔNG ghi rõ classes.program_id —
-- Postgres không biết đây là cột của bảng hay biến đầu ra của hàm, báo
-- lỗi "ambiguous" đúng như bạn gặp.
--
-- Lỗi này có từ file 133, chỉ là trước đó ít bị vấp phải (tuỳ tình huống
-- có chương trình ưu đãi đang chạy hay không mới thực sự gọi tới dòng
-- này) — sửa dứt điểm ở đây.
-- =====================================================================
create or replace function get_auto_discount_program_for_class(p_class_id uuid, p_center_id uuid)
returns table(program_id uuid, program_name text, discount_rate numeric)
language plpgsql
stable
as $func$
declare
  v_course_id uuid;
  v_sublevel_id uuid;
  v_program_id uuid;
begin
  select c.course_id, c.sublevel_id, c.program_id into v_course_id, v_sublevel_id, v_program_id
  from classes c where c.id = p_class_id;

  return query
  select dp.id, dp.name, dp.discount_rate
  from discount_programs dp
  where dp.status = 'active'
    and now() <@ dp.valid_range
    and dp.applies_via in ('counter', 'both')
    and (dp.scope = 'system' or dp.center_id = p_center_id)
    and (
      dp.applies_to = 'all'
      or (dp.applies_to = 'course' and dp.course_id = v_course_id)
      or (dp.applies_to = 'sublevel' and dp.sublevel_id = v_sublevel_id)
      or (dp.applies_to = 'program' and dp.program_id = v_program_id)
    )
  order by dp.discount_rate desc
  limit 1;
end;
$func$;
