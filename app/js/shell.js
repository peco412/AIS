import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';
import { t, applyTranslations, syncLangFromProfile, setLang, getLang } from './i18n.js';
import { attachInstallButton } from './installPrompt.js';

document.documentElement.setAttribute('data-division', localStorage.getItem('ais_division') || 'aloha');

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
}

// Các mục dùng chung luôn hiển thị dù đang ở phòng ban nào (điều hướng
// nhanh) — không tính là "1 phòng ban" nên không bị lọc theo ngữ cảnh.
// (Đã bỏ ALWAYS_VISIBLE_HREFS — không còn cần thiết sau khi tách "Chức
// năng cá nhân" thành nhóm alwaysShow riêng, xem NAV_CONFIG.)

// Kiểm tra quyền hiển thị mặc định THEO đúng vai trò/phòng ban, HOẶC đã
// được cấp thêm riêng qua module "Xin thêm quyền hạn" (granted_permissions,
// nạp sẵn vào profile.grantedModules ở trên).
// Giao diện điện thoại CHỈ hiện các tác vụ cơ bản theo đúng yêu cầu BGD:
// thông báo, đơn xin nghỉ, đơn công tác, yêu cầu truyền thông, yêu cầu
// CSVC, và toàn bộ nhóm "chức năng cá nhân" — các module nghiệp vụ theo
// phòng ban (nhân sự/kế toán/CSVC quản trị...) chỉ dùng trên web/máy tính.
export const MOBILE_ALLOWED_HREFS = new Set([
  '/dashboard.html', '/notifications.html', '/profile.html', '/directory.html',
  '/meetings.html', '/attendance-checkin.html', '/hr/late-clockin-requests.html',
  '/proposals.html', '/archive.html', '/permission-requests.html',
  '/hr/leave-requests.html', '/hr/business-trips.html', '/hr/contracts.html', '/my-payroll.html',
  '/mkt/requests.html', '/fac/requests.html', '/exec/broadcast.html',
]);
export function isMobileViewport() {
  return window.matchMedia('(max-width: 960px)').matches;
}

function canAccess(item, profile) {
  if (isMobileViewport() && !MOBILE_ALLOWED_HREFS.has(item.href)) return false;
  return item.visible(profile) || !!profile.grantedModules?.has(item.href);
}

function findActiveGroup(currentPage, profile) {
  if (!currentPage) return null;
  // SUA LOI THAT: truoc day chi tim nhom DAU TIEN co chua href nay, KHONG
  // quan tam nguoi dang xem co thuoc nhom do khong. Vi mot so trang dung
  // chung o NHIEU nhom (vd "Don nghi" o ca Nhan su LAN Khoi trung tam,
  // "Phieu mua hang" o ca Ke toan LAN Khoi trung tam), Quan ly trung
  // tam/Giao vien/Tu van vien bi day nham vao nhom dung TRUOC trong mang
  // (Nhan su/Ke toan) dù ho khong thuoc phong do. Gio uu tien nhom ma
  // chinh nguoi dang xem CO QUYEN thay item do (canAccess), chi fallback
  // ve khop href don thuan neu khong nhom nao khop dung quyen.
  //
  // Loai bo nhom "alwaysShow" (vd "Chuc nang ca nhan") khoi danh sach
  // canh tranh — nhung nhom nay LUON hien rieng, khong nen duoc chon lam
  // "nhom dang active" chi vi chua 1 item trung href (vd "Phieu mua
  // hang" xuat hien ca o day nhu 1 loi tat ca nhan).
  const groupsWithHref = NAV_CONFIG.filter((group) =>
    group.sectionKey && !group.alwaysShow && group.items.some((item) => currentPage.endsWith(item.href))
  );
  if (groupsWithHref.length === 0) return null;
  if (profile) {
    const roleMatches = groupsWithHref.filter((group) =>
      group.items.some((item) => currentPage.endsWith(item.href) && canAccess(item, profile))
    );
    if (roleMatches.length > 0) {
      // Neu NHIEU nhom cung hop le (vd BDH/Ky thuat co quyen "nhu ACC" o
      // moi noi do inDept() tu dong dung cho ho, nen ca ban Ke toan LAN
      // ban Khoi trung tam deu qua duoc kiem tra) — uu tien ban "Khoi
      // trung tam" vi day la ngu canh van hanh cu the hon (tab da bam
      // vao la tab Khoi trung tam), thay vi mac dinh roi vao Ke toan chi
      // vi no dung truoc trong mang cau hinh.
      const centersMatch = roleMatches.find((group) => group.layer === 'centers');
      if (centersMatch) return centersMatch;
      return roleMatches[0];
    }

    // Khong nhom nao qua duoc kiem tra quyen (vd giao vien khong co quyen
    // "Thu hoc phi" o CA 2 ban, do dung thu vao link khong danh cho ho) —
    // thay vi mac dinh chon nhom DUNG DAU mang (thuong la Nhan su/Ke toan,
    // gay cam giac "bi day nham vao phong khac"), uu tien nhom co layer
    // KHOP DUNG boi canh vai tro chinh cua nguoi dang xem.
    const isCentersPerson = profile.isCenterManager || profile.isTeacher || profile.roleCode === 'CONSULTANT';
    const layerPref = isCentersPerson ? 'centers' : 'office';
    const byLayer = groupsWithHref.find((group) => group.layer === layerPref);
    if (byLayer) return byLayer;
  }
  return groupsWithHref[0];
}

