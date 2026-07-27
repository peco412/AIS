-- =====================================================================
-- File 156: SUA LOI "new row violates row-level security policy for
-- table social_conversations" (27/07/2026)
-- =====================================================================
-- Thay vi de FRONTEND tu insert 3 buoc rieng le (tao social_conversations
-- -> tao 2 dong social_conversation_participants) — moi buoc phai tu
-- ghep dung dieu kien RLS, de sai sot va kho do loi chinh xac tu dau —
-- gom het vao 1 ham SECURITY DEFINER duy nhat, xu ly toan bo tren
-- server, dam bao chac chan dung logic, khong con phu thuoc RLS o
-- tung buoc rieng le nua (van an toan vi ham tu kiem tra danh tinh
-- nguoi goi ngay ben trong).
-- =====================================================================

create or replace function start_or_get_conversation(p_other_type text, p_other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_parent_id uuid := current_parent_id();
  v_my_employee_id uuid := current_employee_id();
  v_conv_id uuid;
begin
  if v_my_parent_id is null and v_my_employee_id is null then
    raise exception 'Không xác định được danh tính người dùng hiện tại.';
  end if;
  if p_other_type not in ('parent', 'employee') then
    raise exception 'Loại người nhận không hợp lệ.';
  end if;

  -- Tim hoi thoai 1-1 DA CO san giua dung 2 nguoi nay, tranh tao trung.
  select scp1.conversation_id into v_conv_id
  from social_conversation_participants scp1
  join social_conversation_participants scp2 on scp2.conversation_id = scp1.conversation_id
  where
    (
      (v_my_parent_id is not null and scp1.participant_parent_id = v_my_parent_id)
      or (v_my_employee_id is not null and scp1.participant_employee_id = v_my_employee_id)
    )
    and (
      (p_other_type = 'parent' and scp2.participant_parent_id = p_other_id)
      or (p_other_type = 'employee' and scp2.participant_employee_id = p_other_id)
    )
  limit 1;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  insert into social_conversations default values returning id into v_conv_id;

  insert into social_conversation_participants (conversation_id, participant_parent_id, participant_employee_id)
  values (v_conv_id, v_my_parent_id, v_my_employee_id);

  insert into social_conversation_participants (conversation_id, participant_parent_id, participant_employee_id)
  values (
    v_conv_id,
    case when p_other_type = 'parent' then p_other_id else null end,
    case when p_other_type = 'employee' then p_other_id else null end
  );

  return v_conv_id;
end;
$$;
