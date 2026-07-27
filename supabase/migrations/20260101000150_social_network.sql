-- =====================================================================
-- File 150: MANG XA HOI NOI BO — dang anh/trang thai + nhan tin, dung
-- chung cho PHU HUYNH va NHAN VIEN (27/07/2026)
-- =====================================================================
-- Pham vi: bai dang (anh + chu thich), like, binh luan — gioi han theo
-- TUNG TRUNG TAM (rieng tu, giong 1 "cong dong" cua trung tam do, khong
-- phai mang xa hoi cong khai toan he thong). Nhan tin truc tiep 1-1
-- hoac nhom giua bat ky ai (phu huynh <-> nhan vien, phu huynh <-> phu
-- huynh, nhan vien <-> nhan vien) khong gioi han theo trung tam (vi la
-- rieng tu giua nhung nguoi tham gia).
--
-- 1 nguoi dang bai/binh luan/nhan tin CHI co the la 1 TRONG 2: phu
-- huynh (parent_accounts) HOAC nhan vien (employees) — dung 2 cot khoa
-- ngoai NULLABLE + rang buoc CHECK dam bao dung 1 trong 2 duoc dien,
-- thay vi lam 1 bang "profiles" chung moi (tranh dao lon du lieu goc).
-- =====================================================================

-- ---------------------------------------------------------------------
-- HAM HELPER
-- ---------------------------------------------------------------------
create or replace function can_see_center_social(p_center_id uuid) returns boolean
language sql stable security definer as $$
  select
    (current_employee_id() is not null and (current_center_id() = p_center_id or sees_all_centers()))
    or
    (current_parent_id() is not null and exists (
      select 1 from parent_student_links psl join students s on s.id = psl.student_id
      where psl.parent_account_id = current_parent_id() and s.center_id = p_center_id
    ));
$$;

-- MOI — is_conversation_participant() chuyen xuong duoi, SAU khi da tao
-- xong bang social_conversation_participants — dat truoc do gay loi that
-- "relation does not exist" vi ham nay tham chieu toi 1 bang CHUA duoc
-- tao trong cung file (PostgreSQL kiem tra su ton tai bang ngay luc
-- TAO HAM ngon ngu SQL, khac voi PL/pgSQL).

-- ---------------------------------------------------------------------
-- BAI DANG
-- ---------------------------------------------------------------------
create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  author_parent_id uuid references parent_accounts(id) on delete set null,
  author_employee_id uuid references employees(id) on delete set null,
  caption text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_posts_author_check check (
    (author_parent_id is not null and author_employee_id is null)
    or (author_parent_id is null and author_employee_id is not null)
  ),
  constraint social_posts_has_content check (caption is not null or image_url is not null)
);
create index idx_social_posts_center on social_posts(center_id, created_at desc);

create table if not exists social_post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references social_posts(id) on delete cascade,
  liker_parent_id uuid references parent_accounts(id) on delete cascade,
  liker_employee_id uuid references employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint social_post_likes_liker_check check (
    (liker_parent_id is not null and liker_employee_id is null)
    or (liker_parent_id is null and liker_employee_id is not null)
  )
);
create unique index social_post_likes_parent_uniq on social_post_likes(post_id, liker_parent_id) where liker_parent_id is not null;
create unique index social_post_likes_employee_uniq on social_post_likes(post_id, liker_employee_id) where liker_employee_id is not null;

create table if not exists social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references social_posts(id) on delete cascade,
  author_parent_id uuid references parent_accounts(id) on delete set null,
  author_employee_id uuid references employees(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint social_comments_author_check check (
    (author_parent_id is not null and author_employee_id is null)
    or (author_parent_id is null and author_employee_id is not null)
  )
);
create index idx_social_comments_post on social_comments(post_id, created_at);

-- ---------------------------------------------------------------------
-- NHAN TIN TRUC TIEP
-- ---------------------------------------------------------------------
create table if not exists social_conversations (
  id uuid primary key default gen_random_uuid(),
  title text, -- ten rieng cho nhom (null = tu dong hien ten nguoi con lai, danh cho 1-1)
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists social_conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references social_conversations(id) on delete cascade,
  participant_parent_id uuid references parent_accounts(id) on delete cascade,
  participant_employee_id uuid references employees(id) on delete cascade,
  joined_at timestamptz not null default now(),
  constraint social_conv_participant_check check (
    (participant_parent_id is not null and participant_employee_id is null)
    or (participant_parent_id is null and participant_employee_id is not null)
  )
);
create unique index social_conv_part_parent_uniq on social_conversation_participants(conversation_id, participant_parent_id) where participant_parent_id is not null;
create unique index social_conv_part_employee_uniq on social_conversation_participants(conversation_id, participant_employee_id) where participant_employee_id is not null;

create table if not exists social_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references social_conversations(id) on delete cascade,
  sender_parent_id uuid references parent_accounts(id) on delete set null,
  sender_employee_id uuid references employees(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint social_messages_sender_check check (
    (sender_parent_id is not null and sender_employee_id is null)
    or (sender_parent_id is null and sender_employee_id is not null)
  )
);
create index idx_social_messages_conv on social_messages(conversation_id, created_at);

