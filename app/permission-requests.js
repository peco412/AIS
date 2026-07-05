import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { NAV_CONFIG } from '/js/navConfig.js';
import { t } from '/js/i18n.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.permission_' + code, code) });
const STATUS_BADGE = { pending: 'submitted', approved: 'active', rejected: 'rejected' };

let PROFILE = null;
let IS_EXEC = false;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

// Danh sách "mục" có thể xin thêm quyền — lấy thẳng từ cấu hình menu để
// không phải khai báo trùng lặp, và tên hiển thị luôn khớp với menu thật.
function allModuleOptions() {
  const options = [];
  NAV_CONFIG.forEach((group) => {
    const deptLabel = group.sectionKey ? t(group.sectionKey, group.section || '') : null;
    group.items.forEach((item) => {
      const itemLabel = t(item.labelKey, item.label);
      // Nhiều mục trùng tên giữa các phòng ban (vd "Ký số hồ sơ", "Phân việc"
      // đều xuất hiện ở HR/ACC/MKT/FAC/EDU) — phải ghi rõ phòng ban đứng
      // trước để không chọn nhầm khi xin quyền.
      const label = deptLabel ? `${deptLabel} — ${itemLabel}` : itemLabel;
      options.push({ key: item.href, label });
    });
  });
  return options;
}

async function loadTeam() {
  let query = supabase.from('employees').select('id, full_name, employee_code').order('full_name');
  if (!IS_EXEC && PROFILE.departmentId) query = query.eq('department_id', PROFILE.departmentId);
  const { data } = await query;
  document.getElementById('targetEmployee').innerHTML = (data || [])
    .map((e) => `<option value="${e.id}">${esc(e.employee_code)} — ${esc(e.full_name)}</option>`).join('');
}

function loadModuleOptions() {
  document.getElementById('moduleKey').innerHTML = allModuleOptions()
    .map((m) => `<option value="${esc(m.key)}">${esc(m.label)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const status = document.getElementById('filterStatus').value;

  let query = supabase
    .from('permission_requests')
    .select('id, module_key, reason, status, created_at, target_employee_id, requested_by, target:employees!permission_requests_target_employee_id_fkey(full_name), requester:employees!permission_requests_requested_by_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (!IS_EXEC) query = query.or(`requested_by.eq.${PROFILE.id},target_employee_id.eq.${PROFILE.id}`);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function moduleLabelFor(key) {
  const found = allModuleOptions().find((m) => m.key === key);
  return found ? found.label : key;
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} yêu cầu`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có yêu cầu nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => `
    <tr>
      <td>${esc(r.target?.full_name || '—')}</td>
      <td class="cell-muted">${esc(moduleLabelFor(r.module_key))}</td>
      <td class="cell-muted">${esc(r.reason)}</td>
      <td class="cell-muted">${esc(r.requester?.full_name || '—')}</td>
      <td><span class="badge badge-${STATUS_BADGE[r.status]}">${esc(STATUS_LABEL[r.status])}</span></td>
      <td>
        ${IS_EXEC && r.status === 'pending' ? `
          <button class="btn btn-accent btn-sm" data-approve="${r.id}">Duyệt</button>
          <button class="btn btn-outline btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.approve, 'approved')));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.reject, 'rejected')));
}

async function decide(id, status) {
  const { error } = await supabase.from('permission_requests')
    .update({ status, decided_by: PROFILE.id, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadRows();
}

document.getElementById('filterStatus').addEventListener('change', loadRows);

const modal = document.getElementById('reqModal');
const form = document.getElementById('reqForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const btn = document.getElementById('submitReq');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const { error } = await supabase.from('permission_requests').insert({
      requested_by: PROFILE.id,
      target_employee_id: document.getElementById('targetEmployee').value,
      module_key: document.getElementById('moduleKey').value,
      reason: document.getElementById('reason').value.trim(),
    });
    if (error) throw error;
    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi yêu cầu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentId: emp?.department_id };
    IS_EXEC = ['EXECUTIVE', 'TECH'].includes(profile.roleCode);

    const canUse = IS_EXEC || ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ trưởng/phó phòng và Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    document.getElementById('btnAdd').style.display = canUse ? '' : 'none';

    loadModuleOptions();
    await loadTeam();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
