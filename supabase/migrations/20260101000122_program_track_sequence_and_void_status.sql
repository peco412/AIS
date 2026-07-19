-- =====================================================================
-- File 122: SƠ ĐỒ DỮ LIỆU CHO "BIG UPDATE" — TUYẾN CHƯƠNG TRÌNH (SEQUENCE)
-- + TRẠNG THÁI VOID (19/07/2026)
-- =====================================================================
-- GIAI ĐOẠN 1/nhiều giai đoạn của bản đặc tả mới (thay thế công thức
-- 3 lựa chọn cũ của "Ví buổi học" bằng 4 công thức mới — sẽ làm ở giai
-- đoạn sau). Giai đoạn này CHỈ dựng sơ đồ dữ liệu nền tảng.
--
-- QUYẾT ĐỊNH THIẾT KẾ quan trọng: theo bạn xác nhận, 5 "Chương trình bắt
-- buộc" trong tài liệu (Mầm non/Mẫu giáo/Trẻ em/Thiếu nhi/Thanh thiếu
-- niên) là 1 TẦNG NHÓM MỚI, NẰM TRÊN các "Chương trình" (programs) ĐANG
-- CÓ SẴN trong hệ thống (PRESCHOOL/KIDS/STARTERS/MOVERS/FLYERS/KET/PET/
-- FCE/IELTS/COMMUNICATION — đặt tên theo chuẩn thi Cambridge) — "bên
-- trong còn có các bậc nhỏ hơn" đúng như bạn mô tả. Vì vậy KHÔNG đổi tên
-- hay cấu trúc bảng "programs" đang chạy — chỉ THÊM 1 tầng nhóm mới ở
-- trên, và gắn từng chương trình hiện có vào đúng nhóm của nó. Cây đầy đủ
-- sau khi thêm:
--
--   [MỚI] Tuyến chương trình (program_tracks: Mầm non/Mẫu giáo/.../Tự chọn)
--     └── Chương trình (programs: PRESCHOOL/KIDS/.../COMMUNICATION — ĐÃ CÓ)
--            └── Cấp độ (program_levels — ĐÃ CÓ)
--                   └── Cấp độ con (program_sublevels — ĐÃ CÓ)
--                          └── Khoá học (program_courses — ĐÃ CÓ, đã có
--                              thêm định lượng buổi học ở đợt Ví buổi học)
--
-- GÁN TẠM 9/10 chương trình hiện có vào đúng tuyến theo cách hiểu hợp lý
-- nhất về độ tuổi (PRESCHOOL=Mầm non, KIDS=Mẫu giáo, STARTERS+MOVERS=Trẻ
-- em, FLYERS+KET=Thiếu nhi, PET+FCE+IELTS=Thanh thiếu niên,
-- COMMUNICATION=Tự chọn/Giao tiếp) — ĐÂY LÀ SUY ĐOÁN CỦA MÌNH DỰA TRÊN QUY
-- ƯỚC ĐỘ TUỔI THÔNG THƯỜNG, CẦN BẠN KIỂM TRA LẠI VÀ CHỈNH SỬA NẾU SAI —
-- có thể tự sửa dễ dàng qua trang "Chương trình & Bảng giá khoá học"
-- (mình sẽ thêm ô chọn Tuyến ở đó tại giai đoạn sau). "Học thuật" và
-- "One-on-One" (2 tuyến tự chọn còn lại) CHƯA có Chương trình thật nào
-- tương ứng trong dữ liệu hiện tại nên chưa gán gì — tạo Chương trình mới
-- rồi gán vào đúng tuyến khi cần.
-- =====================================================================
create table if not exists program_tracks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  -- 1-5 cho tuyen BAT BUOC (kiem tra khong nhay coc); null/0 cho tuyen
  -- TU CHON (bo qua kiem tra lien ke hoan toan).
  sequence smallint,
  is_mandatory boolean not null default true,
  display_order smallint not null default 0,
  created_at timestamptz not null default now()
);

alter table programs add column if not exists track_id uuid references program_tracks(id);
create index if not exists idx_programs_track on programs(track_id);

insert into program_tracks (code, name, sequence, is_mandatory, display_order) values
  ('MAM_NON', 'Tiếng Anh Mầm non', 1, true, 1),
  ('MAU_GIAO', 'Tiếng Anh Mẫu Giáo', 2, true, 2),
  ('TRE_EM', 'Tiếng Anh Trẻ em', 3, true, 3),
  ('THIEU_NHI', 'Tiếng Anh Thiếu Nhi', 4, true, 4),
  ('THANH_THIEU_NIEN', 'Tiếng Anh Thanh thiếu niên', 5, true, 5),
  ('HOC_THUAT', 'Tiếng Anh Học thuật', null, false, 6),
  ('GIAO_TIEP', 'Tiếng Anh Giao tiếp', null, false, 7),
  ('ONE_ON_ONE', 'Tiếng Anh theo nhu cầu (One-on-One)', null, false, 8)
on conflict (code) do nothing;

-- Gan tam cac chuong trinh DA CO vao dung tuyen — xem ghi chu o tren, can
-- ban kiem tra lai.
update programs set track_id = (select id from program_tracks where code = 'MAM_NON') where code = 'PRESCHOOL';
update programs set track_id = (select id from program_tracks where code = 'MAU_GIAO') where code = 'KIDS';
update programs set track_id = (select id from program_tracks where code = 'TRE_EM') where code in ('PREA1STARTERS', 'A1MOVERS');
update programs set track_id = (select id from program_tracks where code = 'THIEU_NHI') where code in ('A2FLYERS', 'A2KET');
update programs set track_id = (select id from program_tracks where code = 'THANH_THIEU_NIEN') where code in ('B1PET', 'B2FCE', 'IELTS');
update programs set track_id = (select id from program_tracks where code = 'GIAO_TIEP') where code = 'COMMUNICATION';

alter table program_tracks enable row level security;
create policy program_tracks_select on program_tracks for select using (true);
create policy program_tracks_write on program_tracks for all
  using (is_executive_or_tech())
  with check (is_executive_or_tech());

comment on table program_tracks is 'Tuyến chương trình (nhóm bậc tuổi) — tầng MỚI nằm trên "programs" — GIAI ĐOẠN 1 bản đặc tả mới, xem file 122.';
comment on column programs.track_id is 'Chương trình này thuộc tuyến nào — null nếu chưa gán (sẽ không bị kiểm tra vượt cấp cho tới khi gán).';

-- =====================================================================
-- Thêm trạng thái VOID cho hoá đơn — dùng ở luồng Đổi lớp tự động (giai
-- đoạn sau): huỷ hoá đơn cũ khi học sinh chuyển lớp, không xoá hẳn (giữ
-- lại để truy vết/đối soát A/B), chỉ đánh dấu không còn hiệu lực.
-- =====================================================================
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in ('draft', 'processing', 'unpaid', 'partially_paid', 'paid', 'void'));

comment on constraint invoices_status_check on invoices is 'Thêm void (19/07/2026) — hoá đơn bị huỷ khi đổi lớp, xem file 122.';
