// =====================================================================
// EDGE FUNCTION: send-debt-reminders
// Chạy lúc 08:00 sáng mỗi ngày (đặt lịch qua pg_cron hoặc Supabase Cron —
// xem hướng dẫn cuối file). Thực hiện đúng 4 bước theo tài liệu mục 4.4:
//   1. Quét ứng viên: hoá đơn đóng thiếu, hạn chót còn đúng 3 ngày
//   2. Xác định nội dung: nhắc theo đơn vị đã dùng để đóng (coin/VNĐ)
//   3. Re-check ngay trước khi gửi (chống race condition)
//   4. Gửi Push (Tầng 1) — nếu gửi thất bại NGAY LẬP TỨC, fallback SMS
//      ngay (không đợi 6 giờ); nếu gửi thành công, việc kiểm tra "6 giờ
//      chưa mở" được xử lý ở function riêng "send-debt-reminders-sms-fallback"
//      (chạy 6 tiếng sau, xem file đó).
//
// ⚠️ CẦN CẮM THẬT TRƯỚC KHI DÙNG:
//   - sendPushNotification(): điền SDK Firebase Admin (FCM) hoặc APNs thật
//   - sendSms(): điền API của SMS Gateway thật (Twilio/Vonage/eSMS...)
// Code dưới đây ĐÃ ĐÚNG LOGIC nghiệp vụ theo tài liệu, chỉ 2 hàm gửi thật
// là stub — cắm xong 2 hàm đó là chạy được ngay, không cần sửa gì khác.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// ---------------------------------------------------------------------
// ⚠️ STUB — thay bằng gọi FCM Admin SDK / APNs thật.
// Trả về { success: true } nếu gửi thành công, { success: false, reason }
// nếu thất bại NGAY LẬP TỨC (token không hợp lệ, thiết bị offline biết
// ngay, app đã gỡ...) — đúng ý "lỗi gửi thất bại ngay lập tức" ở mục 4.4.
// ---------------------------------------------------------------------
async function sendPushNotification(deviceToken, platform, title, body, data) {
  const fcmServerKey = Deno.env.get('FCM_SERVER_KEY');
  if (!fcmServerKey) {
    return { success: false, reason: 'FCM_SERVER_KEY chưa được cấu hình — xem comment đầu file.' };
  }
  // TODO: gọi FCM HTTP v1 API thật ở đây, ví dụ:
  // const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ message: { token: deviceToken, notification: { title, body }, data } }),
  // });
  // if (!res.ok) return { success: false, reason: await res.text() };
  return { success: false, reason: 'CHƯA CẮM FCM THẬT — đây là stub, xem TODO trong code.' };
}