// ============================================================================
// HE THONG "4 THE GIOI" (ERP / CRM / Database / Ca nhan) — thay the hoan
// toan sidebar cay thu muc bang icon hub, dung theo yeu cau tach rieng
// ERP (Ban dieu hanh + Khoi van phong, quy trinh noi bo) khoi CRM (Khoi
// trung tam, huong ve khach hang/hoc vien) khoi Database (cau hinh goc).
// ============================================================================
export const WORLD_LAYERS = {
  erp: ['executive', 'office'],
  crm: ['centers'],
  database: ['masterdata'],
  personal: ['personal'],
};
export const WORLD_META = {
  erp: { label: 'ERP — Vận hành nội bộ', icon: '<svg class="icon icon--sm" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>', color: '#0094D9' },
  crm: { label: 'CRM — Khối trung tâm', icon: '<svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/></svg>', color: '#22a06b' },
  database: { label: 'Database — Dữ liệu gốc', icon: '<svg class="icon icon--sm" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>', color: '#6c5ce7' },
  personal: { label: 'Cá nhân', icon: '<svg class="icon icon--sm" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>', color: '#8a8f98' },
};
const WORLD_STORAGE_KEY = 'ais_current_world';

export function layerToWorld(layer) {
  return Object.keys(WORLD_LAYERS).find((w) => WORLD_LAYERS[w].includes(layer)) || 'erp';
}

export function getSavedWorld() {
  return localStorage.getItem(WORLD_STORAGE_KEY);
}

function setSavedWorld(world) {
  localStorage.setItem(WORLD_STORAGE_KEY, world);
}

// The gioi hien tai: uu tien lua chon nguoi dung da luu tu truoc (chuyen
// qua lai bang nut tren thanh tren cung), khong co thi tu suy ra tu trang
// dang dung (vd dang o /acc/... -> ERP), mac dinh ERP neu khong doan duoc.
function resolveCurrentWorld(currentPage, profile) {
  const saved = getSavedWorld();
  if (saved && WORLD_LAYERS[saved]) return saved;
  const group = findActiveGroup(currentPage, profile);
  if (group?.layer) return layerToWorld(group.layer);
  return 'erp';
}

function renderNav(profile, currentPage) {
  // AN HAN sidebar cay thu muc cu — thay bang he thong "4 The gioi" (ERP/
  // CRM/Database/Ca nhan) + Icon Hub, dung theo yeu cau bo sidebar vi qua
  // roi. Sidebar <aside> van con trong HTML cua tung trang (khong sua tay
  // 80+ file), chi an di bang JS + CSS o day.
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.style.display = 'none';
  document.querySelector('.app-shell')?.classList.add('app-shell--no-sidebar');

  const currentWorld = resolveCurrentWorld(currentPage, profile);
  injectBrandName();
  injectWorldSwitcher(profile, currentWorld, currentPage);
  injectHubLauncher(profile, currentWorld, currentPage);
  injectMobileBottomNav(profile, currentWorld, currentPage);
  if (!currentPage?.endsWith('/dashboard.html')) injectSiblingStrip(profile, currentPage);
}

