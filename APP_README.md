# ERP AIS — Frontend (HTML + CSS + JS thuần + Supabase)

Hệ thống quản trị nội bộ 2 phân hệ (ALOHA / iLingo), 8 trung tâm, 8 phòng ban, workflow ký số nhiều cấp qua PDF.js + pdf-lib, có PWA cài được như app, đa ngôn ngữ Việt/Anh, và thông báo đẩy thật (Web Push). Toàn bộ frontend là HTML/CSS/JS thuần (ES module), không build step, deploy thẳng lên Vercel như static site.

---

## 1. Cấu trúc thư mục

```
app/
├── index.html                    # Đăng nhập (2 phân hệ, hiệu ứng "mở sách" khi vào hệ thống)
├── change-password.html          # Bắt buộc đổi mật khẩu lần đầu
├── dashboard.html                 # App Hub — lưới icon phòng ban, KHÔNG có sidebar (màn hình chọn)
├── profile.html                   # Hồ sơ cá nhân + bật/tắt thông báo đẩy
├── notifications.html, meetings.html, proposals.html (có lọc tháng + phân trang), archive.html
├── directory.html                 # Danh bạ nội bộ (mọi nhân viên)
├── permission-requests.html       # Xin thêm quyền hạn — duyệt xong tự mở đúng menu
├── manifest.json / service-worker.js   # PWA (network-first cho JS/CSS/HTML, cache-bust theo version)
│
├── css/  — tokens.css (theme phân hệ + nền), login.css (hiệu ứng mở sách),
│           dashboard.css (App Hub, sidebar theo ngữ cảnh), module.css, pdfEditor.css
│
├── js/   — module dùng chung:
│   ├── supabase.js        # Client Supabase + esc()/uploadPrivateFile()/resolveFileUrl()/triggerPush()
│   ├── shell.js            # bootShell(): nạp profile, dịch, nav theo ngữ cảnh, quyền được cấp thêm
│   ├── navConfig.js         # Cấu hình menu (i18n key + điều kiện hiển thị)
│   ├── i18n.js              # Từ điển Việt/Anh + applyTranslations()
│   ├── auth.js, changePassword.js, dashboard.js, pwa.js
│   ├── pdfEditor.js          # PDF.js hiển thị + pdf-lib điền/ký, hỗ trợ field_map tự định vị
│   ├── freeSign.js           # Ký số hồ sơ tự do — dùng chung HR/ACC/MKT/FAC/EDU
│   ├── taskAssignments.js    # Phân việc — gắn với yêu cầu thật từ module (ACC/MKT/FAC)
│   ├── googleCalendar.js, googleMaps.js
│   ├── loginLoader.js        # Hiệu ứng "mở sách" lúc đăng nhập
│   ├── installPrompt.js      # Nút "Cài đặt ứng dụng" (Android beforeinstallprompt + hướng dẫn iOS)
│   └── pushNotifications.js  # Đăng ký/huỷ thông báo đẩy trên từng thiết bị
│
├── hr/   — employees (đầy đủ hồ sơ + phân hệ + Ban chuyên môn/giáo viên linh hoạt),
│           contracts, leave-requests, leave-balances, business-trips (đo khoảng cách GG Maps),
│           work-schedule (lưới tuần, giờ bắt đầu/kết thúc), positions, sign
├── acc/  — payment-requests, advance-requests, payroll (tự tính khấu trừ theo nghỉ phép),
│           reports, tasks, sign
├── mkt/  — requests, event-proposals, accounts (mật khẩu mã hoá), expense-reports, tasks, sign
├── fac/  — requests, purchase-requests, stats, tasks, sign
├── edu/  — classes, students, grades, class-assignment (tự gợi ý theo bảng điểm cũ),
│           center-overview, teachers, duty-schedule (lưới tuần), teacher-schedule,
│           attendance-overview (biểu đồ chuyên cần), tuition (thu học phí), sign
├── teacher/ — classes (+ liên lạc phụ huynh), attendance, grades, schedule
├── consultant/ — leads (CRM), stats
└── exec/    — broadcast, sign, orders, archive, reports (có biểu đồ Chart.js)
```

## 2. Cấu hình môi trường

