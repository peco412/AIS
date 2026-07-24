import { supabase, esc } from './supabase.js';
import { worldsWithAccess } from './shell.js';
import { NAV_CONFIG } from './navConfig.js';

const STORAGE_KEY = 'ais_lobby_layer';
const WORLD_STORAGE_KEY = 'ais_current_world';

// =====================================================================
// PHAN 1 — Dieu huong 3 lop (overlay, khong tai lai trang) + luu trang
// thai qua sessionStorage/history de F5 hoac bam Back trinh duyet van
// mo dung lop dang xem, dung yeu cau trong dac ta.
// =====================================================================
const PARENT_OF = {
  layerBranches: 'layerEntry',
  layerErp: 'layerBranches',
  layerDeptWorkspace: 'layerErp',
  layerCrm: 'layerBranches',
  layerRoom: 'layerBranches',
  layerBanzone: 'layerBranches',
};

let currentLayer = 'layerEntry';

function showLayer(id, { push = true } = {}) {
  const from = document.getElementById(currentLayer);
  const to = document.getElementById(id);
  if (from && from !== to) {
    from.classList.remove('is-active', 'is-entering');
    from.classList.add('is-leaving');
    setTimeout(() => { from.classList.remove('is-leaving'); }, 360);
  }
  to.classList.add('is-active', 'is-entering');
  setTimeout(() => { to.classList.remove('is-entering'); }, 360);
  currentLayer = id;
  sessionStorage.setItem(STORAGE_KEY, id);
  if (push) window.history.pushState({ layer: id }, '', '#' + id.replace('layer', '').toLowerCase());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('popstate', (e) => {
  const layer = e.state?.layer || 'layerEntry';
  showLayer(layer, { push: false });
  if (layer === 'layerCrm') startCrmAnimation(); else stopCrmAnimation();
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  // SUA LOI THAT: truoc day dung window.history.back() — loi khi khong
  // co "lich su" dung de quay ve (vd tai lai trang dang o thang
  // world-select.html#crm, hoac mo thang link co san #crm) — luc do
  // trinh duyet hoac khong lam gi, hoac nhay ra HAN NGOAI trang nay.
  // Gio di THANG toi dung lop cha (da ghi san trong data-back), luon
  // dang tin cay bat ke lich su trinh duyet dang the nao.
  btn.addEventListener('click', () => { showLayer(btn.dataset.back); stopCrmAnimation(); });
});

document.getElementById('btnEnterDoor').addEventListener('click', () => showLayer('layerBranches'));

// =====================================================================
// PHAN 2 — 4 nhanh: bam the -> mo dung lop noi dung, khoa theo quyen
// that (worldsWithAccess, dung chung logic voi menu chinh).
// =====================================================================
const BRANCH_TO_LAYER = { erp: 'layerErp', crm: 'layerCrm', room: 'layerRoom', banzone: 'layerBanzone' };
const BRANCH_TO_WORLD = { erp: 'erp', crm: 'crm', room: 'personal', banzone: 'database' };

document.querySelectorAll('.branch-card').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.classList.contains('branch-card--locked')) return;
    const layer = BRANCH_TO_LAYER[card.dataset.branch];
    showLayer(layer);
    if (layer === 'layerCrm') startCrmAnimation();
  });
});

function hasAccessToSection(sectionName, profile) {
  const group = NAV_CONFIG.find((g) => g.section === sectionName);
  if (!group) return false;
  return group.items.some((item) => item.visible(profile));
}

function applyBranchLocks(profile) {
  const accessibleWorlds = new Set(worldsWithAccess(profile));
  document.querySelectorAll('.branch-card[data-branch]').forEach((card) => {
    const world = BRANCH_TO_WORLD[card.dataset.branch];
    if (accessibleWorlds.has(world)) return;
    card.classList.add('branch-card--locked');
    card.querySelector('.branch-card__desc').insertAdjacentHTML('afterend', '<div class="branch-card__lock">🔒 Không có quyền</div>');
  });
}

// =====================================================================
// PHAN 3 — ERP: doi tab + luoi chuc nang dieu hanh + khoi phong ban.
// =====================================================================
function timeGreeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

