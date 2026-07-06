import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let chartInstance = null;

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }
function last14Days() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function loadTopStats() {
  const [{ count: studying }, { count: reserved }, { count: withdrawn }, { count: newThisMonth }] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('center_id', PROFILE.centerId).eq('status', 'studying'),
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('center_id', PROFILE.centerId).eq('status', 'reserved'),
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('center_id', PROFILE.centerId).eq('status', 'withdrawn'),
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('center_id', PROFILE.centerId)
      .gte('enrollment_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)),
  ]);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Đang học</div><div class="value mono" style="color:var(--success);">${studying ?? 0}</div></div>
    <div class="stat-card"><div class="label">Bảo lưu</div><div class="value mono" style="color:var(--warning);">${reserved ?? 0}</div></div>
    <div class="stat-card"><div class="label">Nghỉ học vĩnh viễn</div><div class="value mono" style="color:var(--danger);">${withdrawn ?? 0}</div></div>
    <div class="stat-card"><div class="label">Đăng ký mới tháng này</div><div class="value mono">${newThisMonth ?? 0}</div></div>
  `;
}

async function loadChart() {
  const days = last14Days();
  const { data: classIds } = await supabase.from('classes').select('id').eq('center_id', PROFILE.centerId);
  const ids = (classIds || []).map((c) => c.id);
  if (ids.length === 0) return;

  const { data } = await supabase
    .from('class_attendance')
    .select('session_date, present')
    .in('class_id', ids)
    .gte('session_date', days[0]);

  const byDay = {};
  days.forEach((d) => { byDay[d] = { present: 0, total: 0 }; });
  (data || []).forEach((r) => {
    if (!byDay[r.session_date]) return;
    byDay[r.session_date].total += 1;
    if (r.present) byDay[r.session_date].present += 1;
  });

  const rates = days.map((d) => (byDay[d].total ? Math.round((byDay[d].present / byDay[d].total) * 100) : null));

  const ctx = document.getElementById('attendanceChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days.map((d) => new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })),
      datasets: [{ label: 'Tỷ lệ chuyên cần (%)', data: rates, borderColor: '#0094d9', backgroundColor: 'rgba(0,148,217,0.12)', fill: true, tension: 0.3, spanGaps: true }],
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } },
  });
}

async function loadClassTable(date) {
  const tbody = document.getElementById('classTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, employees:teacher_id(full_name)')
    .eq('center_id', PROFILE.centerId)
    .eq('status', 'active');

  if (!classes || classes.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Trung tâm chưa có lớp đang hoạt động.</td></tr>'; return; }

  const { data: attendance } = await supabase
    .from('class_attendance')
    .select('class_id, present')
    .eq('session_date', date)
    .in('class_id', classes.map((c) => c.id));

  const byClass = {};
  (attendance || []).forEach((r) => {
    byClass[r.class_id] = byClass[r.class_id] || { present: 0, absent: 0 };
    if (r.present) byClass[r.class_id].present += 1; else byClass[r.class_id].absent += 1;
  });

  tbody.innerHTML = classes.map((c) => {
    const stat = byClass[c.id];
    const total = stat ? stat.present + stat.absent : 0;
    const rate = total ? Math.round((stat.present / total) * 100) : null;
    return `
      <tr>
        <td>${esc(c.name)}</td>
        <td class="cell-muted">${esc(c.employees?.full_name || '—')}</td>
        <td class="cell-code">${stat ? stat.present : '—'}</td>
        <td class="cell-code">${stat ? stat.absent : '—'}</td>
        <td>${rate != null ? `<span class="badge badge-${rate >= 80 ? 'active' : rate >= 50 ? 'submitted' : 'rejected'}">${rate}%</span>` : '—'}</td>
        <td class="cell-muted">${stat ? 'Đã điểm danh' : 'Chưa điểm danh'}</td>
      </tr>
    `;
  }).join('');
}

async function loadAbsentStudents() {
  const tbody = document.getElementById('absentTableBody');
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: classIds } = await supabase.from('classes').select('id').eq('center_id', PROFILE.centerId);
  const ids = (classIds || []).map((c) => c.id);
  if (ids.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Không có dữ liệu.</td></tr>'; return; }

  const { data } = await supabase
    .from('class_attendance')
    .select('student_id, class_id, present, students(full_name, phone, parent_name), classes(name)')
    .in('class_id', ids)
    .eq('present', false)
    .gte('session_date', since.toISOString().slice(0, 10));

  const byStudent = {};
  (data || []).forEach((r) => {
    if (!byStudent[r.student_id]) byStudent[r.student_id] = { count: 0, name: r.students?.full_name, className: r.classes?.name, phone: r.students?.phone };
    byStudent[r.student_id].count += 1;
  });

  const rows = Object.values(byStudent).filter((s) => s.count >= 3).sort((a, b) => b.count - a.count).slice(0, 20);
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="4" class="empty-cell">Không có học viên nào vắng từ 3 buổi trở lên trong 30 ngày qua.</td></tr>'
    : rows.map((s) => `
      <tr>
        <td>${esc(s.name || '—')}</td>
        <td class="cell-muted">${esc(s.className || '—')}</td>
        <td><span class="badge badge-rejected">${s.count} buổi</span></td>
        <td class="cell-code">${esc(s.phone || '—')}</td>
      </tr>
    `).join('');
}

document.getElementById('filterDate').addEventListener('change', (e) => loadClassTable(e.target.value));

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    if (!PROFILE.centerId) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Trang này dành cho Quản lý trung tâm — tài khoản của bạn chưa gắn với 1 trung tâm cụ thể.</div>';
      return;
    }
    document.getElementById('filterDate').value = new Date().toISOString().slice(0, 10);
    await Promise.all([loadTopStats(), loadChart(), loadClassTable(document.getElementById('filterDate').value), loadAbsentStudents()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
