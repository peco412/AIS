-- =====================================================================
-- File 144: HIỆN QUÀ TẶNG QUA discount_programs_view (19/07/2026)
-- =====================================================================
-- View discount_programs_view liệt kê CỤ THỂ từng cột (không dùng dp.*)
-- nên 2 cột mới gift_item_id/gift_quantity (file 143) chưa tự động hiện
-- ra — thêm rõ vào đây để trang "Chương trình ưu đãi" (ACC) hiện được
-- quà tặng đã gắn.
-- =====================================================================
create or replace view discount_programs_view as
select
  id, code, name, scope, center_id, discount_rate,
  applies_to, applies_via, program_id, sublevel_id, course_id,
  lower(valid_range) as valid_from, upper(valid_range) as valid_to,
  status, created_by, created_at, updated_at,
  gift_item_id, gift_quantity
from discount_programs;
alter view discount_programs_view set (security_invoker = true);
