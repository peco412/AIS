# ERP AIS — Frontend (HTML + CSS + JS thuần + Supabase)

Hệ thống quản trị nội bộ 2 phân hệ (ALOHA / iLingo), 8 trung tâm, 8 phòng ban, workflow ký số nhiều cấp qua PDF.js + pdf-lib. Toàn bộ frontend là HTML/CSS/JS thuần (ES module), không build step, deploy thẳng lên Vercel như static site.

> Tài liệu này đã được viết lại toàn bộ để phản ánh đúng trạng thái hiện tại sau khi hoàn thiện đủ các module theo đề bài gốc và vá các lỗi bảo mật/logic phát hiện được. Lịch sử các đợt sửa lỗi/hoàn thiện nằm ở mục **13. Lịch sử thay đổi quan trọng** cuối file.

---

## 1. Cấu trúc thư mục

```
app/
├── index.html                  # Trang đăng nhập (2 phân hệ ALOHA/iLingo)
├── change-password.html        # Bắt buộc đổi mật khẩu lần đầu
├── dashboard.html               # Khung Dashboard (sidebar + topbar)
├── profile.html                 # Hồ sơ cá nhân (chữ ký số, bằng cấp, đổi mật khẩu...)
├── notifications.html           # Thông báo (4 phạm vi)
├── meetings.html                # Lịch họp offline + online (Google Meet)
├── proposals.html                # Đề xuất nội bộ (ký PDF tại chỗ, lưu đè)
├── archive.html                  # Kho lưu trữ hệ thống (8 phòng ban + Biểu mẫu)
├── manifest.json / service-worker.js   # PWA
│
├── css/
│   ├── tokens.css, login.css, dashboard.css, module.css, pdfEditor.css
│
├── js/                            # Module dùng chung toàn hệ thống
│   ├── supabase.js                # Khởi tạo Supabase client + helper esc()/uploadPrivateFile()/resolveFileUrl()/openFile()
│   ├── auth.js, changePassword.js, dashboard.js, shell.js, navConfig.js, pwa.js
│   ├── archive.js                 # Logic trang archive.html
│   ├── proposals.js               # Logic trang proposals.html
│   ├── pdfEditor.js                # PDF.js (xem) + pdf-lib (điền/ký/resize) dùng chung mọi biểu mẫu
│   ├── freeSign.js                 # Ký số hồ sơ TỰ DO (tự nhập file) dùng chung HR/ACC/MKT/FAC
│   ├── taskAssignments.js          # Phân việc xử lý yêu cầu, dùng chung ACC/MKT/FAC
│   ├── googleCalendar.js           # Tạo sự kiện + Google Meet link
│   └── googleMaps.js               # Đo quãng đường (Distance Matrix) + Places Autocomplete
│
├── hr/     — Nhân sự: employees, contracts, leave-requests, leave-balances,
│             business-trips, work-schedule, sign (ký tự do)
├── acc/    — Kế toán: payment-requests, advance-requests, payroll, reports
│             (gồm công nợ + dòng tiền), tasks, sign
├── mkt/    — Truyền thông: requests, event-proposals, accounts (tài khoản
│             nội bộ, mật khẩu mã hoá), expense-reports (chi phí digital
│             marketing), tasks, sign
├── fac/    — Cơ sở vật chất: requests, purchase-requests, stats (kiểm kê
│             tài sản), tasks, sign
├── edu/    — Học vụ / Quản lý trung tâm: classes, students, grades,
│             class-assignment (tự gợi ý lớp theo bảng điểm cũ),
│             center-overview (tổng quan trung tâm/hệ thống), teachers,
│             duty-schedule, teacher-schedule
├── teacher/ — Giáo viên: classes, attendance, grades, schedule (lịch tuần
│             dạng calendar, đọc từ edu/teacher-schedule.html)
├── consultant/ — Tư vấn: leads (CRM), stats
└── exec/    — Ban điều hành: broadcast, sign (tổng hợp hồ sơ chờ duyệt),
              orders (lệnh yêu cầu nhanh), archive (kho lưu trữ điều hành riêng)
```

## 2. Cấu hình kết nối Supabase & biến môi trường

`js/supabase.js` đọc `window.__ENV__` trước, fallback về giá trị hard-code nếu không có:
```js
const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || '...';
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || '...';
```
`js/googleCalendar.js` và `js/googleMaps.js` cũng theo đúng mẫu này cho `GOOGLE_CLIENT_ID` và `GOOGLE_MAPS_API_KEY`.

**Khi deploy thật (khuyến nghị bắt buộc):** tạo 1 file `app/env.js` (thêm vào `.gitignore`, KHÔNG commit) build/inject lúc deploy:
```js
window.__ENV__ = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...',
  GOOGLE_CLIENT_ID: '....apps.googleusercontent.com',
  GOOGLE_MAPS_API_KEY: '...',
};
```
rồi thêm `<script src="/env.js"></script>` trước mọi `<script type="module" src="/js/...">` trong từng trang HTML. Anon key và Client ID/Maps key đều là giá trị **công khai được phép lộ ra frontend** — bảo mật thật nằm ở Row Level Security (RLS) trong Postgres, không nằm ở việc giấu các key này.

