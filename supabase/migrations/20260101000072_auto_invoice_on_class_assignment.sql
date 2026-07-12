-- =====================================================================
-- File 72: TU DONG TAO HOA DON theo TRON CAP DO CON ngay khi 1 hoc vien
-- CHINH THUC (khong phai hoc thu) duoc xep/doi lop - thay vi phai vao
-- Thu hoc phi go ten tay roi tao hoa don rieng nhu truoc.
--
-- Chi ap dung cho hoc sinh dang "studying" (khong ap dung "trial" - hoc
-- sinh hoc thu da co co che rieng bo qua tao hoa don tu migration 40).
-- Chi kich hoat khi class_id THUC SU DOI (lan dau xep hoac chuyen lop
-- khac), khong chay lai khi cap nhat cac truong khac cua hoc sinh.
--
-- Neu tao hoa don loi (vd gia CHUA CAU HINH cho cap do con do) - KHONG
-- chan viec xep lop lai (hoc sinh van duoc xep lop binh thuong), chi ghi
-- canh bao vao notifications de Quan ly trung tam biet ma tu tao hoa don
-- tay bu vao sau.
-- (chay sau file 71)
-- =====================================================================
create or replace function trg_auto_invoice_on_class_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_sublevel_id uuid;
  v_center_manager_id uuid;
begin
  -- Chi chay khi class_id THUC SU thay doi (khac gia tri cu, va co gia
  -- tri moi) va hoc sinh dang hoc chinh thuc (khong phai hoc thu).
  if new.class_id is distinct from old.class_id and new.class_id is not null and new.status = 'studying' then
    select sublevel_id into v_sublevel_id from classes where id = new.class_id;

    if v_sublevel_id is not null then
      begin
        perform create_payment_plan_invoice(new.id, 'sublevel', v_sublevel_id);
      exception when others then
        -- Khong chan viec xep lop neu tao hoa don loi (vd chua cau hinh
        -- gia) - chi bao cho Quan ly trung tam cua dung trung tam hoc
        -- sinh nay biet de tu xu ly tay.
        select e.id into v_center_manager_id
        from employees e
        join system_roles sr on sr.id = e.role_id
        where sr.code = 'CENTER_MANAGER' and e.center_id = new.center_id
        limit 1;

        if v_center_manager_id is not null then
          insert into notifications (scope, title, content, target_employee_id, created_by, created_at)
          values (
            'personal',
            '⚠️ Không tự tạo được hoá đơn khi xếp lớp',
            format('Học sinh "%s" vừa được xếp lớp nhưng hệ thống KHÔNG tự tạo được hoá đơn trọn cấp độ con (lỗi: %s). Vui lòng vào Thu học phí để tạo hoá đơn thủ công.', new.full_name, SQLERRM),
            v_center_manager_id, coalesce(current_employee_id(), v_center_manager_id), now()
          );
        end if;
      end;
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists auto_invoice_on_class_assignment on students;
create trigger auto_invoice_on_class_assignment
after update of class_id on students
for each row execute function trg_auto_invoice_on_class_assignment();
