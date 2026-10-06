// =====================================================================
// SERVICE WORKER — cache "app shell" tối thiểu để mở nhanh lần sau
// và hoạt động cơ bản khi mất mạng tạm thời (KHÔNG cache dữ liệu Supabase,
// dữ liệu nghiệp vụ luôn cần mạng để đảm bảo tính đúng đắn/bảo mật).
//
// CHIẾN LƯỢC: network-first cho HTML/JS/CSS (luôn ưu tiên bản MỚI NHẤT từ
// server, cache chỉ dùng khi mất mạng) — trước đây CSS bị bỏ sót, dùng
// cache-first, là nguyên nhân chính khiến giao diện hay bị "dính" bản cũ
// sau mỗi lần cập nhật code.
//
// Tăng số version CACHE_NAME này (v3, v4...) MỖI KHI deploy code mới có
// thay đổi quan trọng, để buộc mọi client xoá sạch cache cũ ngay lập tức.
// =====================================================================
const CACHE_NAME = 'ais-shell-v200';
const APP_SHELL = [
  '/index.html',
  '/world-select.html',
  '/css/tokens.css',
  '/css/login.css',
  '/css/dashboard.css',
  '/css/module.css',
  '/css/pdfEditor.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/navConfig.js',
  '/js/i18n.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll từng file riêng lẻ để 1 file lỗi không làm hỏng toàn bộ cài đặt
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('SW cache miss:', url, err))
        )
      )
    )
  );
  self.skipWaiting(); // kích hoạt bản mới ngay, không đợi mọi tab cũ đóng lại
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('ais-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // chiếm quyền điều khiển các tab đang mở ngay lập tức
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only local static assets are eligible, never API/file responses.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!/\.(html|js|css|png|jpg|svg|woff2?|json)$/.test(url.pathname)) return;
  if (url.pathname === '/env.js') return;

  // Network-first cho HTML/JS/CSS: luôn ưu tiên bản mới nhất từ server,
  // chỉ dùng cache khi mất mạng. Đây là danh sách ĐẦY ĐỦ 3 loại tài
  // nguyên hay đổi khi deploy — thiếu 'style' ở đây chính là lý do CSS
  // từng bị dính bản cũ trước đây.
  const dest = event.request.destination;
  if (dest === 'script' || dest === 'document' || dest === 'style') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const resClone = res.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone)).catch(() => {}));
          }
          return res;
        })
        .catch(async () => (await caches.match(event.request)) || new Response('Không có kết nối mạng. Vui lòng thử lại.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
    );
    return;
  }

  // Các tài nguyên khác (icon, font, ảnh...) — cache-first cho nhanh,
  // ít khi đổi nên không cần luôn xin lại server.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// =====================================================================
// THÔNG BÁO ĐẨY (WEB PUSH) — hiện thông báo hệ thống ngay cả khi đã tắt
// màn hình / đóng tab trình duyệt, đúng yêu cầu "dùng như app thật".
// =====================================================================
self.addEventListener('push', (event) => {
  let payload = { title: 'AIS OFFICE', body: 'Bạn có thông báo mới.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    payload.body = event.data ? event.data.text() : payload.body;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      data: { url: payload.url || '/notifications.html' },
      tag: payload.tag || 'ais-notification',
      renotify: true,
    })
  );
});

// Bấm vào thông báo -> mở đúng trang liên quan, hoặc focus tab đang mở sẵn
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const candidate = new URL(event.notification.data?.url || '/notifications.html', self.location.origin);
  const targetUrl = candidate.origin === self.location.origin ? candidate.href : new URL('/notifications.html', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clientList.length > 0 && 'focus' in clientList[0]) {
        clientList[0].navigate(targetUrl);
        return clientList[0].focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
