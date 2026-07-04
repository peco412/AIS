import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  // "Giáo viên" xác định qua positions.is_teacher_eligible = true, khớp đúng
  // nghiệp vụ "2 đầu việc" (nhân sự khác có chứng chỉ dạy học, không chỉ role STAFF EDU).
  let query = supabase
    .from('employees')
    .select('id, employee_code, full_name, phone, email, is_foreign_teacher, center_id, centers(name), positions!inner(name, is_teacher_eligible)')
    .eq('positions.is_teacher_eligible', true)
    .order('full_name');
  if (PROFILE.centerId) query = query.eq('center_id', PROFILE.centerId);

  const { data: employees, error } = await query;

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  let classesQuery = supabase.from('classes').select('teacher_id').eq('status', 'active');
  if (PROFILE.centerId) classesQuery = classesQuery.eq('center_id', PROFILE.centerId);
  const { data: classCounts } = await classesQuery;

  const countMap = {};
  (classCounts || []).forEach((c) => { if (c.teacher_id) countMap[c.teacher_id] = (countMap[c.teacher_id] || 0) + 1; });

  ALL_ROWS = (employees || []).map((e) => ({ ...e, classCount: countMap[e.id] || 0 }));
  render();
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !search || r.full_name.toLowerCase().includes(search));
  document.getElementById('resultCount').textContent = `${rows.length} giáo viên`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có giáo viên nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.full_name)}</td>
      <td class="cell-code">${esc(r.employee_code)}</td>
      <td class="cell-muted">${esc(r.centers?.name || '—')}</td>
      <td class="cell-muted">${esc(r.phone || '—')}</td>
      <td class="cell-muted">${esc(r.email || '—')}</td>
      <td class="cell-code">${r.classCount}</td>
      <td>${r.is_foreign_teacher ? '<span class="badge badge-active">Có</span>' : '—'}</td>
    </tr>
  `).join('');
}

document.getElementById('searchInput').addEventListener('input', render);

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
