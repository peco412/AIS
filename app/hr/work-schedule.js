import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];
let CAN_EDIT = false;

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadLookups() {
  const [{ data: centers }, { data: employees }] = await Promise.all([
    supabase.from('centers').select('id, name').order('name'),
    // Nhân sự hành chính = trừ phòng học vụ (EDU), đúng phạm vi đề bài
    supabase.from('employees').select('id, employee_code, full_name, departments(code)').order('employee_code'),
  ]);
  const nonEdu = (employees || []).filter((e) => e.departments?.code !== 'EDU');

  const centerOpts = '<option value="">— Chọn trung tâm —</option>' +
    (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  document.getElementById('centerSelect').innerHTML = centerOpts;
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  document.getElementById('employeeSelect').innerHTML = '<option value="">— Chọn nhân viên —</option>' +
    nonEdu.map((e) => `<option value="${e.id}">${esc(e.employee_code)} — ${esc(e.full_name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase
    .from('work_schedules')
    .select('id, work_date, shift, employee_id, center_id, employees!work_schedules_employee_id_fkey(full_name, employee_code), centers(name), created_by')
    .order('work_date', { ascending: false });

  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  const center = document.getElementById('filterCenter').value;
  if (from) query = query.gte('work_date', from);
  if (to) query = query.lte('work_date', to);
  if (center) query = query.eq('center_id', center);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !search || (r.employees?.full_name || '').toLowerCase().includes(search));
  document.getElementById('resultCount').textContent = `${rows.length} lịch`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có lịch làm việc nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-code">${fmtDate(r.work_date)}</td>
      <td>${esc(r.shift || '—')}</td>
      <td>${esc(r.employees?.employee_code || '')} — ${esc(r.employees?.full_name || '')}</td>
      <td class="cell-muted">${esc(r.centers?.name || '—')}</td>
      <td class="cell-muted">${r.created_by === PROFILE.id ? 'Bạn' : ''}</td>
      <td>${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
}

['filterCenter', 'filterFrom', 'filterTo'].forEach((id) => document.getElementById(id).addEventListener('change', loadRows));
document.getElementById('searchInput').addEventListener('input', render);

const modal = document.getElementById('schedModal');
const form = document.getElementById('schedForm');
const formError = document.getElementById('formError');
const deleteBtn = document.getElementById('deleteSched');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('schedId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm lịch làm việc';
  deleteBtn.style.display = 'none';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa lịch làm việc';
  document.getElementById('schedId').value = row.id;
  document.getElementById('employeeSelect').value = row.employee_id;
  document.getElementById('centerSelect').value = row.center_id;
  document.getElementById('workDate').value = row.work_date;
  document.getElementById('shift').value = row.shift || '';
  deleteBtn.style.display = 'inline-flex';
  formError.classList.remove('show');
  modal.classList.add('show');
}

deleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('schedId').value;
  if (!id || !confirm('Xoá lịch làm việc này?')) return;
  const { error } = await supabase.from('work_schedules').delete().eq('id', id);
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  modal.classList.remove('show');
  await loadRows();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('schedId').value;
  const payload = {
    employee_id: document.getElementById('employeeSelect').value,
    center_id: document.getElementById('centerSelect').value,
    work_date: document.getElementById('workDate').value,
    shift: document.getElementById('shift').value || null,
    created_by: PROFILE.id,
  };
  const btn = document.getElementById('submitSched');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('work_schedules').update(payload).eq('id', id)
      : await supabase.from('work_schedules').insert(payload);
    if (error) throw error;
    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_EDIT = profile.departmentCode === 'HR' || profile.roleCode === 'EXECUTIVE' || profile.roleCode === 'TECH';
    document.getElementById('btnAdd').style.display = CAN_EDIT ? '' : 'none';
    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