const EXEC_ICONS = { '/exec/reports.html': '📊', '/exec/sign.html': '✍️' };
const DEPT_ICON = { 'Phòng nhân sự': '👥', 'Phòng kế toán': '💰', 'Phòng truyền thông': '📣', 'Phòng cơ sở vật chất': '🔧' };
// MOI — moi phong ban co MAU RIENG khi mo ra (banner chu de), khong con
// dung chung 1 mau xanh nhu truoc.
const DEPT_THEME = {
  'Phòng nhân sự': '#0094D9',
  'Phòng kế toán': '#2FAE6B',
  'Phòng truyền thông': '#A855C9',
  'Phòng cơ sở vật chất': '#D97A3D',
};
// MOI — icon RIENG cho tung chuc nang cu the (truoc day dung chung 1
// icon "📄" cho moi thu trong danh sach con, nhin rat "trong" — gio moi
// muc co bieu tuong dac trung dung noi dung cua no).
const ITEM_ICONS = {
  '/hr/employees.html': '👤', '/hr/positions.html': '🏷️', '/hr/leave-balances.html': '📅',
  '/hr/work-schedule.html': '🗓️', '/hr/contracts.html': '📜', '/hr/leave-requests.html': '✋',
  '/hr/base-salary.html': '💵', '/hr/business-trips.html': '✈️', '/hr/tasks.html': '✅', '/hr/sign.html': '✍️',
  '/acc/payment-requests.html': '🧾', '/acc/advance-requests.html': '💳', '/acc/reports.html': '📊',
  '/acc/discount-programs.html': '🏷️', '/edu/refund-requests.html': '↩️', '/acc/wallet-links.html': '🔗',
  '/acc/wallet-recovery.html': '🛠️', '/acc/sepay-transactions.html': '💸', '/acc/general-ledger.html': '📒',
  '/acc/period-closing.html': '🔒', '/acc/commissions.html': '🎯', '/acc/budget-setup.html': '📈',
  '/acc/attendance-payroll-report.html': '⏱️', '/acc/payroll.html': '💵', '/acc/tasks.html': '✅', '/acc/sign.html': '✍️',
  '/mkt/requests.html': '📣', '/mkt/event-proposals.html': '🎉', '/mkt/expense-reports.html': '🧮',
  '/mkt/accounts.html': '🔐', '/mkt/parent-announcements.html': '📢', '/mkt/extracurricular-programs.html': '🎨',
  '/mkt/tasks.html': '✅', '/mkt/sign.html': '✍️',
  '/fac/requests.html': '🛠️', '/fac/purchase-requests.html': '🛒', '/fac/stats.html': '📦',
  '/fac/tasks.html': '✅', '/fac/sign.html': '✍️',
};

document.querySelectorAll('.erp-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.erp-tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.querySelectorAll('.erp-panel').forEach((p) => p.classList.remove('is-active'));
    document.getElementById(tab.dataset.tab === 'exec' ? 'erpPanelExec' : 'erpPanelDept').classList.add('is-active');
  });
});

