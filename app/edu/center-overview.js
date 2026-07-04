import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let IS_SYSTEM_WIDE = false;

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadStats() {
  const centerId = IS_SYSTEM_WIDE ? document.getElementById('filterCenter').value : PROFILE.centerId;

  let classesQuery = supabase.from('classes').select('id, name, status, student_count, programs(name)');
  let studentsQuery = supabase.from('students').select('id, status', { count: 'exact', head: true });
  let leadsQuery = supabase.from('crm_leads').select('id', { count: 'exact', head: true });
  if (centerId) {
    classesQuery = classesQuery.eq('center_id', centerId);
    studentsQuery = studentsQuery.eq('center_id', centerId);
    leadsQuery = leadsQuery.eq('center_id', centerId);
  }

  const [{ data: classes }, { count: studentCount }, { count: leadCount }] = await Promise.all([
    classesQuery, studentsQuery, leadsQuery,
  ]);

  const activeClasses = (classes || []).filter((c) => c.status === 'active');
  const totalSeats = activeClasses.reduce((sum, c) => sum + (c.student_count || 0), 0);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Lớp đang hoạt động</div><div class="value mono">${activeClasses.length}</div></div>
    <div class="stat-card"><div class="label">Tổng sĩ số đang học</div><div class="value mono">${totalSeats}</div></div>
    <div class="stat-card"><div class="label">Học viên (tất cả trạng thái)</div><div class="value mono">${studentCount ?? 0}</div></div>
    <div class="stat-card"><div class="label">Hồ sơ khách hàng (CRM)</div><div class="value mono">${leadCount ?? 0}</div></div>
  `;

  const byProgram = {};
  activeClasses.forEach((c) => {
    const name = c.programs?.name || 'Khác';
    if (!byProgram[name]) byProgram[name] = { classes: 0, seats: 0 };
    byProgram[name].classes += 1;
    byProgram[name].seats += c.student_count || 0;
  });

  const rows = Object.entries(byProgram).sort((a, b) => b[1].classes - a[1].classes);
  const tbody = document.getElementById('programBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="3" class="empty-cell">Chưa có lớp nào đang hoạt động.</td></tr>'
    : rows.map(([name, v]) => `
      <tr><td>${esc(name)}</td><td class="cell-code">${v.classes}</td><td class="cell-code">${v.seats}</td></tr>
    `).join('');
}

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    IS_SYSTEM_WIDE = !profile.centerId || ['DEPT_HEAD', 'DEPT_DEPUTY', 'EXECUTIVE', 'TECH'].includes(profile.roleCode);

    if (IS_SYSTEM_WIDE) {
      document.getElementById('pageTitle').textContent = 'Tổng quan thống kê toàn hệ thống';
      document.getElementById('pageSub').textContent = 'Có thể lọc theo từng trung tâm.';
      document.getElementById('filterBar').style.display = '';
      await loadCenters();
      document.getElementById('filterCenter').addEventListener('change', loadStats);
    } else {
      document.getElementById('pageTitle').textContent = `Tổng quan trung tâm — ${profile.centerName}`;
    }
    await loadStats();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
