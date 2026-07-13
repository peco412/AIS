// =====================================================================
// Edge Function: sepay-webhook
// Nhan webhook tu SePay moi khi co giao dich chuyen khoan vao tai khoan
// ngan hang da lien ket - tu dong doi chieu theo transfer_content (ma
// noi dung chuyen khoan, vd "NAP A1B2C3D4") va cong Coin vao vi tuong ung.
//
// SUA LOI QUAN TRONG (doi chieu lai voi tai lieu chinh thuc SePay):
// 1) SePay CHI tinh la THANH CONG khi phan hoi DUNG CA 3: (a) HTTP 200/
//    201, (b) body JSON DUNG Y HET {"success": true} (khong duoc them
//    bot truong nao khac!), (c) tra ve trong 30 giay. Truoc day ham nay
//    tra ve nguyen ket qua RPC (vd {status:"confirmed", request_id:...})
//    — SAI cau truc, khien SePay LUON coi la THAT BAI va gui lai lien
//    tuc du xu ly dung ben trong.
// 2) Uu tien dung truong "code" (SePay da tu tach san ma thanh toan dua
//    theo "Payment Code Structure" cau hinh ben Cong ty > Cau hinh
//    chung) thay vi tu do regex tren "content" — dang tin cay hon nhieu.
//
// TRIEN KHAI (chay tu may tinh, can cai Supabase CLI):
//   supabase functions deploy sepay-webhook --no-verify-jwt
//   supabase secrets set SEPAY_API_KEY=<dan_API_Key_ban_tao_ben_SePay>
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEPAY_API_KEY = Deno.env.get('SEPAY_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Phan hoi DUY NHAT hop le theo dung dac ta SePay — dung LAI CHINH XAC
// object nay o MOI truong hop tra ve 200, khong duoc sua doi gi them.
const SEPAY_SUCCESS_BODY = JSON.stringify({ success: true });
function sepayOk() {
  return new Response(SEPAY_SUCCESS_BODY, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Chỉ chấp nhận POST' }), { status: 405 });
  }

  // Xac thuc — SePay gui header "Authorization: Apikey <API_KEY>" theo
  // dung tai lieu (https://developer.sepay.vn/en/sepay-webhooks/xac-thuc).
  const authHeader = req.headers.get('authorization') || '';
  const expectedAuth = `Apikey ${SEPAY_API_KEY}`;
  if (authHeader !== expectedAuth) {
    console.error('SePay webhook: sai Authorization header.');
    // Loi xac thuc KHONG tra ve sepayOk() — day la loi that, can SePay
    // biet va bao cho quan tri xu ly, khac voi "khong khop yeu cau nao"
    // (van la nhan thanh cong, chi la khong tim thay de xu ly tiep).
    return new Response(JSON.stringify({ error: 'Không xác thực được' }), { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Payload không hợp lệ' }), { status: 400 });
  }

  const transactionId = String(payload.id ?? '');
  const amountVnd = Number(payload.transferAmount ?? 0);
  const rawContent = String(payload.content ?? '');
  const transferType = String(payload.transferType ?? 'in');

  // Chi xu ly giao dich TIEN VAO — tien ra van tra sepayOk() (da "nhan"
  // request thanh cong, chi la khong can xu ly gi them).
  if (transferType !== 'in') {
    return sepayOk();
  }

  // UU TIEN dung "code" SePay da tu tach san (dua theo Payment Code
  // Structure da cau hinh ben SePay) — chi ROI VE tu regex tren content
  // khi "code" la null (chua cau hinh, hoac khong khop prefix nao).
  let transferContent: string;
  if (payload.code) {
    transferContent = String(payload.code).toUpperCase();
  } else {
    const match = rawContent.match(/NAP[A-Z0-9]{6,}/i);
    transferContent = match ? match[0].toUpperCase() : rawContent.trim().toUpperCase();
  }

  if (!transactionId || !amountVnd || !transferContent) {
    console.warn('SePay webhook: thiếu dữ liệu cần thiết.', payload);
    return sepayOk(); // van tra thanh cong — da "nhan" duoc, chi thieu du lieu de xu ly tiep
  }

  const { data, error } = await supabase.rpc('process_sepay_webhook', {
    p_transfer_content: transferContent,
    p_amount_vnd: amountVnd,
    p_sepay_transaction_id: transactionId,
    p_raw_content: rawContent,
    p_raw_payload: payload,
  });

  if (error) {
    console.error('process_sepay_webhook lỗi:', error.message);
    // Day la loi THAT (vd DB tam thoi loi) — KHONG tra sepayOk(), de SePay
    // tu dong thu lai theo lich retry cua ho, tranh mat du lieu giao dich.
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log('SePay webhook xử lý:', data);
  // Du khop duoc yeu cau (confirmed) hay khong (no_match — se can Ke
  // toan tu doi chieu qua trang "Khắc phục sự cố nạp ví") thi request
  // NAY van coi la "nhan thanh cong" theo dung nghia SePay quy dinh —
  // PHAI tra dung {"success": true}, khong duoc tra nguyen ket qua RPC.
  return sepayOk();
});
