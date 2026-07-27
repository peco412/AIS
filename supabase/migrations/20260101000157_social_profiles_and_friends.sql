-- =====================================================================
-- File 157: HO SO MANG XA HOI RIENG + KET BAN (27/07/2026)
-- =====================================================================
-- LOI THAT da tim ra: bang parent_accounts chi cho phep xem TEN cua
-- CHINH MINH (hoac BDH/Ke toan/QLTT) — thiet ke DUNG cho nghiep vu ERP
-- (bao ve thong tin phu huynh), nhung lai khien TEN NGUOI DANG BAI/
-- NHAN TIN trong Cong dong bi AN DI voi hau het nguoi xem khac (hien ra
-- "Người dùng" chung chung, giong nhu an danh). Khong nen NOI LONG
-- thang RLS cua parent_accounts (anh huong toi rieng tu trong toan bo
-- ERP) — thay vao do tao 1 bang HO SO MANG XA HOI RIENG, tach biet,
-- CHI chua thong tin NGUOI DUNG TU NGUYEN cong khai (ten hien thi,
-- avatar) — mo doc cho tat ca, dung cho DUNG muc dich "mang xa hoi".
-- =====================================================================

create table if not exists social_profiles (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid references parent_accounts(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_profiles_owner_check check (
    (parent_account_id is not null and employee_id is null)
    or (parent_account_id is null and employee_id is not null)
  )
);
create unique index social_profiles_parent_uniq on social_profiles(parent_account_id) where parent_account_id is not null;
create unique index social_profiles_employee_uniq on social_profiles(employee_id) where employee_id is not null;

alter table social_profiles enable row level security;

-- Ho so mang xa hoi la thong tin TU NGUYEN CONG KHAI (dung dinh nghia
-- mang xa hoi) — ai dang nhap (phu huynh hoac nhan vien) cung xem
-- duoc het, khong gioi han nhu bang goc.
create policy social_profiles_select on social_profiles for select
  using (current_parent_id() is not null or current_employee_id() is not null);

create policy social_profiles_insert on social_profiles for insert
  with check (
    (parent_account_id is not null and parent_account_id = current_parent_id())
    or (employee_id is not null and employee_id = current_employee_id())
  );

create policy social_profiles_update on social_profiles for update
  using (
    (parent_account_id is not null and parent_account_id = current_parent_id())
    or (employee_id is not null and employee_id = current_employee_id())
  );

-- MOI — ham lay-hoac-tao ho so mang xa hoi: goi 1 lan duy nhat khi
-- nguoi dung vao Cong dong/Tin nhan lan dau, tu dong tao ban ghi ban
-- dau (sao chep ten that lam ten hien thi mac dinh, nguoi dung co the
-- doi lai sau), tranh JOIN ra NULL truoc khi ho so ton tai.
create or replace function ensure_social_profile() returns social_profiles
language plpgsql security definer set search_path = public as $$
declare
  v_parent_id uuid := current_parent_id();
  v_employee_id uuid := current_employee_id();
  v_result social_profiles;
  v_name text;
begin
  if v_parent_id is not null then
    select * into v_result from social_profiles where parent_account_id = v_parent_id;
    if v_result.id is not null then return v_result; end if;
    select full_name into v_name from parent_accounts where id = v_parent_id;
    insert into social_profiles (parent_account_id, display_name) values (v_parent_id, coalesce(v_name, 'Phụ huynh'))
    returning * into v_result;
    return v_result;
  elsif v_employee_id is not null then
    select * into v_result from social_profiles where employee_id = v_employee_id;
    if v_result.id is not null then return v_result; end if;
    select full_name into v_name from employees where id = v_employee_id;
    insert into social_profiles (employee_id, display_name) values (v_employee_id, coalesce(v_name, 'Nhân viên'))
    returning * into v_result;
    return v_result;
  else
    raise exception 'Không xác định được danh tính người dùng hiện tại.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- KET BAN — gui loi moi, chap nhan/tu choi, danh sach ban be.
-- ---------------------------------------------------------------------
create table if not exists social_friendships (
  id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null references social_profiles(id) on delete cascade,
  addressee_profile_id uuid not null references social_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint social_friendships_no_self check (requester_profile_id <> addressee_profile_id),
  unique (requester_profile_id, addressee_profile_id)
);

alter table social_friendships enable row level security;

create policy social_friendships_select on social_friendships for select
  using (
    exists (select 1 from social_profiles sp where sp.id = requester_profile_id and (
      (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
      or (sp.employee_id is not null and sp.employee_id = current_employee_id())
    ))
    or exists (select 1 from social_profiles sp where sp.id = addressee_profile_id and (
      (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
      or (sp.employee_id is not null and sp.employee_id = current_employee_id())
    ))
  );

create policy social_friendships_insert on social_friendships for insert
  with check (
    exists (select 1 from social_profiles sp where sp.id = requester_profile_id and (
      (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
      or (sp.employee_id is not null and sp.employee_id = current_employee_id())
    ))
  );

create policy social_friendships_update on social_friendships for update
  using (
    exists (select 1 from social_profiles sp where sp.id = addressee_profile_id and (
      (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
      or (sp.employee_id is not null and sp.employee_id = current_employee_id())
    ))
  );

create policy social_friendships_delete on social_friendships for delete
  using (
    exists (select 1 from social_profiles sp where sp.id = requester_profile_id and (
      (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
      or (sp.employee_id is not null and sp.employee_id = current_employee_id())
    ))
    or exists (select 1 from social_profiles sp where sp.id = addressee_profile_id and (
      (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
      or (sp.employee_id is not null and sp.employee_id = current_employee_id())
    ))
  );

-- ---------------------------------------------------------------------
-- STORAGE — cho phep tai avatar len chung bucket social-media da co,
-- trong thu muc rieng "avatars/".
-- ---------------------------------------------------------------------
-- (khong can policy rieng — bucket social-media da mo doc + cho dang
-- nhap upload tu truoc, avatar chi la 1 thu muc con trong do)
