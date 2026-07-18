-- =====================================================================
-- File 113: STATE MACHINE HOÁ ĐƠN + KHOÁ MUTEX 30 GIÂY (18/07/2026)
-- GIAI ĐOẠN 2 của mô hình Ví buổi học (sau file 112 — sơ đồ dữ liệu).
-- =====================================================================
-- Theo đúng mục III + IV.Luồng 2 của tài liệu:
--   - Vòng đời bắt buộc: Draft -> (Processing tạm thời) -> Unpaid ->
--     Partially_Paid -> Paid — KHÔNG được nhảy cóc.
--   - Một khi đã Partially_Paid/Paid -> KHOÁ CHẶT giá trị gốc hoá đơn.
--   - Cơ chế khoá (Mutex) 30 giây khi ai đó bắt đầu xử lý 1 hoá đơn Draft
--     (phụ huynh chọn Option trên Ví, HOẶC nhân viên bắt đầu thu tại
--     quầy) — chặn 2 bên xử lý trùng cùng lúc (Anti-Race Condition).
--
-- LƯU Ý QUAN TRỌNG: đây MỚI là khung trạng thái + khoá — CHƯA có RPC nào
-- gọi thật (tạo hoá đơn Draft tự động, chọn Option, hoàn tất thanh toán)
-- vì các RPC đó cần nối với sổ cái buổi học (file 112) VÀ Ví AIScoins
-- hiện tại cùng lúc — đây là phần phức tạp và rủi ro nhất, cần 1 giai
-- đoạn riêng bàn kỹ trước khi viết, tránh vừa làm vừa sai.
-- =====================================================================

alter table invoices add column if not exists payment_deadline date;
alter table invoices add column if not exists processing_started_at timestamptz;
alter table invoices add column if not exists processing_started_by uuid references employees(id);

alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in ('draft', 'processing', 'unpaid', 'partially_paid', 'paid'));

comment on column invoices.payment_deadline is 'Ngày hẹn đóng nốt khi phụ huynh xin nợ/đóng trước 1 phần tại quầy (mục IV.Luồng 3 tài liệu Ví buổi học).';
comment on column invoices.processing_started_at is 'Thời điểm bắt đầu khoá mutex (Draft -> Processing) — hết hạn sau 30 giây, xem enforce_invoice_state_machine().';

-- =====================================================================
-- Trigger chặn TẠI TẦNG BẢNG — áp dụng cho MỌI đường ghi (RPC lẫn update
-- trực tiếp). Ở GIAI ĐOẠN NÀY, CHỈ khoá 2 việc chắc chắn an toàn, không
-- đụng tới logic đối soát hiện có:
--   1) Khoá chặt giá trị gốc khi đã Partially_Paid/Paid.
--   2) Khoá mutex 30 giây khi vào trạng thái 'processing' (hoàn toàn mới,
--      không ai đang dùng nên không xung đột gì).
-- CHƯA áp luật "không nhảy cóc" chặt cho cả bộ (draft/unpaid/partially_paid/
-- paid) — vì refresh_invoice_status() (hàm tính lại trạng thái sau MỖI
-- lần thu tiền, đang chạy khắp hệ thống) có thể hợp lệ đưa hoá đơn LÙI
-- trạng thái (vd Kế toán giảm bớt ưu đãi trên 1 hoá đơn đã Paid khiến số
-- tiền còn thiếu tăng lên -> quay lại Partially_Paid) — chặn cứng chiều
-- này sẽ làm hỏng đúng luồng điều chỉnh hợp lệ đang chạy. Luật "không nhảy
-- cóc" đầy đủ cho Draft/Processing sẽ thêm ở giai đoạn viết RPC mua buổi
-- học thật (khi đó mới biết chính xác luồng nào cần khoá cứng, luồng nào
-- cần được lùi để đối soát).
-- =====================================================================
create or replace function enforce_invoice_state_machine()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_lock_active boolean;
begin
  -- KHOÁ CHẶT giá trị gốc: tuyệt đối không sửa amount_vnd/amount_aiscoin
  -- một khi hoá đơn đã có thanh toán (Partially_Paid/Paid), bất kể ai
  -- thao tác — mọi biến động dòng tiền từ nay chỉ ghi qua giao dịch/hoàn
  -- tiền, không sửa thẳng số tiền gốc trên hoá đơn.
  if old.status in ('partially_paid', 'paid') then
    if new.amount_vnd is distinct from old.amount_vnd or new.amount_aiscoin is distinct from old.amount_aiscoin then
      raise exception 'Hoá đơn đã có thanh toán — không được sửa giá trị gốc. Mọi thay đổi phải ghi qua giao dịch/hoàn tiền, không sửa thẳng.';
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'processing' then
    if old.status <> 'draft' then
      raise exception 'Chỉ hoá đơn ở trạng thái Nháp mới bắt đầu xử lý được.';
    end if;
    v_lock_active := old.processing_started_at is not null and old.processing_started_at > now() - interval '30 seconds';
    if v_lock_active and old.processing_started_by is distinct from current_employee_id() then
      raise exception 'Hoá đơn này đang được người khác xử lý, vui lòng thử lại sau giây lát.';
    end if;
    new.processing_started_at := now();
    new.processing_started_by := current_employee_id();
  end if;

  return new;
end;
$func$;

drop trigger if exists invoices_guard_state_machine on invoices;
create trigger invoices_guard_state_machine
before update on invoices
for each row execute function enforce_invoice_state_machine();
