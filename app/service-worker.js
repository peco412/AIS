// =====================================================================
// SERVICE WORKER — cache "app shell" tối thiểu để mở nhanh lần sau
// và hoạt động cơ bản khi mất mạng tạm thời (KHÔNG cache dữ liệu Supabase,
// dữ liệu nghiệp vụ luôn cần mạng để đảm bảo tính đúng đắn/bảo mật).
// =====================================================================
// Tăng số version này (v2, v3...) MỖI KHI deploy code mới có thay đổi quan
// trọng (đặc biệt config như supabase.js) để buộc mọi client tải bản mới.
const CACHE_NAME = 'ais-shell-v2';
const APP_SHELL = [
  '/index.html',
  '/dashboard.html',
  '/css/tokens.css',
  '/css/login.css',
  '/css/dashboard.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/dashboard.js',
  '/js/navConfig.js',
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
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Không cache API Supabase — luôn lấy dữ liệu mới nhất
  if (url.hostname.includes('supabase.co')) return;

  // Network-first cho JS/HTML: luôn ưu tiên bản mới nhất từ server,
  // chỉ dùng cache khi mất mạng. Tránh việc code deploy mới bị "kẹt"
  // sau bản cache cũ (đây là nguyên nhân gây lỗi gọi nhầm URL cũ).
  if (event.request.destination === 'script' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// =====================================================================
// ĐĂNG KÝ SERVICE WORKER + TỰ ĐỘNG RELOAD KHI CÓ BẢN MỚI
// =====================================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {

      // Kiểm tra định kỳ xem server có SW mới không (vd mỗi 5 phút)
      setInterval(() => reg.update(), 5 * 60 * 1000);

      // Khi phát hiện SW mới đang cài (do đổi CACHE_NAME/version)
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // SW mới đã activate và claim() các client
            // -> reload để load JS/CSS/HTML mới thay vì bản đang chạy dở trong RAM
            window.location.reload();
          }
        });
      });

    }).catch((err) => console.warn('SW register failed:', err));
  });

  // Phòng trường hợp reload() bị gọi lặp (một số trình duyệt bắn controllerchange nhiều lần)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}