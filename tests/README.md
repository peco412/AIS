# Kiểm thử AIS Workspace

```sh
cd tests
python3 static-audit.py
npm install
npm test
```

Ba bộ test: DOM/navigation giả lập Supabase; logic công và game cùng PDF Unicode thực; PostgreSQL PGlite kiểm tra migration, trạng thái, khóa và liên kết lương/đơn. Không ghi dữ liệu thực. Test DB dùng schema cũ rút gọn và hàm chốt phép giả lập; không thay kiểm thử full migration, RLS/storage Supabase và trình duyệt staging. Phụ thuộc test không đưa vào frontend.
