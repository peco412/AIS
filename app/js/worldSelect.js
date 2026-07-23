import { supabase, esc } from './supabase.js';
import { worldsWithAccess } from './shell.js';

const WORLD_STORAGE_KEY = 'ais_current_world';
const RADIUS_LIMIT_M = 1000;

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function enterWorld(world) {
  localStorage.setItem(WORLD_STORAGE_KEY, world);
  window.location.href = '/dashboard.html';
}

// SUA: cong truong ("gateGroup") dung CHUNG kieu dang voi cac toa nha
// (.ws-building, tu nhac len khi tro chuot) nhung KHONG phai la 1 the
// gioi de nhay toi — bam vao se mo the "Cham cong nhanh" thay vi dieu
// huong, nen phai kiem tra rieng, tranh goi nham enterWorld(undefined).
document.querySelectorAll('.ws-building').forEach((el) => {
  const isGate = el.id === 'gateGroup';
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (isGate) { toggleCheckin(); return; }
    if (el.classList.contains('ws-building--locked')) return; // khong lam gi ca, da khoa
    enterWorld(el.dataset.world);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (isGate) { toggleCheckin(); return; }
    if (el.classList.contains('ws-building--locked')) return;
    enterWorld(el.dataset.world);
  });
});
document.getElementById('btnSkip').addEventListener('click', () => enterWorld('erp'));

// ---------------------------------------------------------------------
// MỚI — Chấm công nhanh ngay tại cổng, không cần rời màn hình chọn thế
// giới — logic core giống hệt attendance-checkin.html (định vị GPS, bán
// kính 1km) nhưng gọn lại thành 1 thẻ nhỏ bung ra khi bấm vào cổng.
// ---------------------------------------------------------------------
let PROFILE = null;
let CENTER = null;
let LAST_POSITION = null;
let watchId = null;

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
  watchId = navigator.geolocation.watchPosition(
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

  // MOI — khoa truy cap dung the gioi khong co quyen: dung LAI chinh xac
  // logic phan quyen da co san cua he thong (worldsWithAccess, tu
  // navConfig.js) — tranh viet lai luat rieng o day de roi bi lech voi
  // menu that (vd 1 vai tro duoc them quyen sau nay ma quen sua ca 2 cho).
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

  document.querySelectorAll('.ws-building[data-world]').forEach((el) => {
    const world = el.dataset.world;
    if (accessibleWorlds.has(world)) return;
    // Khoa lai: mo den xam, bo tro chuot/ban phim, hien khoa nho thay vi
    // nhan ten the gioi — khong xoa han khoi man hinh de van thay du 4
    // toa nha (dung that voi bo cuc san truong), chi ro rang la KHONG VAO
    // DUOC thay vi im lang khong phan ung khi bam vao.
    el.classList.add('ws-building--locked');
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    const label = el.querySelector('.ws-label-sub') || el.querySelector('.ws-label');
    if (label) {
      const lockNote = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lockNote.setAttribute('x', label.getAttribute('x'));
      lockNote.setAttribute('y', String(Number(label.getAttribute('y')) + 14));
      lockNote.setAttribute('class', 'ws-label-lock');
      lockNote.textContent = '🔒 Không có quyền truy cập';
      el.appendChild(lockNote);
    }
  });
})();