Nên dùng **2 project Supabase riêng biệt** cho staging và production — không dùng chung, tránh thao tác test ghi đè dữ liệu thật.

## 3. Quy ước đăng nhập bằng "tên đăng nhập"

Supabase Auth mặc định cần email; hệ thống map tên đăng nhập (`VMTDTP`) sang email nội bộ giả `vmtdtp@ais.local` (xem `usernameToEmail()`/`emailToUsername()` trong `js/supabase.js`). Email thật để liên lạc lưu riêng ở `employees.email`.

## 4. Chạy thử cục bộ

Dùng ES module (`type="module"`), phải chạy qua HTTP server:
```bash
cd app
npx serve .
# hoặc: python3 -m http.server 5500
```

## 5. Deploy lên Vercel

```bash
cd app
npx vercel
```
Site tĩnh, không build step — Vercel tự nhận diện. Nhớ tạo `app/env.js` như mục 2 trước khi deploy production thật.

## 6. Thứ tự chạy migration SQL (bắt buộc, xem chi tiết ở `DATABASE_README.md`)

```
01 → 09 (schema gốc + seed)
supabase_migrations_10_additional_rls.sql
supabase_migrations_11_security_fixes.sql        -- set app.settings.mkt_secret_key TRƯỚC khi chạy file 12
supabase_migrations_12_spec_completion.sql
supabase_migrations_13_private_storage.sql
```
Tài khoản mẫu chạy được ngay: `VMTDTP / 123456` (qua `supabase_admin_seed.sql`) — **đổi mật khẩu hoặc xoá hẳn** tài khoản này trước khi có dữ liệu thật.

## 7. Bảo mật đã áp dụng ở tầng frontend

- **Không tự tin vào validation phía UI** — mọi giới hạn hiển thị/ẩn nút trên frontend (menu, nút hành động...) chỉ là UX, quyền thật luôn được RLS + trigger ở database chặn lại (xem `DATABASE_README.md` mục 4).
- **Chống XSS**: mọi nơi nội suy dữ liệu người dùng nhập (tên, tiêu đề, ghi chú, nội dung...) vào `innerHTML` đều đi qua hàm `esc()` dùng chung trong `js/supabase.js`.
- **File đính kèm private**: bucket Storage `attachments` đã chuyển Private (từ migration 13). Code không còn lưu public URL vào DB — chỉ lưu **path**, và luôn xin **signed URL có hạn** (`resolveFileUrl()`, 5-30 phút tuỳ ngữ cảnh) ngay lúc người dùng bấm xem/ký. Có tương thích ngược với dữ liệu cũ đã lỡ lưu public URL đầy đủ.
- **Không có secret nào trong code frontend** ngoài anon key/Client ID/Maps key (đều là loại được phép public).

## 8. PDF Form Viewer / Ký số (`js/pdfEditor.js`)

Đúng yêu cầu PDF.js (hiển thị) + pdf-lib (điền/ký), tải qua CDN khi cần:
1. PDF.js render từng trang ra `<canvas>`.
2. Bấm "📝 Thêm văn bản" hoặc "✍️ Chèn chữ ký" rồi click vào vị trí để đặt — **kéo-thả để đổi vị trí, kéo góc dưới-phải để đổi kích thước** (đã bổ sung resize bằng chuột).
3. Bấm Lưu: pdf-lib tính lại toạ độ (pixel canvas → điểm PDF) rồi nhúng text/ảnh chữ ký, xuất `Blob` PDF mới.
4. Trang gọi component tự upload `Blob` (qua `uploadPrivateFile()`) và cập nhật database.

**2 cách dùng:**
- **Gắn với 1 phiếu có sẵn** (Hợp đồng, Thanh toán, Tạm ứng, Trình sự kiện, Mua sắm, Đề xuất nội bộ): mỗi bước ký tạo 1 bản PDF mới, cột `*_signed_at/_by` được set theo đúng luồng nhiều cấp, trạng thái chuyển tiếp được **trigger DB** kiểm soát (không chỉ dựa vào frontend).
- **Ký tự do** (`js/freeSign.js`, dùng ở `hr|acc|mkt|fac/sign.html`): trưởng/phó phòng, BĐH, kỹ thuật tự tải lên 1 file PDF bất kỳ (không gắn với phiếu nào), ký tại vị trí bất kỳ, tự động lưu vào Kho lưu trữ hệ thống đúng phòng ban + ghi `signature_logs` để truy vết.

## 9. Google Calendar & Google Maps

- `js/googleCalendar.js`: Google Identity Services + Calendar API, dùng ở `meetings.html` (chọn "Trực tuyến" → điền thông tin → "Tạo link" → tự sinh sự kiện + Google Meet link, mời đúng người đã tick).
- `js/googleMaps.js`: **Maps JavaScript SDK** (không gọi thẳng REST Distance Matrix vì bị chặn CORS phía trình duyệt) — cung cấp `attachPlaceAutocomplete()` (gợi ý địa điểm, dùng ở `hr/business-trips.html` và `meetings.html`) và `computeDrivingDistanceKm()` (tự tính quãng đường lái xe cho Đơn công tác).

