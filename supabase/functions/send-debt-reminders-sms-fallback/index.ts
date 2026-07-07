// =====================================================================
// EDGE FUNCTION: send-debt-reminders-sms-fallback
// Chạy ĐỊNH KỲ MỖI GIỜ (không phải 1 lần/ngày như send-debt-reminders) —
// mỗi lần chạy tự tìm đúng những lượt push đã gửi THÀNH CÔNG cách đây
// ĐÚNG 6 TIẾNG TRỞ LÊN mà phụ huynh VẪN CHƯA MỞ (opened_at is null) và
// CHƯA từng có SMS fallback nào được gửi cho cùng invoice đó — đúng Tầng 2
// theo tài liệu mục 4.4.
//
// ⚠️ CẦN CẮM THẬT: sendSms() — xem chi tiết trong send-debt-reminders/index.ts
// (copy nguyên hàm đó sang đây sau khi đã cắm xong, để tránh lệch code).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// ⚠️ STUB — dán lại đúng nội dung hàm sendSms() thật đã cắm ở
// send-debt-reminders/index.ts vào đây (giữ 2 bản giống hệt nhau).
async function sendSms(phone, message) {
  const smsApiKey = Deno.env.get('SMS_GATEWAY_API_KEY');
  if (!smsApiKey) return { success: false, reason: 'SMS_GATEWAY_API_KEY chưa được cấu hình.' };
  return { success: false, reason: 'CHƯA CẮM SMS GATEWAY THẬT — đây là stub.' };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  // Tìm các lượt push ĐÃ GỬI THÀNH CÔNG >= 6 tiếng trước, CHƯA MỞ.
  const { data: unopenedPushes, error } = await supabaseAdmin
    .from('debt_reminder_logs')
    .select('id, invoice_id, sent_at')
    .eq('channel', 'push')
    .eq('status', 'sent')
    .is('opened_at', null)
    .lte('sent_at', sixHoursAgo);

  if (error) return jsonResponse({ error: error.message }, 500);
  if (!unopenedPushes || unopenedPushes.length === 0) return jsonResponse({ checked: 0, smsSent: 0 });

  let smsSentCount = 0;
  const processedInvoices = new Set();

  for (const push of unopenedPushes) {
    // Mỗi invoice chỉ fallback SMS 1 lần dù có nhiều thiết bị/nhiều lượt push
    if (processedInvoices.has(push.invoice_id)) continue;

    // Đã có SMS fallback cho invoice này rồi (từ lần chạy giờ trước) -> bỏ qua
    const { data: existingSms } = await supabaseAdmin
      .from('debt_reminder_logs')
      .select('id')
      .eq('invoice_id', push.invoice_id)
      .eq('channel', 'sms')
      .limit(1);
    if (existingSms && existingSms.length > 0) { processedInvoices.add(push.invoice_id); continue; }

    // Re-check trạng thái hoá đơn ngay trước khi gửi SMS — nếu đã đóng rồi
    // thì không cần nhắc nữa (cùng nguyên tắc chống race condition ở bước 3).
    const { data: invoice } = await supabaseAdmin.from('invoices').select('id, student_id, amount_vnd, status').eq('id', push.invoice_id).single();
    if (!invoice || invoice.status === 'paid') {
      processedInvoices.add(push.invoice_id);
      continue;
    }

    const { data: student } = await supabaseAdmin.from('students').select('full_name').eq('id', invoice.student_id).single();
    const { data: links } = await supabaseAdmin.from('parent_student_links').select('parent_account_id').eq('student_id', invoice.student_id);

    const message = `Nhắc lại: Học phí của ${student?.full_name || 'con bạn'} sắp đến hạn, còn thiếu ${Number(invoice.amount_vnd).toLocaleString('vi-VN')} VNĐ.`;

    for (const link of links || []) {
      const { data: parent } = await supabaseAdmin.from('parent_accounts').select('phone').eq('id', link.parent_account_id).single();
      if (!parent?.phone) continue;

      const result = await sendSms(parent.phone, message);
      await supabaseAdmin.from('debt_reminder_logs').insert({
        invoice_id: invoice.id, channel: 'sms',
        status: result.success ? 'sent' : 'failed',
        failure_reason: result.success ? null : result.reason,
      });
      if (result.success) smsSentCount++;
    }
    processedInvoices.add(push.invoice_id);
  }

  return jsonResponse({ checked: unopenedPushes.length, smsSent: smsSentCount });
});

/* =====================================================================
   ĐẶT LỊCH CHẠY MỖI GIỜ (Supabase Cron): 0 * * * *
===================================================================== */