/**
 * Thanh điều hướng dưới (Material Design bottom navigation) — CHỈ hiện
 * trên điện thoại (CSS ẩn ở màn rộng hơn). Gom 4 điểm đến chính (Trang
 * chủ/Menu/Thông báo/Tài khoản) thay vì rải rác nhiều icon trên thanh
 * trên cùng như trước — đúng yêu cầu "tránh nav quá nhiều", vì các icon
 * tương ứng (mở menu, chuông, avatar) được ẩn bớt trên điện thoại (xem
 * CSS @media 640px), tránh lặp 2 nơi cùng dẫn tới 1 chỗ.
 */
function injectMobileBottomNav(profile, currentWorld, currentPage) {
  document.getElementById('mobileBottomNav')?.remove();

  const isOn = (path) => currentPage && currentPage.endsWith(path);
  const nav = document.createElement('nav');
  nav.id = 'mobileBottomNav';
  nav.className = 'mobile-bottom-nav';
  nav.innerHTML = `
    <a href="/dashboard.html" class="${isOn('/dashboard.html') ? 'active' : ''}">
      <svg class="icon icon--nav" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>
      <span>Trang chủ</span>
    </a>
    <button type="button" id="mobileBottomNavMenu">
      <svg class="icon icon--nav" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>
      <span>Menu</span>
    </button>
    <a href="/notifications.html" class="${isOn('/notifications.html') ? 'active' : ''}">
      <svg class="icon icon--nav" viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 6 2 6.5H4c.5-.5 2-2.5 2-6.5z"/><path d="M9.5 18a2.5 2.5 0 0 0 5 0"/></svg>
      <span class="mobile-bottom-nav__badge" id="mobileBottomNavBadge" style="display:none;">0</span>
      <span>Thông báo</span>
    </a>
    <a href="/profile.html" class="${isOn('/profile.html') ? 'active' : ''}">
      <svg class="icon icon--nav" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
      <span>Cá nhân</span>
    </a>
  `;
  document.body.appendChild(nav);
  nav.querySelector('#mobileBottomNavMenu').addEventListener('click', () => openHubOverlay(profile, currentWorld, currentPage));

  // Đồng bộ số thông báo chưa đọc với chuông ở topbar (nếu trang có sẵn).
  const topbarBadge = document.getElementById('notifBadge');
  if (topbarBadge) {
    const syncBadge = () => {
      const navBadge = document.getElementById('mobileBottomNavBadge');
      if (!navBadge) return;
      navBadge.style.display = topbarBadge.style.display;
      navBadge.textContent = topbarBadge.textContent;
    };
    syncBadge();
    new MutationObserver(syncBadge).observe(topbarBadge, { childList: true, attributes: true });
  }
}

/**
 * Dai "cac chuc nang cung nhom" — hien NGAY tren moi trang (khong can
 * bam mo Hub moi thay), dung theo yeu cau "vao 1 chuc nang muon thay lai
 * cac chuc nang khac cung hub de tien di chuyen". Chi hien khi nhom hien
 * tai co NHIEU HON 1 muc (khong hien neu chi minh trang dang dung).
 */
function injectSiblingStrip(profile, currentPage) {
  document.getElementById('siblingStrip')?.remove();

  const group = findActiveGroup(currentPage, profile);
  if (!group) return;
  const items = group.items.filter((item) => canAccess(item, profile));
  if (items.length <= 1) return; // chi 1 muc (chinh trang nay) thi khong can dai gi ca

  const main = document.querySelector('.main');
  if (!main) return;

  const strip = document.createElement('div');
  strip.id = 'siblingStrip';
  strip.className = 'sibling-strip';
  strip.innerHTML = items.map((item) => {
    const active = currentPage && currentPage.endsWith(item.href);
    return `<a href="${item.href}" class="sibling-strip__item ${active ? 'active' : ''}">${item.icon} ${esc(t(item.labelKey, item.label))}</a>`;
  }).join('');
  main.insertBefore(strip, main.firstChild);
}

// Danh sach the gioi ma nguoi nay THUC SU co it nhat 1 muc dung duoc —
// an han the gioi rong (vd nhan vien thuong khong co gi trong "Database").
// XUAT RA (truoc day chi dung noi bo o day) — trang world-select can
// dung LAI dung ham nay de khoa dung cac toa nha khong co quyen, tranh
// viet lai logic kiem tra quyen o 2 noi de bi lech nhau.
export function worldsWithAccess(profile) {
  return Object.keys(WORLD_META).filter((world) => {
    if (world === 'personal') return true; // ai cung co Chuc nang ca nhan
    return NAV_CONFIG.some((group) =>
      group.sectionKey && !group.alwaysShow && WORLD_LAYERS[world].includes(group.layer)
      && group.items.some((item) => canAccess(item, profile))
    );
  });
}

