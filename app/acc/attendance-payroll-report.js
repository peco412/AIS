import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtDate(d) { return new Date(d).toLocaleDateString('vi-VN'); }
function fmtTime(d) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadReport() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);
  const centerId = document.getElementById('filterCenter').value;
  const monthStart = new Date(year, month - 1, 1).toISOString();
  const monthEnd = new Date(year, month, 1).toISOString();

  let query = supabase.from('attendance_checkins')
    .select('employee_id, center_id, check_type, checked_at, employees(full_name), centers(name)')
    .gte('checked_at', monthStart).lt('checked_at', monthEnd)
    .order('checked_at', { ascending: true });
  if (centerId) query = query.eq('center_id', centerId);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Không có dữ liệu chấm công trong tháng này.</td></tr>'; return; }

  // Đơn xin chấm công trễ ĐÃ ĐƯỢC PHÓ PHÒNG NS DUYỆT trong tháng này —
  // dùng để tự động đánh dấu "Đúng giờ" cho đúng ngày đó, khớp đúng logic
  // "Hệ thống tự động sửa đổi dữ liệu thành Chấm công đúng giờ".
  const { data: lateApprovals } = await supabase.from('late_clockin_requests')
    .select('employee_id, late_date').eq('status', 'approved')
    .gte('late_date', monthStart.slice(0, 10)).lt('late_date', monthEnd.slice(0, 10));
  const onTimeOverrides = new Set((lateApprovals || []).map((l) => `${l.employee_id}:${l.late_date}`));

  // Gom theo nhân viên -> theo ngày -> {in, out}
  const byEmployee = {};
  data.forEach((r) => {
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = { name: r.employees?.full_name || '—', center: r.centers?.name || '—', days: {} };
    const dateKey = r.checked_at.slice(0, 10);
    if (!byEmployee[r.employee_id].days[dateKey]) byEmployee[r.employee_id].days[dateKey] = {};
    byEmployee[r.employee_id].days[dateKey][r.check_type] = r.checked_at;
  });

  const rows = Object.entries(byEmployee).map(([empId, info]) => {
    const dateKeys = Object.keys(info.days).sort();
    const daysWithIn = dateKeys.filter((d) => info.days[d].in).length;
    const missingOut = dateKeys.filter((d) => info.days[d].in && !info.days[d].out).length;
    return { empId, info, dateKeys, daysWithIn, missingOut };
  });

  document.getElementById('resultCount').textContent = `${rows.length} nhân viên`;

  function fmtInOut(day, empId, dateKey) {
    const inTime = day.in ? fmtTime(day.in) : '—';
    const outTime = day.out ? fmtTime(day.out) : '<span style="color:var(--danger);">chưa ra</span>';
    const isExcused = onTimeOverrides.has(`${empId}:${dateKey}`);
    const badge = isExcused ? ' <span class="badge badge-active" style="font-size:9px;">Đúng giờ (đã duyệt)</span>' : '';
    return `vào ${inTime} → ra ${outTime}${badge}`;
  }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.info.name)}</td>
      <td class="cell-muted">${esc(r.info.center)}</td>
      <td class="mono" style="font-weight:700; color:var(--success);">${r.daysWithIn}</td>
      <td class="mono" style="color:${r.missingOut > 0 ? 'var(--danger)' : 'var(--muted)'};">${r.missingOut}</td>
      <td>
        <details>
          <summary class="cell-muted" style="cursor:pointer;">Xem ${r.dateKeys.length} ngày</summary>
          <div style="font-size:11.5px; margin-top:6px; line-height:1.8;">
            ${r.dateKeys.map((d) => `
              <div>${fmtDate(d)}: ${fmtInOut(r.info.days[d], r.empId, d)}</div>
            `).join('')}
          </div>
        </details>
      </td>
    </tr>
  `).join('');
}

document.getElementById('filterCenter').addEventListener('change', loadReport);
document.getElementById('filterMonth').addEventListener('change', loadReport);

(async () => {
  try {
    const { profile } = await bootShell();
    const canUse = ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode) || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Trưởng/phó phòng Kế toán hoặc Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    document.getElementById('filterMonth').value = new Date().toISOString().slice(0, 7);
    await loadCenters();
    await loadReport();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
