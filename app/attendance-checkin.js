import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const RADIUS_LIMIT_M = 1000; // bán kính cho phép chấm công — 1km theo đúng yêu cầu

let PROFILE = null;
let CENTER = null;
let LAST_POSITION = null;

// Công thức Haversine — tính khoảng cách thật giữa 2 toạ độ GPS (mét)
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtTime(d) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
function fmtDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }

function watchPosition() {
  const hint = document.getElementById('gpsHint');
  if (!('geolocation' in navigator)) {
    hint.textContent = 'Trình duyệt không hỗ trợ định vị vị trí.';
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      LAST_POSITION = pos.coords;
      const dist = distanceMeters(pos.coords.latitude, pos.coords.longitude, CENTER.latitude, CENTER.longitude);
      const inRange = dist <= RADIUS_LIMIT_M;
      hint.textContent = inRange
        ? `Đang trong phạm vi — cách trung tâm ${fmtDistance(dist)}`
        : `❌ Ngoài phạm vi cho phép — cách trung tâm ${fmtDistance(dist)} (giới hạn 1km)`;
      hint.style.color = inRange ? 'var(--success)' : 'var(--danger)';
      document.getElementById('btnCheckIn').disabled = !inRange;
      document.getElementById('btnCheckOut').disabled = !inRange;
    },
    (err) => {
      hint.textContent = 'Không lấy được vị trí: ' + (err.message || 'Bạn cần cho phép truy cập vị trí.');
      hint.style.color = 'var(--danger)';
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

async function loadTodayHistory() {
  const tbody = document.getElementById('historyBody');
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('attendance_checkins')
    .select('check_type, checked_at, distance_m')
    .eq('employee_id', PROFILE.id)
    .gte('checked_at', todayStart.toISOString())
    .order('checked_at', { ascending: true });

  if (error) { tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">Chưa có lượt chấm công nào hôm nay.</td></tr>';
  } else {
    tbody.innerHTML = data.map((r) => `
      <tr>
        <td class="cell-code">${fmtTime(r.checked_at)}</td>
        <td><span class="badge badge-${r.check_type === 'in' ? 'active' : 'draft'}">${r.check_type === 'in' ? 'Chấm công vào' : 'Chấm công ra'}</span></td>
        <td class="cell-muted">${fmtDistance(r.distance_m)}</td>
      </tr>
    `).join('');
  }

  const hasIn = (data || []).some((r) => r.check_type === 'in');
  const hasOut = (data || []).some((r) => r.check_type === 'out');
  document.getElementById('statusIn').style.display = hasIn ? 'none' : 'block';
  document.getElementById('statusIn').textContent = hasIn ? '' : 'Chưa chấm công vào hôm nay';
  document.getElementById('btnCheckIn').style.display = hasIn ? 'none' : 'block';
  document.getElementById('statusOut').style.display = hasIn && !hasOut ? 'block' : 'none';
  document.getElementById('btnCheckOut').style.display = hasIn && !hasOut ? 'block' : 'none';
  if (hasIn && hasOut) {
    document.getElementById('statusIn').style.display = 'block';
    document.getElementById('statusIn').textContent = 'Đã hoàn tất chấm công hôm nay (vào & ra)';
  }
}

async function doCheckin(type) {
  const errBox = document.getElementById('checkinError');
  errBox.classList.remove('show');

  if (!LAST_POSITION) { errBox.textContent = 'Chưa xác định được vị trí — vui lòng đợi vài giây rồi thử lại.'; errBox.classList.add('show'); return; }

  const dist = distanceMeters(LAST_POSITION.latitude, LAST_POSITION.longitude, CENTER.latitude, CENTER.longitude);
  if (dist > RADIUS_LIMIT_M) {
    errBox.textContent = `Bạn đang cách trung tâm ${fmtDistance(dist)} — ngoài phạm vi cho phép (1km). Không thể chấm công.`;
    errBox.classList.add('show');
    return;
  }

  const btn = type === 'in' ? document.getElementById('btnCheckIn') : document.getElementById('btnCheckOut');
  btn.disabled = true; btn.textContent = 'Đang chấm công...';
  try {
    const { error } = await supabase.from('attendance_checkins').insert({
      employee_id: PROFILE.id, center_id: CENTER.id, check_type: type,
      latitude: LAST_POSITION.latitude, longitude: LAST_POSITION.longitude, distance_m: dist,
    });
    if (error) throw error;
    await loadTodayHistory();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = type === 'in' ? '📍 Chấm công vào' : '📍 Chấm công ra';
  }
}

document.getElementById('btnCheckIn').addEventListener('click', () => doCheckin('in'));
document.getElementById('btnCheckOut').addEventListener('click', () => doCheckin('out'));

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;

    if (!profile.centerId) {
      // Khối văn phòng không gắn cố định 1 trung tâm — vẫn cho chấm công
      // nếu họ đang thực sự có mặt tại 1 trung tâm nào đó (ví dụ đi công
      // tác/họp), tự chọn đúng trung tâm đang đứng thay vì bị chặn hẳn.
      const { data: centers } = await supabase.from('centers').select('id, name, latitude, longitude').order('name');
      document.getElementById('officeCenterPicker').style.display = 'block';
      document.getElementById('centerSelect').innerHTML = '<option value="">— Chọn trung tâm —</option>' +
        (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

      document.getElementById('centerSelect').addEventListener('change', async (e) => {
        const chosen = (centers || []).find((c) => c.id === e.target.value);
        if (!chosen || !chosen.latitude || !chosen.longitude) {
          document.getElementById('checkinCard').style.display = 'none';
          return;
        }
        CENTER = chosen;
        document.getElementById('centerName').textContent = chosen.name;
        document.getElementById('checkinCard').style.display = 'block';
        watchPosition();
        await loadTodayHistory();
      });
      return;
    }

    const { data: center } = await supabase.from('centers').select('id, name, latitude, longitude').eq('id', profile.centerId).single();
    if (!center || !center.latitude || !center.longitude) {
      document.getElementById('noCenterNotice').style.display = 'block';
      document.getElementById('noCenterNotice').textContent = 'Trung tâm của bạn chưa được cấu hình toạ độ GPS — liên hệ bộ phận kỹ thuật.';
      return;
    }
    CENTER = center;
    document.getElementById('centerName').textContent = center.name;
    document.getElementById('checkinCard').style.display = 'block';

    watchPosition();
    await loadTodayHistory();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
