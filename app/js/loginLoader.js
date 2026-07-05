// =====================================================================
// LOGIN LOADER — hiệu ứng "mở quyển sách" như cánh cổng bước vào thế
// giới Anh ngữ, hiện ngay sau khi đăng nhập thành công, trước khi
// chuyển vào dashboard.
//
// Cách hoạt động: 2 cánh "bìa sách" phủ kín màn hình, xoay mở ra 2 bên
// theo trục 3D (giống cửa đôi/mở sách), để lộ dần logo + trạng thái
// đăng nhập phía sau.
//
// Muốn đổi logo theo từng phân hệ: thêm file assets/logo-ilingo.png rồi
// hàm bên dưới sẽ tự dùng đúng logo của phân hệ đang chọn (mặc định dùng
// logo-aloha.png cho cả 2 nếu chưa có logo iLingo riêng).
// =====================================================================

export function showLoginLoader({ division = 'aloha', message = 'Đang vào hệ thống...' } = {}) {
  const logoSrc = `/assets/logo-${division}.png`;
  const fallbackSrc = '/assets/logo-aloha.png';

  const el = document.createElement('div');
  el.className = 'login-loader';
  el.innerHTML = `
    <div class="login-loader__content">
      <div class="login-loader__logo-wrap">
        <img class="login-loader__logo" src="${logoSrc}" alt="ERP AIS" />
      </div>
      <div class="login-loader__text">${message}</div>
      <div class="login-loader__bar"><div class="login-loader__bar-fill"></div></div>
    </div>
    <div class="login-loader__spine"></div>
    <div class="login-loader__stage">
      <div class="book-door book-door--left">
        <div class="book-door__frame"></div>
        <span class="book-door__emblem">📖</span>
      </div>
      <div class="book-door book-door--right">
        <div class="book-door__frame"></div>
        <span class="book-door__emblem">🎓</span>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  // Nếu chưa có logo riêng cho phân hệ này thì tự dùng lại logo ALOHA
  el.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => { if (img.src !== location.origin + fallbackSrc) img.src = fallbackSrc; }, { once: true });
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => { el.remove(); resolve(); }, 350);
    }, 2300);
  });
}
