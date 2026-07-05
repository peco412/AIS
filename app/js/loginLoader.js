// =====================================================================
// LOGIN LOADER — logo phân hệ hiện mờ dần rồi rõ nét (blur-to-focus),
// hiện ngay sau khi đăng nhập thành công, trước khi chuyển vào dashboard.
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
    <div class="login-loader__glow"></div>
    <div class="login-loader__logo-wrap">
      <img class="login-loader__logo" src="${logoSrc}" alt="ERP AIS" />
    </div>
    <div class="login-loader__text">${message}</div>
    <div class="login-loader__bar"><div class="login-loader__bar-fill"></div></div>
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
    }, 1500);
  });
}
