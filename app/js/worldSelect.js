import { supabase } from './supabase.js';
import { worldsWithAccess } from './shell.js';

const WORLD_STORAGE_KEY = 'ais_current_world';
const RADIUS_LIMIT_M = 1000;

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 11) return 'CHÀO BUỔI SÁNG';
  if (h < 14) return 'CHÀO BUỔI TRƯA';
  if (h < 18) return 'CHÀO BUỔI CHIỀU';
  return 'CHÀO BUỔI TỐI';
}

function enterWorld(world) {
  localStorage.setItem(WORLD_STORAGE_KEY, world);
  window.location.href = '/dashboard.html';
}

// ---------------------------------------------------------------------
// MOI — Vet sang mo phia sau (trang tri, dung dung mau slate-blue +
// cyan theo dac ta).
// ---------------------------------------------------------------------
function renderBackgroundStreaks() {
  const svg = document.getElementById('bgStreak');
  let html = '';
  for (let i = 0; i < 5; i++) {
    const y = 10 + i * 20 + Math.random() * 8;
    const w = 30 + Math.random() * 40;
    html += `<rect x="${Math.random() * 60}%" y="${y}%" width="${w}%" height="1" fill="#22D3EE" opacity="${(0.02 + Math.random() * 0.04).toFixed(2)}"/>`;
  }
  svg.innerHTML = html;
}

// ---------------------------------------------------------------------
// MOI — Anh sang phan chieu tren mat kinh toa nha di chuyen theo con tro
// chuot, dung "Interactive Lighting" trong dac ta.
// ---------------------------------------------------------------------
const stage = document.getElementById('wsStage');
const cursorGlow = document.getElementById('cursorGlow');
const buildingSvg = document.getElementById('buildingScene');
stage.addEventListener('mousemove', (e) => {
  const rect = stage.getBoundingClientRect();
  const viewBox = buildingSvg.viewBox.baseVal;
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;
  const x = viewBox.x + px * viewBox.width;
  const y = viewBox.y + py * viewBox.height;
  cursorGlow.setAttribute('cx', x.toFixed(0));
  cursorGlow.setAttribute('cy', y.toFixed(0));
});

// ---------------------------------------------------------------------
// MOI — Cua chinh: hieu ung "Dolly Zoom" (phong to tien vao trong) truoc
// khi hien Sanh chinh (4 nhanh) — dung dac ta yeu cau.
// ---------------------------------------------------------------------
const branchesOverlay = document.getElementById('branchesOverlay');
const btnBack = document.getElementById('btnBack');
const subText = document.getElementById('subText');
const footerBar = document.getElementById('footerBar');

function openBranches() {
  buildingSvg.classList.add('is-entering');
  setTimeout(() => { branchesOverlay.classList.add('is-visible'); }, 700);
  btnBack.classList.add('is-visible');
  subText.textContent = 'Chọn nơi bạn muốn bắt đầu';
  footerBar.style.display = 'none';
}
function closeBranches() {
  branchesOverlay.classList.remove('is-visible');
  buildingSvg.classList.remove('is-entering');
  btnBack.classList.remove('is-visible');
  subText.textContent = 'Bấm vào cửa để bước vào sảnh chính';
  footerBar.style.display = 'block';
}

document.getElementById('doorGroup').addEventListener('click', openBranches);
document.getElementById('doorGroup').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBranches(); }
});
btnBack.addEventListener('click', closeBranches);

branchesOverlay.querySelectorAll('.ws-branch-card').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.classList.contains('ws-branch-card--locked')) return;
    if (card.dataset.world === 'erp') { window.location.href = '/erp-lobby.html'; return; }
    if (card.dataset.world === 'crm') { window.location.href = '/crm-galaxy.html'; return; }
    if (card.dataset.world === 'personal') { window.location.href = '/room-lobby.html'; return; }
    if (card.dataset.world === 'database') { window.location.href = '/banzone-vault.html'; return; }
    enterWorld(card.dataset.world);
  });
});
document.getElementById('btnSkip').addEventListener('click', () => enterWorld('erp'));

// ---------------------------------------------------------------------
// Tram cham cong kinh (Glass Kiosk) — logic giu nguyen nhu truoc.
// ---------------------------------------------------------------------
let PROFILE = null;
let CENTER = null;
let LAST_POSITION = null;

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
      hint.style.color = inRange ? '#67E8F9' : '#FCA5A5';
      const btnIn = document.getElementById('btnCiIn');
      const btnOut = document.getElementById('btnCiOut');
      if (btnIn.style.display !== 'none') btnIn.disabled = !inRange;
      if (btnOut.style.display !== 'none') btnOut.disabled = !inRange;
    },
    (err) => { hint.textContent = 'Không lấy được vị trí: ' + (err.message || 'cần cho phép truy cập vị trí.'); hint.style.color = '#FCA5A5'; },
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
document.getElementById('btnCloseCheckin').addEventListener('click', () => { document.getElementById('checkinCard').style.display = 'none'; });

let checkinInitialized = false;
async function toggleCheckin() {
  const card = document.getElementById('checkinCard');
  if (card.style.display === 'block') { card.style.display = 'none'; return; }
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
const checkinTrigger = document.getElementById('checkinTrigger');
checkinTrigger.addEventListener('click', toggleCheckin);
checkinTrigger.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCheckin(); } });

(async () => {
  renderBackgroundStreaks();
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
  const accessibleWorlds = new Set(worldsWithAccess(fullProfile));

  branchesOverlay.querySelectorAll('.ws-branch-card[data-world]').forEach((card) => {
    if (accessibleWorlds.has(card.dataset.world)) return;
    card.classList.add('ws-branch-card--locked');
    const desc = card.querySelector('.ws-branch-card__desc');
    const lockNote = document.createElement('div');
    lockNote.className = 'ws-branch-card__lock';
    lockNote.textContent = '🔒 Không có quyền truy cập';
    desc.after(lockNote);
  });
})();
