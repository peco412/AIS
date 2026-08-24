import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl, uploadPrivateFile, triggerPush } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { showConfirm, showPromptDialog } from '/js/confirmDialog.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.advance_' + code, code) });

let PROFILE = null;
let TEMPLATE = null;
let ACC_DEPT_ID = null;
let ALL_ROWS = [];
let IS_ACC_HEAD = false;
let IS_EXEC = false;
let DIRECT_MANAGER_MAP = {};

function fmtMoney(n) { return n ? Number(n).toLocaleString('vi-VN') + ' đ' : '—'; }
function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

async function loadTemplate() {
  const { data } = await supabase.from('document_templates').select('*').eq('code', '03.Phieudenghitamung').single();
  TEMPLATE = data;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;
  let query = supabase
    .from('advance_requests')
    .select('id, code, amount, reason, status, draft_file_url, final_file_url, updated_at, requester_id, employees!advance_requests_requester_id_fkey(full_name, employee_code, department_id, center_id)')
    .order('updated_at', { ascending: false })
    .limit(300);
  if (scope === 'mine') query = query.eq('requester_id', PROFILE.id);
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];

  const approvedIds = ALL_ROWS.filter((r) => r.status === 'approved_3').map((r) => r.id);
  if (approvedIds.length > 0) {
    const { data: settlements } = await supabase.from('advance_settlements').select('advance_request_id').in('advance_request_id', approvedIds);
    const settledSet = new Set((settlements || []).map((s) => s.advance_request_id));
    ALL_ROWS.forEach((r) => { r.hasSettlement = settledSet.has(r.id); });
  }

  DIRECT_MANAGER_MAP = {};
  (data || []).forEach((r) => {
    const emp = r.employees;
    if (!emp) return;
    DIRECT_MANAGER_MAP[r.requester_id] = emp.department_id
      ? (emp.department_id === PROFILE.departmentId && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode))
      : (emp.center_id === PROFILE.centerId && PROFILE.roleCode === 'CENTER_MANAGER');
  });

  render();
}

// LÀM LẠI 24/08/2026 — duyệt dựa trên dữ liệu, tách khỏi việc ký PDF;
// thêm khả năng từ chối (trước đây không có).
function actionFor(row) {
  if (row.status === 'draft' && DIRECT_MANAGER_MAP[row.requester_id]) return { label: 'Quản lý trực tiếp duyệt', step: 'manager', next: 'approved_1' };
  if (row.status === 'approved_1' && (IS_ACC_HEAD || IS_EXEC)) return { label: 'Kế toán duyệt', step: 'accountant', next: 'approved_2' };
  if (row.status === 'approved_2' && IS_EXEC) return { label: 'Ban điều hành duyệt', step: 'executive', next: 'approved_3' };
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
      <td>${esc(r.employees?.full_name || '—')}</td>
      <td class="mono">${fmtMoney(r.amount)}</td>
      <td class="cell-muted">${esc(r.reason || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td class="cell-muted">${fmtDate(r.updated_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-detail="${r.id}">Chi tiết</button>
        ${(r.final_file_url || r.draft_file_url) ? `<button class="btn btn-outline btn-sm" data-view="${r.id}">Xem PDF</button>` : ''}
        ${action ? `<button class="btn btn-accent btn-sm" data-approve="${r.id}">${action.label}</button>` : ''}
        ${action ? `<button class="btn btn-danger btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
        ${action ? `<button class="btn btn-outline btn-sm" data-sign="${r.id}" title="Mở mẫu đơn để ký — TÁCH RIÊNG khỏi việc duyệt dữ liệu">✍️ Ký vào mẫu đơn</button>` : ''}
        ${r.status === 'approved_3' && !r.hasSettlement && (IS_ACC_HEAD || IS_EXEC) ? `<button class="btn btn-outline btn-sm" data-settle="${r.id}">Hoàn ứng</button>` : ''}
        ${r.hasSettlement ? `<span class="badge badge-active" style="font-size:10px;">Đã hoàn ứng</span>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => viewDetail(b.dataset.detail)));
  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => approveRow(b.dataset.approve)));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectRow(b.dataset.reject)));
  tbody.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => signDocument(b.dataset.sign)));
  tbody.querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', () => settleRow(b.dataset.settle)));
}

