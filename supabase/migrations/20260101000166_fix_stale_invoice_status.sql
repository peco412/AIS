-- =====================================================================
-- File 166: SUA LOI TRANG THAI HOA DON BI LECH VOI SO GHI THANH TOAN
-- THAT (28/07/2026)
-- =====================================================================
-- Trieu chung: hoa don hien "Đã đóng đủ" nhung "Đã đóng: 0đ, Còn lại:
-- 900đ" — tuc la cot status trong bang invoices dang GHI SAI, khong
-- khop voi debt_ledger (so ghi CAC LAN THANH TOAN THAT).
--
-- Nguyen nhan goc: ham refresh_invoice_status() — noi DUY NHAT tinh
-- lai dung trang thai — CHI duoc goi tai NHUNG THOI DIEM CU THE (luc
-- ghi nhan thanh toan, luc tao hoa don...), nhung KHONG CO co che nao
-- tu dong goi lai NEU sau do amount_vnd hoac manual_discount_vnd cua
-- hoa don BI SUA (vi du: doi uu dai, sua sai lech tay, hoan/doi
-- so tien...) — khien trang thai cu ("paid" tu truoc do, khi so tien
-- con thap/co giam gia nhieu) bi "dinh lai" (stale), khong con dung voi
-- so tien MOI dang can dong.
--
-- Sua 2 phan: (1) THEM TRIGGER de tu dong tinh lai moi khi so tien hoa
-- don thay doi, tranh lap lai ve sau; (2) SUA LAI NGAY toan bo hoa don
-- dang bi lech san co trong he thong.
-- =====================================================================

create or replace function trg_refresh_invoice_status_on_amount_change() returns trigger
language plpgsql as $$
begin
  if (new.amount_vnd is distinct from old.amount_vnd) or (new.manual_discount_vnd is distinct from old.manual_discount_vnd) then
    perform refresh_invoice_status(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_amount_change on invoices;
create trigger trg_invoice_amount_change
  after update of amount_vnd, manual_discount_vnd on invoices
  for each row execute function trg_refresh_invoice_status_on_amount_change();

-- SUA NGAY toan bo du lieu hien co — tinh lai dung trang thai cho MOI
-- hoa don dang ton tai, dua theo dung so tien va so ghi thanh toan
-- THAT hien tai. KHONG dong cham toi hoa don da huy ("void") hoac dang
-- cho chon hinh thuc ("draft" — trang thai nay mang y nghia rieng,
-- khong lien quan toi so tien da dong, ham refresh_invoice_status()
-- khong duoc thiet ke de giu nguyen "draft").
do $$
declare
  r record;
begin
  for r in select id from invoices where status not in ('void', 'draft') loop
    perform refresh_invoice_status(r.id);
  end loop;
end;
$$;
