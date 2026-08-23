-- =======================================================================
-- BIRTHDAY WISHES — theo yêu cầu: thông báo sinh nhật là thông báo dành
-- cho MỌI NGƯỜI biết (trước đây chỉ người có sinh nhật tự thấy banner
-- của chính mình), và cần có nút gửi lời chúc mừng tới đúng nhân sự đó.
-- =======================================================================

create table if not exists birthday_wishes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade, -- người được chúc
  wisher_id uuid not null references employees(id) on delete cascade,   -- người gửi lời chúc
  wish_date date not null default current_date,
  created_at timestamptz not null default now(),
  -- Mỗi người chỉ chúc được 1 lần/ngày cho 1 đồng nghiệp — tránh bấm spam
  -- nhiều lần làm sai lệch số lượt chúc mừng hiển thị.
  unique (employee_id, wisher_id, wish_date),
  check (employee_id <> wisher_id) -- không tự chúc mừng chính mình
);
create index if not exists idx_birthday_wishes_employee_date on birthday_wishes(employee_id, wish_date);

alter table birthday_wishes enable row level security;

-- Ai cũng xem được (để đếm số lượt chúc + hiện avatar người đã chúc trên
-- banner sinh nhật công khai) — không phải dữ liệu nhạy cảm.
create policy birthday_wishes_select on birthday_wishes for select
  to authenticated using (true);

-- Chỉ được tự chúc bằng đúng danh tính của mình (không chúc thay người
-- khác), và không tự chúc chính mình (đã chặn thêm ở constraint check
-- phía trên, chặn kép ở RLS cho chắc).
create policy birthday_wishes_insert on birthday_wishes for insert
  to authenticated with check (
    wisher_id = current_employee_id()
    and employee_id <> wisher_id
  );
