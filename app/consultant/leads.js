import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const STATUS_LABEL = { potential: 'Tiềm năng', success: 'Thành công', rejected: 'Từ chối' };
let PROFILE = null;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const { data, error } = await supabase
    .from('crm_leads')
    .select('id, full_name, dob, parent_name, phone, status')
    .eq('consultant_id', PROFILE.id)
    .order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  renderStats();
  render();
}

function renderStats() {
  const counts = { potential: 0, success: 0, rejected: 0 };
  ALL_ROWS.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const total = ALL_ROWS.length;
  const rate = total ? Math.round((counts.success / total) * 100) : 0;

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng hồ sơ</div><div class="value mono">${total}</div></div>
    <div class="stat-card"><div class="label">Tiềm năng</div><div class="value mono">${counts.potential}</div></div>
    <div class="stat-card"><div class="label">Thành công</div><div class="value mono">${counts.success}</div></div>
    <div class="stat-card"><div class="label">Tỷ lệ chốt</div><div class="value mono">${rate}%</div></div>
  `;
}

function render() {
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) =>
    (!status || r.status === status) &&
    (!search || r.full_name.toLowerCase().includes(search) || (r.parent_name || '').toLowerCase().includes(search))
  );
  document.getElementById('resultCount').textContent = `${rows.length} hồ sơ`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có hồ sơ nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.full_name)}</td>
      <td class="cell-muted">${fmtDate(r.dob)}</td>
      <td class="cell-muted">${esc(r.parent_name || '—')}</td>
      <td class="cell-muted">${esc(r.phone || '—')}</td>
      <td><span class="badge badge-${r.status === 'success' ? 'active' : r.status === 'rejected' ? 'rejected' : 'submitted'}">${STATUS_LABEL[r.status]}</span></td>
      <td><button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
}

['filterStatus', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('change', render);
  document.getElementById(id).addEventListener('input', render);
});

// ---------------------------------------------------------------------
// Modal thêm/sửa
// ---------------------------------------------------------------------
const modal = document.getElementById('leadModal');
const form = document.getElementById('leadForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('leadId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm hồ sơ khách hàng';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

async function openEdit(id) {
  const { data: row } = await supabase.from('crm_leads').select('*').eq('id', id).single();
  if (!row) return;
  document.getElementById('modalTitle').textContent = `Sửa hồ sơ — ${row.full_name}`;
  document.getElementById('leadId').value = row.id;
  document.getElementById('fullName').value = row.full_name;
  document.getElementById('dob').value = row.dob || '';
  document.getElementById('currentSchool').value = row.current_school || '';
  document.getElementById('parentName').value = row.parent_name || '';
  document.getElementById('email').value = row.email || '';
  document.getElementById('phone').value = row.phone || '';
  document.getElementById('backupPhone').value = row.backup_phone || '';
  document.getElementById('status').value = row.status;
  document.getElementById('note').value = row.note || '';
  formError.classList.remove('show');
  modal.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('leadId').value;
  const payload = {
    full_name: document.getElementById('fullName').value.trim(),
    dob: document.getElementById('dob').value || null,
    current_school: document.getElementById('currentSchool').value || null,
    parent_name: document.getElementById('parentName').value || null,
    email: document.getElementById('email').value || null,
    phone: document.getElementById('phone').value || null,
    backup_phone: document.getElementById('backupPhone').value || null,
    status: document.getElementById('status').value,
    note: document.getElementById('note').value || null,
    consultant_id: PROFILE.id,
    center_id: PROFILE.centerId,
  };

  const btn = document.getElementById('submitLead');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('crm_leads').update(payload).eq('id', id)
      : await supabase.from('crm_leads').insert(payload);
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
    const { data: emp } = await supabase.from('employees').select('center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id };
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
