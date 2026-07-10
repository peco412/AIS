-- =====================================================================
-- File 38: BO SUNG BUOC "QUAN LY TRUNG TAM DUYET TRUOC" cho Yeu cau
-- truyen thong + Yeu cau CSVC - dung theo yeu cau: "nhan su tai trung tam
-- se yeu cau - quan ly trung tam duyet - truong phong tiep nhan va phan
-- viec" - TRUOC DAY BI BO SOT, tao xong la vao thang phong ban luon.
-- (chay sau file 37)
-- =====================================================================

alter table communication_requests drop constraint if exists communication_requests_status_check;
alter table communication_requests add constraint communication_requests_status_check
  check (status in ('pending', 'center_approved', 'in_progress', 'done', 'rejected'));
alter table communication_requests add column if not exists center_approved_by uuid references employees(id);
alter table communication_requests add column if not exists center_approved_at timestamptz;

alter table facility_requests drop constraint if exists facility_requests_status_check;
alter table facility_requests add constraint facility_requests_status_check
  check (status in ('pending', 'center_approved', 'in_progress', 'done', 'rejected'));
alter table facility_requests add column if not exists center_approved_by uuid references employees(id);
alter table facility_requests add column if not exists center_approved_at timestamptz;
-- LUU Y: truoc day facility_requests co san gia tri 'approved' trong
-- constraint nhung KHONG HE duoc dung o dau ca (code khong tham chieu) -
-- doi han sang 'center_approved' cho dung ngu nghia va nhat quan voi
-- communication_requests.
update facility_requests set status = 'center_approved' where status = 'approved';

-- ---------------------------------------------------------------------
-- PHAT HIEN THEM: 2 policy UPDATE nay hoan toan thieu dieu kien cho
-- CENTER_MANAGER -> khong the thuc hien buoc duyet moi vua them o tren.
-- ---------------------------------------------------------------------
drop policy if exists commreq_update on communication_requests;
create policy commreq_update on communication_requests for update
  using (
    requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='MKT')
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or is_executive_or_tech()
  );

drop policy if exists facreq_update on facility_requests;
create policy facreq_update on facility_requests for update
  using (
    requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='FAC')
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or is_executive_or_tech()
  );
