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
const CACHE_NAME = 'ais-shell-v4';
const APP_SHELL = [
  '/index.html',
  '/dashboard.html',
  '/css/tokens.css',
  '/css/login.css',
  '/css/dashboard.css',
  '/css/module.css',
  '/css/pdfEditor.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/dashboard.js',
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
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // chiếm quyền điều khiển các tab đang mở ngay lập tức
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Không cache API Supabase — luôn lấy dữ liệu mới nhất
  if (url.hostname.includes('supabase.co')) return;

  // Network-first cho HTML/JS/CSS: luôn ưu tiên bản mới nhất từ server,
  // chỉ dùng cache khi mất mạng. Đây là danh sách ĐẦY ĐỦ 3 loại tài
  // nguyên hay đổi khi deploy — thiếu 'style' ở đây chính là lý do CSS
  // từng bị dính bản cũ trước đây.
  const dest = event.request.destination;
  if (dest === 'script' || dest === 'document' || dest === 'style') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Các tài nguyên khác (icon, font, ảnh...) — cache-first cho nhanh,
  // ít khi đổi nên không cần luôn xin lại server.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
