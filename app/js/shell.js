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
  erp: { label: 'ERP — Vận hành nội bộ', icon: '🏢', color: '#0094D9' },
  crm: { label: 'CRM — Khối trung tâm', icon: '🎓', color: '#22a06b' },
  database: { label: 'Database — Dữ liệu gốc', icon: '🗄️', color: '#6c5ce7' },
  personal: { label: 'Cá nhân', icon: '👤', color: '#8a8f98' },
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
  injectWorldSwitcher(profile, currentWorld, currentPage);
  injectHubLauncher(profile, currentWorld, currentPage);
}

// Danh sach the gioi ma nguoi nay THUC SU co it nhat 1 muc dung duoc —
// an han the gioi rong (vd nhan vien thuong khong co gi trong "Database").
function worldsWithAccess(profile) {
  return Object.keys(WORLD_META).filter((world) => {
    if (world === 'personal') return true; // ai cung co Chuc nang ca nhan
    return NAV_CONFIG.some((group) =>
      group.sectionKey && !group.alwaysShow && WORLD_LAYERS[world].includes(group.layer)
      && group.items.some((item) => canAccess(item, profile))
    );
  });
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
      homeBtn.textContent = '🏠';
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
  menuToggle.textContent = '⊞';
  menuToggle.title = t('common.openHub', 'Mở danh mục điều hướng');
  menuToggle.style.display = '';
  menuToggle.onclick = () => openHubOverlay(profile, currentWorld, currentPage);
}

const SUBGROUP_LABEL = { tuition: 'Thu học phí', warehouse: 'Kho & Chi phí vận hành', role: 'Chức năng riêng' };

function renderSectionHtml(group, profile, currentPage) {
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
  return `
    <div class="hub-overlay__section">
      <h3 class="hub-overlay__section-title">${esc(t(group.sectionKey, group.section))}</h3>
      ${bodyHtml}
    </div>
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
        <button type="button" class="icon-btn" id="hubOverlayClose">✕</button>
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

  const bodyHtml = effectiveGroups.map((group) => renderSectionHtml(group, profile, currentPage)).join('');
  openOverlayPanel({ icon: meta.icon, color: meta.color, label: meta.label, bodyHtml });
}

/**
 * Mo hub CHI 1 phong ban/section cu the (vd bam icon "Phong Nhan su" tren
 * trang chu) — hien luoi icon cua RIENG phong do, dung theo yeu cau
 * "bam icon phong ban phai hien tiep cac chuc nang cua phong do", thay vi
 * nhay thang vao 1 trang dau tien nhu truoc.
 */
export function openSectionHub(profile, group, currentPage) {
  const bodyHtml = renderSectionHtml(group, profile, currentPage);
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
 * Chèn nút "📲 Cài đặt ứng dụng" vào topbar bằng JS — trước đây không có
 * nơi nào để tải ứng dụng về máy, người dùng không biết là cài được.
 */
function injectInstallButton() {
  const topbarRight = document.querySelector('.topbar__right, .hub-topbar__right');
  if (!topbarRight || document.getElementById('installAppBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'installAppBtn';
  btn.className = 'icon-btn';
  btn.title = t('common.installApp', 'Cài đặt ứng dụng');
  btn.textContent = '📲';
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
      banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; background:#d3352f; color:#fff; padding:10px 16px; font-size:13px; text-align:center; font-weight:600;';
      banner.textContent = '⚠️ Tải trang lâu hơn bình thường — có thể do mất mạng. Bấm để tải lại trang.';
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
    // đánh dấu is_teacher_eligible = true (khớp với app/edu/teachers.js).
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
    brand.addEventListener('click', () => { window.location.href = '/dashboard.html'; });
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
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.toggle('open');
  });

  return { profile, supabase };
}