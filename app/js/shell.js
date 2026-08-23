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
  '/world-select.html', '/notifications.html', '/profile.html', '/directory.html',
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
  injectHubLauncher(profile, currentWorld, currentPage);
  injectMobileBottomNav(profile, currentWorld, currentPage);
  if (!currentPage?.endsWith('/world-select.html')) injectSiblingSidebar(profile, currentPage);
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
    <a href="/world-select.html" class="${isOn('/world-select.html') ? 'active' : ''}">
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
function injectSiblingSidebar(profile, currentPage) {
  document.getElementById('subSidebar')?.remove();
  const oldWrap = document.querySelector('.main-content-area');
  const main = document.querySelector('.main');
  if (oldWrap && main) { while (oldWrap.firstChild) main.insertBefore(oldWrap.firstChild, oldWrap); oldWrap.remove(); main.classList.remove('main--with-subsidebar'); }
  if (!main) return;

  const group = findActiveGroup(currentPage, profile);
  if (!group) return;
  const items = group.items.filter((item) => canAccess(item, profile));
  if (items.length <= 1) return; // chi 1 muc (chinh trang nay) thi khong can sidebar phu

  // Bọc toàn bộ nội dung .main hiện có vào 1 wrapper riêng, rồi đặt
  // sidebar phụ bên cạnh — hoàn toàn bằng JS, không cần sửa tay 121 file
  // HTML. LÀM LẠI 22/08/2026: trước đây là 1 dải pill cuộn ngang ở đầu
  // trang ("sibling-strip") — nhiều mục thì tràn dài, rối mắt, không rõ
  // đây là điều hướng phụ hay nội dung trang. Đổi thành sidebar dọc thật
  // sự, tách bạch rõ ràng khỏi nội dung chính, giống mẫu ứng dụng desktop
  // chuyên nghiệp hơn.
  const contentWrap = document.createElement('div');
  contentWrap.className = 'main-content-area';
  while (main.firstChild) contentWrap.appendChild(main.firstChild);

  const subSidebar = document.createElement('nav');
  subSidebar.id = 'subSidebar';
  subSidebar.className = 'sub-sidebar';
  subSidebar.innerHTML = `
    <div class="sub-sidebar__title">${esc(t(group.sectionKey, group.section || ''))}</div>
    ${items.map((item) => {
      const active = currentPage && currentPage.endsWith(item.href);
      return `<a href="${item.href}" class="sub-sidebar__item ${active ? 'active' : ''}">${item.icon}<span>${esc(t(item.labelKey, item.label))}</span></a>`;
    }).join('')}
  `;

  main.classList.add('main--with-subsidebar');
  main.appendChild(subSidebar);
  main.appendChild(contentWrap);
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
 * (dashboard.html khi đó có khung riêng .hub-topbar__brand), còn 90 trang
 * khác hoàn toàn KHÔNG có tên hệ thống nào hiện trên thanh trên cùng
 * (sidebar cũ có nhưng đã ẩn vĩnh viễn). Thêm lại ở đây — LUÔN hiện, mọi
 * trang. LÀM LẠI 22/08/2026: dashboard.html giờ cũng dùng chung đúng
 * .topbar chuẩn (không còn .hub-topbar riêng), nên hàm này áp dụng thống
 * nhất cho MỌI trang qua cùng 1 selector, không cần phân biệt nữa.
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
 * Nut mo Hub (thay cho nut hamburger cu tung dung de dong/mo sidebar) —
 * bam vao hien 1 lop phu day man hinh voi luoi icon cua DUNG the gioi
 * dang chon, thay hoan toan cho viec di chuyen bang cay sidebar truoc day.
 */
function injectHubLauncher(profile, currentWorld, currentPage) {
  // Nut "Trang chu" — thoat nhanh ve /world-select.html tu bat ky trang
  // nao, dung theo yeu cau "bam vao 1 chuc nang cu the khong co cach nao
  // thoat ra nhanh" — truoc day chi co nut Hub (⊞) hoi nho, de bi bo qua.
  if (!document.getElementById('homeBtn') && !currentPage?.endsWith('/world-select.html')) {
    const topbarRight = document.querySelector('.topbar__right');
    if (topbarRight) {
      const homeBtn = document.createElement('button');
      homeBtn.id = 'homeBtn';
      homeBtn.className = 'icon-btn';
      homeBtn.title = t('common.backToHome', 'Về trang chủ');
      homeBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>';
      homeBtn.onclick = () => { window.location.href = '/world-select.html'; };
      topbarRight.insertBefore(homeBtn, topbarRight.firstChild);
    }
  }

  let menuToggle = document.getElementById('menuToggle');
  if (!menuToggle) {
    // Trang chua co san nut hamburger tinh trong HTML (topbar__left rong,
    // vd dashboard.html) — tu tao 1 nut moi de mo Hub.
    const anchor = document.querySelector('.topbar__left');
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

  // Neu khong nhom nao khop trang hien tai (vd dang o world-select.html) ->
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
  // Chèn NGAY SAU nút Home (nếu có) — khớp đúng thứ tự chuẩn topbar:
  // AIS OFFICE, Home, Đổi ngôn ngữ, Thông báo, Hồ sơ cá nhân, Đăng xuất.
  const homeBtn = document.getElementById('homeBtn');
  if (homeBtn && homeBtn.nextSibling) topbarRight.insertBefore(wrap, homeBtn.nextSibling);
  else if (homeBtn) topbarRight.appendChild(wrap);
  else topbarRight.insertBefore(wrap, topbarRight.firstChild);

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
  const topbarRight = document.querySelector('.topbar__right');
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

  // MOI — gan 1 cham mau + icon nho canh tieu de trang, dung DUNG mau/
  // icon da dung o Sanh ERP trong trang cho (lobby) — noi TOAN BO trang
  // trong tung phong ban voi dung mau cua no, sua 1 CHO NAY la ap dung
  // duoc cho MOI trang hien tai va sau nay, khong can sua tung file HTML.
  // Boc try/catch rieng — neu co loi gi o day cung KHONG lam hong phan
  // con lai cua bootShell (dang xuat, thong bao... van chay binh thuong).
  try { injectDeptHeaderBadge(); } catch (e) { /* khong lam gi, chi la trang tri */ }
  try { setupMobileTableLabels(); } catch (e) { /* khong lam gi, bang van dung duoc, chi thieu nhan tren dien thoai */ }
  // LÀM LẠI 22/08/2026 — footer mới: trước đây hệ thống KHÔNG có footer
  // trang thật nào. Dựng bằng JS ở đây, gắn vào MỌI trang hiện có (áp
  // dụng ngay, không cần sửa tay 121 file HTML) và mọi trang thêm sau này
  // (chỉ cần gọi bootShell() như mọi trang khác đã làm).
  try { injectFooter(); } catch (e) { /* khong lam gi, chi la trang tri */ }

  return { profile, supabase };
}

// LÀM LẠI 22/08/2026 — Footer dựng bằng JS, gắn vào MỌI trang gọi
// bootShell() (tức là toàn bộ ~121 trang hiện có, tự động, không cần sửa
// tay từng file HTML). Chỉ 1 nguồn duy nhất ở đây — sau này đổi nội dung
// footer chỉ cần sửa 1 chỗ, không phải rà lại hàng trăm file.
function injectFooter() {
  if (document.getElementById('appFooter')) return; // đã có (vd F5 lại nhanh) — không chèn trùng
  const shell = document.querySelector('.app-shell');
  if (!shell) return; // trang không dùng khung chuẩn (vd trang đăng nhập) — bỏ qua, không phải lỗi
  const year = new Date().getFullYear();
  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  footer.id = 'appFooter';
  footer.innerHTML = `
    <div class="app-footer__brand"><span class="dot" aria-hidden="true"></span>AIS OFFICE © ${year}</div>
    <div class="app-footer__links">
      <a href="/directory.html">Danh bạ</a>
      <a href="/archive.html">Kho lưu trữ</a>
      <a href="/permission-requests.html">Hỗ trợ quyền hạn</a>
    </div>
  `;
  shell.appendChild(footer);
}

function injectDeptHeaderBadge() {
  const DEPT_BADGE = {
    '/hr/': { icon: '👥', color: '#0094D9', label: 'Phòng nhân sự' },
    '/acc/': { icon: '💰', color: '#2FAE6B', label: 'Phòng kế toán' },
    '/mkt/': { icon: '📣', color: '#A855C9', label: 'Phòng truyền thông' },
    '/fac/': { icon: '🔧', color: '#D97A3D', label: 'Phòng cơ sở vật chất' },
    '/exec/': { icon: '🏛️', color: '#D4AF6E', label: 'Ban điều hành' },
    '/master-data/': { icon: '🗄️', color: '#6c5ce7', label: 'Dữ liệu gốc' },
    '/edu/': { icon: '🎓', color: '#22a06b', label: 'Khối trung tâm' },
    '/consultant/': { icon: '🎓', color: '#22a06b', label: 'Khối trung tâm' },
    '/teacher/': { icon: '🎓', color: '#22a06b', label: 'Khối trung tâm' },
  };
  // MOI — 3 trang nay nam trong thu muc /acc/ nhung THUC RA thuoc "Khoi
  // trung tam" (CRM) trong dieu huong chung, khong phai nghiep vu Ke
  // toan thuan tuy — uu tien kiem tra rieng TRUOC ca quy tac theo thu
  // muc, tranh bi gan nham mau Ke toan.
  const CRM_OVERRIDE_PAGES = new Set([
    '/acc/wallet-topup-requests.html', '/acc/budget-setup.html', '/acc/commissions.html',
  ]);
  const CRM_BADGE = { icon: '🎓', color: '#22a06b', label: 'Khối trung tâm' };
  // MOI — cac trang "Room" (ca nhan) khong nam chung 1 thu muc nhu cac
  // phong ban khac (vd /profile.html, /meetings.html nam thang o goc),
  // nen phai liet ke DUNG TEN FILE thay vi doan tien to duong dan — dung
  // mau xam cua the gioi "Ca nhan" da dat o lobby.
  const ROOM_PAGES = new Set([
    '/directory.html', '/profile.html', '/my-payroll.html', '/meetings.html',
    '/attendance-checkin.html', '/proposals.html', '/archive.html',
    '/permission-requests.html', '/change-password.html', '/acc/purchase-orders.html',
  ]);
  const ROOM_BADGE = { icon: '🚪', color: '#8a8f98', label: 'Cá nhân' };

  const path = window.location.pathname;
  let badgeInfo;
  if (CRM_OVERRIDE_PAGES.has(path)) badgeInfo = CRM_BADGE;
  else if (ROOM_PAGES.has(path)) badgeInfo = ROOM_BADGE;
  else {
    const prefix = Object.keys(DEPT_BADGE).find((p) => path.startsWith(p));
    badgeInfo = prefix ? DEPT_BADGE[prefix] : null;
  }

  const pageHeader = document.querySelector('.page-header');
  if (!pageHeader || pageHeader.dataset.lobbyHeaderDone) return; // da lam roi thi thoi, tranh chen 2 lan
  pageHeader.dataset.lobbyHeaderDone = '1';

  // MOI — thanh nho phia tren tieu de trang, DUNG DUNG kieu "eyebrow" +
  // nut "Quay lai" da dung o trang cho (lobby) — ap dung cho MOI trang
  // co ".page-header", khong rieng gi cac trang co gan duoc mau phong
  // ban. Day chinh la "noi de ve lobby" khi dang o sau trong 1 chuc
  // nang cu the cua tung phong.
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;';
  bar.innerHTML = `
    <a href="/world-select.html" style="display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--muted); text-decoration:none;">← Sảnh chính</a>
    ${badgeInfo ? `<span style="font-family:var(--font-mono); font-size:10.5px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${badgeInfo.color};">${esc(badgeInfo.label)}</span>` : ''}
  `;
  pageHeader.parentElement.insertBefore(bar, pageHeader);

  if (!badgeInfo) return;
  const h1 = pageHeader.querySelector('h1');
  if (!h1 || h1.querySelector('.dept-header-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'dept-header-badge';
  badge.textContent = badgeInfo.icon;
  badge.style.cssText = `display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:10px; background:${badgeInfo.color}1a; margin-right:10px; font-size:15px; vertical-align:middle;`;
  h1.insertBefore(badge, h1.firstChild);
}

// MOI — Gan "data-label" cho tung o <td> DUA VAO DUNG CHU O <thead> CUNG
// BANG DO — de CSS (@media max-width:640px trong module.css) co the
// hien tung dong bang thanh 1 the doc tren dien thoai, kem ten cot ro
// rang, MA KHONG can sua tay bat ky trang nao trong so hon 100 trang
// dang co bang du lieu. Vi da so bang deu duoc dien du lieu SAU KHI
// trang da tai xong (goi API roi moi "innerHTML = ..."), phai theo doi
// them thay doi trong trang bang MutationObserver de gan nhan LAI moi
// khi co dong moi duoc them vao — CHI theo doi "co phan tu moi hay
// khong" (childList), TUYET DOI KHONG theo doi thay doi thuoc tinh
// (attributes) — vi chinh ham nay se ghi thuoc tinh data-label, neu lo
// theo doi ca attributes se tu kich hoat lai chinh no vo han lan.
function applyMobileTableLabels() {
  document.querySelectorAll('.data-table').forEach((table) => {
    const headerCells = table.querySelectorAll('thead th');
    if (headerCells.length === 0) return;
    const headers = [...headerCells].map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (td.hasAttribute('data-label')) return; // da gan roi, bo qua cho nhanh
        const label = headers[i];
        if (label) td.setAttribute('data-label', label);
      });
    });
  });
}

function setupMobileTableLabels() {
  applyMobileTableLabels();
  let pending = null;
  const observer = new MutationObserver(() => {
    // Gop nhieu thay doi lien tiep lai thanh 1 lan chay (vd 1 bang render
    // ca chuc dong cung luc), tranh chay lai qua nhieu lan lien tuc.
    if (pending) clearTimeout(pending);
    pending = setTimeout(applyMobileTableLabels, 120);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}