// MỚI — xem dữ liệu phiếu để duyệt, không cần mở PDF.
function viewDetail(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  document.getElementById('detailViewTitle').textContent = `Phiếu ${row.code} — ${row.employees?.full_name || ''}`;
  document.getElementById('detailViewBody').innerHTML = `
    <div class="field-grid-2" style="margin-bottom:10px;">
      <div><div class="cell-muted" style="font-size:11.5px;">Số tiền tạm ứng</div><div class="mono">${fmtMoney(row.amount)}</div></div>
      <div><div class="cell-muted" style="font-size:11.5px;">Cập nhật</div><div>${fmtDate(row.updated_at)}</div></div>
    </div>
    <div><div class="cell-muted" style="font-size:11.5px;">Lý do</div><div>${esc(row.reason || '—')}</div></div>
  `;
  document.getElementById('detailViewModal').classList.add('show');
}
document.getElementById('closeDetailViewModal').addEventListener('click', () => document.getElementById('detailViewModal').classList.remove('show'));

async function settleRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const actualSpentStr = await showPromptDialog(`Khoản tạm ứng "${row.code}" — ${fmtMoney(row.amount)} đ.\nSố tiền THỰC SỰ đã chi (có chứng từ):`, { defaultValue: String(row.amount), required: true, title: 'Hoàn ứng' });
  if (actualSpentStr === null) return;
  const actualSpent = Number(actualSpentStr);
  if (isNaN(actualSpent) || actualSpent < 0) { alert('Số tiền không hợp lệ.'); return; }
  const notes = await showPromptDialog('Diễn giải các khoản đã chi (VD: "Mua văn phòng phẩm 2tr, taxi công tác 500k..."):', { multiline: true, title: 'Hoàn ứng' });

  const diff = row.amount - actualSpent;
  const diffMsg = diff > 0 ? `Nhân viên cần TRẢ LẠI ${fmtMoney(diff)} đ.` : diff < 0 ? `Công ty cần BÙ THÊM ${fmtMoney(Math.abs(diff))} đ.` : 'Khớp đúng 100% số tạm ứng.';
  if (!(await showConfirm(`Xác nhận hoàn ứng?\nTạm ứng: ${fmtMoney(row.amount)} đ\nThực chi: ${fmtMoney(actualSpent)} đ\n${diffMsg}\nThao tác này sẽ ghi sổ kế toán ngay.`, { confirmLabel: 'Hoàn ứng' }))) return;

  const { error } = await supabase.rpc('settle_advance', { p_request_id: id, p_actual_spent: actualSpent, p_receipt_notes: notes, p_actor_id: PROFILE.id });
  if (error) { alert('Lỗi: ' + error.message); return; }
  alert('Đã hoàn ứng thành công.');
  await loadRows();
}

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
  const path = `advance-requests/${requesterId}/${Date.now()}_${suffix}.pdf`;
  await uploadPrivateFile(path, fileOrBlob, { contentType: 'application/pdf' });
  return path;
}

// LÀM LẠI 24/08/2026 — "duyệt dữ liệu" tách khỏi "ký vào mẫu đơn". Có
// .select() để phát hiện RLS âm thầm chặn. Bước cuối (BĐH) giữ NGUYÊN
// cách gọi approve_advance_final() RPC — hàm này vừa đổi trạng thái VỪA
// ghi sổ kế toán trong CÙNG 1 giao dịch, không tách rời như trước.
async function approveRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  if (!(await showConfirm(`${action.label} cho phiếu "${row.code}" (${fmtMoney(row.amount)}) của ${row.employees?.full_name || ''}?`, { confirmLabel: 'Duyệt' }))) return;

  if (action.step === 'executive') {
    const { error: glError } = await supabase.rpc('approve_advance_final', { p_request_id: row.id, p_approver_id: PROFILE.id });
    if (glError) { alert('Lỗi: ' + glError.message); return; }
    if (row.draft_file_url) {
      const now = new Date();
      await supabase.from('advance_requests').update({ final_file_url: row.draft_file_url }).eq('id', row.id);
      await supabase.from('archive_files').insert({
        department_id: ACC_DEPT_ID, category: 'advance_request', year: now.getFullYear(), month: now.getMonth() + 1,
        file_name: `${row.code}.pdf`, file_url: row.draft_file_url, related_table: 'advance_requests', related_id: row.id, uploaded_by: PROFILE.id,
      });
    } else {
      alert('Đã duyệt xong dữ liệu và ghi sổ kế toán. Lưu ý: phiếu CHƯA có file PDF nào được ký — dùng nút "✍️ Ký vào mẫu đơn" để hoàn tất và lưu vào Kho lưu trữ.');
    }
    await loadRows();
    return;
  }

  const nowIso = new Date().toISOString();
  const updatePayload = { status: action.next };
  if (action.step === 'manager') { updatePayload.manager_signed_at = nowIso; updatePayload.manager_signed_by = PROFILE.id; }
  if (action.step === 'accountant') { updatePayload.accountant_signed_at = nowIso; updatePayload.accountant_signed_by = PROFILE.id; }

  const { data, error } = await supabase.from('advance_requests').update(updatePayload).eq('id', row.id).select('id');
  if (error) { alert('Lỗi: ' + error.message); return; }
  if (!data || data.length === 0) {
    alert('Không thể duyệt phiếu này — có thể bạn không đúng quyền ở cấp hiện tại, hoặc phiếu đã được xử lý trước đó. Tải lại trang và kiểm tra lại.');
    await loadRows();
    return;
  }

  await notifyNextLevel(row, action.step);
  await loadRows();
}

// MỚI — trước đây KHÔNG có cách từ chối phiếu.
async function rejectRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  const reason = await showPromptDialog(`Lý do từ chối phiếu "${row.code}" (${fmtMoney(row.amount)}) của ${row.employees?.full_name || ''}:`, { title: 'Từ chối phiếu', required: true });
  if (reason === null) return;

  const { data, error } = await supabase.from('advance_requests').update({
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
    title: `Phiếu tạm ứng "${row.code}" đã bị từ chối`,
    content: `Lý do: ${reason}`,
  };
  await supabase.from('notifications').insert({ ...notifPayload, created_by: PROFILE.id });
  triggerPush(notifPayload);
  await loadRows();
}

// MỚI — báo cho ĐÚNG người ở cấp tiếp theo, tránh "im lặng".
async function notifyNextLevel(row, justApprovedStep, requesterDeptId, requesterCenterId) {
  let targetIds = [];
  if (justApprovedStep === 'requester_created') {
    if (requesterDeptId) {
      const { data } = await supabase.from('employees').select('id, system_roles(code)').eq('department_id', requesterDeptId);
      targetIds = (data || []).filter((e) => ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(e.system_roles?.code)).map((e) => e.id);
    } else if (requesterCenterId) {
      const { data } = await supabase.from('employees').select('id, system_roles(code)').eq('center_id', requesterCenterId);
      targetIds = (data || []).filter((e) => e.system_roles?.code === 'CENTER_MANAGER').map((e) => e.id);
    }
  } else if (justApprovedStep === 'manager') {
    const { data } = await supabase.from('employees').select('id, system_roles(code)').eq('department_id', ACC_DEPT_ID);
    targetIds = (data || []).filter((e) => ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(e.system_roles?.code)).map((e) => e.id);
  } else if (justApprovedStep === 'accountant') {
    const { data } = await supabase.from('employees').select('id, system_roles(code)');
    targetIds = (data || []).filter((e) => e.system_roles?.code === 'EXECUTIVE').map((e) => e.id);
  }
  for (const employeeId of targetIds) {
    const notif = { scope: 'personal', target_employee_id: employeeId, title: `Phiếu tạm ứng "${row.code}" cần duyệt`, content: `Phiếu của ${row.employees?.full_name || ''} (${fmtMoney(row.amount)}) đã qua cấp trước, đang chờ bạn duyệt.`, link_url: '/acc/advance-requests.html', created_by: PROFILE.id };
    await supabase.from('notifications').insert(notif);
    triggerPush(notif);
  }
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
      if (row.status === 'approved_3') updatePayload.final_file_url = newUrl;
      await supabase.from('advance_requests').update(updatePayload).eq('id', row.id);
      if (row.status === 'approved_3') {
        const now = new Date();
        await supabase.from('archive_files').insert({
          department_id: ACC_DEPT_ID, category: 'advance_request', year: now.getFullYear(), month: now.getMonth() + 1,
          file_name: `${row.code}.pdf`, file_url: newUrl, related_table: 'advance_requests', related_id: row.id, uploaded_by: PROFILE.id,
        });
      }
      await loadRows();
    },
  });
}

// ---------------------------------------------------------------------
// Tạo phiếu mới
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');
const createError = document.getElementById('createError');
document.getElementById('btnAdd').addEventListener('click', () => {
  createError.classList.remove('show');
  document.getElementById('amount').value = '';
  document.getElementById('reason').value = '';
  document.getElementById('signedFileInput').value = '';
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

// LÀM LẠI 24/08/2026 — "Gửi phiếu" giờ gửi thẳng dữ liệu (+ tuỳ chọn file
// đã ký) — không còn bắt buộc điền lên PDF ngay lúc tạo.
document.getElementById('submitCreate').addEventListener('click', async () => {
  createError.classList.remove('show');
  const amount = document.getElementById('amount').value;
  const reason = document.getElementById('reason').value.trim();
  const signedFile = document.getElementById('signedFileInput').files[0];
  if (!amount || !reason) { createError.textContent = 'Vui lòng nhập đầy đủ số tiền và lý do.'; createError.classList.add('show'); return; }

  const submitBtn = document.getElementById('submitCreate');
  submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...';

  try {
    let signedUrl = null;
    if (signedFile) signedUrl = await uploadFile(signedFile, PROFILE.id, 'requester');

    const { data: inserted, error } = await supabase.from('advance_requests').insert({
      requester_id: PROFILE.id, department_id: PROFILE.departmentId, center_id: PROFILE.centerId,
      template_id: TEMPLATE?.id || null, amount: Number(amount), reason,
      draft_file_url: signedUrl, requester_signed_at: signedUrl ? new Date().toISOString() : null,
      status: 'draft',
    }).select('id, code').single();
    if (error) throw error;

    createModal.classList.remove('show');
    await notifyNextLevel({ code: inserted.code, employees: { full_name: PROFILE.fullName }, amount }, 'requester_created', PROFILE.departmentId, PROFILE.centerId);

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
    const { data: accDept } = await supabase.from('departments').select('id').eq('code', 'ACC').single();
    ACC_DEPT_ID = accDept?.id;

    const { data: emp } = await supabase.from('employees').select('signature_url, department_id, center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, signatureUrl: emp?.signature_url || null, departmentId: emp?.department_id, centerId: emp?.center_id };

    IS_ACC_HEAD = profile.departmentCode === 'ACC' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode);
    IS_EXEC = profile.roleCode === 'EXECUTIVE';
    if (IS_ACC_HEAD || IS_EXEC || profile.roleCode === 'TECH') document.getElementById('deptScopeOption').style.display = 'block';

    await loadTemplate();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