**Cần cấu hình trước khi dùng:** bật "Google Calendar API", "Maps JavaScript API", "Places API" trên cùng 1 project Google Cloud; tạo OAuth Client ID (cho Calendar) + API key riêng (cho Maps, nên **restrict theo HTTP referrer** = domain deploy thật); điền vào `env.js` như mục 2. Nhớ chuyển OAuth consent screen sang "In production" (chế độ "Testing" giới hạn 100 người dùng và token hết hạn sau 7 ngày).

## 10. PWA

`manifest.json` + `service-worker.js` cache app shell cơ bản, **không cache dữ liệu Supabase** (đảm bảo dữ liệu luôn mới). Icon PWA thật đã có ở `assets/icon-192.png` / `icon-512.png`.

## 11. Đăng nhập bằng "tên đăng nhập" & tạo nhân viên mới

Tạo tài khoản đăng nhập đòi hỏi `service_role` key — không gọi an toàn từ frontend. Code nằm ở `supabase/functions/create-employee-account/index.ts` (Edge Function), tự kiểm tra người gọi phải là HR (trưởng/phó phòng), Executive, hoặc Kỹ thuật.
```bash
supabase functions deploy create-employee-account
supabase secrets set SUPABASE_URL=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

## 12. Việc còn lại (không chặn go-live, xem chi tiết ở `PRODUCTION_CHECKLIST.md`)

- Nâng gói Supabase lên Pro (backup + point-in-time recovery) trước khi nhập dữ liệu thật.
- Hoàn tất thủ tục pháp lý về bảo vệ dữ liệu cá nhân (CCCD nhân viên, thông tin học viên có thể là trẻ vị thành niên) theo Nghị định 13/2023/NĐ-CP.
- Gắn công cụ theo dõi lỗi runtime phía frontend (hiện lỗi chỉ hiện `alert()` cho đúng người dùng gặp phải).
- Rà lại giới hạn tốc độ gọi Edge Function `create-employee-account` nếu lo ngại lạm dụng.

## 13. Lịch sử thay đổi quan trọng

**Đợt rà soát bảo mật + đối chiếu đề bài (trước khi viết lại README này):**
- Vá 5 lỗ hổng RLS nghiêm trọng: lộ PII cho người chưa đăng nhập, tự nâng quyền qua sửa hồ sơ, tự duyệt phiếu tài chính/HR của chính mình, `contracts_insert` mở toang, thiếu policy duyệt nghỉ phép/công tác.
- Phát hiện & vá thêm: `signature_logs`/`work_schedules`/`center_duty_schedules`/`teacher_weekly_schedules`/`facility_assets`/`document_templates`/`document_code_counters` hoàn toàn không có RLS (mở toang); `internal_accounts` bật RLS nhưng 0 policy (bị chặn hoàn toàn).
- Sửa lỗi nghiêm trọng: 4 file `acc/*.js` import sai đường dẫn (`/js/supabaseClient.js` không tồn tại) khiến cả module Kế toán không chạy được.
- Xây mới 14 trang/module còn thiếu so với đề bài (lịch làm việc, lịch trực, lịch tuần giáo viên, danh sách giáo viên, tổng quan thống kê, phân lớp tự động, lệnh yêu cầu BĐH, kho lưu trữ điều hành, tài khoản nội bộ, báo cáo chi phí MKT, thống kê CSVC, thống kê CRM...).
- Chuyển toàn bộ Storage bucket `attachments` từ Public sang Private + signed URL (13 file JS liên quan).
- Tích hợp Google Maps (đo quãng đường + gợi ý địa điểm), bổ sung resize bằng chuột trong `pdfEditor.js`, xây tính năng "ký số hồ sơ tự do" dùng chung 4 phòng ban (`hr|acc|mkt|fac/sign.html`).
- Rà soát & vá XSS (`esc()`) trên diện rộng khắp các trang hiển thị dữ liệu người dùng nhập.
- Phát hiện & sửa 1 lỗi tự gây ra ở đợt vá trước: policy `signature_logs` dùng sai tên cột (`signed_by` thay vì `employee_id` thật), và hàm `generate_document_code()`/`generate_employee_code()` cần chuyển sang `SECURITY DEFINER` — nếu không sửa, việc khoá RLS bảng `document_code_counters` sẽ làm **toàn bộ trigger sinh mã phiếu bị vỡ** cho mọi nhân viên không phải TECH.
- Dọn 2 file HTML rác trùng lặp ở thư mục gốc (`payroll.html`, `reports.html` — bản nháp cũ của `acc/payroll.html`/`acc/reports.html`).

Chi tiết đầy đủ từng lỗi + cách vá nằm trong `AUDIT_ERP_AIS.md`, `GAP_ANALYSIS.md`, và các file `supabase_migrations_11/12/13_*.sql`.
