import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.student_' + code, code) });
let PROFILE = null;
let CLASSES = [], LEVELS = [];
let ALL_ROWS = [];

function fillSelect(el, items, { valueKey = 'id', labelKey = 'name', placeholder } = {}) {
  el.innerHTML = '';
  if (placeholder) el.innerHTML += `<option value="">${placeholder}</option>`;
  items.forEach((i) => { el.innerHTML += `<option value="${i[valueKey]}">${i[labelKey]}</option>`; });
}

async function loadLookups() {
  const [{ data: classes }, { data: levels }] = await Promise.all([
    supabase.from('classes').select('id, name').eq('center_id', PROFILE.centerId).order('name'),
    supabase.from('program_levels').select('id, name').order('display_order'),
  ]);
  CLASSES = classes || []; LEVELS = levels || [];
  fillSelect(document.getElementById('filterClass'), CLASSES, { placeholder: 'Tất cả các lớp' });
  fillSelect(document.getElementById('classSelect'), CLASSES, { placeholder: '— Chưa phân lớp —' });
  fillSelect(document.getElementById('entryLevel'), LEVELS, { placeholder: '—' });
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const { data, error } = await supabase
    .from('students')
    .select('id, full_name, dob, parent_name, phone, status, class_id, classes(name)')
    .eq('center_id', PROFILE.centerId)
    .order('full_name');
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

function render() {
  const cls = document.getElementById('filterClass').value;
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  const rows = ALL_ROWS.filter((r) =>
    (!cls || r.class_id === cls) &&
    (!status || r.status === status) &&
    (!search || r.full_name.toLowerCase().includes(search) || (r.parent_name || '').toLowerCase().includes(search))
  );
  document.getElementById('resultCount').textContent = `${rows.length} học viên`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Không có học viên nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><span class="avatar-sm">${esc((r.full_name || '?').trim().split(/\s+/).slice(-2).map(w=>w[0]).join('').toUpperCase())}</span>${esc(r.full_name)}</td>
      <td class="cell-muted">${fmtDate(r.dob)}</td>
      <td>${r.classes?.name ? esc(r.classes.name) : '<span class="cell-muted">Chưa phân lớp</span>'}</td>
      <td class="cell-muted">${esc(r.parent_name || '—')}</td>
      <td class="cell-muted">${esc(r.phone || '—')}</td>
      <td><span class="badge badge-${r.status === 'studying' ? 'active' : r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td><button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
}

['filterClass', 'filterStatus', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('change', render);
  document.getElementById(id).addEventListener('input', render);
});

// ---------------------------------------------------------------------
// Modal thêm/sửa
// ---------------------------------------------------------------------
const modal = document.getElementById('studentModal');
const form = document.getElementById('studentForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('studentId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm học viên';
  document.getElementById('enrollmentDate').value = new Date().toISOString().slice(0, 10);
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

async function openEdit(id) {
  const { data: row } = await supabase.from('students').select('*').eq('id', id).single();
  if (!row) return;
  document.getElementById('modalTitle').textContent = `Sửa học viên — ${row.full_name}`;
  document.getElementById('studentId').value = row.id;
  document.getElementById('fullName').value = row.full_name;
  document.getElementById('dob').value = row.dob || '';
  document.getElementById('currentSchool').value = row.current_school || '';
  document.getElementById('entryLevel').value = row.entry_level_id || '';
  document.getElementById('classSelect').value = row.class_id || '';
  document.getElementById('parentName').value = row.parent_name || '';
  document.getElementById('email').value = row.email || '';
  document.getElementById('phone').value = row.phone || '';
  document.getElementById('backupPhone').value = row.backup_phone || '';
  document.getElementById('enrollmentDate').value = row.enrollment_date || '';
  document.getElementById('status').value = row.status;
  formError.classList.remove('show');
  modal.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('studentId').value;
  const payload = {
    full_name: document.getElementById('fullName').value.trim(),
    dob: document.getElementById('dob').value || null,
    current_school: document.getElementById('currentSchool').value || null,
    entry_level_id: document.getElementById('entryLevel').value || null,
    class_id: document.getElementById('classSelect').value || null,
    parent_name: document.getElementById('parentName').value || null,
    email: document.getElementById('email').value || null,
    phone: document.getElementById('phone').value || null,
    backup_phone: document.getElementById('backupPhone').value || null,
    enrollment_date: document.getElementById('enrollmentDate').value || null,
    status: document.getElementById('status').value,
    center_id: PROFILE.centerId,
  };

  const btn = document.getElementById('submitStudent');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('students').update(payload).eq('id', id)
      : await supabase.from('students').insert(payload);
    if (error) throw error;
    modal.classList.remove('show');
    await loadLookups(); // sĩ số lớp có thể đã đổi (trigger tự cập nhật)
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
    const { data: emp } = await supabase.from('employees').select('center_id, centers(name)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id };

    if (!PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(profile.roleCode)) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không thuộc trung tâm nào để quản lý học viên.</div>';
      return;
    }
    document.getElementById('centerHint').textContent = `Trung tâm: ${emp?.centers?.name || '—'}`;

    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