`js/supabase.js` đọc `window.__ENV__` trước, fallback về giá trị hard-code. Cần tạo `app/env.js` (không commit) khi deploy production:
```js
window.__ENV__ = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...',
  GOOGLE_CLIENT_ID: '....apps.googleusercontent.com',
  GOOGLE_MAPS_API_KEY: '...',
  VAPID_PUBLIC_KEY: '...',   // khớp với VAPID_PRIVATE_KEY ở Edge Function send-push
};
```

## 3. Thứ tự chạy migration SQL

```
01 → 09 (schema gốc + seed)
supabase_migrations_10_additional_rls.sql
supabase_migrations_11_security_fixes.sql       -- set app.settings.mkt_secret_key TRƯỚC file 12
supabase_migrations_12_spec_completion.sql
supabase_migrations_13_private_storage.sql
supabase_migrations_14_new_features.sql         -- lịch giờ cụ thể, Ban chuyên môn, thu học phí, xin quyền hạn
supabase_migrations_15_new_requests.sql         -- Kế toán xem nghỉ phép (tính lương), bảng push_subscriptions
```
Tài khoản mẫu: `VMTDTP / 123456` — đổi/xoá trước khi có dữ liệu thật.

## 4. Điều hướng — App Hub, không phải sidebar liệt kê hết

`dashboard.html` là màn hình "chọn phòng ban" kiểu app di động (lưới icon màu riêng từng phòng ban, không có sidebar). Bấm vào 1 phòng ban mới vào trang có sidebar — và sidebar đó **chỉ hiện đúng nhóm phòng ban đang mở** (không liệt kê tất cả như thiết kế ban đầu), cộng thêm 3 mục dùng chung (Trang chủ, Thông báo, Hồ sơ cá nhân). Ô phòng ban không có quyền sẽ mờ đi, không bấm được.

**Quyền hạn được cấp thêm**: module `permission-requests.html` cho trưởng/phó phòng xin thêm quyền vào 1 trang cụ thể cho nhân sự, Ban điều hành duyệt → tự động mở đúng mục đó trong menu (bảng `granted_permissions`, nạp vào `profile.grantedModules` ở `shell.js`). **Từ migration 16**, quyền này đã lan xuống RLS thật cho nhóm trang báo cáo/quản trị từng phòng ban (`acc/reports.html`, `acc/payroll.html`, `mkt/expense-reports.html`, `mkt/accounts.html`, `fac/stats.html`, `hr/work-schedule.html`, `hr/positions.html`) — mở quyền cho các trang này giờ mở luôn dữ liệu thật, không chỉ menu. Các trang khác ngoài danh sách này vẫn cần bổ sung thủ công theo mẫu `has_module_permission('/duong-dan.html')` khi phát sinh nhu cầu thật.

## 5. Đa ngôn ngữ (Việt/Anh)

`js/i18n.js` — từ điển tra cứu + `applyTranslations()` quét `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`. Nút chuyển ngôn ngữ tự chèn vào topbar mọi trang qua `shell.js`. Lựa chọn được lưu vào `employees.language_preference` (đồng bộ giữa các thiết bị). **Phạm vi hiện tại:** đã dịch đầy đủ menu điều hướng + trang đăng nhập + trang chủ + các cụm từ dùng chung (Lưu/Huỷ/Trạng thái...); phần nội dung riêng của từng trang nghiệp vụ (tiêu đề cột, nhãn field...) phần lớn vẫn tiếng Việt — mở rộng dần bằng cách thêm `data-i18n="key"` + key tương ứng trong `DICT`.

## 6. PDF Form Viewer / Ký số (`js/pdfEditor.js`)

PDF.js hiển thị (co giãn đúng khổ theo màn hình, kể cả điện thoại, có render nét trên retina) + pdf-lib điền/ký. Có điều hướng trang riêng khi biểu mẫu nhiều trang.

**Tự định vị vị trí (field_map):** vào Kho lưu trữ → tab Biểu mẫu → nút "📐 Thiết kế vị trí" (HR quản trị/TECH) để đặt sẵn vị trí ký/điền 1 lần cho mỗi loại biểu mẫu (lưu dạng % kích thước trang vào `document_templates.field_map`, không phải pixel — nên đúng trên mọi màn hình). Lần điền/tạo phiếu sau tự có sẵn đúng vị trí, không phải kéo-thả lại.

**Ký tự do** (`js/freeSign.js`): `hr|acc|mkt|fac|edu/sign.html` — trưởng/phó phòng (hoặc Quản lý trung tâm với EDU), BĐH, kỹ thuật tự tải PDF bất kỳ lên ký, lưu vào kho + ghi `signature_logs`.

