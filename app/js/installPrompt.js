// =====================================================================
// CÀI ĐẶT ỨNG DỤNG (PWA "Add to Home Screen") — trước đây không có nút
// nào gọi ra được, người dùng không biết là có thể cài về dùng như app.
//
// Android/Chrome/Edge: trình duyệt tự bắn sự kiện "beforeinstallprompt",
// mình giữ lại sự kiện đó và hiện nút bấm để gọi ra đúng lúc người dùng
// muốn (bắt buộc phải gọi trong 1 thao tác bấm nút thật của người dùng).
//
// iOS Safari: KHÔNG hỗ trợ beforeinstallprompt — phải hướng dẫn thủ công
// (bấm nút Chia sẻ -> Thêm vào MH chính), nên hiện hướng dẫn dạng modal.
// =====================================================================

let deferredPrompt = null;
let installBtnEls = [];

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtnEls.forEach((el) => { el.style.display = ''; });
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installBtnEls.forEach((el) => { el.style.display = 'none'; });
});

function showIOSInstructions() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:380px;">
      <button class="modal-close" id="iosInstallClose">✕</button>
      <h3>Cài ứng dụng lên iPhone/iPad</h3>
      <p class="modal-sub" style="margin-bottom:16px;">Safari không cho phép cài tự động — làm theo 3 bước sau:</p>
      <ol style="padding-left:20px; font-size:13.5px; line-height:2; color:var(--ink);">
        <li>Bấm biểu tượng <strong>Chia sẻ</strong> (hình vuông có mũi tên ↑) ở thanh dưới trình duyệt</li>
        <li>Chọn <strong>"Thêm vào MH chính"</strong> (Add to Home Screen)</li>
        <li>Bấm <strong>"Thêm"</strong> ở góc trên bên phải</li>
      </ol>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#iosInstallClose').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function handleInstallClick() {
  if (isIOS()) { showIOSInstructions(); return; }
  if (!deferredPrompt) {
    alert('Trình duyệt này chưa hỗ trợ cài đặt trực tiếp, hoặc ứng dụng đã được cài rồi. Trên Chrome/Edge, thử vào menu (⋮) -> "Cài đặt ứng dụng".');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
}

/**
 * Gắn hành vi "Cài đặt ứng dụng" vào 1 nút có sẵn trong trang.
 * Nút sẽ tự ẩn nếu đã cài rồi, và tự động HIỆN khi trình duyệt sẵn sàng
 * cho cài đặt (Android/Chrome) — trên iOS luôn hiện sẵn vì không có cách
 * nào phát hiện "có thể cài" như Android.
 */
export function attachInstallButton(el, { alwaysVisible = false } = {}) {
  if (!el) return;
  if (isStandalone()) { el.style.display = 'none'; return; }

  if (alwaysVisible) {
    el.style.display = '';
  } else {
    installBtnEls.push(el);
    el.style.display = isIOS() ? '' : 'none'; // Android/Chrome chờ beforeinstallprompt mới hiện
  }
  el.addEventListener('click', handleInstallClick);
}

export function isInstallable() {
  return !isStandalone();
}
