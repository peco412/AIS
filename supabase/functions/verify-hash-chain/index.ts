// =====================================================================
// EDGE FUNCTION: verify-hash-chain
// Chạy hàng đêm (mục 3.2) — đọc toàn bộ financial_transaction_logs theo
// đúng thứ tự thời gian của TỪNG nguồn (WALLET/CASH/BANK_TRANSFER riêng),
// so khớp prev_hash của mỗi bản ghi với hash THẬT của bản ghi liền trước.
// Nếu 1 bản ghi ở giữa chuỗi bị sửa trực tiếp trong DB, hash của nó thay
// đổi -> mọi prev_hash phía sau không còn khớp -> phát hiện được.
//
// Không cần cắm gì thêm để chạy được — chỉ cần cắm kênh CẢNH BÁO nếu muốn
// (mặc định chỉ trả JSON kết quả + log console; có thể nối thêm gửi email/
// Slack cảnh báo ở cuối hàm nếu phát hiện đứt chuỗi, xem TODO cuối file).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const sources = ['WALLET', 'CASH', 'BANK_TRANSFER'];
  const brokenRecords = [];

  for (const source of sources) {
    const { data: chain, error } = await supabaseAdmin.rpc('get_financial_log_chain', { p_source: source });
    if (error) return jsonResponse({ error: `Lỗi đọc chuỗi ${source}: ${error.message}` }, 500);
    if (!chain || chain.length === 0) continue;

    let expectedPrevHash = null; // bản ghi đầu tiên của chuỗi có prev_hash = null
    for (const record of chain) {
      if (record.prev_hash !== expectedPrevHash) {
        brokenRecords.push({
          id: record.id, source, created_at: record.created_at,
          reason: `prev_hash không khớp — kỳ vọng "${expectedPrevHash}" nhưng bản ghi lưu "${record.prev_hash}". Có khả năng dữ liệu đã bị sửa trực tiếp trong DB.`,
        });
      }
      expectedPrevHash = record.hash;
    }
  }

  if (brokenRecords.length > 0) {
    console.error('⚠️ PHÁT HIỆN ĐỨT CHUỖI HASH TÀI CHÍNH:', JSON.stringify(brokenRecords));
    // TODO: nối thêm cảnh báo thật ở đây nếu muốn (email/Slack/push cho Kế
    // toán trưởng + Ban điều hành), ví dụ:
    // await notifyDepartmentHeadsViaEmail('ACC', 'CẢNH BÁO: phát hiện dữ liệu tài chính bị can thiệp', JSON.stringify(brokenRecords));
  }

  return jsonResponse({
    ok: brokenRecords.length === 0,
    checkedSources: sources,
    brokenCount: brokenRecords.length,
    brokenRecords,
  });
});

/* =====================================================================
   ĐẶT LỊCH CHẠY HÀNG ĐÊM (Supabase Cron): 0 18 * * *  (18:00 UTC = 01:00
   sáng giờ Việt Nam hôm sau — chỉnh lại theo giờ bạn muốn chạy)
===================================================================== */