/**
 * Tên thương hiệu "AIS OFFICE" — trước đây CHỈ hiện ở trang Trang chủ
 * (dashboard.html có khung riêng .hub-topbar__brand), còn 90 trang khác
 * hoàn toàn KHÔNG có tên hệ thống nào hiện trên thanh trên cùng (sidebar
 * cũ có nhưng đã ẩn vĩnh viễn). Thêm lại ở đây — LUÔN hiện, mọi trang.
 */
function injectBrandName() {
  const anchor = document.querySelector('.topbar__left');
  if (!anchor || document.getElementById('topbarBrand')) return;
  const brand = document.createElement('div');
  brand.id = 'topbarBrand';
  brand.className = 'topbar-brand';
  brand.innerHTML = '<span class="dot"></span><span>AIS OFFICE</span>';
  brand.addEventListener('click', () => { window.location.href = '/world-select.html'; });
  anchor.insertBefore(brand, anchor.firstChild);
}

/**
 * Nut chon The gioi tren thanh tren cung — bam vao mo menu 4 lua chon
 * (ERP/CRM/Database/Ca nhan), chon xong luu lai va tu dieu huong ve trang
 * chu cua the gioi do (dashboard.html), tru khi dang o san 1 trang thuoc
 * dung the gioi vua chon (thi chi doi trang thai, khong dieu huong).
 */
