-- =====================================================================
-- File 111: TÁCH THÔNG BÁO THÔNG TIN / HỆ THỐNG + KÝ TÊN CHÍNH CHỦ
-- (18/07/2026) — theo yêu cầu: tách "Thông báo" thành 2 loại, và thêm
-- chữ ký (tên + chức danh) ở cuối thông báo dạng "thông tin" cho formal.
-- =====================================================================

-- 'system'  = tự động sinh ra từ các luồng nghiệp vụ (duyệt đơn, phân
--             việc, nhắc nợ...) — giữ nguyên hành vi cũ, KHÔNG cần sửa gì
--             ở hàng chục nơi đang tạo loại này (mặc định 'system').
-- 'info'    = do con người CHỦ ĐỘNG soạn để thông báo/announce (vd trang
--             Ban hành thông báo) — loại DUY NHẤT hiện chữ ký cuối bài.
alter table notifications add column if not exists notification_type text not null default 'system'
  check (notification_type in ('system', 'info'));

-- =====================================================================
-- Chuyển trang "Ban hành thông báo" (exec/broadcast.js) từ insert() trực
-- tiếp (created_by lấy từ client — giả mạo được, đúng lỗi quen thuộc)
-- sang gọi qua hàm này — tự suy người gửi từ current_employee_id(), đảm
-- bảo chữ ký hiện ra sau này LUÔN đúng là người thật đã bấm gửi, không
-- ai giả mạo được tên/chức danh người ký.
-- =====================================================================
create or replace function create_broadcast_notification(
  p_scope notification_scope, p_title text, p_content text,
  p_center_id uuid default null, p_department_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_id uuid;
begin
  if not is_dept_head_or_above() then
    raise exception 'Chỉ Trưởng/phó phòng trở lên mới được ban hành thông báo.';
  end if;
  if p_title is null or trim(p_title) = '' then
    raise exception 'Vui lòng nhập tiêu đề thông báo.';
  end if;

  insert into notifications (scope, center_id, department_id, title, content, created_by, notification_type)
  values (p_scope, p_center_id, p_department_id, trim(p_title), p_content, current_employee_id(), 'info')
  returning id into v_id;

  return v_id;
end;
$func$;