-- Tu dong cap nhat last_message_at moi khi co tin nhan moi, de sap xep
-- danh sach hoi thoai theo hoat dong gan nhat.
create or replace function touch_conversation_last_message() returns trigger
language plpgsql as $$
begin
  update social_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists trg_touch_conversation on social_messages;
create trigger trg_touch_conversation after insert on social_messages
  for each row execute function touch_conversation_last_message();

-- MOI — chuyen ham nay xuong DAY (sau khi bang social_conversation_
-- participants da ton tai) de sua loi "relation does not exist".
create or replace function is_conversation_participant(p_conversation_id uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from social_conversation_participants scp
    where scp.conversation_id = p_conversation_id
    and (
      (current_parent_id() is not null and scp.participant_parent_id = current_parent_id())
      or (current_employee_id() is not null and scp.participant_employee_id = current_employee_id())
    )
  );
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table social_posts enable row level security;
alter table social_post_likes enable row level security;
alter table social_comments enable row level security;
alter table social_conversations enable row level security;
alter table social_conversation_participants enable row level security;
alter table social_messages enable row level security;

create policy social_posts_select on social_posts for select
  using (can_see_center_social(center_id));
create policy social_posts_insert on social_posts for insert
  with check (
    can_see_center_social(center_id)
    and (
      (author_parent_id is not null and author_parent_id = current_parent_id())
      or (author_employee_id is not null and author_employee_id = current_employee_id())
    )
  );
create policy social_posts_delete on social_posts for delete
  using (
    (author_parent_id is not null and author_parent_id = current_parent_id())
    or (author_employee_id is not null and author_employee_id = current_employee_id())
    or is_executive_or_tech() -- kiem duyet: BDH/Tech xoa duoc bai vi pham
  );

create policy social_post_likes_select on social_post_likes for select
  using (exists (select 1 from social_posts p where p.id = post_id and can_see_center_social(p.center_id)));
create policy social_post_likes_insert on social_post_likes for insert
  with check (
    exists (select 1 from social_posts p where p.id = post_id and can_see_center_social(p.center_id))
    and (
      (liker_parent_id is not null and liker_parent_id = current_parent_id())
      or (liker_employee_id is not null and liker_employee_id = current_employee_id())
    )
  );
create policy social_post_likes_delete on social_post_likes for delete
  using (
    (liker_parent_id is not null and liker_parent_id = current_parent_id())
    or (liker_employee_id is not null and liker_employee_id = current_employee_id())
  );

create policy social_comments_select on social_comments for select
  using (exists (select 1 from social_posts p where p.id = post_id and can_see_center_social(p.center_id)));
create policy social_comments_insert on social_comments for insert
  with check (
    exists (select 1 from social_posts p where p.id = post_id and can_see_center_social(p.center_id))
    and (
      (author_parent_id is not null and author_parent_id = current_parent_id())
      or (author_employee_id is not null and author_employee_id = current_employee_id())
    )
  );
create policy social_comments_delete on social_comments for delete
  using (
    (author_parent_id is not null and author_parent_id = current_parent_id())
    or (author_employee_id is not null and author_employee_id = current_employee_id())
    or is_executive_or_tech()
  );

create policy social_conversations_select on social_conversations for select
  using (is_conversation_participant(id));
create policy social_conversations_insert on social_conversations for insert
  with check (current_parent_id() is not null or current_employee_id() is not null);

create policy social_conv_participants_select on social_conversation_participants for select
  using (is_conversation_participant(conversation_id));
create policy social_conv_participants_insert on social_conversation_participants for insert
  with check (
    -- chi tao duoc dong tham gia cho hoi thoai VUA tu minh tao (ngay
    -- sau insert conversations o tren) hoac hoi thoai minh da la thanh
    -- vien — tranh bi nguoi la tu y them minh vao 1 hoi thoai bat ky.
    is_conversation_participant(conversation_id)
    or not exists (select 1 from social_conversation_participants x where x.conversation_id = conversation_id)
  );

create policy social_messages_select on social_messages for select
  using (is_conversation_participant(conversation_id));
create policy social_messages_insert on social_messages for insert
  with check (
    is_conversation_participant(conversation_id)
    and (
      (sender_parent_id is not null and sender_parent_id = current_parent_id())
      or (sender_employee_id is not null and sender_employee_id = current_employee_id())
    )
  );

-- ---------------------------------------------------------------------
-- STORAGE — bucket rieng cho anh dang bai (cong khai xem, chi nguoi
-- dang nhap moi upload duoc)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('social-media', 'social-media', true)
on conflict (id) do nothing;

drop policy if exists social_media_public_read on storage.objects;
create policy social_media_public_read on storage.objects for select
  using (bucket_id = 'social-media');

drop policy if exists social_media_auth_upload on storage.objects;
create policy social_media_auth_upload on storage.objects for insert
  with check (
    bucket_id = 'social-media'
    and (current_parent_id() is not null or current_employee_id() is not null)
  );

drop policy if exists social_media_own_delete on storage.objects;
create policy social_media_own_delete on storage.objects for delete
  using (bucket_id = 'social-media' and owner = auth.uid());
