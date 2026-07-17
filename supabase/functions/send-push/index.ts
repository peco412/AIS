// =====================================================================
// EDGE FUNCTION: send-push
// Gửi thông báo đẩy (Web Push) thật tới các thiết bị đã đăng ký, theo
// đúng phạm vi thông báo (hệ thống / trung tâm / phòng ban / cá nhân) —
// khớp với cấu trúc bảng "notifications" đã có.
//
// BẢN VÁ 16/07/2026 (xem AUDIT_ERP_AIS_2026-07-16.md mục B.3):
// Bản cũ KHÔNG kiểm tra người gọi là ai cả — bất kỳ nhân viên nào đã
// đăng nhập (kể cả vai trò thấp nhất) đều có thể gọi thẳng function này
// với scope:'system' để đẩy push notification tuỳ ý (tiêu đề/nội dung/
// link) tới TOÀN BỘ nhân viên đang hoạt động, hoặc scope:'personal' nhắm
// vào bất kỳ target_employee_id nào — mở đường cho spam/lừa đảo nội bộ
// (phishing) qua đúng kênh thông báo chính thức của công ty.
// Sửa: mirror ĐÚNG quy tắc đã áp dụng cho bảng notifications (file 07 +
// 09) — scope 'personal' thì ai cũng gọi được, còn scope 'system'/
// 'center'/'department' bắt buộc phải là Trưởng/phó phòng trở lên
// (is_dept_head_or_above()), xác thực qua JWT của chính người gọi.
//
// CÁCH DÙNG (gọi từ frontend ngay sau khi insert vào bảng notifications):
//   await supabase.functions.invoke('send-push', {
//     body: { scope, center_id, department_id, target_employee_id, title, content, url }
//   });
//
// CẤU HÌNH BẮT BUỘC trước khi dùng (Supabase Dashboard -> Edge Functions
// -> send-push -> Secrets, hoặc `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
    if (!vapidPublic || !vapidPrivate) {
      return jsonResponse({ error: 'Chưa cấu hình VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY cho Edge Function này.' }, 500);
    }
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // MỚI — Xác thực người gọi qua chính JWT của họ (không phải service
    // role), rồi kiểm tra quyền phát thông báo theo đúng phạm vi yêu cầu.
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: 'Không xác thực được người gọi.' }, 401);
    }

    const { scope, center_id, department_id, target_employee_id, title, content, url } = await req.json();
    if (!scope || !title) return jsonResponse({ error: 'Thiếu scope hoặc title.' }, 400);

    if (scope !== 'personal') {
      // Giống hệt quy tắc RLS của bảng notifications: chỉ Trưởng/phó
      // phòng trở lên mới được phát thông báo phạm vi rộng (system/
      // center/department). Gọi qua callerClient để hàm chạy đúng theo
      // quyền/JWT của người gọi thật, không phải service role.
      const { data: isElevated, error: roleErr } = await callerClient.rpc('is_dept_head_or_above');
      if (roleErr || !isElevated) {
        return jsonResponse({ error: 'Bạn không có quyền gửi thông báo ở phạm vi này.' }, 403);
      }
    } else if (!target_employee_id) {
      return jsonResponse({ error: 'Thiếu target_employee_id cho thông báo cá nhân.' }, 400);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Xác định danh sách employee_id cần nhận, đúng theo phạm vi thông báo
    let employeeIds = [];
    if (scope === 'personal' && target_employee_id) {
      employeeIds = [target_employee_id];
    } else if (scope === 'department' && department_id) {
      const { data } = await supabaseAdmin.from('employees').select('id').eq('department_id', department_id);
      employeeIds = (data || []).map((e) => e.id);
    } else if (scope === 'center' && center_id) {
      const { data } = await supabaseAdmin.from('employees').select('id').eq('center_id', center_id);
      employeeIds = (data || []).map((e) => e.id);
    } else if (scope === 'system') {
      const { data } = await supabaseAdmin.from('employees').select('id').eq('status', 'active');
      employeeIds = (data || []).map((e) => e.id);
    }

    if (employeeIds.length === 0) return jsonResponse({ sent: 0, note: 'Không có người nhận phù hợp phạm vi.' });

    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .in('employee_id', employeeIds);

    if (!subs || subs.length === 0) return jsonResponse({ sent: 0, note: 'Chưa có thiết bị nào đăng ký nhận push trong phạm vi này.' });

    const payload = JSON.stringify({ title, body: content || '', url: url || '/notifications.html' });

    let sent = 0;
    const staleIds = [];
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload,
        );
        sent++;
      } catch (err) {
        // 404/410 = thiết bị đã gỡ đăng ký / hết hạn -> dọn khỏi DB, không phải lỗi thật
        if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(sub.id);
        else console.warn('Gửi push thất bại:', sub.endpoint, err?.message);
      }
    }));

    if (staleIds.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('id', staleIds);
    }

    return jsonResponse({ sent, total: subs.length, cleaned: staleIds.length });
  } catch (err) {
    console.error('send-push error:', err);
    return jsonResponse({ error: err.message || 'Lỗi không xác định.' }, 500);
  }
});
