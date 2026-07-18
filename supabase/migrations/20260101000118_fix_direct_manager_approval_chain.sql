-- =====================================================================
-- File 118: SỬA LỖI CHUỖI DUYỆT "NHÂN VIÊN → QUẢN LÝ TRỰC TIẾP → PHÒNG
-- CHUYÊN TRÁCH → BAN ĐIỀU HÀNH" bị đứt đoạn (18/07/2026)
-- =====================================================================
-- Theo yêu cầu rà lại toàn bộ logic kết nối phòng ban từ nhân viên tới
-- Ban điều hành — phát hiện 2 lỗi thật.
--
-- LỖI 1 — payment_requests/advance_requests: file 39 thêm đúng 1 cấp mới
-- "Quản lý trực tiếp" vào giữa luồng duyệt (đúng theo đặc tả: "duyệt ĐÚNG
-- 3 CẤP: quản lý trực tiếp -> phòng chuyên trách -> ban điều hành") — có
-- sửa RLS (ai được CHẠM vào phiếu) và sửa giao diện (nút "Quản lý trực
-- tiếp ký" đã hiện đúng), NHƯNG QUÊN sửa trigger enforce_workflow_transition()
-- (hàm quyết định BƯỚC CHUYỂN nào hợp lệ) — hàm này vẫn chỉ nhận đúng 1
-- điều kiện cho bước submitted->approved_1: "phải thuộc phòng Kế toán" —
-- không hề biết tới khái niệm "quản lý trực tiếp" mới thêm.
--
-- HẬU QUẢ THỰC TẾ: nút "Quản lý trực tiếp ký" hiện đúng cho quản lý của
-- phòng ban BẤT KỲ (HR/MKT/FAC/EDU...) — nhưng bấm vào sẽ BỊ TRIGGER CHẶN
-- LẠI với lỗi "Không được phép chuyển trạng thái..." vì quản lý đó không
-- thuộc phòng Kế toán. Chỉ có 1 trường hợp trùng hợp hoạt động được: quản
-- lý trực tiếp CỦA CHÍNH NHÂN VIÊN PHÒNG KẾ TOÁN. Mọi phòng ban khác đều
-- bị chặn — đúng là lỗi "đứt kết nối" giữa nhân viên và cấp duyệt đầu
-- tiên, cho tới tận Ban điều hành.
--
-- SỬA: thêm điều kiện "quản lý trực tiếp của người gửi phiếu" vào đúng
-- bước submitted->approved_1 cho 2 bảng payment_requests/advance_requests
-- (2 bảng DUY NHẤT được đặc tả yêu cầu thêm cấp này ở file 39) — không
-- đụng gì tới contracts/event_proposals/purchase_requests (không nằm
-- trong đặc tả 3 cấp mới, vẫn giữ nguyên 2 cấp như cũ).
-- =====================================================================
create or replace function enforce_workflow_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_col_val uuid;
  dept_code text;
  is_owner boolean;
  is_dept_approver boolean;
  is_manager_approver boolean;
  is_exec boolean;
begin
  is_exec := is_executive_or_tech();

  if tg_table_name = 'contracts' then
    owner_col_val := old.employee_id; dept_code := 'HR';
  elsif tg_table_name = 'payment_requests' then
    owner_col_val := old.requester_id; dept_code := 'ACC';
  elsif tg_table_name = 'advance_requests' then
    owner_col_val := old.requester_id; dept_code := 'ACC';
  elsif tg_table_name = 'event_proposals' then
    owner_col_val := old.center_manager_id; dept_code := 'MKT';
  elsif tg_table_name = 'purchase_requests' then
    owner_col_val := old.requester_id; dept_code := 'FAC';
  end if;

  is_owner := (owner_col_val = current_employee_id());
  is_dept_approver := (
    current_department_id() = (select id from departments where code = dept_code)
    and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY')
  );
  -- MỚI: chỉ 2 bảng có cấp "Quản lý trực tiếp" theo đúng đặc tả file 39 —
  -- bảng khác (contracts/event_proposals/purchase_requests) không có cấp
  -- này, is_manager_approver luôn false, không đổi hành vi cũ của chúng.
  is_manager_approver := (
    tg_table_name in ('payment_requests', 'advance_requests')
    and is_direct_manager_of(owner_col_val)
  );

  if is_exec then
    return new; -- Executive/Tech luôn được phép, kể cả sửa chữa dữ liệu khi cần
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'submitted' and is_owner then
      -- ok: chủ phiếu nộp phiếu
    elsif old.status = 'submitted' and new.status = 'approved_1' and (is_manager_approver or is_dept_approver) then
      -- ok: quản lý trực tiếp ký (payment_requests/advance_requests), hoặc
      -- trưởng/phó phòng chuyên trách ký (contracts/event_proposals/purchase_requests)
    elsif old.status = 'approved_1' and new.status = 'approved_2' and is_dept_approver then
      -- ok: phòng chuyên trách ký (chỉ có ý nghĩa khi bước 1 vừa rồi là quản lý trực tiếp ký)
    elsif new.status = 'rejected' and (is_owner or is_dept_approver or is_manager_approver) then
      -- ok: từ chối
    else
      raise exception 'Không được phép chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  elsif is_owner and old.status not in ('draft','submitted') then
    raise exception 'Phiếu đã được duyệt, không thể tự chỉnh sửa.';
  elsif not is_owner and not is_dept_approver and not is_manager_approver then
    raise exception 'Bạn không có quyền sửa phiếu này.';
  end if;

  return new;
end;
$$;

-- =====================================================================
-- LỖI 2 — purchase_orders (Phiếu mua hàng): PHÁT HIỆN THÊM khi rà theo
-- yêu cầu — bảng này có ĐÚNG CÙNG 3 CẤP (Quản lý trực tiếp -> Kế toán ->
-- Ban điều hành) nhưng CHƯA TỪNG có trigger nào chặn cả — không chỉ thiếu
-- nhận diện "quản lý trực tiếp" như lỗi 1 ở trên, mà còn HOÀN TOÀN CHƯA
-- CÓ RÀO CHẮN "nhảy cóc" nào — 1 Trưởng phòng Kế toán có thể tự set thẳng
-- status='approved_3' kèm đủ 3 chữ ký giả chỉ bằng 1 lệnh update(), y hệt
-- lớp lỗi đã vá cho leave_requests/business_trips/mkt_ad_expenses ở các
-- đợt trước — chỉ là bảng này bị sót vì được thêm sau, không nằm trong 5
-- bảng gốc dùng enforce_workflow_transition().
-- =====================================================================
create or replace function enforce_purchase_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  is_manager boolean;
  is_acc boolean;
begin
  if is_executive_or_tech() then
    return new;
  end if;

  is_manager := is_direct_manager_of(old.requester_id);
  is_acc := (current_department_id() = (select id from departments where code = 'ACC') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'));

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'submitted' and old.requester_id = current_employee_id() then
      null;
    elsif old.status = 'draft' and new.status = 'approved_1' and is_manager then
      if new.manager_signed_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
    elsif old.status = 'approved_1' and new.status = 'approved_2' and is_acc then
      if new.accountant_signed_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
    elsif new.status = 'rejected' and old.status in ('draft', 'submitted', 'approved_1', 'approved_2') and (is_manager or is_acc) then
      null;
    else
      raise exception 'Không được phép chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  else
    if old.requester_id is distinct from current_employee_id() then
      raise exception 'Không có quyền chỉnh sửa trực tiếp phiếu này ở trạng thái hiện tại.';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists purchase_orders_guard_update on purchase_orders;
create trigger purchase_orders_guard_update
before update on purchase_orders
for each row execute function enforce_purchase_order_transition();

-- =====================================================================
-- LỖI 3 — "Cấp phê duyệt của Chức vụ" (positions.approval_level) không
-- có tác dụng gì — mảnh ghép còn lại của câu hỏi "kết nối phòng ban có
-- chuẩn chỉnh không": rà thấy trang Quản lý chức vụ cho HR chọn hẳn 1 ô
-- "Cấp phê duyệt" (0=Nhân viên/1=Trưởng-phó phòng/2=Ban điều hành/9=Kỹ
-- thuật) cho MỖI chức vụ — nhìn qua tưởng đây là nơi QUYẾT ĐỊNH quyền
-- duyệt của nhân viên giữ chức vụ đó. Nhưng rà toàn bộ hệ thống xác nhận:
-- KHÔNG một luật phân quyền/trigger nào ở bất kỳ đâu đọc cột này cả —
-- quyền duyệt thật sự luôn được quyết định bởi "Vai trò hệ thống"
-- (system_roles, gán riêng cho từng nhân viên ở màn Nhân viên), hoàn toàn
-- độc lập với Chức vụ. Đây không phải lỗi có thể "sửa bằng migration" —
-- là 1 hiểu lầm dễ xảy ra trong vận hành thực tế (HR đổi Cấp phê duyệt
-- của 1 chức vụ, tưởng đã cấp quyền duyệt, thực ra chưa cấp gì cả). Ghi
-- chú lại ở đây để không quên; bản sửa giao diện làm rõ chuyện này nằm
-- trong đợt cập nhật frontend đi kèm.
-- =====================================================================