## 7. Thông báo đẩy thật (Web Push)

Khác với thông báo trong app (chuông), đây là thông báo tới được cả khi tắt màn hình/đóng trình duyệt:
- `service-worker.js`: xử lý sự kiện `push` (hiện thông báo hệ điều hành) + `notificationclick` (mở đúng trang).
- `js/pushNotifications.js`: đăng ký/huỷ trên từng thiết bị, lưu vào bảng `push_subscriptions`. Bật/tắt ở `profile.html`.
- `supabase/functions/send-push/index.ts`: Edge Function gửi push thật theo đúng phạm vi thông báo (hệ thống/trung tâm/phòng ban/cá nhân), tự dọn thiết bị đã gỡ đăng ký (lỗi 404/410).
- `js/supabase.js` có `triggerPush()` gọi sau khi insert vào bảng `notifications` — đã nối ở `exec/broadcast.js`, `js/proposals.js`, `mkt/requests.js`, `fac/requests.js`. **Muốn thêm chỗ khác gửi push** (ví dụ duyệt nghỉ phép), gọi `triggerPush({scope, ...})` ngay sau khi insert notification ở đó.

**Cần cấu hình trước khi dùng (bắt buộc):**
```bash
supabase secrets set VAPID_PUBLIC_KEY=<khớp với js/pushNotifications.js>
supabase secrets set VAPID_PRIVATE_KEY=<giữ bí mật tuyệt đối>
supabase secrets set VAPID_SUBJECT=mailto:admin@yourcompany.com
supabase functions deploy send-push
```
Khoá mẫu đã có sẵn trong code để chạy thử ngay — **nên tự sinh cặp khoá riêng cho production** (bất kỳ thư viện `web-push` nào cũng có lệnh `generate-vapid-keys`).

## 8. PWA — cài như app thật

- `manifest.json` đầy đủ icon `any` + `maskable`, meta tag chuẩn cho cả Android lẫn iOS (`apple-mobile-web-app-*` + `mobile-web-app-capable`).
- **Nút "Cài đặt ứng dụng"** (`js/installPrompt.js`) tự chèn vào topbar mọi trang (📲) + banner nổi bật trên trang chủ — trước đây không có nơi nào để bấm cài, giờ rõ ràng. Android/Chrome dùng `beforeinstallprompt`; iOS Safari hiện hướng dẫn thủ công (Chia sẻ → Thêm vào MH chính) vì Safari không hỗ trợ cài tự động.
- `service-worker.js` dùng chiến lược **network-first cho cả HTML/JS/CSS** (trước đây CSS bị sót, dùng cache-first, là nguyên nhân chính gây "dính" bản cũ) — mỗi lần deploy quan trọng, **tăng số `CACHE_NAME`** (hiện tại `v5`) để buộc mọi client xoá cache cũ.
- Đã tối ưu responsive: bảng cuộn ngang thay vì bị cắt, form 2 cột tự co về 1 cột, sidebar full-screen trên di động, toolbar PDF thu gọn trên màn hình hẹp.

## 9. Đăng nhập bằng "tên đăng nhập" & tạo nhân viên mới

Map tên đăng nhập sang email nội bộ giả (`usernameToEmail()`). Tạo tài khoản qua Edge Function `create-employee-account` (cần `service_role`, không gọi được từ frontend):
```bash
supabase functions deploy create-employee-account
```
Form thêm nhân viên có nút "🎲 Tạo tự động" sinh mật khẩu tạm ngay tại chỗ (CSPRNG), gửi kèm lên Edge Function — **nhớ deploy lại function sau khi cập nhật code**, code cục bộ không tự đồng bộ lên server.

## 10. Việc còn lại / giới hạn đã biết

- Quyền hạn cấp thêm (mục 4) mới ở tầng UI, chưa lan hết xuống RLS mọi bảng liên quan.
- i18n chưa phủ hết nội dung riêng từng trang (mục 5).
- Push notification chưa nối vào TẤT CẢ các luồng tạo thông báo trong hệ thống (mới 4 điểm chính).
- Xem chi tiết đầy đủ ở `PRODUCTION_CHECKLIST.md`, `AUDIT_ERP_AIS.md`, `GAP_ANALYSIS.md`.
