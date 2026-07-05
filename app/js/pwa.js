// =====================================================================
// ĐĂNG KÝ SERVICE WORKER + TỰ ĐỘNG RELOAD KHI CÓ BẢN MỚI
//
// LƯU Ý QUAN TRỌNG: đoạn code này BẮT BUỘC phải nằm trong 1 file chạy ở
// NGỮ CẢNH TRANG WEB (như file này, được mọi trang <script src="/js/pwa.js">
// tải), KHÔNG được đặt trong service-worker.js — vì "navigator.serviceWorker"
// chỉ tồn tại ở ngữ cảnh trang web, không tồn tại bên trong chính Service
// Worker. Đặt nhầm chỗ (như bản trước) khiến đoạn tự-reload này không bao
// giờ chạy được, gây ra tình trạng "dính" giao diện/code bản cũ dù đã
// deploy bản mới.
// =====================================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {

      // Kiểm tra định kỳ xem server có bản Service Worker mới không
      setInterval(() => reg.update(), 5 * 60 * 1000);

      // Kiểm tra ngay khi quay lại tab (người dùng có thể để tab mở rất lâu)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });

      // Khi phát hiện Service Worker mới đang cài (do đổi CACHE_NAME/version)
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // Service Worker mới đã activate và claim() các tab đang mở
            // -> reload để tải JS/CSS/HTML mới thay vì bản đang chạy dở trong RAM
            window.location.reload();
          }
        });
      });

    }).catch((err) => console.warn('Không thể đăng ký service worker:', err));
  });

  // Phòng trường hợp reload() bị gọi lặp (một số trình duyệt bắn controllerchange nhiều lần)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
