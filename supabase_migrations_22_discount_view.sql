-- =====================================================================
-- File 22: VIEW HỖ TRỢ HIỂN THỊ (chạy sau file 21)
-- Tránh phải parse chuỗi tstzrange thô ở phía frontend (dễ lỗi/rối) —
-- tách sẵn valid_from/valid_to thành 2 cột timestamptz thường.
-- =====================================================================
create or replace view discount_programs_view as
select
  id, name, scope, center_id, discount_rate, status, created_by, created_at, updated_at,
  lower(valid_range) as valid_from,
  upper(valid_range) as valid_to
from discount_programs;

-- View kế thừa RLS của bảng gốc thông qua security_invoker (mặc định từ
-- Postgres 15+; nếu Supabase project dùng bản cũ hơn, bật thủ công dòng dưới)
alter view discount_programs_view set (security_invoker = true);
