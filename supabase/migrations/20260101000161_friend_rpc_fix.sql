-- =====================================================================
-- File 161: CHUYEN "KET BAN" SANG RPC — CHAC CHAN HON (27/07/2026)
-- =====================================================================
-- Thay vi de trinh duyet tu insert vao social_friendships (phai tu
-- truyen dung "requester_profile_id" — neu buoc lay ho so truoc do vi
-- ly do gi khong tra ve dung gia tri, thao tac se am tham that bai hoac
-- bi RLS chan ma khong ro nguyen nhan), gom vao 1 ham RPC — ham tu XAC
-- DINH DANH TINH NGUOI GOI o phia server (dung current_parent_id()/
-- current_employee_id(), khong phu thuoc gia tri client gui len),
-- dung 1 mau hinh voi "start_or_get_conversation" da sua thanh cong
-- truoc do.
-- =====================================================================

create or replace function get_my_social_profile_id() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_result social_profiles;
begin
  v_result := ensure_social_profile();
  return v_result.id;
end;
$$;

create or replace function send_friend_request(p_addressee_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_my_id uuid := get_my_social_profile_id();
begin
  if v_my_id is null then
    raise exception 'Không xác định được hồ sơ của bạn.';
  end if;
  if v_my_id = p_addressee_profile_id then
    raise exception 'Không thể tự kết bạn với chính mình.';
  end if;
  insert into social_friendships (requester_profile_id, addressee_profile_id)
  values (v_my_id, p_addressee_profile_id)
  on conflict (requester_profile_id, addressee_profile_id) do nothing;
end;
$$;

create or replace function respond_friend_request(p_friendship_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_my_id uuid := get_my_social_profile_id();
begin
  if p_accept then
    update social_friendships set status = 'accepted', responded_at = now()
    where id = p_friendship_id and addressee_profile_id = v_my_id;
  else
    delete from social_friendships where id = p_friendship_id and addressee_profile_id = v_my_id;
  end if;
end;
$$;