function renderErp(profile) {
  const execGroup = NAV_CONFIG.find((g) => g.section === 'Ban điều hành');
  const execItems = (execGroup?.items || []).filter((it) => it.visible(profile));
  document.getElementById('execGrid').innerHTML = execItems.length === 0
    ? '<div class="content-sub">🔒 Không có quyền truy cập Tầng Điều hành.</div>'
    : execItems.map((it) => `
        <div class="item-card" data-href="${it.href}">
          <span class="item-card__icon">${EXEC_ICONS[it.href] || '📁'}</span>
          <span class="item-card__name">${it.label}</span>
        </div>
      `).join('');

  const deptSections = ['Phòng nhân sự', 'Phòng kế toán', 'Phòng truyền thông', 'Phòng cơ sở vật chất'];
  document.getElementById('deptGrid').innerHTML = deptSections.map((s) => {
    const visible = hasAccessToSection(s, profile);
    return `
      <div class="item-card ${visible ? '' : 'item-card--locked'}" data-dept="${s}">
        <span class="item-card__icon">${DEPT_ICON[s]}</span>
        <span class="item-card__name">${s}</span>
        ${visible ? '' : '<span class="item-card__lock">🔒</span>'}
      </div>
    `;
  }).join('');

  document.querySelectorAll('#execGrid .item-card, #deptDrillGrid .item-card').forEach((el) => {
    el.addEventListener('click', () => { if (el.dataset.href) window.location.href = el.dataset.href; });
  });
  document.querySelectorAll('#deptGrid .item-card:not(.item-card--locked)').forEach((el) => {
    el.addEventListener('click', () => {
      const dept = el.dataset.dept;
      const group = NAV_CONFIG.find((g) => g.section === dept);
      const items = group.items.filter((it) => it.visible(profile));
      const theme = DEPT_THEME[dept] || 'var(--accent)';
      // MOI — "spacework" rieng cho tung phong ban: mo hang han 1 LOP
      // MAN HINH RIENG (giong het ERP/CRM/Room/Banzone), khong con la
      // 1 khoi mo rong ngay trong trang ERP nua.
      document.getElementById('deptWorkspaceBanner').innerHTML = `
        <div class="dept-workspace-banner" style="background:${theme}1a; border-color:${theme}40;">
          <span class="dept-workspace-banner__icon" style="background:${theme};">${DEPT_ICON[dept] || '🏢'}</span>
          <div><div class="dept-workspace-banner__name">${dept}</div><div class="dept-workspace-banner__count">${items.length} chức năng</div></div>
        </div>
      `;
      document.getElementById('deptWorkspaceGrid').innerHTML = items.map((it) => `
        <div class="item-card" data-href="${it.href}" style="border-color:${theme}30;">
          <span class="item-card__icon" style="background:${theme}1a; border-radius:8px; width:32px; height:32px; display:flex; align-items:center; justify-content:center;">${ITEM_ICONS[it.href] || '📄'}</span>
          <span class="item-card__name">${it.label}</span>
        </div>
      `).join('') || '<div class="content-sub">Không có mục nào.</div>';
      document.querySelectorAll('#deptWorkspaceGrid .item-card').forEach((c) => {
        c.addEventListener('click', () => { window.location.href = c.dataset.href; });
      });
      showLayer('layerDeptWorkspace');
    });
  });
}

// =====================================================================
// PHAN 4 — CRM: quy dao ve tinh quanh logo, du lieu trung tam THAT.
// =====================================================================
// SUA LOI THAT (lan 2): cach cu dung CSS "animation: translateX(var(--
// orbit-r)) + rotate" — ve mat ly thuyet dung, nhung tren thuc te van
// khong an dinh duoc dung do vi thoi diem do offsetWidth (luc lop dang
// an/vua hien) khong dang tin cay, va % trong translateX() lai tinh theo
// KICH THUOC PHAN TU chu khong phai san khau. Lam lai HOAN TOAN khac —
// bo CSS animation, tu tinh toa do bang JS qua requestAnimationFrame,
// gan THANG top/left (khong qua transform/bien CSS nao ca) — chac chan
// dung, khong con phu thuoc thoi diem do kich thuoc.
let crmAnimHandle = null;
let CRM_SATELLITES = []; // { el, angleDeg, radiusPct, speedDegPerSec }

// MOI — moi trung tam gio la 1 "tieu hanh tinh" rieng: mau khac nhau,
// kich thuoc khac nhau, va CO QUY DAO RIENG cua no (khong con dung 2
// vong gop chung nhu truoc) — dung dan xen ban kinh deu nhau tu gan ra
// xa, giong 1 he mat troi that hon la 2 nhom co dinh.
const PLANET_COLORS = ['#0094D9', '#E8A33D', '#2FAE6B', '#A855C9', '#E85D5D', '#3DBFB0', '#7B68C4', '#D97A3D'];

