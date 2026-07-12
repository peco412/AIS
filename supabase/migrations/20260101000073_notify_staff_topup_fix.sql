-- =====================================================================
-- File 73: SUA LOI THAT - phu huynh gui thong bao cho nhan vien khi tao
-- yeu cau nap vi dang INSERT SAI cot (dung "url" - khong ton tai tren
-- bang notifications, cot dung la "attachment_url") va THIEU cot bat
-- buoc "created_by" (NOT NULL references employees - phu huynh khong
-- phai nhan vien nen khong co gia tri hop le). Loi nay bi NUOT AM THAM
-- (chi log console.warn), khien Ke toan KHONG BAO GIO nhan duoc thong
-- bao co yeu cau nap vi moi can doi chieu.
--
-- Sua bang 1 ham SECURITY DEFINER rieng, chay voi quyen he thong de tu
-- dien created_by hop le, thay vi de client insert truc tiep.
-- (chay sau file 72)
-- =====================================================================
create or replace function notify_staff_new_topup_request(p_request_id uuid, p_center_id uuid, p_vnd_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_transfer_content text;
  v_acc_dept_id uuid;
  v_system_employee_id uuid;
  v_staff record;
begin
  select transfer_content into v_transfer_content from wallet_topup_requests where id = p_request_id;
  select id into v_acc_dept_id from departments where code = 'ACC';

  -- Dung tam 1 nhan vien Ke toan bat ky lam "nguoi tao" thong bao he
  -- thong (created_by bat buoc phai la employees.id hop le) - khong anh
  -- huong noi dung/nguoi nhan thong bao, chi la truong bat buoc ve mat
  -- du lieu.
  select id into v_system_employee_id from employees where department_id = v_acc_dept_id limit 1;
  if v_system_employee_id is null then return; end if; -- khong co ai de gan, bo qua an toan

  for v_staff in
    select id from employees where department_id = v_acc_dept_id or center_id = p_center_id
  loop
    insert into notifications (scope, title, content, target_employee_id, created_by)
    values (
      'personal',
      format('💰 Yêu cầu nạp ví mới — %s', v_transfer_content),
      format('Cần đối chiếu chuyển khoản %s VNĐ, nội dung "%s".', to_char(p_vnd_amount, 'FM999,999,999'), v_transfer_content),
      v_staff.id, v_system_employee_id
    );
  end loop;
end;
$func$;

grant execute on function notify_staff_new_topup_request(uuid, uuid, numeric) to authenticated;
