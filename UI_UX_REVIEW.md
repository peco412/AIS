# ERP AIS — Bản chỉnh UI/UX ngày 06/10/2026

## Kết quả và phạm vi

Đã chỉnh mã nguồn của AIS OFFICE (`app/`) và cổng phụ huynh (`ais-center/`) theo phong cách workspace giáo dục: nền sáng trung tính, bề mặt trắng, chữ sans dễ đọc, màu thương hiệu làm điểm nhấn. Đây là bản mã nguồn để chạy thử và nghiệm thu; chưa triển khai lên website hoặc thay đổi database đang sử dụng.

Đã kiểm tra tĩnh 124 trang HTML và 133 file JavaScript sau chỉnh sửa. Không phát hiện lỗi cú pháp JavaScript, file liên kết trực tiếp hoặc import tương đối bị thiếu. Kiểm tra này không xác nhận các URL tạo động, API, dữ liệu hoặc quyền RLS đang chạy trên server.

## Các thay đổi chính

| Hạng mục | Thay đổi | Lợi ích |
| --- | --- | --- |
| Thiết kế hai giao diện | Đồng bộ màu nền, màu chữ, font, viền ô nhập và trạng thái focus | Dễ đọc và nhất quán hơn |
| Trang chủ và danh sách trung tâm | Thay các trung tâm chuyển động theo quỹ đạo bằng nút dạng thẻ có tên đầy đủ | Dễ chọn, thao tác bàn phím được, bỏ vòng lặp animation liên tục |
| Tải dữ liệu trung tâm | Chỉ truy vấn khi mở khu vực trung tâm; chống tải trùng và có nút thử lại | Giảm truy vấn không cần thiết lúc vào trang chủ |
| Menu | Tìm chức năng theo tên, hỗ trợ tìm không dấu và chỉ tìm trong các mục có quyền | Giảm bước mở nhiều nhóm để tìm chức năng |
| Ngữ cảnh điều hướng | Ưu tiên khu vực của trang đang mở thay vì khu vực đã lưu trước đó | Menu đi cùng tác vụ hiện tại |
| Quyền mở rộng | Trang chủ dùng cùng `canAccess` và `module_key` với shell | Tránh được cấp quyền nhưng trang chủ không hiển thị |
| Nhóm không có quyền | Bỏ các nhóm/khu vực trống khỏi trang chủ | Giảm lựa chọn không sử dụng được; không xóa nghiệp vụ gốc |
| Hộp thoại chung | Escape, giữ focus trong hộp thoại, trả focus khi đóng; mặc định focus Hủy ở xác nhận | Dùng bàn phím thuận tiện, giảm thao tác nhầm |
| Hộp thoại nhập | Escape dấu nháy trong value/placeholder và escape tiêu đề/nút | Sửa lỗi chèn thuộc tính HTML từ nội dung đầu vào |
| Trang phê duyệt | Không tự khởi tạo khi được nhập chỉ để đếm công việc; bổ sung departmentId khi đếm | Sửa khởi tạo thừa trên trang chủ và điều kiện duyệt theo phòng ban |
| Đăng nhập | Bỏ “Ghi nhớ đăng nhập” không hoạt động; nút quên mật khẩu có hướng dẫn; phục hồi nút khi lỗi mạng | Trạng thái rõ ràng, không kẹt nút |
| Phiên nhân viên | Kiểm tra trạng thái active và yêu cầu đổi mật khẩu ở trang chủ/shell | Đồng nhất điều kiện vào ứng dụng; đây là lớp UI, không thay thế backend |
| Chấm công nhanh | Dừng GPS khi đóng/rời trang, khởi động lại khi mở; thay handler chọn trung tâm thay vì cộng dồn; chặn gửi lặp khi đang gửi | Giảm theo dõi thừa và tránh trạng thái nút không đúng |
| Bảng và modal | Modal có giới hạn chiều cao, nút đủ lớn trên mobile; bảng có colspan giữ cấu trúc cột | Form dài và báo cáo dễ thao tác hơn |
| Service worker | Cache version mới; chỉ xử lý file local GET; không cache env.js/cross-origin; không lưu response lỗi; fallback 503 khi không có cache | Giảm cache sai và lỗi khi mất mạng |
| Thông báo đẩy | Chỉ mở URL trong cùng origin | Tránh mở URL ngoài ứng dụng từ payload |
| Lỗi cổng phụ huynh | Escape thông báo lỗi trước khi render | Không đưa nội dung lỗi thô vào HTML |

## Thành phần đã loại bỏ

