-- =====================================================================
-- File 152: MO RONG CONG DONG XEM DUOC MOI TRUNG TAM (27/07/2026)
-- =====================================================================
-- Theo yeu cau: khong can chon/gioi han trung tam nua — dung dinh nghia
-- "mang xa hoi" la xem duoc ca cac trung tam khac, khong bi khoanh vung
-- rieng tung noi. Van GIU LAI cot center_id tren bai dang (de hien nhan
-- "dang tu trung tam nao" tren giao dien cho de nhan biet), chi bo phan
-- GIOI HAN QUYEN XEM theo trung tam trong RLS.
-- =====================================================================

drop policy if exists social_posts_select on social_posts;
create policy social_posts_select on social_posts for select
  using (current_parent_id() is not null or current_employee_id() is not null);

drop policy if exists social_post_likes_select on social_post_likes;
create policy social_post_likes_select on social_post_likes for select
  using (current_parent_id() is not null or current_employee_id() is not null);

drop policy if exists social_comments_select on social_comments;
create policy social_comments_select on social_comments for select
  using (current_parent_id() is not null or current_employee_id() is not null);

-- Dang bai/thich/binh luan van chi can dang nhap (khong con phai kiem
-- tra can_see_center_social nua, vi gio ai cung xem duoc het) — nhung
-- van phai dung DUNG danh tinh cua chinh minh (khong gia mao nguoi khac).
drop policy if exists social_posts_insert on social_posts;
create policy social_posts_insert on social_posts for insert
  with check (
    (author_parent_id is not null and author_parent_id = current_parent_id())
    or (author_employee_id is not null and author_employee_id = current_employee_id())
  );

drop policy if exists social_post_likes_insert on social_post_likes;
create policy social_post_likes_insert on social_post_likes for insert
  with check (
    (liker_parent_id is not null and liker_parent_id = current_parent_id())
    or (liker_employee_id is not null and liker_employee_id = current_employee_id())
  );

drop policy if exists social_comments_insert on social_comments;
create policy social_comments_insert on social_comments for insert
  with check (
    (author_parent_id is not null and author_parent_id = current_parent_id())
    or (author_employee_id is not null and author_employee_id = current_employee_id())
  );