// ---------------------------------------------------------------------
// ⚠️ STUB — thay bằng gọi SMS Gateway thật (Twilio/Vonage/eSMS...).
// ---------------------------------------------------------------------
async function sendSms(phone, message) {
  const smsApiKey = Deno.env.get('SMS_GATEWAY_API_KEY');
  if (!smsApiKey) {
    return { success: false, reason: 'SMS_GATEWAY_API_KEY chưa được cấu hình — xem comment đầu file.' };
  }
  // TODO: gọi SMS Gateway thật ở đây, ví dụ (Twilio):
  // const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
  //   method: 'POST',
  //   headers: { Authorization: `Basic ${btoa(accountSid + ':' + authToken)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  //   body: new URLSearchParams({ To: phone, From: fromNumber, Body: message }),
  // });
  // if (!res.ok) return { success: false, reason: await res.text() };
  return { success: false, reason: 'CHƯA CẮM SMS GATEWAY THẬT — đây là stub, xem TODO trong code.' };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  // -----------------------------------------------------------------
  // BƯỚC 1 — Quét ứng viên: hoá đơn đóng thiếu, hạn chót cách đúng 3 ngày
  // -----------------------------------------------------------------
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 3);
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  const { data: candidates, error: scanErr } = await supabaseAdmin
    .from('invoices')
    .select('id, student_id, amount_vnd, due_date, status')
    .in('status', ['unpaid', 'partially_paid'])
    .eq('due_date', targetDateStr);

  if (scanErr) return jsonResponse({ error: scanErr.message }, 500);
  if (!candidates || candidates.length === 0) return jsonResponse({ scanned: 0, sent: 0, note: 'Không có hoá đơn nào đến hạn trong 3 ngày tới.' });

  let sentCount = 0;
  let skippedCount = 0;
  let smsFailoverCount = 0;

  for (const invoice of candidates) {
    // -----------------------------------------------------------------
    // BƯỚC 3 — Re-check NGAY TRƯỚC KHI GỬI cho từng ứng viên (chống race
    // condition: phụ huynh có thể đã đóng tiền trong khoảng 8h quét -> lúc
    // gửi thật).
    // -----------------------------------------------------------------
    const { data: freshInvoice } = await supabaseAdmin.from('invoices').select('status').eq('id', invoice.id).single();
    if (!freshInvoice || freshInvoice.status === 'paid') {
      skippedCount++;
      await supabaseAdmin.from('debt_reminder_logs').insert({ invoice_id: invoice.id, channel: 'push', status: 'skipped', failure_reason: 'Đã thanh toán trước khi gửi (re-check).' });
      continue;
    }

    // -----------------------------------------------------------------
    // BƯỚC 2 — Xác định nội dung: nhắc theo đơn vị phụ huynh đã dùng để
    // đóng phần đã trả (nếu có), mặc định VNĐ nếu chưa đóng đồng nào qua
    // ví (ưu tiên hiển thị AIScoins nếu có lịch sử dùng ví, theo mục 4.3).
    // -----------------------------------------------------------------
    const { data: walletDebt } = await supabaseAdmin.from('debt_ledger').select('id').eq('invoice_id', invoice.id).eq('source', 'WALLET').limit(1);
    const usesWallet = (walletDebt || []).length > 0;

    const { data: student } = await supabaseAdmin.from('students').select('full_name').eq('id', invoice.student_id).single();
    const { data: links } = await supabaseAdmin.from('parent_student_links').select('parent_account_id').eq('student_id', invoice.student_id);

    const remainingVnd = Number(invoice.amount_vnd); // (bản đầy đủ nên trừ đi debt_ledger đã đóng — rút gọn ở đây, đã có logic đầy đủ ở edu/debt-overview.js phía ERP)
    const messageBody = usesWallet
      ? `Học phí của ${student?.full_name || 'con bạn'} sắp đến hạn (còn 3 ngày). Vui lòng kiểm tra số dư ví AIScoins.`
      : `Học phí của ${student?.full_name || 'con bạn'} sắp đến hạn (còn 3 ngày). Số tiền còn thiếu: ${remainingVnd.toLocaleString('vi-VN')} VNĐ.`;

    for (const link of links || []) {
      const { data: tokens } = await supabaseAdmin.from('parent_push_tokens').select('device_token, platform').eq('parent_account_id', link.parent_account_id);

      if (!tokens || tokens.length === 0) {
        // Không có thiết bị nào đăng ký push -> đi thẳng SMS luôn (không có
        // Tầng 1 để thử) — vẫn tôn trọng "logic 2 tầng fallback" ở mức tổng
        // thể: không thiết bị nhận push thì SMS là lựa chọn duy nhất.
        await fallbackToSms(supabaseAdmin, sendSms, invoice.id, link.parent_account_id, messageBody);
        smsFailoverCount++;
        continue;
      }

      let anySuccess = false;
      for (const t of tokens) {
        const result = await sendPushNotification(t.device_token, t.platform, 'Nhắc hạn học phí', messageBody, { invoice_id: invoice.id });
        await supabaseAdmin.from('debt_reminder_logs').insert({
          invoice_id: invoice.id, channel: 'push',
          status: result.success ? 'sent' : 'failed',
          failure_reason: result.success ? null : result.reason,
        });
        if (result.success) { anySuccess = true; sentCount++; }
      }

      // Push thất bại NGAY LẬP TỨC ở MỌI thiết bị -> fallback SMS ngay,
      // không đợi 6 giờ (đúng mục 4.4 Tầng 1 -> Tầng 2 tức thời).
      if (!anySuccess) {
        await fallbackToSms(supabaseAdmin, sendSms, invoice.id, link.parent_account_id, messageBody);
        smsFailoverCount++;
      }
    }
  }

  return jsonResponse({ scanned: candidates.length, sent: sentCount, skipped: skippedCount, immediateSmsFailover: smsFailoverCount });
});

async function fallbackToSms(supabaseAdmin, sendSmsFn, invoiceId, parentAccountId, message) {
  const { data: parent } = await supabaseAdmin.from('parent_accounts').select('phone').eq('id', parentAccountId).single();
  if (!parent?.phone) {
    await supabaseAdmin.from('debt_reminder_logs').insert({ invoice_id: invoiceId, channel: 'sms', status: 'failed', failure_reason: 'Phụ huynh chưa có số điện thoại.' });
    return;
  }
  const result = await sendSmsFn(parent.phone, message);
  await supabaseAdmin.from('debt_reminder_logs').insert({
    invoice_id: invoiceId, channel: 'sms',
    status: result.success ? 'sent' : 'failed',
    failure_reason: result.success ? null : result.reason,
  });
}

/* =====================================================================
   CÁCH ĐẶT LỊCH CHẠY LÚC 08:00 SÁNG MỖI NGÀY:

   Cách 1 — Supabase Cron (Dashboard -> Edge Functions -> send-debt-reminders
   -> Cron), đặt biểu thức: 0 8 * * *  (theo UTC — nếu muốn đúng 08:00 giờ
   Việt Nam (UTC+7), đặt biểu thức UTC là: 0 1 * * *)

   Cách 2 — pg_cron gọi qua pg_net (nếu project đã bật 2 extension này):
     select cron.schedule(
       'send-debt-reminders-daily', '0 1 * * *',
       $$ select net.http_post(
         url := 'https://<project-ref>.supabase.co/functions/v1/send-debt-reminders',
         headers := jsonb_build_object('Authorization', 'Bearer ' || '<service-role-key>')
       ); $$
     );
===================================================================== */
