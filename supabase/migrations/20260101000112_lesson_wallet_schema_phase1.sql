-- =====================================================================
-- File 112: SƠ ĐỒ DỮ LIỆU CHO MÔ HÌNH "VÍ SỐ BUỔI HỌC" (18/07/2026)
-- =====================================================================
-- Đây là GIAI ĐOẠN 1/nhiều giai đoạn của việc đổi lõi hệ thống từ đơn vị
-- "AIScoins/VNĐ" sang "Số buổi học" theo tài liệu bạn gửi. Giai đoạn này
-- CHỈ dựng sơ đồ dữ liệu nền tảng — CHƯA đổi state machine hoá đơn, CHƯA
-- có cron quét tự động, CHƯA khoá điểm danh, CHƯA có công thức hoàn tiền
-- mới (những phần đó là các giai đoạn sau, cần bàn kỹ từng phần trước khi
-- đổi vì đụng trực tiếp tới tiền thật).
--
-- Nguyên tắc thiết kế để đạt đúng yêu cầu "100% chính xác":
--   1) available_lessons dùng cột GENERATED ALWAYS AS — Postgres tự tính,
--      KHÔNG BAO GIỜ có thể bị lệch khỏi công thức
--      Available = Total_Purchased - Allocated, vì đây là cột do chính
--      database tính ra, không phải do code tính rồi ghi vào (nguồn lỗi
--      phổ biến nhất khi 2 nơi tính cùng 1 công thức mà quên đồng bộ).
--   2) Thêm sổ cái "student_lesson_transactions" — ghi lại TỪNG thay đổi
--      số buổi (mua thêm, bốc vào lớp, học xong 1 buổi, hoàn buổi khi rút
--      học phí...) — dùng ĐÚNG nguyên lý sổ cái (ledger) đã áp dụng thành
--      công cho Ví AIScoins trong suốt các đợt vá trước (debt_ledger,
--      wallet_topup_batches) — mọi số dư đều PHẢI truy ngược được về
--      đúng giao dịch nào tạo ra nó, không có con số nào "từ trên trời".
--   3) classes.subcourse_id là CỘT MỚI, CHO PHÉP RỖNG (không bắt buộc) —
--      lớp học cũ vẫn hoạt động bình thường qua sublevel_id như trước,
--      tránh phá vỡ toàn bộ dữ liệu đang chạy trong 1 lần đổi.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — Thêm tầng thứ 4 "Khoá nhỏ" vào cây chương trình đào tạo.
-- Cây hiện tại: programs -> program_levels -> program_sublevels (3 tầng).
-- Cây mới theo tài liệu: thêm "Khoá nhỏ" bên dưới program_sublevels,
-- định lượng theo Số tuần -> Số buổi/tuần -> Số tiết/buổi. Đơn vị GỐC mà
-- Ví buổi học dùng là "Số buổi" (total_sessions) — số tuần và tiết/buổi
-- chỉ là thông tin mô tả/lên lịch, không phải đơn vị ví.
-- =====================================================================
create table if not exists program_subcourses (
  id uuid primary key default gen_random_uuid(),
  sublevel_id uuid not null references program_sublevels(id) on delete cascade,
  name text not null,
  weeks int not null check (weeks > 0),
  sessions_per_week int not null check (sessions_per_week > 0),
  periods_per_session int not null default 1 check (periods_per_session > 0),
  -- Tong so buoi (Lessons) cua khoa nho nay — DAY LA DON VI VI DUNG, tu
  -- tinh = tuan x buoi/tuan, khong bao gio lech vi la cot generated.
  total_sessions int generated always as (weeks * sessions_per_week) stored,
  -- Gia goc KHONG GIAM cua khoa nho nay — bat buoc phai co de sau nay
  -- tinh dung cong thuc hoan tien chong truc loi (muc V.2 tai lieu):
  -- hoan = tong da dong - so khoa nho da hoc x GIA GOC khoa nho do.
  base_price_vnd numeric not null check (base_price_vnd >= 0),
  display_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create index idx_program_subcourses_sublevel on program_subcourses(sublevel_id);

alter table classes add column if not exists subcourse_id uuid references program_subcourses(id);
create index if not exists idx_classes_subcourse on classes(subcourse_id);

-- =====================================================================
-- PHẦN 2 — Ví buổi học của học sinh: 3 trạng thái theo đúng tài liệu.
-- available_lessons KHÔNG BAO GIỜ tự ghi tay — luôn để Postgres tính,
-- đảm bảo đúng công thức 100% mọi lúc, kể cả khi có bug ở tầng ứng dụng.
-- =====================================================================
alter table students add column if not exists total_purchased_lessons int not null default 0
  check (total_purchased_lessons >= 0);
alter table students add column if not exists allocated_lessons int not null default 0
  check (allocated_lessons >= 0);
alter table students add column if not exists available_lessons int
  generated always as (total_purchased_lessons - allocated_lessons) stored;
-- Rang buoc quan trong: KHONG duoc phan bo (allocate) nhieu hon so buoi
-- da mua — chan dung tu tang truoc khi co RPC rieng kiem soat logic nay
-- o giai doan sau, phong truong hop ai do UPDATE truc tiep nham.
alter table students add constraint chk_students_lessons_not_negative
  check (allocated_lessons <= total_purchased_lessons);

-- =====================================================================
-- PHẦN 3 — Sổ cái buổi học (student_lesson_transactions): ghi lại TỪNG
-- thay đổi, đúng nguyên lý ledger đã dùng cho Ví AIScoins — mọi con số
-- trên students.total_purchased_lessons/allocated_lessons đều PHẢI cộng
-- dồn đúng từ các dòng trong bảng này, không có ngoại lệ. Đây là nền để
-- các giai đoạn sau (mua thêm qua hoá đơn, bốc vào lớp, hoàn tiền...) ghi
-- vào — bản thân RPC ghi/thay đổi số buổi CHƯA làm ở giai đoạn này.
-- =====================================================================
create table if not exists student_lesson_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  -- 'purchase'   = mua thêm qua hoá đơn (Total_Purchased tăng)
  -- 'allocate'   = bốc từ kho khả dụng vào 1 lớp cụ thể (Allocated tăng)
  -- 'deallocate' = rút khỏi lớp trả về khả dụng (Allocated giảm, vd đổi lớp)
  -- 'consume'    = học xong 1 buổi thật (Allocated giảm, Total_Purchased giảm theo — tiêu hao thật)
  -- 'refund_adjust' = điều chỉnh khi làm thủ tục hoàn học phí giữa chừng
  transaction_type text not null check (transaction_type in ('purchase', 'allocate', 'deallocate', 'consume', 'refund_adjust')),
  lesson_delta int not null, -- so buoi thay doi, am hoac duong tuy loai
  class_id uuid references classes(id), -- lop lien quan (bat buoc voi allocate/deallocate/consume)
  invoice_id uuid references invoices(id), -- hoa don lien quan (bat buoc voi purchase/refund_adjust)
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_lesson_tx_student on student_lesson_transactions(student_id);
create index idx_lesson_tx_class on student_lesson_transactions(class_id);
create index idx_lesson_tx_invoice on student_lesson_transactions(invoice_id);

alter table program_subcourses enable row level security;
alter table student_lesson_transactions enable row level security;

-- Doc: giong dung quyen xem chuong trinh/lop hoc hien co (moi nhan vien
-- da dang nhap deu xem duoc danh muc chuong trinh) — ghi se lam qua RPC
-- rieng o giai doan sau (SECURITY DEFINER), CHUA mo quyen ghi truc tiep
-- o day de tranh lo hong y het lop debt_ledger da gap truoc do.
create policy program_subcourses_select on program_subcourses for select using (true);
create policy lesson_tx_select on student_lesson_transactions for select using (
  current_department_id() = (select id from departments where code='EDU')
  or current_department_id() = (select id from departments where code='ACC')
  or is_executive_or_tech()
  or current_role_code() = 'CENTER_MANAGER'
);

comment on table program_subcourses is 'Tầng thứ 4 (Khoá nhỏ) trong cây chương trình — GIAI ĐOẠN 1 mô hình Ví buổi học, xem file 112.';
comment on table student_lesson_transactions is 'Sổ cái buổi học — mọi thay đổi total_purchased_lessons/allocated_lessons của học sinh phải truy ngược được về đây. GIAI ĐOẠN 1, xem file 112.';
comment on column students.available_lessons is 'TỰ TÍNH (generated) = total_purchased_lessons - allocated_lessons — không bao giờ ghi tay cột này.';
