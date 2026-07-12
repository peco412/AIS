-- =====================================================================
-- File 71 (SUA LAI CHO DUNG): CONG CU BACKUP/KHAC PHUC SU CO nap vi -
-- 2 phan:
-- A) Xu ly lai yeu cau bi ket (dang "cho xu ly" qua lau, hoac "tu choi
--    nham" nhung xac minh lai la tien da ve that) - dung LAI co che khoa
--    dong (FOR UPDATE) + kiem tra trang thai co san, dam bao KHONG THE
--    cong trung du bam nhieu lan.
-- B) Nap thu cong khong qua yeu cau nao (su kien tien mat, hoac khong
--    tim thay yeu cau goc) - bat buoc ghi ro ly do de audit.
--
-- QUAN TRONG - LOI TU SUA PHAT HIEN LUC VIET: ban dau nham lay ham
-- topup_wallet() 4 tham so (tu file 24 - da CU) lam goc de sua, trong
-- khi ham THAT DANG CHAY la ban 6 tham so o file 31 (co them giam gia
-- theo truong hop + case_discount_note) - neu chay nham se XOA MAT logic
-- giam gia theo truong hop dang dung that. Da doi lai dung goc 6 tham so.
-- (chay sau file 70)
-- =====================================================================

-- Xoa dung chu ky DANG CHAY THAT (6 tham so, tu file 31) truoc khi thay,
-- tranh Postgres hieu nham thanh ham chong lap.
drop function if exists topup_wallet(uuid, numeric, text, uuid, numeric, text);

create or replace function topup_wallet(
  p_student_id uuid, p_coin_amount numeric, p_method text, p_created_by uuid default null,
  p_case_discount_rate numeric default 0, p_case_discount_note text default null,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_wallet_id uuid;
  v_center_id uuid;
  v_calc record;
  v_batch_id uuid;
  v_note text;
begin
  if p_created_by is null then
    if not is_linked_to_student(p_student_id) then
      raise exception 'Ban khong co quyen nap vi cho hoc sinh nay.';
    end if;
    if p_case_discount_rate > 0 then
      raise exception 'Giam gia theo truong hop chi Ke toan/Quan ly trung tam duoc ap dung.';
    end if;
  else
    if not (
      current_department_id() = (select id from departments where code = 'ACC')
      or (current_role_code() = 'CENTER_MANAGER' and p_student_id in (select id from students where center_id = current_center_id()))
      or is_executive_or_tech()
    ) then
      raise exception 'Ban khong co quyen ghi nhan nap vi ho hoc sinh nay.';
    end if;
    -- Nap ho tai quay (khong qua 1 yeu cau QR co san) BAT BUOC phai ghi
    -- ro ly do — cong cu nay dung de "backup" khi co su co, can audit
    -- chat de doi chieu duoc sau nay neu co tranh chap.
    if p_reason is null or trim(p_reason) = '' then
      raise exception 'Bat buoc ghi ro ly do khi nap vi ho tai quay (vd "Thu tien mat tai su kien khai giang 20/8").';
    end if;
  end if;

  select id into v_wallet_id from wallets where student_id = p_student_id;
  if v_wallet_id is null then
    insert into wallets (student_id) values (p_student_id) returning id into v_wallet_id;
  end if;

  select center_id into v_center_id from students where id = p_student_id;
  select * into v_calc from calculate_topup_conversion(p_coin_amount, v_center_id, p_case_discount_rate);

  insert into wallet_topup_batches (
    wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate,
    applied_program_id, amount_vnd_paid, method, created_by, case_discount_note
  ) values (
    v_wallet_id, p_coin_amount, p_coin_amount, v_calc.discount_rate, v_calc.conversion_rate,
    v_calc.program_id, p_coin_amount * v_calc.conversion_rate, p_method, p_created_by, p_case_discount_note
  ) returning id into v_batch_id;

  v_note := format('Nạp ví %s AIScoins (chiết khấu tổng %s%%)', p_coin_amount, v_calc.discount_rate * 100);
  if p_reason is not null then
    v_note := v_note || ' — Lý do: ' || p_reason;
  end if;
  perform append_financial_log('WALLET', p_coin_amount * v_calc.conversion_rate, null, p_created_by, v_wallet_id, p_student_id, v_note);

  return v_batch_id;
end;
$func$;

-- Phan A: xu ly lai yeu cau bi TU CHOI NHAM (confirm_topup_request goc
-- chi cho phep tu trang thai 'pending', khong xu ly duoc 'rejected' —
-- ham nay mo rong them cho dung truong hop do). Dung CHUNG co che khoa
-- dong FOR UPDATE + kiem tra trang thai y het ham goc, dam bao an toan
-- tuyet doi khong cong trung du bam lai nhieu lan.
create or replace function reprocess_rejected_topup(p_request_id uuid, p_approver_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req wallet_topup_requests%rowtype;
  v_student_id uuid;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or is_executive_or_tech()
  ) then
    raise exception 'Chi Ke toan/Ban dieu hanh moi duoc xu ly lai yeu cau da tu choi.';
  end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'rejected' then
    raise exception 'Chi xu ly lai duoc yeu cau dang o trang thai "Da tu choi". Yeu cau nay hien dang: %', v_req.status;
  end if;

  select student_id into v_student_id from wallets where id = v_req.wallet_id;
  perform topup_wallet(v_student_id, v_req.coin_amount, 'bank_transfer', p_approver_id, 0, null,
    coalesce(p_note, 'Xử lý lại yêu cầu đã từ chối nhầm trước đó — đã xác minh tiền đã về'));

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
end;
$func$;
