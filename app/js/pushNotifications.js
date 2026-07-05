// =====================================================================
// THÔNG BÁO ĐẨY (WEB PUSH) — đăng ký/huỷ nhận thông báo trên từng thiết bị.
// Trình duyệt BẮT BUỘC phải có hành động bấm nút thật của người dùng mới
// được xin quyền Notification (không thể tự động xin lúc vừa vào trang).
//
// CẦN CẤU HÌNH: điền đúng VAPID_PUBLIC_KEY bên dưới khớp với private key
// đã đặt ở Supabase Edge Function "send-push" (biến môi trường
// VAPID_PRIVATE_KEY) — 2 khoá này PHẢI là 1 cặp sinh ra cùng lúc.
// =====================================================================

const VAPID_PUBLIC_KEY = window.__ENV__?.VAPID_PUBLIC_KEY
  || 'BMjLA_Hhoa86J2O3saX6-twTp-oEgqB-QT0cZo12w800-DfyTG1oAz7UHPqQdD7ZZCOLXY0fcABx1NOSuX3hSww';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getPushPermissionState() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/**
 * Bật thông báo đẩy cho thiết bị hiện tại — PHẢI gọi trực tiếp trong 1
 * event handler bấm nút của người dùng (không gọi tự động).
 */
export async function enablePush(supabase, employeeId) {
  if (!isPushSupported()) throw new Error('Trình duyệt này không hỗ trợ thông báo đẩy.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bạn đã từ chối quyền nhận thông báo. Vào cài đặt trình duyệt để bật lại.');

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    employee_id: employeeId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth_key: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) throw error;

  return subscription;
}

/** Tắt thông báo đẩy cho thiết bị hiện tại. */
export async function disablePush(supabase) {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;

  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}

export async function isPushEnabledOnThisDevice() {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  return !!subscription;
}
