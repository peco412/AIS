-- =====================================================================
-- File 146: THÔNG BÁO CHO PHỤ HUYNH (19/07/2026)
-- =====================================================================
-- Trước giờ app AISCenter (phụ huynh) KHÔNG có bất kỳ nơi nào để xem
-- thông báo/thông tin từ trung tâm — chỉ có "Chương trình ưu đãi" (thuần
-- về giảm giá). Theo đúng yêu cầu: thêm nơi để nhân viên đăng thông báo
-- (vd nghỉ lễ, sự kiện, lưu ý...) cho phụ huynh xem trong app.
-- =====================================================================
create table if not exists parent_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  center_id uuid references centers(id), -- null = hien cho TOAN HE THONG, khong rieng trung tam nao
  is_active boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_parent_announcements_active on parent_announcements(is_active, center_id);

alter table parent_announcements enable row level security;

-- Phu huynh (bat ky ai dang nhap qua app) xem duoc thong bao dang bat,
-- dung trung tam cua CON MINH hoac thong bao toan he thong.
create policy parent_announcements_select_parent on parent_announcements for select
  using (
    is_active = true
    and (
      center_id is null
      or exists (
        select 1 from parent_student_links psl
        join students s on s.id = psl.student_id
        where psl.parent_account_id = current_parent_id() and s.center_id = parent_announcements.center_id
      )
    )
  );

-- Nhan vien (Truyen thong/Hoc vu/Quan ly trung tam/BDH-Ky thuat) xem
-- TOAN BO (ke ca dang tat) de quan ly, va la nguoi duoc tao/sua/xoa.
create policy parent_announcements_select_staff on parent_announcements for select
  using (
    current_department_id() = (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );

create policy parent_announcements_write on parent_announcements for all
  using (
    current_department_id() = (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );

comment on table parent_announcements is 'Thông báo hiển thị cho phụ huynh trong app AISCenter (không phải giảm giá — xem discount_programs cho phần đó). Xem file 146.';

-- =====================================================================
-- Chan gia mao nguoi dang (created_by lay tu client truoc gio deu bi
-- gia mao duoc) — dung mau da ap dung nhieu lan.
-- =====================================================================
create or replace function parent_announcements_guard_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  new.created_by := current_employee_id();
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists parent_announcements_guard_identity on parent_announcements;
create trigger parent_announcements_guard_identity
before insert or update on parent_announcements
for each row execute function parent_announcements_guard_identity();
