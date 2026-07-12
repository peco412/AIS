// =====================================================================
// Edge Function: sepay-webhook
// Nhan webhook tu SePay moi khi co giao dich chuyen khoan vao tai khoan
// ngan hang da lien ket - tu dong doi chieu theo transfer_content (ma
// noi dung chuyen khoan, vd "NAP A1B2C3D4") va cong Coin vao vi tuong ung.
//
// TRIEN KHAI (chay tu may tinh, can cai Supabase CLI):
//   supabase functions deploy sepay-webhook --no-verify-jwt
//   supabase secrets set SEPAY_API_KEY=<dan_API_Key_ban_tao_ben_SePay>
//
// Sau khi deploy xong, lay URL function (dang):
//   https://<project-ref>.supabase.co/functions/v1/sepay-webhook
// Dan URL nay vao SePay: Webhooks -> Them webhook -> Goi den URL, chon
// xac thuc "API Key", dien DUNG API_KEY da set o buoc tren.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEPAY_API_KEY = Deno.env.get('SEPAY_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Chỉ chấp nhận POST' }), { status: 405 });
  }

  // Xac thuc — SePay gui header "Authorization: Apikey <API_KEY>" theo
  // dung tai lieu (https://docs.sepay.vn). Kiem tra khop dung API Key da
  // cau hinh (luu qua `supabase secrets set`, khong hardcode trong code).
  const authHeader = req.headers.get('authorization') || '';
  const expectedAuth = `Apikey ${SEPAY_API_KEY}`;
  if (authHeader !== expectedAuth) {
    console.error('SePay webhook: sai Authorization header.');
    return new Response(JSON.stringify({ error: 'Không xác thực được' }), { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Payload không hợp lệ' }), { status: 400 });
  }

  // CAN KIEM TRA LAI DUNG TEN TRUONG THAT khi co payload mau tu SePay
  // (dung tinh nang "Gui thu" trong dashboard SePay de xem cau truc that
  // truoc khi dua vao san xuat) — cac ten duoi day dua theo tai lieu cong
  // khai, co the can dieu chinh cho khop 100% phien ban SePay dang dung.
  const transactionId = String(payload.id ?? payload.transactionId ?? payload.referenceCode ?? '');
  const amountVnd = Number(payload.transferAmount ?? payload.amount ?? 0);
  const content = String(payload.content ?? payload.description ?? payload.transferContent ?? '');
  const transferType = String(payload.transferType ?? payload.type ?? 'in');

  // Chi xu ly giao dich TIEN VAO (khong xu ly tien ra, tranh nham lan).
  if (transferType !== 'in' && transferType.toLowerCase() !== 'credit') {
    return new Response(JSON.stringify({ status: 'ignored_not_credit' }), { status: 200 });
  }

  // Trich ra dung ma noi dung chuyen khoan (transfer_content dang "NAP
  // XXXXXXXX") tu noi dung day du SePay gui ve (co the kem theo van ban
  // khac cua ngan hang truoc/sau ma nay).
  const match = content.match(/NAP[A-Z0-9]{6,}/i);
  const transferContent = match ? match[0].toUpperCase() : content.trim().toUpperCase();

  if (!transactionId || !amountVnd || !transferContent) {
    console.warn('SePay webhook: thiếu dữ liệu cần thiết.', payload);
    return new Response(JSON.stringify({ status: 'missing_fields', received: payload }), { status: 200 });
  }

  const { data, error } = await supabase.rpc('process_sepay_webhook', {
    p_transfer_content: transferContent,
    p_amount_vnd: amountVnd,
    p_sepay_transaction_id: transactionId,
    p_raw_content: content,
    p_raw_payload: payload,
  });

  if (error) {
    console.error('process_sepay_webhook lỗi:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log('SePay webhook xử lý:', data);
  // Luon tra ve 200 cho SePay (tranh SePay retry lien tuc) dù khong khop
  // duoc yeu cau nao — truong hop "no_match" se can Ke toan tu kiem tra
  // qua trang "Khắc phục sự cố nạp ví" da xay san.
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
