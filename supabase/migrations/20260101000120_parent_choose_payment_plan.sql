-- =====================================================================
-- File 120: PHỤ HUYNH TỰ CHỌN HÌNH THỨC ĐÓNG HỌC PHÍ TRONG APP VÍ
-- (19/07/2026)
-- =====================================================================
-- Theo yêu cầu: "Phụ huynh có quyền chọn hình thức đóng trong app ví thay
-- vì đang cứng nhắc theo dữ liệu tư vấn". Hoá đơn nháp do cron tự tạo
-- (file 115) đã có sẵn 3 lựa chọn giá (draft_options) nhưng CHƯA có cách
-- nào cho phụ huynh THẤY và CHỌN — đây là mảnh ghép còn thiếu, nối vào
-- đúng cơ chế đã xây (không tạo hệ thống mới).
--
-- An toàn: phụ huynh KHÔNG tự gõ số tiền — chỉ chọn 1 trong 3 lựa chọn đã
-- được hệ thống TÍNH SẴN (draft_options), hàm tự tra đúng số tiền tương
-- ứng, không tin bất kỳ số tiền nào phía client gửi lên.
-- =====================================================================
create or replace function choose_draft_invoice_plan(p_invoice_id uuid, p_plan_type text)
returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_chosen_option jsonb;
  v_chosen_amount numeric;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'Không tìm thấy hoá đơn.';
  end if;
  if not is_linked_to_student(v_invoice.student_id) then
    raise exception 'Bạn không có quyền thao tác với hoá đơn này.';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Hoá đơn này không còn ở trạng thái chờ chọn hình thức đóng.';
  end if;

  select opt into v_chosen_option
  from jsonb_array_elements(coalesce(v_invoice.draft_options, '[]'::jsonb)) opt
  where opt->>'plan_type' = p_plan_type
  limit 1;

  if v_chosen_option is null then
    raise exception 'Hình thức đóng học phí này không có trong danh sách lựa chọn của hoá đơn.';
  end if;

  v_chosen_amount := (v_chosen_option->>'amount_vnd')::numeric;

  update invoices set
    amount_vnd = v_chosen_amount,
    manual_discount_vnd = 0,
    discount_type = 'none',
    status = 'unpaid'
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$func$;

grant execute on function choose_draft_invoice_plan(uuid, text) to authenticated;
