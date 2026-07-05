import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, openFile, triggerPush } from '/js/supabase.js';
import { t } from '/js/i18n.js';

const TYPE_LABEL = { design: 'Thiết kế', print: 'In ấn', ads: 'Quảng cáo', event: 'Tổ chức sự kiện', photo_video: 'Quay phim/chụp ảnh' };
const PRIORITY_LABEL = { low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp' };
const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.request_' + code, code) });
const STATUS_BADGE = { pending: 'submitted', in_progress: 'approved_1', done: 'active', rejected: 'rejected' };

let PROFILE = null;
let IS_MKT = false;
let ALL_ROWS = [];
let ACTIVE_ID = null;

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;

  let query = supabase
    .from('communication_requests')
    .select('id, title, request_type, priority, deadline, status, brief_file_url, result_file_urls, requester_id, employees!communication_requests_requester_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (scope === 'mine') query = query.eq('requester_id', PROFILE.id);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const status = document.getElementById('filterStatus').value;
  const rows = ALL_ROWS.filter((r) => !status || r.status === status);
  document.getElementById('resultCount').textContent = `${rows.length} yêu cầu`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có yêu cầu nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.employees?.full_name || '—')}</td>
      <td class="cell-muted">${esc(TYPE_LABEL[r.request_type] || r.request_type)}</td>
      <td>
        ${esc(r.title)}
        ${r.brief_file_url ? `<button class="btn-link cell-muted" data-open="${esc(r.brief_file_url)}" style="border:none;background:none;text-decoration:underline;cursor:pointer;">(brief)</button>` : ''}
        ${r.result_file_urls?.[0] ? `<button class="btn-link cell-muted" data-open="${esc(r.result_file_urls[0])}" style="border:none;background:none;text-decoration:underline;cursor:pointer;">(kết quả)</button>` : ''}
      </td>
      <td class="cell-muted">${esc(PRIORITY_LABEL[r.priority] || r.priority)}</td>
      <td class="cell-muted">${fmtDate(r.deadline)}</td>
      <td><span class="badge badge-${STATUS_BADGE[r.status]}">${esc(STATUS_LABEL[r.status])}</span></td>
      <td>${IS_MKT && r.status !== 'done' && r.status !== 'rejected' ? `<button class="btn btn-accent btn-sm" data-process="${r.id}">Xử lý</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
  tbody.querySelectorAll('[data-process]').forEach((b) => b.addEventListener('click', () => openResultModal(b.dataset.process)));
}

document.getElementById('viewScope').addEventListener('change', loadRows);
document.getElementById('filterStatus').addEventListener('change', render);

// ---------------------------------------------------------------------
// Tạo yêu cầu mới
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');
const createError = document.getElementById('createError');
document.getElementById('btnAdd').addEventListener('click', () => {
  createError.classList.remove('show');
  document.getElementById('title').value = '';
  document.getElementById('deadline').value = '';
  document.getElementById('briefFile').value = '';
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

document.getElementById('submitCreate').addEventListener('click', async () => {
  createError.classList.remove('show');
  const title = document.getElementById('title').value.trim();
  if (!title) { createError.textContent = 'Vui lòng nhập tiêu đề.'; createError.classList.add('show'); return; }

  const btn = document.getElementById('submitCreate');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    let briefUrl = null;
    const file = document.getElementById('briefFile').files[0];
    if (file) {
      const path = `mkt-requests/${PROFILE.id}/${Date.now()}_${file.name}`;
      briefUrl = await uploadPrivateFile(path, file);
    }

    const { error } = await supabase.from('communication_requests').insert({
      requester_id: PROFILE.id, department_id: PROFILE.departmentId, center_id: PROFILE.centerId,
      request_type: document.getElementById('requestType').value,
      title, priority: document.getElementById('priority').value,
      deadline: document.getElementById('deadline').value || null,
      brief_file_url: briefUrl, status: 'pending',
    });
    if (error) throw error;
    createModal.classList.remove('show');
    await loadRows();
  } catch (err) {
    createError.textContent = err.message || 'Có lỗi xảy ra.';
    createError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi yêu cầu';
  }
});

// ---------------------------------------------------------------------
// Xử lý yêu cầu (phòng truyền thông)
// ---------------------------------------------------------------------
const resultModal = document.getElementById('resultModal');
const resultError = document.getElementById('resultError');

function openResultModal(id) {
  ACTIVE_ID = id;
  resultError.classList.remove('show');
  document.getElementById('resultNote').value = '';
  document.getElementById('resultFile').value = '';
  resultModal.classList.add('show');
}
document.getElementById('closeResultModal').addEventListener('click', () => resultModal.classList.remove('show'));
document.getElementById('cancelResult').addEventListener('click', () => resultModal.classList.remove('show'));

document.getElementById('submitResult').addEventListener('click', async () => {
  resultError.classList.remove('show');
  const row = ALL_ROWS.find((r) => r.id === ACTIVE_ID);
  const status = document.getElementById('resultStatus').value;
  const note = document.getElementById('resultNote').value.trim();

  const btn = document.getElementById('submitResult');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    let resultUrls = null;
    const file = document.getElementById('resultFile').files[0];
    if (file) {
      const path = `mkt-requests/${row.requester_id}/result_${Date.now()}_${file.name}`;
      resultUrls = [await uploadPrivateFile(path, file)];
    }

    const { error } = await supabase.from('communication_requests').update({
      status, result_note: note || null, result_file_urls: resultUrls, handled_by: PROFILE.id,
    }).eq('id', ACTIVE_ID);
    if (error) throw error;

    await supabase.from('notifications').insert({
      scope: 'personal', target_employee_id: row.requester_id,
      title: `Yêu cầu truyền thông "${row.title}" đã được cập nhật`,
      content: note || `Trạng thái mới: ${STATUS_LABEL[status]}`,
      created_by: PROFILE.id,
    });
    triggerPush({ scope: 'personal', target_employee_id: row.requester_id, title: `Yêu cầu truyền thông "${row.title}" đã được cập nhật`, content: note || `Trạng thái mới: ${STATUS_LABEL[status]}` });

    resultModal.classList.remove('show');
    await loadRows();
  } catch (err) {
    resultError.textContent = err.message || 'Có lỗi xảy ra.';
    resultError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu & thông báo';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentId: emp?.department_id, centerId: emp?.center_id };
    IS_MKT = profile.departmentCode === 'MKT' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (IS_MKT) document.getElementById('deptScopeOption').style.display = 'block';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
