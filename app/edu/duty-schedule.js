import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];
let CAN_EDIT = false;

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadLookups() {
  const { data: centers } = await supabase.from('centers').select('id, name').order('name');
  const filterCenter = document.getElementById('filterCenter');

  if (CAN_EDIT) {
    // Quản lý trung tâm chỉ trực trung tâm mình -> khoá filter về đúng trung tâm đó
    filterCenter.innerHTML = (centers || [])
      .filter((c) => c.id === PROFILE.centerId)
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    filterCenter.disabled = true;

    const { data: employees } = await supabase
      .from('employees').select('id, employee_code, full_name').eq('center_id', PROFILE.centerId).order('full_name');
    document.getElementById('employeeSelect').innerHTML = '<option value="">— Chọn nhân viên —</option>' +
      (employees || []).map((e) => `<option value="${e.id}">${esc(e.employee_code)} — ${esc(e.full_name)}</option>`).join('');
  } else {
    filterCenter.innerHTML = '<option value="">Tất cả trung tâm</option>' +
      (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase
    .from('center_duty_schedules')
    .select('id, duty_date, shift, employee_id, center_id, employees!center_duty_schedules_employee_id_fkey(full_name, employee_code), centers(name)')
    .order('duty_date', { ascending: false });

  const center = document.getElementById('filterCenter').value;
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  if (center) query = query.eq('center_id', center);
  if (from) query = query.gte('duty_date', from);
  if (to) query = query.lte('duty_date', to);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !search || (r.employees?.full_name || '').toLowerCase().includes(search));
  document.getElementById('resultCount').textContent = `${rows.length} lịch trực`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có lịch trực nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-code">${fmtDate(r.duty_date)}</td>
      <td>${esc(r.shift || '—')}</td>
      <td>${esc(r.employees?.employee_code || '')} — ${esc(r.employees?.full_name || '')}</td>
      <td class="cell-muted">${esc(r.centers?.name || '—')}</td>
      <td>${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
}

['filterCenter', 'filterFrom', 'filterTo'].forEach((id) => document.getElementById(id).addEventListener('change', loadRows));
document.getElementById('searchInput').addEventListener('input', render);

const modal = document.getElementById('dutyModal');
const form = document.getElementById('dutyForm');
const formError = document.getElementById('formError');
const deleteBtn = document.getElementById('deleteDuty');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('dutyId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm lịch trực';
  deleteBtn.style.display = 'none';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row || !CAN_EDIT) return;
  document.getElementById('modalTitle').textContent = 'Sửa lịch trực';
  document.getElementById('dutyId').value = row.id;
  document.getElementById('employeeSelect').value = row.employee_id;
  document.getElementById('dutyDate').value = row.duty_date;
  document.getElementById('shift').value = row.shift || '';
  deleteBtn.style.display = 'inline-flex';
  formError.classList.remove('show');
  modal.classList.add('show');
}

deleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('dutyId').value;
  if (!id || !confirm('Xoá lịch trực này?')) return;
  const { error } = await supabase.from('center_duty_schedules').delete().eq('id', id);
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  modal.classList.remove('show');
  await loadRows();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('dutyId').value;
  const payload = {
    employee_id: document.getElementById('employeeSelect').value,
    center_id: PROFILE.centerId,
    duty_date: document.getElementById('dutyDate').value,
    shift: document.getElementById('shift').value || null,
    created_by: PROFILE.id,
  };
  const btn = document.getElementById('submitDuty');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('center_duty_schedules').update(payload).eq('id', id)
      : await supabase.from('center_duty_schedules').insert(payload);
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
    CAN_EDIT = profile.isCenterManager;
    document.getElementById('btnAdd').style.display = CAN_EDIT ? '' : 'none';
    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
