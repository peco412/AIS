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
  if (layer === 'layerCrm') setTimeout(repositionCrmSatellites, 60);
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => { window.history.back(); });
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
    if (layer === 'layerCrm') setTimeout(repositionCrmSatellites, 60);
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
      const group = NAV_CONFIG.find((g) => g.section === el.dataset.dept);
      const items = group.items.filter((it) => it.visible(profile));
      document.getElementById('deptDrillTitle').textContent = el.dataset.dept;
      document.getElementById('deptDrillGrid').innerHTML = items.map((it) => `
        <div class="item-card" data-href="${it.href}"><span class="item-card__icon">📄</span><span class="item-card__name">${it.label}</span></div>
      `).join('') || '<div class="content-sub">Không có mục nào.</div>';
      document.querySelectorAll('#deptDrillGrid .item-card').forEach((c) => {
        c.addEventListener('click', () => { window.location.href = c.dataset.href; });
      });
      document.getElementById('deptDrill').classList.add('is-visible');
      document.getElementById('deptDrill').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

// =====================================================================
// PHAN 4 — CRM: quy dao ve tinh quanh logo, du lieu trung tam THAT.
// =====================================================================
async function renderCrm(profile) {
  const { data: centers, error } = await supabase.from('centers').select('id, name, code').eq('is_active', true).order('name');
  const sub = document.getElementById('crmSub');
  const stage = document.getElementById('crmStage');
  if (error || !centers || centers.length === 0) { sub.textContent = 'Không tải được danh sách trung tâm.'; return; }
  sub.textContent = `${centers.length} trung tâm đang hoạt động`;

  let html = '<div class="crm-logo"><div class="crm-logo__title">AIS</div><div class="crm-logo__sub">OFFICE</div></div>';
  const n = centers.length;
  const ring1 = centers.slice(0, Math.min(n, 6));
  const ring2 = centers.slice(6);
  // SUA LOI THAT: truoc day dung "--orbit-r: 44%" roi translateX(var(--orbit-r))
  // — nhung transform: translateX(%) luon tinh theo KICH THUOC CUA CHINH
  // PHAN TU DO (ve tinh 56px), KHONG PHAI theo khung san khau — nen ban
  // kinh thuc te chi ~25px, khien moi ve tinh don cuc vao sat logo. Gio do
  // dung KICH THUOC THAT cua san khau (do bang JS) roi tinh ban kinh ra
  // PIXEL that, khong dung % nua.
  const stageSize = stage.offsetWidth || 560;
  const rings = [{ items: ring1, rPct: 0.30, size: 220 }, { items: ring2, rPct: 0.44, size: 340 }].filter((r) => r.items.length > 0);

  rings.forEach((ring) => {
    html += `<div class="crm-orbit" style="width:${ring.size}%; height:${ring.size}%; margin-left:-${ring.size / 2}%; margin-top:-${ring.size / 2}%;"></div>`;
    const count = ring.items.length;
    const radiusPx = Math.round(stageSize * ring.rPct);
    ring.items.forEach((c, i) => {
      const angle = (360 / count) * i;
      const duration = 40 + radiusPx / 10;
      const isAccessible = !profile.isCenterManager || profile.centerId === c.id;
      html += `
        <div class="crm-satellite ${isAccessible ? '' : 'crm-satellite--locked'}" data-center="${c.id}" data-ring-pct="${ring.rPct}"
             style="top:50%; left:50%; margin-top:-28px; margin-left:-28px; --orbit-r:${radiusPx}px; animation-duration:${duration}s; animation-delay:-${(angle / 360) * duration}s;"
             tabindex="${isAccessible ? '0' : '-1'}" role="button" aria-label="Vào trung tâm ${esc(c.name)}">
          ${esc(c.code || c.name.slice(0, 4))}
          <span class="crm-satellite__full">${esc(c.name)}${isAccessible ? '' : ' — 🔒'}</span>
        </div>
      `;
    });
  });

  stage.innerHTML = html;
  repositionCrmSatellites();
  stage.querySelectorAll('.crm-satellite').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.classList.contains('crm-satellite--locked')) return;
      localStorage.setItem(WORLD_STORAGE_KEY, 'crm');
      localStorage.setItem('ais_selected_center', el.dataset.center);
      window.location.href = '/dashboard.html';
    });
  });
}

// MOI — tinh lai ban kinh quy dao THEO KICH THUOC THAT cua san khau tai
// thoi diem lop CRM dang HIEN (khi dang an, offsetWidth = 0, do sai) —
// goi lai moi khi mo lop nay de dam bao chinh xac tren moi kich man hinh.
function repositionCrmSatellites() {
  const stage = document.getElementById('crmStage');
  const stageSize = stage.offsetWidth;
  if (!stageSize) return; // van dang an, doi lan goi sau
  stage.querySelectorAll('.crm-satellite').forEach((el) => {
    const ringPct = Number(el.dataset.ringPct);
    const radiusPx = Math.round(stageSize * ringPct);
    el.style.setProperty('--orbit-r', radiusPx + 'px');
  });
}

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

  // Khoi phuc dung lop dang xem neu F5 / mo lai (dung sessionStorage)
  const savedLayer = sessionStorage.getItem(STORAGE_KEY);
  if (savedLayer && savedLayer !== 'layerEntry' && document.getElementById(savedLayer)) {
    showLayer(savedLayer, { push: false });
    if (savedLayer === 'layerCrm') setTimeout(repositionCrmSatellites, 60);
  } else {
    window.history.replaceState({ layer: 'layerEntry' }, '', '#entry');
  }

  window.addEventListener('resize', () => { if (currentLayer === 'layerCrm') repositionCrmSatellites(); });
})();
