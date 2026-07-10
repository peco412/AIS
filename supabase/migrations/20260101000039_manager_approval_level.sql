-- =====================================================================
-- File 39: THEM CAP "QUAN LY TRUC TIEP" CHO 3 MODULE - Don cong tac,
-- Phieu tam ung, Phieu de nghi thanh toan (chay sau file 38)
--
-- Dac ta ghi ro ca 3 cai nay duyet DUNG 3 CAP: quan ly truc tiep -> phong
-- chuyen trach -> ban dieu hanh. Code hien tai chi co 2 cap (Don cong tac
-- con chi co 1 cap!), thieu han buoc quan ly truc tiep dau tien.
-- =====================================================================

alter table business_trips add column if not exists manager_signed_by uuid references employees(id);
alter table business_trips add column if not exists manager_signed_at timestamptz;
alter table business_trips add column if not exists hr_signed_by uuid references employees(id);
alter table business_trips add column if not exists hr_signed_at timestamptz;
-- approved_by/approved_at cu gio dung cho buoc CUOI (Ban dieu hanh) de
-- tuong thich nguoc, khong doi ten tranh vo code cu con cho o dau do.

alter table advance_requests add column if not exists manager_signed_by uuid references employees(id);
alter table advance_requests add column if not exists manager_signed_at timestamptz;

alter table payment_requests add column if not exists manager_signed_by uuid references employees(id);
alter table payment_requests add column if not exists manager_signed_at timestamptz;

-- Ham xac dinh dung "quan ly truc tiep" cua 1 nhan vien: Truong/Pho phong
-- CUNG PHONG BAN neu co phong ban; neu la nhan su tai trung tam (giao
-- vien/tu van/QLTT) khong thuoc phong ban nao thi la Quan ly trung tam
-- cua chinh trung tam do.
create or replace function is_direct_manager_of(p_employee_id uuid)
returns boolean
language plpgsql stable
as $func$
declare
  v_target_dept uuid;
  v_target_center uuid;
begin
  select department_id, center_id into v_target_dept, v_target_center from employees where id = p_employee_id;

  if v_target_dept is not null then
    return current_department_id() = v_target_dept and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY');
  elsif v_target_center is not null then
    return current_center_id() = v_target_center and current_role_code() = 'CENTER_MANAGER';
  end if;
  return false;
end;
$func$;

-- Mo rong 3 policy UPDATE de Quan ly truc tiep duyet duoc buoc moi.
drop policy if exists payment_requests_update on payment_requests;
create policy payment_requests_update on payment_requests for update
  using (
    requester_id = current_employee_id()
    or is_direct_manager_of(requester_id)
    or (current_department_id() = (select id from departments where code='ACC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

drop policy if exists advance_requests_update on advance_requests;
create policy advance_requests_update on advance_requests for update
  using (
    requester_id = current_employee_id()
    or is_direct_manager_of(requester_id)
    or (current_department_id() = (select id from departments where code='ACC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );

drop policy if exists trips_update on business_trips;
create policy trips_update on business_trips for update
  using (
    (employee_id = current_employee_id() and status = 'draft')
    or is_direct_manager_of(employee_id)
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );
