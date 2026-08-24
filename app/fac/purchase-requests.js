import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl, uploadPrivateFile, triggerPush } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';
import { showConfirm, showPromptDialog } from '/js/confirmDialog.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.purchase_' + code, code) });

let PROFILE = null;
let TEMPLATE = null;
let FAC_DEPT_ID = null;
let ALL_ROWS = [];
let IS_FAC_HEAD = false;
let IS_EXEC = false;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }
function fmtMoney(n) { return n ? Number(n).toLocaleString('vi-VN') + ' đ' : '—'; }

async function loadTemplate() {
  const { data } = await supabase.from('document_templates').select('*').eq('code', '05.Phieudenghimuasam').single();
  TEMPLATE = data;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;

  let query = supabase
    .from('purchase_requests')
    .select('id, code, status, request_type, filled_data, draft_file_url, final_file_url, updated_at, requester_id, center_id, centers(name), employees!purchase_requests_requester_id_fkey(full_name, employee_code)')
    .order('updated_at', { ascending: false });
  if (scope === 'mine') query = query.eq('requester_id', PROFILE.id);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

// LÀM LẠI 24/08/2026 — duyệt dựa trên dữ liệu (filled_data), tách khỏi
// việc ký PDF; thêm khả năng từ chối (trước đây không có).
function actionFor(row) {
  if (row.status === 'draft' && (IS_FAC_HEAD || IS_EXEC)) return { label: 'Trưởng phòng CSVC duyệt', step: 'fac_head', next: 'approved_1' };
  if (row.status === 'approved_1' && IS_EXEC) return { label: 'Ban điều hành duyệt', step: 'executive', next: 'approved_2' };
  return null;
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} phiếu`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có phiếu nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => {
    const action = actionFor(r);
    return `
    <tr>
      <td class="cell-code">${esc(r.code)}</td>
      <td>${r.request_type === 'repair' ? '<span class="badge badge-submitted">Sửa chữa</span>' : '<span class="badge badge-active">Mua sắm</span>'}</td>
      <td>${esc(r.employees?.full_name || '—')}</td>
      <td class="cell-muted">${esc(r.centers?.name || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td class="cell-muted">${fmtDate(r.updated_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-detail="${r.id}">Chi tiết</button>
        ${(r.final_file_url || r.draft_file_url) ? `<button class="btn btn-outline btn-sm" data-view="${r.id}">Xem PDF</button>` : ''}
        ${action ? `<button class="btn btn-accent btn-sm" data-approve="${r.id}">${esc(action.label)}</button>` : ''}
        ${action ? `<button class="btn btn-danger btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
        ${action ? `<button class="btn btn-outline btn-sm" data-sign="${r.id}" title="Mở mẫu đơn để ký — TÁCH RIÊNG khỏi việc duyệt dữ liệu">✍️ Ký vào mẫu đơn</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => viewDetail(b.dataset.detail)));
  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => approveRow(b.dataset.approve)));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectRow(b.dataset.reject)));
  tbody.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => signDocument(b.dataset.sign)));
}

// MỚI — xem dữ liệu phiếu để duyệt, không cần mở PDF.
function viewDetail(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const d = row.filled_data || {};
  document.getElementById('detailViewTitle').textContent = `Phiếu ${row.code} — ${row.employees?.full_name || ''}`;
  document.getElementById('detailViewBody').innerHTML = `
    <div class="field-grid-2" style="margin-bottom:10px;">
      <div><div class="cell-muted" style="font-size:11.5px;">Loại phiếu</div><div>${row.request_type === 'repair' ? 'Sửa chữa' : 'Mua sắm'}</div></div>
      <div><div class="cell-muted" style="font-size:11.5px;">Số tiền dự kiến</div><div class="mono">${fmtMoney(d.estimatedAmount)}</div></div>
    </div>
    <div><div class="cell-muted" style="font-size:11.5px;">Mô tả nội dung</div><div>${esc(d.description || '—')}</div></div>
  `;
  document.getElementById('detailViewModal').classList.add('show');
}
document.getElementById('closeDetailViewModal').addEventListener('click', () => document.getElementById('detailViewModal').classList.remove('show'));

async function viewRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const stored = row.final_file_url || row.draft_file_url;
  if (!stored) { alert('Chưa có file để xem.'); return; }
  try {
    const url = await resolveFileUrl(stored, 1800);
    openPdfEditor({ pdfUrl: url, readOnly: true, title: `Xem phiếu ${row.code}` });
  } catch (e) {
    alert('Không thể mở file: ' + (e.message || 'Có lỗi xảy ra.'));
  }
}

async function uploadFile(fileOrBlob, requesterId, suffix) {
  const path = `purchase-requests/${requesterId}/${Date.now()}_${suffix}.pdf`;
  await uploadPrivateFile(path, fileOrBlob, { contentType: 'application/pdf' });
  return path;
}

// LÀM LẠI 24/08/2026 — "duyệt dữ liệu" tách khỏi "ký vào mẫu đơn". Có
// .select() để phát hiện RLS âm thầm chặn.
async function approveRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  if (!(await showConfirm(`${action.label} cho phiếu "${row.code}" của ${row.employees?.full_name || ''}?`, { confirmLabel: 'Duyệt' }))) return;

  const nowIso = new Date().toISOString();
  const updatePayload = { status: action.next };
  if (action.step === 'fac_head') { updatePayload.fac_head_signed_at = nowIso; updatePayload.fac_head_signed_by = PROFILE.id; }
  if (action.step === 'executive') { updatePayload.executive_signed_at = nowIso; updatePayload.executive_signed_by = PROFILE.id; }

  const { data, error } = await supabase.from('purchase_requests').update(updatePayload).eq('id', row.id).select('id');
  if (error) { alert('Lỗi: ' + error.message); return; }
  if (!data || data.length === 0) {
    alert('Không thể duyệt phiếu này — có thể bạn không đúng quyền ở cấp hiện tại, hoặc phiếu đã được xử lý trước đó. Tải lại trang và kiểm tra lại.');
    await loadRows();
    return;
  }

  if (action.step === 'executive') {
    if (row.draft_file_url) {
      const now = new Date();
      await supabase.from('purchase_requests').update({ final_file_url: row.draft_file_url }).eq('id', row.id);
      await supabase.from('archive_files').insert({
        department_id: FAC_DEPT_ID, category: 'purchase_request', year: now.getFullYear(), month: now.getMonth() + 1,
        file_name: `${row.code}.pdf`, file_url: row.draft_file_url, related_table: 'purchase_requests', related_id: row.id, uploaded_by: PROFILE.id,
      });
    } else {
      alert('Đã duyệt xong dữ liệu. Lưu ý: phiếu CHƯA có file PDF nào được ký — dùng nút "✍️ Ký vào mẫu đơn" để hoàn tất và lưu vào Kho lưu trữ.');
    }
  } else {
    const { data: execs } = await supabase.from('employees').select('id, system_roles(code)');
    const targetIds = (execs || []).filter((e) => e.system_roles?.code === 'EXECUTIVE').map((e) => e.id);
    for (const employeeId of targetIds) {
      const notif = { scope: 'personal', target_employee_id: employeeId, title: `Phiếu "${row.code}" cần duyệt`, content: `Phiếu của ${row.employees?.full_name || ''} đã qua Trưởng phòng CSVC, đang chờ bạn duyệt.`, link_url: '/fac/purchase-requests.html', created_by: PROFILE.id };
      await supabase.from('notifications').insert(notif);
      triggerPush(notif);
    }
  }

  await loadRows();
}

// MỚI — trước đây KHÔNG có cách từ chối phiếu.
async function rejectRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  const reason = await showPromptDialog(`Lý do từ chối phiếu "${row.code}" của ${row.employees?.full_name || ''}:`, { title: 'Từ chối phiếu', required: true });
  if (reason === null) return;

  const { data, error } = await supabase.from('purchase_requests').update({
    status: 'rejected', reject_reason: reason, rejected_by: PROFILE.id, rejected_at: new Date().toISOString(),
  }).eq('id', row.id).select('id');
  if (error) { alert('Lỗi: ' + error.message); return; }
  if (!data || data.length === 0) {
    alert('Không thể từ chối — có thể bạn không đúng quyền ở cấp hiện tại, hoặc phiếu đã được xử lý trước đó.');
    await loadRows();
    return;
  }

  const notifPayload = {
    scope: 'personal', target_employee_id: row.requester_id,
    title: `Phiếu "${row.code}" đã bị từ chối`,
    content: `Lý do: ${reason}`,
  };
  await supabase.from('notifications').insert({ ...notifPayload, created_by: PROFILE.id });
  triggerPush(notifPayload);
  await loadRows();
}

// MỚI — "Ký vào mẫu đơn" TÁCH RIÊNG khỏi việc duyệt.
async function signDocument(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!PROFILE.signatureUrl) { alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.'); return; }

  const sourceStored = row.draft_file_url || TEMPLATE?.file_url;
  if (!sourceStored) { alert('Chưa có biểu mẫu để ký — chưa có file đính kèm và cũng chưa có biểu mẫu gốc.'); return; }

  let pdfUrl, signatureUrl;
  try {
    pdfUrl = await resolveFileUrl(sourceStored, 1800);
    signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
  } catch (e) {
    alert('Không thể mở file để ký: ' + (e.message || 'Có lỗi xảy ra.'));
    return;
  }

  await openPdfEditor({
    pdfUrl,
    signatureUrl,
    title: `Ký vào mẫu đơn — phiếu ${row.code}`,
    fieldMap: !row.draft_file_url ? (TEMPLATE?.field_map || []) : undefined,
    onSave: async (blob) => {
      const newUrl = await uploadFile(blob, row.requester_id, 'signed');
      const updatePayload = { draft_file_url: newUrl };
      if (row.status === 'approved_2') updatePayload.final_file_url = newUrl;
      await supabase.from('purchase_requests').update(updatePayload).eq('id', row.id);
      if (row.status === 'approved_2') {
        const now = new Date();
        await supabase.from('archive_files').insert({
          department_id: FAC_DEPT_ID, category: 'purchase_request', year: now.getFullYear(), month: now.getMonth() + 1,
          file_name: `${row.code}.pdf`, file_url: newUrl, related_table: 'purchase_requests', related_id: row.id, uploaded_by: PROFILE.id,
        });
      }
      await loadRows();
    },
  });
}

// ---------------------------------------------------------------------
// Tạo mới
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');
const createError = document.getElementById('createError');
document.getElementById('btnAdd').addEventListener('click', () => {
  createError.classList.remove('show');
  document.getElementById('reqDescription').value = '';
  document.getElementById('reqEstimatedAmount').value = '';
  document.getElementById('signedFileInput').value = '';
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

// LÀM LẠI 24/08/2026 — "Gửi phiếu" giờ gửi thẳng dữ liệu — không còn bắt
// buộc điền lên PDF ngay lúc tạo.
document.getElementById('submitCreate').addEventListener('click', async () => {
  createError.classList.remove('show');
  const reqType = document.querySelector('input[name="reqType"]:checked').value;
  const description = document.getElementById('reqDescription').value.trim();
  const estimatedAmount = Number(document.getElementById('reqEstimatedAmount').value) || null;
  const signedFile = document.getElementById('signedFileInput').files[0];
  if (!description) { createError.textContent = 'Vui lòng nhập mô tả nội dung.'; createError.classList.add('show'); return; }

  const submitBtn = document.getElementById('submitCreate');
  submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...';

  try {
    let signedUrl = null;
    if (signedFile) signedUrl = await uploadFile(signedFile, PROFILE.id, 'requester');

    const { data: inserted, error } = await supabase.from('purchase_requests').insert({
      requester_id: PROFILE.id, center_id: PROFILE.centerId, template_id: TEMPLATE?.id || null,
      request_type: reqType, filled_data: { description, estimatedAmount },
      draft_file_url: signedUrl, requester_signed_at: signedUrl ? new Date().toISOString() : null,
      status: 'draft',
    }).select('id, code').single();
    if (error) throw error;

    createModal.classList.remove('show');
    const { data: heads } = await supabase.from('employees').select('id, system_roles(code)').eq('department_id', FAC_DEPT_ID);
    const targetIds = (heads || []).filter((e) => e.system_roles?.code === 'DEPT_HEAD').map((e) => e.id);
    for (const employeeId of targetIds) {
      const notif = { scope: 'personal', target_employee_id: employeeId, title: `Có phiếu đề nghị ${reqType === 'repair' ? 'sửa chữa' : 'mua sắm'} mới cần duyệt`, content: `${PROFILE.fullName} vừa gửi phiếu ${inserted.code} — vào duyệt ngay.`, link_url: '/fac/purchase-requests.html', created_by: PROFILE.id };
      await supabase.from('notifications').insert(notif);
      triggerPush(notif);
    }

    await loadRows();
  } catch (err) {
    createError.textContent = 'Lỗi: ' + (err.message || 'Có lỗi xảy ra.');
    createError.classList.add('show');
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Gửi phiếu';
  }
});

document.getElementById('viewScope').addEventListener('change', loadRows);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: facDept } = await supabase.from('departments').select('id').eq('code', 'FAC').single();
    FAC_DEPT_ID = facDept?.id;

    const { data: emp } = await supabase.from('employees').select('signature_url, center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, signatureUrl: emp?.signature_url || null, centerId: emp?.center_id };

    IS_FAC_HEAD = profile.departmentCode === 'FAC' && profile.roleCode === 'DEPT_HEAD'; // đặc tả chỉ ghi Trưởng phòng, không có Phó phòng
    IS_EXEC = profile.roleCode === 'EXECUTIVE';
    if (IS_FAC_HEAD || IS_EXEC) document.getElementById('deptScopeOption').style.display = 'block';

    await loadTemplate();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
