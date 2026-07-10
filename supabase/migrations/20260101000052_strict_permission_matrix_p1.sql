-- =====================================================================
-- File 52: AP DUNG DUNG MA TRAN PHAN QUYEN MOI - DOT 1 (nhung dong ro
-- rang nhat: duyet cap cuoi, cham cong tre, phan viec phong ban) - chay
-- sau file 51.
--
-- THAY DOI KIEN TRUC QUAN TRONG: truoc day is_executive_or_tech() la
-- "toan quyen ghi de" dung khap noi. Ma tran moi phan biet ro:
--   - EXECUTIVE (BDH): duoc "A" (duyet/ky) O CAP CUOI CUNG cho cac luong
--     duyet nhieu cap, nhung CHI R (xem) cho da so man hinh nghiep vu
--     hang ngay cua tung phong ban.
--   - TECH (Ky thuat): da so la R (xem) hoac X (khong thay), KHONG con
--     duoc duyet/ky thay o hau het noi - vai tro thuc su la "quan tri
--     he thong/du lieu goc" (Master Data), khong phai "sieu quyen" moi
--     nghiep vu nhu truoc.
-- =====================================================================

-- Ham rieng cho dung NHU CAU "chi Ban dieu hanh, khong tinh Ky thuat" -
-- dung o cac buoc DUYET CAP CUOI CUNG theo dung ma tran.
create or replace function is_executive_strict()
returns boolean
language sql stable
as $$
  select current_role_code() = 'EXECUTIVE';
$$;

-- ---------------------------------------------------------------------
-- 1. Don xin cham cong tre: BDH = X, Ky thuat = X (matran khong cho ca
-- 2 thay/duyet gi ca, CHI DUY NHAT Pho phong Nhan su).
-- ---------------------------------------------------------------------
drop policy if exists late_clockin_update on late_clockin_requests;
create policy late_clockin_update on late_clockin_requests for update
  using (
    current_department_id() = (select id from departments where code='HR') and current_role_code() = 'DEPT_DEPUTY'
  );

-- ---------------------------------------------------------------------
-- 2. Duyet Don xin nghi / Don cong tac CAP 3 (BDH) - chi EXECUTIVE, khong
-- tinh TECH nua (truoc day dung is_executive_or_tech()). Sua dung policy
-- UPDATE (quyen duyet that su) - khong phai policy SELECT (chi anh huong
-- quyen xem).
-- ---------------------------------------------------------------------
drop policy if exists leave_update on leave_requests;
create policy leave_update on leave_requests for update
  using (
    (employee_id = current_employee_id() and status = 'draft')
    or is_direct_manager_of(employee_id)
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_strict()
  );

-- ---------------------------------------------------------------------
-- 3. Duyet Phieu tam ung / De nghi thanh toan CAP 3 (BDH) - chi EXECUTIVE.
-- ---------------------------------------------------------------------
drop policy if exists advance_requests_update on advance_requests;
create policy advance_requests_update on advance_requests for update
  using (
    requester_id = current_employee_id()
    or is_direct_manager_of(requester_id)
    or (current_department_id() = (select id from departments where code='ACC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_strict()
  );

drop policy if exists payment_requests_update on payment_requests;
create policy payment_requests_update on payment_requests for update
  using (
    requester_id = current_employee_id()
    or is_direct_manager_of(requester_id)
    or (current_department_id() = (select id from departments where code='ACC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_strict()
  );

drop policy if exists trips_update on business_trips;
create policy trips_update on business_trips for update
  using (
    (employee_id = current_employee_id() and status = 'draft')
    or is_direct_manager_of(employee_id)
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_strict()
  );

-- ---------------------------------------------------------------------
-- 4. Tiep nhan & Phan viec Yeu cau Truyen thong / CSVC: BDH = X, Ky thuat
-- = X (matran khong cho ca 2 thay - CHI DUNG Truong/Pho phong tuong ung
-- moi duoc xu ly, khong co override).
-- ---------------------------------------------------------------------
drop policy if exists commreq_update on communication_requests;
create policy commreq_update on communication_requests for update
  using (
    requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='MKT')
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
  );

drop policy if exists facreq_update on facility_requests;
create policy facreq_update on facility_requests for update
  using (
    requester_id = current_employee_id()
    or current_department_id() = (select id from departments where code='FAC')
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
  );
