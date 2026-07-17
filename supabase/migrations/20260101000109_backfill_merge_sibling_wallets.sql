-- =====================================================================
-- File 109: GỘP VÍ CHO CÁC GIA ĐÌNH ĐÃ LIÊN KẾT TỪ TRƯỚC (17/07/2026)
-- =====================================================================
-- LỖI: "Số dư không đồng bộ" — 2 con của cùng 1 phụ huynh hiện thấy 2 số
-- dư KHÁC NHAU (vd Student1 = 0, student3 = 8.000) thay vì cùng 1 ví chung.
--
-- NGUYÊN NHÂN: migration 101 (shared_family_wallet) chỉ xử lý ĐÚNG cho
-- 2 trường hợp: (a) học sinh liên kết MỚI sau khi migration 101 chạy —
-- trigger merge_wallet_on_new_link() tự gộp đúng; (b) chuyển đổi cấu trúc
-- dữ liệu CŨ sang bảng nối wallet_students — nhưng phần này (PHẦN A của
-- file 101) chỉ COPY NGUYÊN TRẠNG "1 ví - 1 học sinh" cũ sang bảng mới,
-- KHÔNG hề kiểm tra 2 học sinh có chung phụ huynh hay không để gộp ví.
-- Nghĩa là: mọi gia đình đã liên kết TỪ TRƯỚC khi có tính năng Ví chung
-- (rất có thể là phần lớn dữ liệu thật hiện có) vẫn đang giữ nguyên ví
-- riêng biệt cho từng con — đúng như ảnh chụp màn hình bạn gửi.
--
-- SỬA: chạy 1 LẦN, gộp ví cho mọi gia đình hiện có nhiều hơn 1 con nhưng
-- đang dùng nhiều ví khác nhau — làm ĐÚNG logic gộp ví (chuyển hết lô coin
-- + lịch sử nạp/rút sang 1 ví chung, xoá ví rỗng còn lại) y hệt hàm
-- merge_wallet_on_new_link() đã dùng cho các liên kết mới, chỉ khác là áp
-- dụng hàng loạt cho dữ liệu cũ thay vì từng học sinh một lúc liên kết.
-- Ví được chọn làm "ví chung" là ví có created_at SỚM NHẤT trong nhóm anh
-- chị em — khớp đúng quy tắc get_sibling_wallet_id() đang dùng, để nhất
-- quán với ví sẽ được chọn nếu có thêm 1 con nữa liên kết sau này.
--
-- SỬA THÊM (bản 2): phát hiện thêm 1 trường hợp — học sinh CHƯA TỪNG có ví
-- riêng (chưa từng nạp/mua gì, không có dòng nào trong wallet_students) bị
-- BỎ QUA hoàn toàn ở bản đầu, nên vẫn không được "ghi danh" vào ví chung —
-- giao diện thấy "chưa có ví" nên tự hiện số dư 0 thay vì đúng số dư chung
-- của anh chị em. Đây rất có thể là nguyên nhân THẬT của trường hợp trong
-- ảnh chụp màn hình (Student1 = 0đ) — không phải ví bị tách, mà là chưa
-- từng được gán vào ví nào cả. Bản này thêm bước ghi danh cho cả trường
-- hợp này.
-- An toàn chạy lại nhiều lần (idempotent) — lần chạy sau sẽ không tìm
-- thấy gì cần gộp/ghi danh thêm.
-- =====================================================================
do $$
declare
  v_parent record;
  v_target_wallet uuid;
  v_student record;
  v_own_wallet uuid;
  v_merged_count int := 0;
  v_registered_count int := 0;
begin
  for v_parent in
    select parent_account_id
    from parent_student_links
    group by parent_account_id
    having count(distinct student_id) > 1
  loop
    select ws.wallet_id into v_target_wallet
    from wallet_students ws
    join parent_student_links psl on psl.student_id = ws.student_id
    where psl.parent_account_id = v_parent.parent_account_id
    order by ws.created_at asc
    limit 1;

    if v_target_wallet is null then
      continue; -- gia đình này chưa có ví nào cả, không có gì để gộp/ghi danh
    end if;

    for v_student in
      select distinct psl.student_id
      from parent_student_links psl
      where psl.parent_account_id = v_parent.parent_account_id
    loop
      select wallet_id into v_own_wallet from wallet_students where student_id = v_student.student_id;

      if v_own_wallet = v_target_wallet then
        continue; -- đã đúng ví chung rồi
      end if;

      if v_own_wallet is null then
        -- Học sinh này CHƯA TỪNG có ví riêng — chỉ cần ghi danh vào đúng
        -- ví chung của gia đình, không có lô coin/lịch sử nào để chuyển.
        insert into wallet_students (wallet_id, student_id) values (v_target_wallet, v_student.student_id)
        on conflict (student_id) do nothing;
        v_registered_count := v_registered_count + 1;
        continue;
      end if;

      -- Học sinh có ví RIÊNG khác với ví chung của gia đình -> gộp đầy đủ
      update wallet_topup_batches set wallet_id = v_target_wallet where wallet_id = v_own_wallet;
      update wallet_topup_requests set wallet_id = v_target_wallet where wallet_id = v_own_wallet;
      update wallet_withdrawal_requests set wallet_id = v_target_wallet where wallet_id = v_own_wallet;

      delete from wallet_students where wallet_id = v_own_wallet and student_id = v_student.student_id;
      insert into wallet_students (wallet_id, student_id) values (v_target_wallet, v_student.student_id)
      on conflict (student_id) do nothing;

      delete from wallets where id = v_own_wallet
        and not exists (select 1 from wallet_students where wallet_id = v_own_wallet);

      perform append_financial_log('WALLET', 0, null, null, v_target_wallet, v_student.student_id,
        format('Gộp ví riêng vào ví chung gia đình (dọn dữ liệu liên kết từ trước khi có tính năng Ví chung — học sinh %s)', v_student.student_id));

      v_merged_count := v_merged_count + 1;
    end loop;
  end loop;

  raise notice 'Đã gộp % ví riêng + ghi danh thêm % học sinh chưa từng có ví vào đúng ví chung gia đình.', v_merged_count, v_registered_count;
end $$;