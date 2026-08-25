-- =======================================================================
-- MẠNG XÃ HỘI ĐẦY ĐỦ TÍNH NĂNG — bổ sung schema (24/08/2026)
-- -----------------------------------------------------------------------
-- Thêm: (1) thông báo hoạt động, (2) nhiều ảnh/video 1 bài, (3) bình
-- luận trả lời lồng nhau, (4) chia sẻ lại bài viết, (5) huỷ kết bạn
-- (không cần schema, chỉ cần RPC/UI — policy delete đã có sẵn từ trước),
-- (6) báo cáo vi phạm, (7) chặn người dùng, (8) tìm kiếm bài viết (không
-- cần schema, query .ilike() phía client).
-- =======================================================================

-- -----------------------------------------------------------------------
-- 1) THÔNG BÁO HOẠT ĐỘNG
-- -----------------------------------------------------------------------
create table if not exists social_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references social_profiles(id) on delete cascade,
  actor_profile_id uuid references social_profiles(id) on delete set null,
  type text not null check (type in ('like', 'comment', 'reply', 'friend_request', 'friend_accept', 'share')),
  post_id uuid references social_posts(id) on delete cascade,
  comment_id uuid references social_comments(id) on delete cascade,
  friendship_id uuid references social_friendships(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_social_notif_recipient on social_notifications(recipient_profile_id, created_at desc);

alter table social_notifications enable row level security;
create policy social_notifications_select on social_notifications for select
  using (exists (select 1 from social_profiles sp where sp.id = recipient_profile_id and (
    (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
    or (sp.employee_id is not null and sp.employee_id = current_employee_id())
  )));
create policy social_notifications_update on social_notifications for update
  using (exists (select 1 from social_profiles sp where sp.id = recipient_profile_id and (
    (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
    or (sp.employee_id is not null and sp.employee_id = current_employee_id())
  )));
-- KHÔNG có policy insert cho client — chỉ tạo qua trigger SECURITY DEFINER
-- bên dưới, tránh spam thông báo giả cho người khác.

-- Tự tạo thông báo khi có lượt thích mới (bỏ qua nếu tự thích bài của
-- chính mình).
create or replace function notify_on_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_liker_profile_id uuid;
  v_post_author_profile_id uuid;
begin
  select id into v_liker_profile_id from social_profiles
    where (new.liker_parent_id is not null and parent_account_id = new.liker_parent_id)
       or (new.liker_employee_id is not null and employee_id = new.liker_employee_id);
  select sp.id into v_post_author_profile_id from social_posts p
    join social_profiles sp on (p.author_parent_id is not null and sp.parent_account_id = p.author_parent_id)
                             or (p.author_employee_id is not null and sp.employee_id = p.author_employee_id)
    where p.id = new.post_id;
  if v_post_author_profile_id is not null and v_post_author_profile_id <> v_liker_profile_id then
    insert into social_notifications (recipient_profile_id, actor_profile_id, type, post_id)
    values (v_post_author_profile_id, v_liker_profile_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_on_like on social_post_likes;
create trigger trg_notify_on_like after insert on social_post_likes
for each row execute function notify_on_like();

-- Tự tạo thông báo khi có bình luận mới — báo cho tác giả bài viết, và
-- nếu là TRẢ LỜI 1 bình luận khác thì báo thêm cho tác giả bình luận gốc.
create or replace function notify_on_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_commenter_profile_id uuid;
  v_post_author_profile_id uuid;
  v_parent_comment_author_profile_id uuid;
begin
  select id into v_commenter_profile_id from social_profiles
    where (new.author_parent_id is not null and parent_account_id = new.author_parent_id)
       or (new.author_employee_id is not null and employee_id = new.author_employee_id);

  select sp.id into v_post_author_profile_id from social_posts p
    join social_profiles sp on (p.author_parent_id is not null and sp.parent_account_id = p.author_parent_id)
                             or (p.author_employee_id is not null and sp.employee_id = p.author_employee_id)
    where p.id = new.post_id;
  if v_post_author_profile_id is not null and v_post_author_profile_id <> v_commenter_profile_id then
    insert into social_notifications (recipient_profile_id, actor_profile_id, type, post_id, comment_id)
    values (v_post_author_profile_id, v_commenter_profile_id, 'comment', new.post_id, new.id);
  end if;

  if new.parent_comment_id is not null then
    select sp.id into v_parent_comment_author_profile_id from social_comments c
      join social_profiles sp on (c.author_parent_id is not null and sp.parent_account_id = c.author_parent_id)
                               or (c.author_employee_id is not null and sp.employee_id = c.author_employee_id)
      where c.id = new.parent_comment_id;
    if v_parent_comment_author_profile_id is not null
       and v_parent_comment_author_profile_id <> v_commenter_profile_id
       and v_parent_comment_author_profile_id <> v_post_author_profile_id then
      insert into social_notifications (recipient_profile_id, actor_profile_id, type, post_id, comment_id)
      values (v_parent_comment_author_profile_id, v_commenter_profile_id, 'reply', new.post_id, new.id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_on_comment on social_comments;
create trigger trg_notify_on_comment after insert on social_comments
for each row execute function notify_on_comment();

-- Tự tạo thông báo khi gửi lời mời kết bạn + khi được chấp nhận.
create or replace function notify_on_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into social_notifications (recipient_profile_id, actor_profile_id, type, friendship_id)
    values (new.addressee_profile_id, new.requester_profile_id, 'friend_request', new.id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    insert into social_notifications (recipient_profile_id, actor_profile_id, type, friendship_id)
    values (new.requester_profile_id, new.addressee_profile_id, 'friend_accept', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_on_friendship on social_friendships;
create trigger trg_notify_on_friendship after insert or update on social_friendships
for each row execute function notify_on_friendship();

-- Số thông báo chưa đọc + đánh dấu đã đọc hết — dùng chung 1 hàm cho cả
-- app AISCenter (khác với unread_notification_count() bên AIS OFFICE,
-- vốn đọc bảng "notifications" — hệ thống khác hoàn toàn).
create or replace function unread_social_notification_count() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid := (select id from social_profiles where
    (parent_account_id is not null and parent_account_id = current_parent_id())
    or (employee_id is not null and employee_id = current_employee_id()));
  v_count int;
begin
  if v_profile_id is null then return 0; end if;
  select count(*) into v_count from social_notifications where recipient_profile_id = v_profile_id and is_read = false;
  return v_count;
end;
$$;

create or replace function mark_all_social_notifications_read() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid := (select id from social_profiles where
    (parent_account_id is not null and parent_account_id = current_parent_id())
    or (employee_id is not null and employee_id = current_employee_id()));
begin
  if v_profile_id is null then return; end if;
  update social_notifications set is_read = true where recipient_profile_id = v_profile_id and is_read = false;
end;
$$;

-- -----------------------------------------------------------------------
-- 2) NHIỀU ẢNH/VIDEO 1 BÀI ĐĂNG
-- -----------------------------------------------------------------------
create table if not exists social_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references social_posts(id) on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  sort_order int not null default 0
);
create index idx_social_post_media_post on social_post_media(post_id, sort_order);

alter table social_post_media enable row level security;
create policy social_post_media_select on social_post_media for select
  using (current_parent_id() is not null or current_employee_id() is not null);
create policy social_post_media_insert on social_post_media for insert
  with check (exists (
    select 1 from social_posts p where p.id = post_id and (
      (p.author_parent_id is not null and p.author_parent_id = current_parent_id())
      or (p.author_employee_id is not null and p.author_employee_id = current_employee_id())
    )
  ));
create policy social_post_media_delete on social_post_media for delete
  using (exists (
    select 1 from social_posts p where p.id = post_id and (
      (p.author_parent_id is not null and p.author_parent_id = current_parent_id())
      or (p.author_employee_id is not null and p.author_employee_id = current_employee_id())
    )
  ));

-- -----------------------------------------------------------------------
-- 3) BÌNH LUẬN TRẢ LỜI LỒNG NHAU
-- -----------------------------------------------------------------------
alter table social_comments add column if not exists parent_comment_id uuid references social_comments(id) on delete cascade;
create index if not exists idx_social_comments_parent on social_comments(parent_comment_id);

-- -----------------------------------------------------------------------
-- 4) CHIA SẺ LẠI BÀI VIẾT
-- -----------------------------------------------------------------------
alter table social_posts add column if not exists shared_post_id uuid references social_posts(id) on delete set null;

-- Nới ràng buộc "phải có chữ hoặc ảnh" — bài chia sẻ lại có thể KHÔNG có
-- caption/image riêng, nội dung lấy từ bài gốc (shared_post_id).
alter table social_posts drop constraint if exists social_posts_has_content;
alter table social_posts add constraint social_posts_has_content check (
  caption is not null or image_url is not null or shared_post_id is not null
);

-- Tự tạo thông báo khi bài viết được chia sẻ lại.
create or replace function notify_on_share() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sharer_profile_id uuid;
  v_original_author_profile_id uuid;
begin
  if new.shared_post_id is null then return new; end if;
  select id into v_sharer_profile_id from social_profiles
    where (new.author_parent_id is not null and parent_account_id = new.author_parent_id)
       or (new.author_employee_id is not null and employee_id = new.author_employee_id);
  select sp.id into v_original_author_profile_id from social_posts p
    join social_profiles sp on (p.author_parent_id is not null and sp.parent_account_id = p.author_parent_id)
                             or (p.author_employee_id is not null and sp.employee_id = p.author_employee_id)
    where p.id = new.shared_post_id;
  if v_original_author_profile_id is not null and v_original_author_profile_id <> v_sharer_profile_id then
    insert into social_notifications (recipient_profile_id, actor_profile_id, type, post_id)
    values (v_original_author_profile_id, v_sharer_profile_id, 'share', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_on_share on social_posts;
create trigger trg_notify_on_share after insert on social_posts
for each row execute function notify_on_share();

-- -----------------------------------------------------------------------
-- 5) CHẶN NGƯỜI DÙNG
-- -----------------------------------------------------------------------
create table if not exists social_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_profile_id uuid not null references social_profiles(id) on delete cascade,
  blocked_profile_id uuid not null references social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint social_blocks_no_self check (blocker_profile_id <> blocked_profile_id),
  unique (blocker_profile_id, blocked_profile_id)
);

alter table social_blocks enable row level security;
-- CHỈ người chặn xem được danh sách mình đã chặn ai — người bị chặn
-- KHÔNG biết mình bị chặn (đúng hành vi mạng xã hội thông thường).
create policy social_blocks_select on social_blocks for select
  using (exists (select 1 from social_profiles sp where sp.id = blocker_profile_id and (
    (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
    or (sp.employee_id is not null and sp.employee_id = current_employee_id())
  )));
create policy social_blocks_insert on social_blocks for insert
  with check (exists (select 1 from social_profiles sp where sp.id = blocker_profile_id and (
    (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
    or (sp.employee_id is not null and sp.employee_id = current_employee_id())
  )));
create policy social_blocks_delete on social_blocks for delete
  using (exists (select 1 from social_profiles sp where sp.id = blocker_profile_id and (
    (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
    or (sp.employee_id is not null and sp.employee_id = current_employee_id())
  )));

-- Kiểm tra 2 hồ sơ có chặn nhau (CHIỀU NÀO CŨNG TÍNH) — dùng để lọc bài
-- đăng/kết quả tìm kiếm/lời mời kết bạn ở cả 2 phía.
create or replace function is_blocked_either_way(p_profile_a uuid, p_profile_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from social_blocks
    where (blocker_profile_id = p_profile_a and blocked_profile_id = p_profile_b)
       or (blocker_profile_id = p_profile_b and blocked_profile_id = p_profile_a)
  );
$$;

-- -----------------------------------------------------------------------
-- 6) BÁO CÁO VI PHẠM
-- -----------------------------------------------------------------------
create table if not exists social_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_profile_id uuid not null references social_profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'profile')),
  target_post_id uuid references social_posts(id) on delete cascade,
  target_profile_id uuid references social_profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  constraint social_reports_target_check check (
    (target_type = 'post' and target_post_id is not null and target_profile_id is null)
    or (target_type = 'profile' and target_profile_id is not null and target_post_id is null)
  )
);

alter table social_reports enable row level security;
create policy social_reports_select on social_reports for select
  using (
    exists (select 1 from social_profiles sp where sp.id = reporter_profile_id and (
      (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
      or (sp.employee_id is not null and sp.employee_id = current_employee_id())
    ))
    or is_executive_or_tech()
    or (current_department_id() = (select id from departments where code='HR'))
  );
create policy social_reports_insert on social_reports for insert
  with check (exists (select 1 from social_profiles sp where sp.id = reporter_profile_id and (
    (sp.parent_account_id is not null and sp.parent_account_id = current_parent_id())
    or (sp.employee_id is not null and sp.employee_id = current_employee_id())
  )));
-- Duyệt báo cáo (đổi status) — dành cho HCNS/Kỹ thuật/BĐH, đúng vai trò
-- xử lý vi phạm nội bộ.
create policy social_reports_update on social_reports for update
  using (is_executive_or_tech() or (current_department_id() = (select id from departments where code='HR')));

-- -----------------------------------------------------------------------
-- 7) LỌC BÀI VIẾT TỪ NGƯỜI ĐÃ CHẶN (đặt cuối cùng — cần social_blocks
--    đã tồn tại ở trên)
-- -----------------------------------------------------------------------
drop policy if exists social_posts_select on social_posts;
create policy social_posts_select on social_posts for select
  using (
    (current_parent_id() is not null or current_employee_id() is not null)
    and not exists (
      select 1 from social_profiles me, social_profiles author
      where (
        (me.parent_account_id is not null and me.parent_account_id = current_parent_id())
        or (me.employee_id is not null and me.employee_id = current_employee_id())
      )
      and (
        (author.parent_account_id is not null and author.parent_account_id = social_posts.author_parent_id)
        or (author.employee_id is not null and author.employee_id = social_posts.author_employee_id)
      )
      and is_blocked_either_way(me.id, author.id)
    )
  );
