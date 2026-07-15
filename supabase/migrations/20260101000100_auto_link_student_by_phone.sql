-- =====================================================================
-- File 100: TU DONG LIEN KET phu huynh <-> hoc sinh CHI THEO SO DIEN
-- THOAI - khong can phu huynh tu nhap Ho ten + Ngay sinh nhu
-- self_link_student() (file 36) nua. Duoc goi tu bootParentShell() moi
-- lan vao App (dang ky lan dau HOAC dang nhap lai sau nay), nen se tu
-- bat cac hoc sinh MOI duoc them SDT trung khop sau nay, khong chi luc
-- dang ky.
--
-- CANH BAO BAO MAT (xem giai thich them ben ngoai code): buoc xac minh
-- OTP so dien thoai luc dang ky hien dang bi TAT ("Confirm phone" =
-- false theo comment trong register.js) - nghia la so dien thoai trong
-- JWT hien KHONG duoc dam bao la so that su thuoc ve nguoi dang nhap.
-- Neu chi dua vao SDT de tu dong cap quyen xem du lieu hoc sinh, day la
-- lo hong: ai cung co the tu xung so dien thoai cua nguoi khac de duoc
-- tu dong lien ket. KHUYEN NGHI: bat lai "Confirm phone" (OTP that) o
-- Supabase Dashboard truoc khi bat tinh nang nay o production.
-- (chay sau file 36)
-- =====================================================================

create or replace function auto_link_all_students_by_phone()
returns table(linked_count int, linked_students jsonb)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_parent_id uuid;
  v_phone text;
  v_count int := 0;
begin
  v_parent_id := current_parent_id();
  if v_parent_id is null then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  v_phone := auth.jwt() ->> 'phone';
  if v_phone is null or trim(v_phone) = '' then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  -- Lien ket TAT CA hoc sinh co SDT (chinh hoac phu) khop dung SDT dang
  -- nhap luc dang ky - khong yeu cau nhap them Ho ten/Ngay sinh nhu
  -- self_link_student() truoc day. on conflict do nothing de an toan
  -- goi lai nhieu lan (moi lan boot app) ma khong loi trung.
  insert into parent_student_links (parent_account_id, student_id, relationship)
  select v_parent_id, s.id, 'Chưa xác định'
  from students s
  where
    normalize_phone_vn(s.phone) = normalize_phone_vn(v_phone)
    or normalize_phone_vn(s.backup_phone) = normalize_phone_vn(v_phone)
  on conflict (parent_account_id, student_id) do nothing;

  get diagnostics v_count = row_count;

  return query
  select v_count, coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'full_name', s.full_name)), '[]'::jsonb)
  from students s
  join parent_student_links psl on psl.student_id = s.id
  where psl.parent_account_id = v_parent_id
    and (
      normalize_phone_vn(s.phone) = normalize_phone_vn(v_phone)
      or normalize_phone_vn(s.backup_phone) = normalize_phone_vn(v_phone)
    );
end;
$func$;

grant execute on function auto_link_all_students_by_phone() to authenticated;