async function renderCrm(profile) {
  const { data: centers, error } = await supabase.from('centers').select('id, name, code').eq('is_active', true).order('name');
  const sub = document.getElementById('crmSub');
  const stage = document.getElementById('crmStage');
  if (error || !centers || centers.length === 0) { sub.textContent = 'Không tải được danh sách trung tâm.'; return; }
  sub.textContent = `${centers.length} trung tâm đang hoạt động`;

  let html = '<div class="crm-logo"><div class="crm-logo__title">AIS</div><div class="crm-logo__sub">OFFICE</div></div>';
  const n = centers.length;
  // Ban kinh quy dao rieng cho tung hanh tinh — dan xen deu tu gan ra xa
  // (18% -> 46% cua san khau), moi trung tam 1 khoang cach khac nhau.
  const minR = 0.18, maxR = 0.46;
  const step = n > 1 ? (maxR - minR) / (n - 1) : 0;

  CRM_SATELLITES = [];
  centers.forEach((c, i) => {
    const rPct = minR + step * i;
    const sizePct = rPct * 200; // duong kinh vong quy dao (% cua san khau)
    // Goc bat dau lech nhau (khong xep hang thang) cho tu nhien hon.
    const angleDeg = (137.5 * i) % 360; // "golden angle" — rai deu, khong trung lap kieu hinh hoc
    const color = PLANET_COLORS[i % PLANET_COLORS.length];
    const diameter = 40 + (i % 3) * 8; // 40/48/56px — hanh tinh to nho khac nhau
    const isAccessible = !profile.isCenterManager || profile.centerId === c.id;

    html += `<div class="crm-orbit" style="width:${sizePct}%; height:${sizePct}%; margin-left:-${sizePct / 2}%; margin-top:-${sizePct / 2}%;"></div>`;
    html += `
      <div class="crm-satellite ${isAccessible ? '' : 'crm-satellite--locked'}" data-center="${c.id}"
           style="width:${diameter}px; height:${diameter}px; ${isAccessible ? `background: radial-gradient(circle at 32% 30%, ${color}dd, ${color});` : ''} ${isAccessible ? `border-color:${color};` : ''}"
           tabindex="${isAccessible ? '0' : '-1'}" role="button" aria-label="Vào trung tâm ${esc(c.name)}">
        <span class="crm-satellite__label" style="${isAccessible ? 'color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.25);' : ''}">${esc(c.code || c.name.slice(0, 4))}</span>
        <span class="crm-satellite__full">${esc(c.name)}${isAccessible ? '' : ' — 🔒'}</span>
      </div>
    `;
    CRM_SATELLITES.push({ angleDeg, radiusPct: rPct, speedDegPerSec: 360 / (45 + rPct * 90), half: diameter / 2 });
  });

  stage.innerHTML = html;
  const satelliteEls = [...stage.querySelectorAll('.crm-satellite')];
  satelliteEls.forEach((el, i) => { CRM_SATELLITES[i].el = el; });

  satelliteEls.forEach((el) => {
    el.addEventListener('click', () => {
      if (el.classList.contains('crm-satellite--locked')) return;
      localStorage.setItem(WORLD_STORAGE_KEY, 'crm');
      localStorage.setItem('ais_selected_center', el.dataset.center);
      window.location.href = '/dashboard.html';
    });
  });
}

function positionCrmSatellitesOnce() {
  const stage = document.getElementById('crmStage');
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return false;
  CRM_SATELLITES.forEach((s) => {
    const rad = (s.angleDeg * Math.PI) / 180;
    const rx = w * s.radiusPct, ry = h * s.radiusPct;
    const x = w / 2 + rx * Math.cos(rad) - s.half;
    const y = h / 2 + ry * Math.sin(rad) - s.half;
    s.el.style.left = x + 'px';
    s.el.style.top = y + 'px';
  });
  return true;
}

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function startCrmAnimation() {
  stopCrmAnimation();
  if (!positionCrmSatellitesOnce()) { setTimeout(startCrmAnimation, 80); return; }
  if (REDUCE_MOTION) return; // vi tri tinh la du, khong xoay
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    const stage = document.getElementById('crmStage');
    const w = stage.clientWidth, h = stage.clientHeight;
    CRM_SATELLITES.forEach((s) => {
      s.angleDeg = (s.angleDeg + s.speedDegPerSec * dt) % 360;
      const rad = (s.angleDeg * Math.PI) / 180;
      const rx = w * s.radiusPct, ry = h * s.radiusPct;
      s.el.style.left = (w / 2 + rx * Math.cos(rad) - s.half) + 'px';
      s.el.style.top = (h / 2 + ry * Math.sin(rad) - s.half) + 'px';
    });
    crmAnimHandle = requestAnimationFrame(frame);
  }
  crmAnimHandle = requestAnimationFrame(frame);
}
function stopCrmAnimation() { if (crmAnimHandle) cancelAnimationFrame(crmAnimHandle); crmAnimHandle = null; }

