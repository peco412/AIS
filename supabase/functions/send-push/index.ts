// =====================================================================
// EDGE FUNCTION: send-push
// Gửi thông báo đẩy (Web Push) thật tới các thiết bị đã đăng ký, theo
// đúng phạm vi thông báo (hệ thống / trung tâm / phòng ban / cá nhân) —
// khớp với cấu trúc bảng "notifications" đã có.
//
// CÁCH DÙNG (gọi từ frontend ngay sau khi insert vào bảng notifications):
//   await supabase.functions.invoke('send-push', {
//     body: { scope, center_id, department_id, target_employee_id, title, content, url }
//   });
//
// CẤU HÌNH BẮT BUỘC trước khi dùng (Supabase Dashboard -> Edge Functions
// -> send-push -> Secrets, hoặc `supabase secrets set`):
//   VAPID_PUBLIC_KEY   = khoá public (đã có sẵn trong js/pushNotifications.js)
//   VAPID_PRIVATE_KEY  = khoá private TƯƠNG ỨNG — giữ bí mật tuyệt đối
//   VAPID_SUBJECT      = "mailto:admin@yourcompany.com" (bắt buộc theo chuẩn Web Push)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (đã có sẵn cho mọi Edge Function)
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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { scope, center_id, department_id, target_employee_id, title, content, url } = await req.json();
    if (!scope || !title) return jsonResponse({ error: 'Thiếu scope hoặc title.' }, 400);

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
