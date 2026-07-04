import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let ALL_ROWS = [];

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
}

async function loadLookups() {
  const [{ data: depts }, { data: centers }] = await Promise.all([
    supabase.from('departments').select('id, name').order('name'),
    supabase.from('centers').select('id, name').order('name'),
  ]);
  document.getElementById('filterDept').innerHTML = '<option value="">Tất cả phòng ban</option>' +
    (depts || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  // Chỉ lấy đúng các cột không nhạy cảm — trang này ai cũng xem được nên
  // KHÔNG select CCCD/địa chỉ/liên lạc khẩn cấp dù RLS có cho phép ở tầng bảng.
  const { data, error } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, email, phone, department_id, center_id, status, departments(name), positions(name), centers(name)')
    .eq('status', 'active')
    .order('full_name');

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const dept = document.getElementById('filterDept').value;
  const center = document.getElementById('filterCenter').value;

  const rows = ALL_ROWS.filter((r) =>
    (!dept || r.department_id === dept) &&
    (!center || r.center_id === center) &&
    (!search ||
      r.full_name.toLowerCase().includes(search) ||
      r.employee_code.toLowerCase().includes(search) ||
      (r.email || '').toLowerCase().includes(search) ||
      (r.phone || '').includes(search))
  );

  document.getElementById('resultCount').textContent = `${rows.length} nhân viên`;
  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Không tìm thấy ai phù hợp.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><span class="avatar-sm">${esc(initials(r.full_name))}</span>${esc(r.full_name)} <span class="cell-muted">(${esc(r.employee_code)})</span></td>
      <td>${esc(r.positions?.name || '—')}</td>
      <td class="cell-muted">${esc(r.departments?.name || '—')}</td>
      <td class="cell-muted">${r.centers?.name ? esc(r.centers.name) : 'Văn phòng'}</td>
      <td>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '<span class="cell-muted">—</span>'}</td>
      <td class="cell-code">${esc(r.phone || '—')}</td>
    </tr>
  `).join('');
}

['searchInput', 'filterDept', 'filterCenter'].forEach((id) => {
  document.getElementById(id).addEventListener('input', render);
  document.getElementById(id).addEventListener('change', render);
});

(async () => {
  try {
    await bootShell();
    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
