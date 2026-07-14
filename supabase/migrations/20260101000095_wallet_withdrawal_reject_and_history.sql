-- =====================================================================
-- File 95: SUA 2 LOI THAT o "Yeu cau rut Vi":
-- 1) KHONG HE CO cach TU CHOI (reject) o CA 2 buoc (Trung tam xac nhan /
--    Ke toan duyet) — chi co nut "Xac nhan"/"Duyet", khong co nut "Tu
--    choi" nao ca. Neu Trung tam khong dong y, KHONG CO CACH nao dua
--    yeu cau ve trang thai "Tu choi" — no cu nam o "pending" mai mai,
--    Ke toan thay dong nhung KHONG CO GI de bam (chi hien nut khi status
--    = "center_confirmed"), gay "treo" dung nhu nguoi dung mo ta.
-- 2) Truy van danh sach CHI LOC status IN (pending, center_confirmed) —
--    yeu cau da Tu choi/Da hoan BIEN MAT hoan toan khoi man hinh, khong
--    co cach nao xem lai lich su.
-- (chay sau file 94)
-- =====================================================================

alter table wallet_withdrawal_requests add column if not exists reject_reason text;
alter table wallet_withdrawal_requests add column if not exists rejected_by uuid references employees(id);
alter table wallet_withdrawal_requests add column if not exists rejected_at timestamptz;

-- Tu choi duoc o CA 2 buoc (dang 'pending' — Trung tam tu choi, hoac
-- dang 'center_confirmed' — Ke toan tu choi) — dung 1 ham chung, tu
-- kiem tra dung quyen theo dung trang thai hien tai.
create or replace function reject_wallet_withdrawal(p_request_id uuid, p_rejector_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_student_id uuid;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Bắt buộc ghi rõ lý do từ chối.';
  end if;

  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Không tìm thấy yêu cầu này.'; end if;
  if v_req.status not in ('pending', 'center_confirmed') then
    raise exception 'Yêu cầu này đã được xử lý xong rồi (trạng thái hiện tại: %), không thể từ chối nữa.', v_req.status;
  end if;

  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  if v_req.status = 'pending' then
    -- Tu choi o buoc Trung tam — dung nguoi duoc phep xac nhan buoc nay
    -- moi duoc tu choi (Quan ly trung tam/Tu van vien cua dung trung tam
    -- hoc sinh, hoac BDH/Ky thuat).
    if not (
      (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and v_student_id in (select id from students where center_id = current_center_id()))
      or is_executive_or_tech()
    ) then
      raise exception 'Bạn không có quyền từ chối yêu cầu này.';
    end if;
  else
    -- Tu choi o buoc Ke toan — chi Ke toan/BDH.
    if not (
      current_department_id() = (select id from departments where code = 'ACC')
      or is_executive_or_tech()
    ) then
      raise exception 'Bạn không có quyền từ chối yêu cầu này.';
    end if;
  end if;

  update wallet_withdrawal_requests
  set status = 'rejected', reject_reason = p_reason, rejected_by = p_rejector_id, rejected_at = now()
  where id = p_request_id;
end;
$func$;