function injectWorldSwitcher(profile, currentWorld, currentPage) {
  const anchor = document.querySelector('.topbar__left') || document.querySelector('.hub-topbar__brand');
  if (!anchor) return;
  document.getElementById('worldSwitcher')?.remove();

  const available = worldsWithAccess(profile);
  if (available.length <= 1) return; // chi 1 the gioi thi khong can nut chon

  const meta = WORLD_META[currentWorld];
  const wrap = document.createElement('div');
  wrap.id = 'worldSwitcher';
  wrap.className = 'world-switcher';
  wrap.innerHTML = `
    <button type="button" class="world-switcher__btn" id="worldSwitcherBtn" style="--world-color:${meta.color};">
      <span class="world-switcher__icon">${meta.icon}</span>
      <span class="world-switcher__label">${esc(meta.label.split(' — ')[0])}</span>
      <span class="world-switcher__caret">▾</span>
    </button>
    <div class="world-switcher__menu" id="worldSwitcherMenu" style="display:none;">
      ${available.map((w) => `
        <button type="button" class="world-switcher__option ${w === currentWorld ? 'active' : ''}" data-world="${w}" style="--world-color:${WORLD_META[w].color};">
          <span class="world-switcher__icon">${WORLD_META[w].icon}</span>
          <span>${esc(WORLD_META[w].label)}</span>
        </button>
      `).join('')}
    </div>
  `;
  anchor.appendChild(wrap);

  const btn = wrap.querySelector('#worldSwitcherBtn');
  const menu = wrap.querySelector('#worldSwitcherMenu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { menu.style.display = 'none'; });
  wrap.querySelectorAll('[data-world]').forEach((opt) => {
    opt.addEventListener('click', () => {
      const world = opt.dataset.world;
      setSavedWorld(world);
      menu.style.display = 'none';
      document.dispatchEvent(new CustomEvent('ais:worldchange', { detail: { world } }));
      // Dang o dung trang thuoc the gioi vua chon -> chi ve lai hub, khong
      // can dieu huong. Khac the gioi -> ve trang chu de bat dau lai.
      const stillInWorld = layerToWorld(findActiveGroup(currentPage, profile)?.layer) === world;
      if (!stillInWorld && !currentPage?.endsWith('/dashboard.html')) {
        window.location.href = '/dashboard.html';
      } else {
        injectWorldSwitcher(profile, world, currentPage);
        injectHubLauncher(profile, world, currentPage);
      }
    });
  });
}

/**
 * Nut mo Hub (thay cho nut hamburger cu tung dung de dong/mo sidebar) —
 * bam vao hien 1 lop phu day man hinh voi luoi icon cua DUNG the gioi
 * dang chon, thay hoan toan cho viec di chuyen bang cay sidebar truoc day.
 */
function injectHubLauncher(profile, currentWorld, currentPage) {
  // Nut "Trang chu" — thoat nhanh ve dashboard tu bat ky trang nao, dung
  // theo yeu cau "bam vao 1 chuc nang cu the khong co cach nao thoat ra
  // nhanh" — truoc day chi co nut Hub (⊞) hoi nho, de bi bo qua.
  if (!document.getElementById('homeBtn') && !currentPage?.endsWith('/dashboard.html')) {
    const topbarRight = document.querySelector('.topbar__right, .hub-topbar__right');
    if (topbarRight) {
      const homeBtn = document.createElement('button');
      homeBtn.id = 'homeBtn';
      homeBtn.className = 'icon-btn';
      homeBtn.title = t('common.backToHome', 'Về trang chủ');
      homeBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>';
      homeBtn.onclick = () => { window.location.href = '/dashboard.html'; };
      topbarRight.insertBefore(homeBtn, topbarRight.firstChild);
    }
  }

  let menuToggle = document.getElementById('menuToggle');
  if (!menuToggle) {
    // Trang khong san co nut hamburger (vd dashboard.html dung topbar
    // rieng "hub-topbar") — tu tao 1 nut moi de mo Hub.
    const anchor = document.querySelector('.topbar__left') || document.querySelector('.hub-topbar__brand');
    if (!anchor) return;
    menuToggle = document.createElement('button');
    menuToggle.id = 'menuToggle';
    menuToggle.className = 'menu-toggle';
    anchor.insertBefore(menuToggle, anchor.firstChild);
  }
  menuToggle.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>';
  menuToggle.title = t('common.openHub', 'Mở danh mục điều hướng');
  menuToggle.style.display = '';
  menuToggle.onclick = () => openHubOverlay(profile, currentWorld, currentPage);
}

const SUBGROUP_LABEL = { tuition: 'Thu học phí', warehouse: 'Kho & Chi phí vận hành', role: 'Chức năng riêng' };

// MỚI — Material Design Navigation Drawer: các nhóm (phòng ban) giờ đóng
// lại theo mặc định, bấm vào tiêu đề mới mở ra — thay vì hiện hết mọi
// icon của mọi phòng ban cùng lúc (rất rối, nhất là trên điện thoại khi
// 1 người có quyền truy cập nhiều phòng ban). Chỉ nhóm chứa TRANG ĐANG MỞ
// (nếu có) được mở sẵn, còn lại đóng — đúng tinh thần "chỉ hiện đúng cái
// đang cần", giống ngăn kéo điều hướng (navigation drawer) chuẩn Material.
function renderSectionHtml(group, profile, currentPage, forceOpen) {
  const items = group.items.filter((item) => canAccess(item, profile));
  if (items.length === 0) return '';
  const hasSub = items.some((i) => i.subgroup);
  let bodyHtml;
  if (hasSub) {
    bodyHtml = Object.keys(SUBGROUP_LABEL).map((sg) => {
      const sgItems = items.filter((i) => i.subgroup === sg);
      if (sgItems.length === 0) return '';
      return `
        <div class="hub-overlay__subgroup-label">${SUBGROUP_LABEL[sg]}</div>
        <div class="hub-overlay__grid">${sgItems.map((item) => hubTileHtml(item, profile, currentPage)).join('')}</div>
      `;
    }).join('');
  } else {
    bodyHtml = `<div class="hub-overlay__grid">${items.map((item) => hubTileHtml(item, profile, currentPage)).join('')}</div>`;
  }
  const containsCurrent = items.some((item) => currentPage && currentPage.endsWith(item.href));
  const isOpen = forceOpen || containsCurrent;
  return `
    <details class="hub-overlay__section" ${isOpen ? 'open' : ''}>
      <summary class="hub-overlay__section-title">
        <span>${esc(t(group.sectionKey, group.section))}</span>
        <span class="hub-overlay__section-count">${items.length}</span>
        <svg class="icon icon--sm hub-overlay__section-chevron" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
      </summary>
      ${bodyHtml}
    </details>
  `;
}

function openOverlayPanel({ icon, color, label, bodyHtml }) {
  document.getElementById('hubOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'hubOverlay';
  overlay.className = 'hub-overlay';
  overlay.innerHTML = `
    <div class="hub-overlay__backdrop" id="hubOverlayBackdrop"></div>
    <div class="hub-overlay__panel">
      <div class="hub-overlay__header" style="--world-color:${color};">
        <div class="hub-overlay__header-title"><span>${icon}</span> ${esc(label)}</div>
        <button type="button" class="icon-btn" id="hubOverlayClose"><svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="hub-overlay__body">
        ${bodyHtml || '<div class="empty-cell">Không có mục nào khả dụng.</div>'}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('#hubOverlayBackdrop').addEventListener('click', close);
  overlay.querySelector('#hubOverlayClose').addEventListener('click', close);
}

function openHubOverlay(profile, currentWorld, currentPage) {
  const meta = WORLD_META[currentWorld];
  const groups = NAV_CONFIG.filter((g) =>
    g.sectionKey && !g.alwaysShow && WORLD_LAYERS[currentWorld].includes(g.layer)
  );
  // "Ca nhan" la 1 nhom rieng (alwaysShow), khong nam trong NAV_CONFIG
  // theo dung pattern nhu cac the gioi khac — gom rieng khi world=personal.
  const personalGroup = NAV_CONFIG.find((g) => g.alwaysShow);
  const effectiveGroups = currentWorld === 'personal' && personalGroup ? [personalGroup] : groups;

  // Neu khong nhom nao khop trang hien tai (vd dang o dashboard.html) ->
  // tu mo san nhom DAU TIEN co the hien thi duoc, tranh ngan keo trong
  // rong khi vua mo ra.
  const anyMatchesCurrent = effectiveGroups.some((g) => g.items.some((item) => canAccess(item, profile) && currentPage && currentPage.endsWith(item.href)));
  let forcedFirst = false;
  const bodyHtml = effectiveGroups.map((group) => {
    const visibleCount = group.items.filter((item) => canAccess(item, profile)).length;
    if (visibleCount === 0) return '';
    const forceOpen = !anyMatchesCurrent && !forcedFirst;
    if (forceOpen) forcedFirst = true;
    return renderSectionHtml(group, profile, currentPage, forceOpen);
  }).join('');
  openOverlayPanel({ icon: meta.icon, color: meta.color, label: meta.label, bodyHtml });
}

/**
 * Mo hub CHI 1 phong ban/section cu the (vd bam icon "Phong Nhan su" tren
 * trang chu) — hien luoi icon cua RIENG phong do, dung theo yeu cau
 * "bam icon phong ban phai hien tiep cac chuc nang cua phong do", thay vi
 * nhay thang vao 1 trang dau tien nhu truoc.
 */
export function openSectionHub(profile, group, currentPage) {
  const bodyHtml = renderSectionHtml(group, profile, currentPage, true);
  const meta = WORLD_META[layerToWorld(group.layer)] || WORLD_META.erp;
  openOverlayPanel({ icon: group.items[0]?.icon || meta.icon, color: meta.color, label: t(group.sectionKey, group.section), bodyHtml });
}

/**
 * Ban tong quat hon — mo hub voi 1 danh sach item TU CHON san (dung cho
 * icon nhom con nhu "Thu hoc phi"/"Kho & Van hanh"/"Chuc nang rieng" ben
 * trong Khoi trung tam, khong phai ca 1 section day du).
 */
export function openItemsHub(profile, { icon, color, label }, items, currentPage) {
  const bodyHtml = `<div class="hub-overlay__grid">${items.map((item) => hubTileHtml(item, profile, currentPage)).join('')}</div>`;
  openOverlayPanel({ icon, color, label, bodyHtml });
}

function hubTileHtml(item, profile, currentPage) {
  const active = currentPage && currentPage.endsWith(item.href);
  return `
    <a href="${item.href}" class="hub-overlay__tile ${active ? 'active' : ''}">
      <div class="hub-overlay__tile-icon">${item.icon}</div>
      <div class="hub-overlay__tile-label">${esc(t(item.labelKey, item.label))}</div>
    </a>
  `;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * Chèn 1 nút chuyển ngôn ngữ (VI/EN) vào topbar bằng JS — tránh phải sửa
 * lại phần <header> của mọi trang HTML trong hệ thống.
 */
function injectLangSwitcher(profileId) {
  const topbarRight = document.querySelector('.topbar__right');
  if (!topbarRight || document.getElementById('langSwitcher')) return;

  const wrap = document.createElement('div');
  wrap.id = 'langSwitcher';
  wrap.style.cssText = 'display:flex;background:var(--surface-fill);border-radius:999px;padding:2px;gap:2px;';
  wrap.innerHTML = `
    <button type="button" data-lang="vi" style="border:none;background:transparent;padding:5px 10px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;color:var(--muted);">VI</button>
    <button type="button" data-lang="en" style="border:none;background:transparent;padding:5px 10px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;color:var(--muted);">EN</button>
  `;
  topbarRight.insertBefore(wrap, topbarRight.firstChild);

  function paint() {
    const current = getLang();
    wrap.querySelectorAll('button').forEach((b) => {
      const active = b.dataset.lang === current;
      b.style.background = active ? 'var(--accent)' : 'transparent';
      b.style.color = active ? '#fff' : 'var(--muted)';
    });
  }
  wrap.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => setLang(b.dataset.lang, { supabase, employeeId: profileId }));
  });
  document.addEventListener('ais:langchange', paint);
  paint();
}

/**
 * Chèn nút "Cài đặt ứng dụng" vào topbar bằng JS — trước đây không có
 * nơi nào để tải ứng dụng về máy, người dùng không biết là cài được.
 */
function injectInstallButton() {
  const topbarRight = document.querySelector('.topbar__right, .hub-topbar__right');
  if (!topbarRight || document.getElementById('installAppBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'installAppBtn';
  btn.className = 'icon-btn';
  btn.title = t('common.installApp', 'Cài đặt ứng dụng');
  btn.innerHTML = '<svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M4 19h16"/></svg>';
  btn.style.display = 'none';
  topbarRight.insertBefore(btn, topbarRight.firstChild);
  attachInstallButton(btn);
}

/**
 * Khởi tạo khung trang (sidebar/topbar) cho MỌI trang trong app.
 * Trả về { profile, supabase } để trang gọi tiếp logic riêng của nó.
 * Nếu chưa đăng nhập -> tự chuyển hướng về trang login.
 */
export async function bootShell() {
  // Luoi an toan: neu sau 12 giay ma trang van dang "Dang tai..." (vi du
  // do mang cham/DNS/Supabase tam ngung), hien banner ro rang thay vi de
  // nguoi dung nhin man hinh trong mai khong biet dang xay ra chuyen gi.
  const watchdog = setTimeout(() => {
    const nameEl = document.getElementById('userChipName');
    if (nameEl && nameEl.textContent === 'Đang tải...') {
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; background:var(--danger); color:#fff; padding:10px 16px; font-size:13px; text-align:center; font-weight:600;';
      banner.textContent = 'Tải trang lâu hơn bình thường — có thể do mất mạng. Bấm để tải lại trang.';
      banner.style.cursor = 'pointer';
      banner.addEventListener('click', () => window.location.reload());
      document.body.prepend(banner);
    }
  }, 12000);

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    clearTimeout(watchdog);
    window.location.href = '/index.html';
    throw new Error('NO_SESSION');
  }

  const { data: employee, error } = await supabase
    .from('employees')
    .select(`
      id, full_name, avatar_url, dob, language_preference, can_teach, is_academic_board,
      departments ( code, name ),
      positions ( name, is_teacher_eligible ),
      system_roles ( code, name ),
      centers ( id, name, divisions ( code ) )
    `)
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (error || !employee) {
    // Log lỗi thật ra console — trước đây lỗi bị nuốt im lặng, khiến người
    // dùng thấy như "không đăng nhập được" dù auth đã thành công, chỉ là
    // bước tải hồ sơ nhân viên ngay sau đó bị lỗi (ví dụ thiếu cột DB do
    // chưa chạy đủ migration).
    console.error('bootShell: không tải được hồ sơ nhân viên.', error);
    clearTimeout(watchdog);
    window.location.href = '/index.html';
    throw new Error('NO_EMPLOYEE');
  }

  // Màu giao diện phải theo ĐÚNG trung tâm thật của nhân viên (qua division),
  // không phải theo lựa chọn tạm ở màn hình đăng nhập (localStorage) — nhân
  // viên khối văn phòng (HR/ACC/BĐH...) không gắn 1 trung tâm cụ thể thì mới
  // dùng lại lựa chọn đăng nhập làm mặc định.
  const realDivisionCode = employee.centers?.divisions?.code?.toLowerCase();
  if (realDivisionCode) {
    document.documentElement.setAttribute('data-division', realDivisionCode);
    localStorage.setItem('ais_division', realDivisionCode);
  }

  const profile = {
    id: employee.id,
    fullName: employee.full_name,
    dob: employee.dob,
    departmentCode: employee.departments?.code || null,
    departmentName: employee.departments?.name || '',
    positionName: employee.positions?.name || '',
    roleCode: employee.system_roles?.code || 'STAFF',
    roleName: employee.system_roles?.name || '',
    centerId: employee.centers?.id || null,
    centerName: employee.centers?.name || '',
    // SỬA LỖI THẬT: truoc day so khop theo TEN CHUC VU ("Quản lý trung tâm"
    // - chuoi text, de lech neu dat ten chuc vu khac di du chi 1 ky tu, hoac
    // employee chua duoc gan dung position_id) - khien Quan ly trung tam chi
    // vao duoc dung 1 trang duy nhat khong dieu kien (Kho trung tam), moi noi
    // khac deu bi an vi dieu kien nay luon sai. Doi sang dung MA VAI TRO he
    // thong (giong het cach RLS/backend dang dung o khap noi: 'CENTER_MANAGER').
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
    // Dùng cờ is_teacher_eligible (không phải so tên chức vụ) để đúng nghiệp vụ
    // "kiêm nhiệm": nhân viên khối văn phòng vẫn có thể dạy nếu chức vụ được
    // đánh dấu is_teacher_eligible = true.
    // "Giáo viên linh hoạt": true nếu chức vụ mặc định cho phép dạy, HOẶC
    // nhân sự khối văn phòng được tick riêng "Có thể đứng lớp giảng dạy"
    // (employees.can_teach) — không cần đổi cả phòng ban/chức vụ chính.
    isTeacher: !!employee.positions?.is_teacher_eligible || !!employee.can_teach,
    isAcademicBoard: !!employee.is_academic_board,
  };

  // SUA LOI THAT: cau nay truoc day chay TRUOC buoc cap nhat "Dang tai..."
  // -> ten that o goc tren. Neu cau nay bi treo/loi (mang chap chon, RLS
  // sai...), CA HAM bootShell dung lai o day, khong bao gio chay toi doan
  // cap nhat giao dien, gay hien tuong "Dang tai..." vinh vien ma khong
  // co loi ro rang nao hien ra (nguoi goi bootShell chi bat loi im lang).
  // Boc rieng try/catch de 1 truy van PHU khong lam sap ca trang.
  let grantedModules = new Set();
  try {
    const { data: grants } = await supabase
      .from('granted_permissions')
      .select('module_key')
      .eq('employee_id', employee.id);
    grantedModules = new Set((grants || []).map((g) => g.module_key));
  } catch (e) {
    console.warn('bootShell: không tải được quyền mở rộng (granted_permissions), tiếp tục không có quyền này.', e);
  }
  profile.grantedModules = grantedModules;

  // Ngôn ngữ hiển thị theo đúng hồ sơ nhân viên (employees.language_preference),
  // để đăng nhập ở thiết bị khác vẫn giữ đúng lựa chọn đã lưu.
  syncLangFromProfile(employee.language_preference);

  window.__AIS_PROFILE__ = profile;

  const userChipName = document.getElementById('userChipName');
  const userChipRole = document.getElementById('userChipRole');
  const userChipAvatar = document.getElementById('userChipAvatar');
  if (userChipName) userChipName.textContent = profile.fullName;
  clearTimeout(watchdog); // toi day la thanh cong hoan toan, khong con can canh bao "tai lau" nua
  if (userChipRole) userChipRole.textContent = profile.positionName || profile.roleName;
  if (userChipAvatar) userChipAvatar.textContent = initials(profile.fullName);

  renderNav(profile, document.body.dataset.page || location.pathname);
  applyTranslations();
  injectLangSwitcher(profile.id);
  injectInstallButton();

  // Xoay ngang/dọc hoặc đổi kích thước cửa sổ qua đúng mốc di động/desktop
  // (960px) -> tự vẽ lại menu cho khớp đúng danh sách được phép xem.
  let wasMobile = isMobileViewport();
  window.addEventListener('resize', () => {
    const nowMobile = isMobileViewport();
    if (nowMobile !== wasMobile) {
      wasMobile = nowMobile;
      renderNav(profile, document.body.dataset.page || location.pathname);
    }
  });

  // Bấm logo để quay về màn hình chọn phòng ban (Trang chủ)
  const brand = document.querySelector('.sidebar__brand');
  if (brand) {
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', () => { window.location.href = '/world-select.html'; });
  }
  document.addEventListener('ais:langchange', () => {
    renderNav(profile, document.body.dataset.page || location.pathname);
    applyTranslations();
    document.getElementById('logoutBtn')?.setAttribute('title', t('common.logout'));
  });

  document.getElementById('logoutBtn')?.setAttribute('title', t('common.logout'));
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
  });

  return { profile, supabase };
}