// =====================================================================
// PHAN 5 — ROOM: luoi phang cac chuc nang ca nhan.
// =====================================================================
const ROOM_ICONS = {
  '/directory.html': '📇', '/profile.html': '👤', '/my-payroll.html': '💵', '/meetings.html': '🗓️',
  '/attendance-checkin.html': '📍', '/hr/late-clockin-requests.html': '⏰', '/acc/purchase-orders.html': '🧾',
  '/proposals.html': '💡', '/archive.html': '📚', '/permission-requests.html': '🔑', '/change-password.html': '🔒',
};
function renderRoom(profile) {
  const group = NAV_CONFIG.find((g) => g.section === 'Chức năng cá nhân');
  const grid = document.getElementById('roomGrid');
  grid.innerHTML = group.items.map((item) => {
    const visible = item.visible(profile);
    return `
      <div class="item-card ${visible ? '' : 'item-card--locked'}" data-href="${item.href}">
        <span class="item-card__icon">${ROOM_ICONS[item.href] || '✨'}</span>
        <span class="item-card__name">${item.label}</span>
        ${visible ? '' : '<span class="item-card__lock">🔒</span>'}
      </div>
    `;
  }).join('');
  grid.querySelectorAll('.item-card:not(.item-card--locked)').forEach((el) => {
    el.addEventListener('click', () => { window.location.href = el.dataset.href; });
  });
}

// =====================================================================
// PHAN 6 — BANZONE: gop theo danh muc (accordion) + tim nhanh.
// =====================================================================
const BANZONE_CATEGORIES = [
  { name: 'Tổ chức', icon: '🏢', hrefs: ['/master-data/centers.html', '/master-data/departments.html', '/master-data/system-roles.html', '/master-data/divisions.html'] },
  { name: 'Tài chính', icon: '💰', hrefs: ['/acc/suppliers.html', '/master-data/expense-categories.html', '/master-data/chart-of-accounts.html', '/master-data/wallet-tier-discounts.html', '/master-data/program-pricing.html', '/master-data/program-plan-discounts.html'] },
  { name: 'Vận hành', icon: '📦', hrefs: ['/master-data/size-chart.html', '/master-data/inventory-items.html'] },
];
function renderBanzone(profile) {
  const group = NAV_CONFIG.find((g) => g.section === 'Cấu hình dữ liệu gốc');
  const itemsByHref = {};
  group.items.forEach((it) => { itemsByHref[it.href] = it; });
  const usedHrefs = new Set(BANZONE_CATEGORIES.flatMap((c) => c.hrefs));
  const remaining = group.items.filter((it) => !usedHrefs.has(it.href));
  const categories = [...BANZONE_CATEGORIES];
  if (remaining.length > 0) categories.push({ name: 'Hệ thống', icon: '⚙️', hrefs: remaining.map((it) => it.href) });

  const box = document.getElementById('banzoneAccordions');
  box.innerHTML = categories.map((cat, ci) => {
    const items = cat.hrefs.map((h) => itemsByHref[h]).filter(Boolean);
    const anyVisible = items.some((it) => it.visible(profile));
    return `
      <div class="accordion ${anyVisible ? '' : 'accordion--locked'}" data-cat="${ci}">
        <div class="accordion__head">
          <span class="accordion__icon">${cat.icon}</span>
          <span class="accordion__name">${cat.name}</span>
          <span class="accordion__count">${items.length} mục${anyVisible ? '' : ' — 🔒'}</span>
          <span class="accordion__arrow">▸</span>
        </div>
        <div class="accordion__body">
          ${items.map((it) => {
            const visible = it.visible(profile);
            return `<div class="accordion-row ${visible ? '' : 'accordion-row--locked'}" data-href="${it.href}" data-name="${it.label.toLowerCase()}">${it.label}${visible ? '' : ' 🔒'}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.accordion:not(.accordion--locked) .accordion__head').forEach((head) => {
    head.addEventListener('click', () => { head.closest('.accordion').classList.toggle('is-open'); });
  });
  box.querySelectorAll('.accordion-row:not(.accordion-row--locked)').forEach((row) => {
    row.addEventListener('click', (e) => { e.stopPropagation(); window.location.href = row.dataset.href; });
  });

  document.getElementById('banzoneSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    box.querySelectorAll('.accordion-row').forEach((row) => {
      const match = !q || row.dataset.name.includes(q);
      row.classList.toggle('accordion-row--hidden', !match);
      if (match && q) row.closest('.accordion').classList.add('is-open');
    });
  });
}