- `app/js/fortuneWidget.js`, HTML/CSS tiện ích tử vi/xin quẻ.
- `app/js/dashboard.js`: triển khai dashboard cũ không còn được trang HTML gọi. Giữ `dashboard.html` làm redirect để liên kết cũ vẫn hoạt động.
- Bảng ánh xạ emoji cho từng mục bị trùng với icon sẵn trong navConfig; phần mục công việc sử dụng nguồn icon chung.
- Tải font Fraunces trên hai giao diện; dùng Be Vietnam Pro và font hệ thống dự phòng.
- Mã tạo vị trí/quỹ đạo trung tâm chạy bằng requestAnimationFrame.

Không xóa bảng, migration, tài chính, học vụ, mạng xã hội hoặc tính năng chỉ vì đang ẩn theo vai trò. Mã nguồn không có thống kê sử dụng để chứng minh các tính năng đó không dùng. Xóa chúng cần xác nhận dữ liệu thực tế và đầy đủ phụ thuộc API, RLS, webhook, phê duyệt. Việc tinh gọn trên đây giảm tài nguyên giao diện; không đồng nghĩa giảm dung lượng database.

## Kiểm chứng đã thực hiện

- Kiểm tra cú pháp toàn bộ JavaScript của hai frontend và đường dẫn src/href/import tương đối: không phát hiện lỗi.
- 8 kiểm thử DOM với Supabase giả lập: trang chủ khởi tạo, truy vấn trung tâm trì hoãn, thẻ trung tâm mở workspace, vòng đời GPS, escape thuộc tính prompt, Escape và focus Hủy, quyền mở rộng, tìm chức năng không dấu trong shell.
- Mã kiểm thử nằm trong `tests/`, kèm hướng dẫn chạy lại.
- Không thực hiện ghi dữ liệu vào Supabase, gọi thanh toán, chạy migration hoặc triển khai website.

Môi trường hiện tại không có Chromium và tải browser không thành công. Vì vậy chưa chạy được kiểm thử hiển thị bằng trình duyệt thật, chụp màn hình, xác nhận overflow và kích thước chạm trên các thiết bị. Các test DOM không đo layout CSS.

## Điểm cần nghiệm thu trên staging

1. Desktop 1440px, tablet 768px, mobile 390px: đăng nhập, trang chủ, menu, bảng có colspan, modal dài, bàn phím và safe area.
2. Vai trò: nhân viên, giáo viên, tư vấn viên, quản lý trung tâm, trưởng/phó phòng, điều hành và kỹ thuật; thử quyền cấp thêm và quyền bị thu hồi.
3. Luồng tài chính: tạo phiếu → duyệt đúng cấp → ghi sổ/đối soát; học phí → hóa đơn → webhook SePay → ví; hoàn phí, khóa sổ và bảng lương.
4. Học vụ: liên kết phụ huynh/học viên, chuyển lớp, lịch dạy, điểm danh và chấm điểm.
5. Ký số/PDF: quyền truy cập file private, mở tài liệu, ký, lưu và thứ tự phê duyệt.
6. PWA: nâng từ cache v120 sang v121, refresh, mất mạng và thông báo đẩy.
7. RLS và Edge Functions: kiểm chứng migrations thật đã áp dụng; đối chiếu báo cáo cũ với schema server hiện tại. Frontend không thể chứng minh RLS hoặc toàn vẹn tài chính.
8. Số việc chờ duyệt hiện đọc tối đa 300 bản ghi mỗi nguồn theo thiết kế cũ; khi dữ liệu lớn cần RPC đếm/phân trang phía server. Không khẳng định đây là tổng tuyệt đối của toàn bộ lịch sử.

## Chạy thử

AIS OFFICE dùng đường dẫn tuyệt đối `/js`, `/css`, `/hr`... nên phải phục vụ `app/` làm web root:

```sh
python3 -m http.server 8000 --directory app
```

Cổng phụ huynh phục vụ riêng:

```sh
python3 -m http.server 8001 --directory ais-center
```

Truy cập `http://localhost:8000/` hoặc `http://localhost:8001/`. Cấu hình Supabase/Google hiện có trong các env.js được giữ nguyên từ file người dùng gửi. Nên chạy với môi trường staging trước khi dùng production. Test DOM trong `tests/` dùng mock và không cần tài khoản thật.

## Nội dung gói bàn giao

Có toàn bộ mã nguồn hai frontend, Supabase migrations/functions, tài liệu cũ, báo cáo này và bộ kiểm thử. Không đưa thư mục `.git`, `.temp`, node_modules hoặc dữ liệu chạy tạm vào gói, nhằm giảm dung lượng và tránh mang lịch sử/cache vào bản bàn giao. Không sửa nội dung migration hoặc xóa dữ liệu server.
