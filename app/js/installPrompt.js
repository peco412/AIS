// =====================================================================
// CÀI ĐẶT ỨNG DỤNG (PWA "Add to Home Screen" / "Install app") — 1 ô
// hướng dẫn duy nhất, bấm vào hiện đầy đủ cách cài trên iPhone/iPad,
// Android, Windows, macOS. Hiện ở mọi thiết bị (không chỉ điện thoại)
// vì máy tính (Windows/Mac) cũng cài được — tự ẩn khi đã cài rồi.
//
// Android/Chrome/Edge: trình duyệt tự bắn sự kiện "beforeinstallprompt",
// giữ lại để bấm "Cài ngay" gọi ra đúng lúc người dùng muốn (bắt buộc
// phải gọi trong 1 thao tác bấm nút thật của người dùng).
// Các nền tảng khác không có cách nào tự động hoá — hiện hướng dẫn.
// =====================================================================

let deferredPrompt = null;
let trackedEls = [];

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  trackedEls.forEach((el) => { el.style.display = 'none'; });
});

const PLATFORM_GUIDES = {
  ios: {
    label: 'iPhone / iPad', icon: '📱',
    steps: [
      'Mở trang này bằng <strong>Safari</strong> (bắt buộc — Chrome/Facebook trên iOS không cài được).',
      'Bấm biểu tượng <strong>Chia sẻ</strong> (hình vuông có mũi tên ↑) ở thanh dưới màn hình.',
      'Cuộn xuống, chọn <strong>"Thêm vào MH chính"</strong> (Add to Home Screen).',
      'Bấm <strong>"Thêm"</strong> ở góc trên bên phải — icon app sẽ xuất hiện ở màn hình chính.',
    ],
  },
  android: {
    label: 'Android', icon: '🤖',
    steps: [
      'Mở trang này bằng <strong>Chrome</strong>.',
      'Bấm nút <strong>"Cài ngay"</strong> bên dưới — hộp thoại cài đặt sẽ hiện ra.',
      'Nếu không thấy nút, bấm menu <strong>⋮</strong> góc trên bên phải Chrome → chọn <strong>"Cài đặt ứng dụng"</strong>.',
    ],
    showNativeButton: true,
  },
  windows: {
    label: 'Windows', icon: '🖥️',
    steps: [
      'Mở trang này bằng <strong>Chrome</strong> hoặc <strong>Edge</strong>.',
      'Nhìn vào thanh địa chỉ, bấm icon <strong>cài đặt</strong> (hình máy tính có dấu +) ở bên phải ô địa chỉ.',
      'Hoặc bấm menu <strong>⋮</strong> (Chrome) / <strong>...</strong> (Edge) → <strong>"Cài đặt ứng dụng này"</strong>.',
      'Bấm <strong>"Cài đặt"</strong> trong hộp thoại hiện ra — app sẽ mở trong 1 cửa sổ riêng, có icon trên màn hình nền/thanh Start.',
    ],
  },
  mac: {
    label: 'macOS', icon: '🍎',
    steps: [
      '<strong>Với Safari:</strong> vào menu <strong>File</strong> (Tệp) → <strong>"Add to Dock"</strong> (Thêm vào Dock).',
      '<strong>Với Chrome/Edge:</strong> bấm icon cài đặt ở thanh địa chỉ, hoặc menu <strong>⋮</strong> → <strong>"Cài đặt ứng dụng này"</strong>.',
      'App sẽ có icon riêng trong Dock/Launchpad, mở như 1 ứng dụng độc lập, không cần mở trình duyệt trước.',
    ],
  },
};

function guessDefaultTab() {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/macintosh|mac os x/.test(ua)) return 'mac';
  return 'windows';
}

function renderGuideTab(key) {
  const guide = PLATFORM_GUIDES[key];
  const stepsHtml = guide.steps.map((s) => `<li>${s}</li>`).join('');
  const nativeBtn = guide.showNativeButton
    ? `<button class="btn btn-accent btn-sm" id="guideInstallNow" style="margin-top:14px;">Cài ngay</button>`
    : '';
  return `<ol style="padding-left:20px; font-size:13.5px; line-height:1.9; color:var(--ink); margin:0;">${stepsHtml}</ol>${nativeBtn}`;
}

function showInstallGuide() {
  const defaultTab = guessDefaultTab();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <button class="modal-close" id="guideClose"><svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <h3>Cài ứng dụng ERP AIS</h3>
      <p class="modal-sub">Dùng như 1 app thật — mở nhanh hơn, không cần gõ lại địa chỉ web mỗi lần.</p>
      <div class="install-guide-tabs" id="guideTabs">
        ${Object.entries(PLATFORM_GUIDES).map(([key, g]) => `
          <button type="button" class="install-guide-tab ${key === defaultTab ? 'active' : ''}" data-tab="${key}">
            <span>${g.icon}</span><span>${g.label}</span>
          </button>
        `).join('')}
      </div>
      <div id="guideContent">${renderGuideTab(defaultTab)}</div>
    </div>
  `;
  document.body.appendChild(modal);

  function switchTab(key) {
    modal.querySelectorAll('.install-guide-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    modal.querySelector('#guideContent').innerHTML = renderGuideTab(key);
    wireNativeButton();
  }
  function wireNativeButton() {
    const btn = modal.querySelector('#guideInstallNow');
    if (btn) btn.addEventListener('click', triggerNativePrompt);
  }

  modal.querySelectorAll('.install-guide-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  wireNativeButton();

  modal.querySelector('#guideClose').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function triggerNativePrompt() {
  if (!deferredPrompt) {
    alert('Trình duyệt hiện tại chưa sẵn sàng cài trực tiếp — làm theo các bước hướng dẫn ở trên nhé.');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
}

/**
 * Gắn hành vi "mở hướng dẫn cài đặt" vào 1 phần tử (nút icon topbar, tile
 * trên trang chủ...). Tự ẩn nếu app đã được cài (chạy ở chế độ standalone),
 * hiện ở MỌI thiết bị (điện thoại lẫn máy tính) vì cả 2 đều cài được.
 */
export function attachInstallButton(el) {
  if (!el) return;
  if (isStandalone()) { el.style.display = 'none'; return; }
  trackedEls.push(el);
  el.addEventListener('click', showInstallGuide);
}

export function isInstallable() {
  return !isStandalone();
}

/**
 * Đăng ký 1 khối "gợi ý cài đặt" (khối cha + phần tử bấm bên trong) — khác
 * attachInstallButton ở chỗ ẩn/hiện CẢ KHỐI CHA khi cài xong.
 */
export function registerInstallBanner(containerEl, buttonEl) {
  if (!containerEl || !buttonEl) return;
  if (isStandalone()) { containerEl.style.display = 'none'; return; }
  trackedEls.push(containerEl);
  buttonEl.addEventListener('click', showInstallGuide);
}