// =====================================================================
// PHAN 7 — Cham cong nhanh (giu nguyen logic, doi mau sang theme sang).
// =====================================================================
let PROFILE = null;
let CENTER = null;
let LAST_POSITION = null;
const RADIUS_LIMIT_M = 1000;

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fmtDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }

function watchPosition() {
  const hint = document.getElementById('ciGpsHint');
  if (!('geolocation' in navigator)) { hint.textContent = 'Trình duyệt không hỗ trợ định vị vị trí.'; return; }
  navigator.geolocation.watchPosition(
    (pos) => {
      LAST_POSITION = pos.coords;
      const dist = distanceMeters(pos.coords.latitude, pos.coords.longitude, CENTER.latitude, CENTER.longitude);
      const inRange = dist <= RADIUS_LIMIT_M;
      hint.textContent = inRange ? `Trong phạm vi — cách trung tâm ${fmtDistance(dist)}` : `Ngoài phạm vi — cách ${fmtDistance(dist)} (giới hạn 1km)`;
      hint.style.color = inRange ? 'var(--success)' : 'var(--danger)';
      const btnIn = document.getElementById('btnCiIn');
      const btnOut = document.getElementById('btnCiOut');
      if (btnIn.style.display !== 'none') btnIn.disabled = !inRange;
      if (btnOut.style.display !== 'none') btnOut.disabled = !inRange;
    },
    (err) => { hint.textContent = 'Không lấy được vị trí: ' + (err.message || 'cần cho phép truy cập vị trí.'); hint.style.color = 'var(--danger)'; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

async function loadTodayStatus() {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('attendance_checkins').select('check_type, checked_at')
    .eq('employee_id', PROFILE.id).gte('checked_at', todayStart.toISOString()).order('checked_at', { ascending: true });
  const hasIn = (data || []).some((r) => r.check_type === 'in');
  const hasOut = (data || []).some((r) => r.check_type === 'out');
  const status = document.getElementById('ciStatus');
  const btnIn = document.getElementById('btnCiIn');
  const btnOut = document.getElementById('btnCiOut');
  if (hasIn && hasOut) {
    status.textContent = '✓ Đã hoàn tất chấm công hôm nay (vào & ra).';
    btnIn.style.display = 'none'; btnOut.style.display = 'none';
  } else if (hasIn) {
    status.textContent = `✓ Đã chấm công vào lúc ${new Date(data.find((r) => r.check_type === 'in').checked_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    btnIn.style.display = 'none'; btnOut.style.display = 'block';
  } else {
    status.textContent = 'Chưa chấm công vào hôm nay.';
    btnIn.style.display = 'block'; btnOut.style.display = 'none';
  }
}

async function doCheckin(type) {
  const errBox = document.getElementById('ciError');
  errBox.style.display = 'none';
  if (!LAST_POSITION) { errBox.textContent = 'Chưa xác định được vị trí — đợi vài giây rồi thử lại.'; errBox.style.display = 'block'; return; }
  const dist = distanceMeters(LAST_POSITION.latitude, LAST_POSITION.longitude, CENTER.latitude, CENTER.longitude);
  if (dist > RADIUS_LIMIT_M) { errBox.textContent = `Cách trung tâm ${fmtDistance(dist)} — ngoài phạm vi cho phép (1km).`; errBox.style.display = 'block'; return; }
  const btn = type === 'in' ? document.getElementById('btnCiIn') : document.getElementById('btnCiOut');
  btn.disabled = true; const oldText = btn.textContent; btn.textContent = 'Đang chấm công...';
  try {
    const { error } = await supabase.from('attendance_checkins').insert({
      employee_id: PROFILE.id, center_id: CENTER.id, check_type: type,
      latitude: LAST_POSITION.latitude, longitude: LAST_POSITION.longitude, distance_m: dist,
    });
    if (error) throw error;
    await loadTodayStatus();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.style.display = 'block';
    btn.disabled = false; btn.textContent = oldText;
  }
}
document.getElementById('btnCiIn').addEventListener('click', () => doCheckin('in'));
document.getElementById('btnCiOut').addEventListener('click', () => doCheckin('out'));
document.getElementById('btnCloseCheckin').addEventListener('click', () => { document.getElementById('checkinOverlay').classList.remove('is-visible'); });
document.getElementById('checkinOverlay').addEventListener('click', (e) => { if (e.target.id === 'checkinOverlay') e.currentTarget.classList.remove('is-visible'); });

let checkinInitialized = false;
async function openCheckin() {
  document.getElementById('checkinOverlay').classList.add('is-visible');
  if (checkinInitialized) return;
  checkinInitialized = true;
  if (!PROFILE?.centerId) {
    document.getElementById('ciGpsHint').textContent = 'Bạn không gắn cố định 1 trung tâm — dùng trang chấm công đầy đủ để chọn đúng trung tâm đang có mặt.';
    document.getElementById('btnCiIn').style.display = 'none';
    document.getElementById('btnCiOut').style.display = 'none';
    return;
  }
  const { data: center } = await supabase.from('centers').select('id, name, latitude, longitude').eq('id', PROFILE.centerId).single();
  if (!center || !center.latitude || !center.longitude) {
    document.getElementById('ciGpsHint').textContent = 'Trung tâm của bạn chưa có toạ độ GPS — liên hệ kỹ thuật.';
    document.getElementById('btnCiIn').style.display = 'none';
    document.getElementById('btnCiOut').style.display = 'none';
    return;
  }
  CENTER = center;
  document.getElementById('ciCenterName').textContent = center.name;
  watchPosition();
  await loadTodayStatus();
}
document.getElementById('btnOpenCheckin').addEventListener('click', openCheckin);

// =====================================================================
// BOOT
// =====================================================================
(async () => {
  document.getElementById('greetingEyebrow').textContent = timeGreeting();

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) { window.location.href = '/index.html'; return; }

  const { data: employee } = await supabase
    .from('employees')
    .select(`
      id, full_name, center_id,
      departments ( code ), positions ( name ),
      system_roles ( code ), centers ( id, name )
    `)
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (!employee) return;
  document.getElementById('userNameSpan').textContent = employee.full_name || '';
  PROFILE = { id: employee.id, centerId: employee.center_id };

  const fullProfile = {
    id: employee.id,
    departmentCode: employee.departments?.code || null,
    positionName: employee.positions?.name || '',
    roleCode: employee.system_roles?.code || 'STAFF',
    centerId: employee.centers?.id || null,
    centerName: employee.centers?.name || '',
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
  };

  applyBranchLocks(fullProfile);
  renderErp(fullProfile);
  renderRoom(fullProfile);
  renderBanzone(fullProfile);
  await renderCrm(fullProfile);

  // Khoi phuc dung lop dang xem neu F5 / mo lai (dung sessionStorage) —
  // SUA: truoc day chi goi showLayer(..., {push:false}) — hien dung lop
  // nhung KHONG dung lai chuoi lich su cha-con, khien nut Back CUA TRINH
  // DUYET (khac voi nut "Quay lai" trong app da sua rieng o tren) van bi
  // sai — gio dung lai DUNG chuoi tu goc truoc khi hien lop dich.
  const savedLayer = sessionStorage.getItem(STORAGE_KEY);
  if (savedLayer && savedLayer !== 'layerEntry' && document.getElementById(savedLayer)) {
    window.history.replaceState({ layer: 'layerEntry' }, '', '#entry');
    const chain = [];
    let walk = savedLayer;
    while (walk) { chain.unshift(walk); walk = PARENT_OF[walk]; }
    chain.forEach((id) => { window.history.pushState({ layer: id }, '', '#' + id.replace('layer', '').toLowerCase()); });
    showLayer(savedLayer, { push: false });
    if (savedLayer === 'layerCrm') startCrmAnimation();
  } else {
    window.history.replaceState({ layer: 'layerEntry' }, '', '#entry');
  }
})();
