-- =====================================================================
-- TẠO TÀI KHOẢN ADMIN CHẠY ĐƯỢC NGAY (KHÔNG CẦN GỌI ADMIN API RIÊNG)
-- =====================================================================
-- Cách này insert thẳng vào auth.users + auth.identities bằng SQL, dùng
-- pgcrypto để mã hoá mật khẩu đúng chuẩn bcrypt mà GoTrue (Supabase Auth)
-- yêu cầu. Đây là cách phổ biến để seed tài khoản dev/demo trực tiếp từ
-- SQL Editor, không cần gọi Edge Function hay Admin API.
--
-- Tài khoản tạo ra: VMTDTP / 123456 (Nhân viên kỹ thuật — toàn quyền hệ thống)
--
-- LƯU Ý: cấu trúc bảng auth.users/auth.identities có thể khác nhau nhẹ
-- giữa các phiên bản Supabase. Nếu lệnh dưới báo lỗi cột không tồn tại,
-- dùng phương án dự phòng ở mục "CÁCH 2" cuối file (Admin API, luôn ổn định).
-- =====================================================================

create extension if not exists pgcrypto;

do $$
declare
  v_user_id uuid := uuid_generate_v4();
  v_email text := 'vmtdtp@ais.local';
  v_password text := '123456';
  v_tech_dept_id uuid;
  v_tech_position_id uuid;
  v_tech_role_id uuid;
begin
  -- Nếu tài khoản đã tồn tại thì bỏ qua, không tạo trùng
  if exists (select 1 from auth.users where email = v_email) then
    raise notice 'Tài khoản % đã tồn tại, bỏ qua bước tạo auth.users.', v_email;
  else
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', 'VMTDTP'),
      now(), now()
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      uuid_generate_v4(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );
  end if;

  -- Lấy lại id thật (phòng trường hợp user đã tồn tại từ trước)
  select id into v_user_id from auth.users where email = v_email;

  select id into v_tech_dept_id from departments where code = 'TECH';
  select id into v_tech_position_id from positions where department_id = v_tech_dept_id limit 1;
  select id into v_tech_role_id from system_roles where code = 'TECH';

  if not exists (select 1 from employees where auth_user_id = v_user_id) then
    insert into employees (
      auth_user_id, full_name, department_id, position_id, role_id,
      status, temp_password_flag, hire_date
    ) values (
      v_user_id, 'Tài khoản mẫu VMTDTP', v_tech_dept_id, v_tech_position_id, v_tech_role_id,
      'active', true, current_date
    );
    raise notice 'Đã tạo hồ sơ nhân viên cho tài khoản %.', v_email;
  else
    raise notice 'Hồ sơ nhân viên cho tài khoản % đã tồn tại, bỏ qua.', v_email;
  end if;
end $$;

-- =====================================================================
-- KIỂM TRA NHANH SAU KHI CHẠY
-- =====================================================================
select e.employee_code, e.full_name, u.email, d.name as phong_ban, r.name as vai_tro
from employees e
join auth.users u on u.id = e.auth_user_id
join departments d on d.id = e.department_id
join system_roles r on r.id = e.role_id
where u.email = 'vmtdtp@ais.local';

-- =====================================================================
-- CÁCH 2 (DỰ PHÒNG) — nếu CÁCH 1 ở trên báo lỗi do khác version Supabase:
-- Chạy đoạn JS này 1 lần (Node.js hoặc trong browser console tại trang
-- Supabase Dashboard đã login), dùng service_role key:
--
--   import { createClient } from '@supabase/supabase-js';
--   const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
--   const { data } = await admin.auth.admin.createUser({
--     email: 'vmtdtp@ais.local', password: '123456', email_confirm: true,
--   });
--   // sau đó insert vào employees với auth_user_id = data.user.id
--   // (department_id/position_id/role_id lấy như đoạn SQL ở trên)
-- =====================================================================
