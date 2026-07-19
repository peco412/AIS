-- =====================================================================
-- File 127: HÀM XEM TRƯỚC GIÁ THEO LỚP BẤT KỲ (19/07/2026)
-- =====================================================================
-- calculate_payment_option_amount() (file 124) tính theo LỚP HIỆN TẠI
-- của học sinh — không dùng được để xem trước giá của 1 lớp KHÁC (vd khi
-- đang chọn lớp mới trong màn "Đổi lớp", chưa xác nhận đổi thật). Thêm
-- hàm phụ tính trực tiếp theo course_id chỉ định, dùng chung logic 4
-- công thức — không cần "đổi tạm rồi đổi lại" lớp của học sinh để xem giá
-- (cách đó có rủi ro dữ liệu tạm thời sai nếu mạng lỗi giữa chừng).
-- =====================================================================
create or replace function calculate_payment_option_amount_for_course(p_course_id uuid, p_option text)
returns numeric
language plpgsql
stable
as $func$
declare
  v_course record;
  v_next_course_id uuid;
  v_next_price numeric;
  v_result numeric;
begin
  select price_vnd, weeks, sublevel_id, display_order into v_course
  from program_courses where id = p_course_id;

  if v_course.price_vnd is null or v_course.price_vnd <= 0 then
    raise exception 'Khoá học chưa cấu hình học phí.';
  end if;

  if p_option = 'BY_COURSE' then
    v_result := v_course.price_vnd;

  elsif p_option = 'BY_MONTH' then
    if v_course.weeks is null or v_course.weeks <= 0 then
      raise exception 'Khoá học chưa cấu hình Số tuần — không tính được giá theo tháng.';
    end if;
    v_result := round(v_course.price_vnd / (v_course.weeks / 4.0));

  elsif p_option = 'COMBO_2_COURSES' then
    v_next_course_id := get_next_course_in_sequence(p_course_id);
    if v_next_course_id is null then
      raise exception 'Đây là khoá cuối cùng của lộ trình — không có khoá liền kề để đóng combo 2 khoá.';
    end if;
    select price_vnd into v_next_price from program_courses where id = v_next_course_id;
    v_result := v_course.price_vnd + coalesce(v_next_price, 0);

  elsif p_option = 'FULL_SUB_LEVEL' then
    select coalesce(sum(price_vnd), 0) into v_result
    from program_courses
    where sublevel_id = v_course.sublevel_id and display_order >= v_course.display_order;

  else
    raise exception 'Hình thức đóng học phí không hợp lệ: %', p_option;
  end if;

  return v_result;
end;
$func$;

-- Cap nhat lai calculate_payment_option_amount() (theo hoc sinh) de DUNG
-- CHUNG code voi ham moi, tranh 2 noi cung logic de bi lech nhau sau nay.
create or replace function calculate_payment_option_amount(p_student_id uuid, p_option text)
returns numeric
language plpgsql
stable
as $func$
declare
  v_course_id uuid;
begin
  select cl.course_id into v_course_id
  from students s join classes cl on cl.id = s.class_id
  where s.id = p_student_id;

  if v_course_id is null then
    raise exception 'Học sinh chưa được xếp lớp, hoặc lớp chưa gắn Khoá học cụ thể.';
  end if;

  return calculate_payment_option_amount_for_course(v_course_id, p_option);
end;
$func$;

grant execute on function calculate_payment_option_amount_for_course(uuid, text) to authenticated;
