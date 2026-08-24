import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl, uploadPrivateFile, openFile, notifyDepartmentHeads, triggerPush } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';
import { showConfirm, showPromptDialog } from '/js/confirmDialog.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.payment_' + code, code) });

let PROFILE = null;
let TEMPLATES = { regular: null, trip: null };
let ACC_DEPT_ID = null;
let ALL_ROWS = [];
let IS_ACC_HEAD = false;
let IS_EXEC = false;
let DIRECT_MANAGER_MAP = {};

function fmtMoney(n) { return n ? Number(n).toLocaleString('vi-VN') + ' đ' : '—'; }
function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

async function loadTemplate() {
  const [{ data: regular }, { data: trip }] = await Promise.all([
    supabase.from('document_templates').select('*').eq('code', '02.Phieudenghithanhtoan').maybeSingle(),
    supabase.from('document_templates').select('*').ilike('code', '01.phieudenghithanhtoancongtacphi%').maybeSingle(),
  ]);
  TEMPLATES = { regular, trip };
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;
  let query = supabase
    .from('payment_requests')
    .select('id, code, amount, content, status, draft_file_url, final_file_url, original_document_urls, updated_at, requester_id, employees!payment_requests_requester_id_fkey(full_name, employee_code, department_id, center_id)')
    .order('updated_at', { ascending: false })
    .limit(300);
  if (scope === 'mine') query = query.eq('requester_id', PROFILE.id);
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];

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

// LÀM LẠI 24/08/2026 — theo yêu cầu "quy về dạng giống các bước đơn xin
// nghỉ": bỏ hẳn bước "requester" (ký + đính kèm chứng từ gốc TRƯỚC khi
// gửi) — giờ gửi thẳng phiếu kèm dữ liệu + chứng từ gốc ngay lúc tạo
// (xem submitCreate), không cần bước trung gian "draft". Duyệt dựa trên
// dữ liệu, tách khỏi việc ký PDF; thêm khả năng từ chối.
function actionFor(row) {
  if (row.status === 'submitted' && DIRECT_MANAGER_MAP[row.requester_id]) return { label: 'Quản lý trực tiếp duyệt', step: 'manager', next: 'approved_1' };
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
      <td class="cell-muted">${esc(r.content || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td class="cell-muted">${fmtDate(r.updated_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-detail="${r.id}">Chi tiết</button>
        ${r.original_document_urls?.length ? `<button class="btn btn-outline btn-sm" data-docs="${r.id}">Chứng từ gốc (${r.original_document_urls.length})</button>` : ''}
        ${(r.final_file_url || r.draft_file_url) ? `<button class="btn btn-outline btn-sm" data-view="${r.id}">Xem PDF</button>` : ''}
        ${action ? `<button class="btn btn-accent btn-sm" data-approve="${r.id}">${esc(action.label)}</button>` : ''}
        ${action ? `<button class="btn btn-danger btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
        ${action ? `<button class="btn btn-outline btn-sm" data-sign="${r.id}" title="Mở mẫu đơn để ký — TÁCH RIÊNG khỏi việc duyệt dữ liệu">✍️ Ký vào mẫu đơn</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => viewDetail(b.dataset.detail)));
  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
  tbody.querySelectorAll('[data-docs]').forEach((b) => b.addEventListener('click', () => viewOriginalDocs(b.dataset.docs)));
  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => approveRow(b.dataset.approve)));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectRow(b.dataset.reject)));
  tbody.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => signDocument(b.dataset.sign)));
}

// MỚI — xem dữ liệu phiếu để duyệt, không cần mở PDF.
function viewDetail(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  document.getElementById('detailViewTitle').textContent = `Phiếu ${row.code} — ${row.employees?.full_name || ''}`;
  document.getElementById('detailViewBody').innerHTML = `
    <div class="field-grid-2" style="margin-bottom:10px;">
      <div><div class="cell-muted" style="font-size:11.5px;">Số tiền</div><div class="mono">${fmtMoney(row.amount)}</div></div>
      <div><div class="cell-muted" style="font-size:11.5px;">Cập nhật</div><div>${fmtDate(row.updated_at)}</div></div>
    </div>
    <div style="margin-bottom:10px;"><div class="cell-muted" style="font-size:11.5px;">Nội dung</div><div>${esc(row.content || '—')}</div></div>
    <div><div class="cell-muted" style="font-size:11.5px;">Chứng từ gốc</div><div>${row.original_document_urls?.length ? `${row.original_document_urls.length} file — bấm "Chứng từ gốc" trên bảng để xem` : 'Chưa có'}</div></div>
  `;
  document.getElementById('detailViewModal').classList.add('show');
}
document.getElementById('closeDetailViewModal').addEventListener('click', () => document.getElementById('detailViewModal').classList.remove('show'));

function viewOriginalDocs(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  (row.original_document_urls || []).forEach((path) => openFile(path));
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

async function uploadFile(fileOrBlob, requesterId, suffix, filename) {
  const path = `payment-requests/${requesterId}/${Date.now()}_${suffix}${filename ? '_' + filename : '.pdf'}`;
  await uploadPrivateFile(path, fileOrBlob, { contentType: 'application/pdf' });
  return path;
}

// LÀM LẠI 24/08/2026 — "duyệt dữ liệu" tách khỏi "ký vào mẫu đơn". Có
// .select() để phát hiện RLS âm thầm chặn (0 dòng cập nhật, error vẫn
// null — lỗi kinh điển Supabase/PostgREST).
async function approveRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  if (!(await showConfirm(`${action.label} cho phiếu "${row.code}" (${fmtMoney(row.amount)}) của ${row.employees?.full_name || ''}?`, { confirmLabel: 'Duyệt' }))) return;

  const nowIso = new Date().toISOString();
  const updatePayload = { status: action.next };
  if (action.step === 'manager') { updatePayload.manager_signed_at = nowIso; updatePayload.manager_signed_by = PROFILE.id; }
  if (action.step === 'accountant') { updatePayload.accountant_signed_at = nowIso; updatePayload.accountant_signed_by = PROFILE.id; }
  if (action.step === 'executive') { updatePayload.executive_signed_at = nowIso; updatePayload.executive_signed_by = PROFILE.id; }

  const { data, error } = await supabase.from('payment_requests').update(updatePayload).eq('id', row.id).select('id');
  if (error) { alert('Lỗi: ' + error.message); return; }
  if (!data || data.length === 0) {
    alert('Không thể duyệt phiếu này — có thể bạn không đúng quyền ở cấp hiện tại, hoặc phiếu đã được xử lý trước đó. Tải lại trang và kiểm tra lại.');
    await loadRows();
    return;
  }

  if (action.step === 'executive') {
    if (row.draft_file_url) {
      const now = new Date();
      await supabase.from('payment_requests').update({ final_file_url: row.draft_file_url }).eq('id', row.id);
      await supabase.from('archive_files').insert({
        department_id: ACC_DEPT_ID, category: 'payment_request', year: now.getFullYear(), month: now.getMonth() + 1,
        file_name: `${row.code}.pdf`, file_url: row.draft_file_url, related_table: 'payment_requests', related_id: row.id, uploaded_by: PROFILE.id,
      });
    } else {
      alert('Đã duyệt xong dữ liệu. Lưu ý: phiếu CHƯA có file PDF nào được ký — dùng nút "✍️ Ký vào mẫu đơn" để hoàn tất và lưu vào Kho lưu trữ.');
    }
  } else {
    await notifyNextLevel(row, action.step);
  }

  await loadRows();
}

// MỚI — trước đây KHÔNG có cách từ chối phiếu (dù trigger đã hỗ trợ sẵn).
async function rejectRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  const reason = await showPromptDialog(`Lý do từ chối phiếu "${row.code}" (${fmtMoney(row.amount)}) của ${row.employees?.full_name || ''}:`, { title: 'Từ chối phiếu', required: true });
  if (reason === null) return;

  const { data, error } = await supabase.from('payment_requests').update({
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

// MỚI — báo cho ĐÚNG người ở cấp tiếp theo, tránh "im lặng". "employees"
// truyền vào có thể là object thật (department_id/center_id) hoặc object
// giả lúc mới tạo phiếu (dùng departmentId/centerId của PROFILE thay thế).
async function notifyNextLevel(row, justApprovedStep, requesterDeptId, requesterCenterId) {
  let targetIds = [];
  if (justApprovedStep === 'requester_created') {
    // Cấp 1 = Quản lý trực tiếp — Trưởng/phó phòng cùng phòng (văn
    // phòng) hoặc Quản lý trung tâm cùng trung tâm (nhân sự trung tâm).
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
    const notif = { scope: 'personal', target_employee_id: employeeId, title: `Phiếu "${row.code}" cần duyệt`, content: `Phiếu của ${row.employees?.full_name || ''} (${fmtMoney(row.amount)}) đã qua cấp trước, đang chờ bạn duyệt.`, link_url: '/acc/payment-requests.html', created_by: PROFILE.id };
    await supabase.from('notifications').insert(notif);
    triggerPush(notif);
  }
}

// MỚI — "Ký vào mẫu đơn" TÁCH RIÊNG khỏi việc duyệt.
async function signDocument(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!PROFILE.signatureUrl) { alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.'); return; }

  const sourceStored = row.draft_file_url || TEMPLATES.regular?.file_url;
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
    fieldMap: !row.draft_file_url ? (TEMPLATES.regular?.field_map || []) : undefined,
    onSave: async (blob) => {
      const newUrl = await uploadFile(blob, row.requester_id, 'signed');
      const updatePayload = { draft_file_url: newUrl };
      if (row.status === 'approved_3') updatePayload.final_file_url = newUrl;
      await supabase.from('payment_requests').update(updatePayload).eq('id', row.id);
      if (row.status === 'approved_3') {
        const now = new Date();
        await supabase.from('archive_files').insert({
          department_id: ACC_DEPT_ID, category: 'payment_request', year: now.getFullYear(), month: now.getMonth() + 1,
          file_name: `${row.code}.pdf`, file_url: newUrl, related_table: 'payment_requests', related_id: row.id, uploaded_by: PROFILE.id,
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
document.getElementById('btnAdd').addEventListener('click', async () => {
  createError.classList.remove('show');
  document.getElementById('amount').value = '';
  document.getElementById('content').value = '';
  document.getElementById('paymentType').value = 'regular';
  document.getElementById('originalDocs').value = '';
  document.getElementById('signedFileInput').value = '';
  await togglePoField();
  createModal.classList.add('show');
});
document.getElementById('paymentType').addEventListener('change', togglePoField);
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

async function togglePoField() {
  const isRegular = document.getElementById('paymentType').value === 'regular';
  document.getElementById('poField').style.display = isRegular ? 'block' : 'none';
  document.getElementById('amount').readOnly = isRegular;
  if (isRegular) await loadApprovedPurchaseOrders();
}

async function loadApprovedPurchaseOrders() {
  const { data } = await supabase.from('purchase_orders')
    .select('id, code, total_amount, center_id, expense_category_id, suppliers(name)')
    .eq('status', 'approved_3')
    .eq('requester_id', PROFILE.id);
  const { data: used } = await supabase.from('payment_requests').select('purchase_order_id').not('purchase_order_id', 'is', null);
  const usedIds = new Set((used || []).map((u) => u.purchase_order_id));

  const available = (data || []).filter((po) => !usedIds.has(po.id));
  const sel = document.getElementById('purchaseOrderSelect');
  sel.innerHTML = available.length === 0
    ? '<option value="">— Chưa có phiếu mua hàng nào đã duyệt xong —</option>'
    : available.map((po) => `<option value="${po.id}" data-amount="${po.total_amount}">${esc(po.code)} — ${esc(po.suppliers?.name || '')} — ${Number(po.total_amount).toLocaleString('vi-VN')} đ</option>`).join('');

  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    document.getElementById('amount').value = opt?.dataset.amount || '';
  };
  sel.dispatchEvent(new Event('change'));
}

// LÀM LẠI 24/08/2026 — "Gửi phiếu" giờ gửi thẳng dữ liệu + chứng từ gốc +
// (tuỳ chọn) file đã ký NGAY TRONG 1 LẦN — không còn 2 bước tách rời
// (ký PDF trống rồi mới đính chứng từ) như trước.
document.getElementById('submitCreate').addEventListener('click', async () => {
  createError.classList.remove('show');
  const paymentType = document.getElementById('paymentType').value;
  const amount = document.getElementById('amount').value;
  const content = document.getElementById('content').value.trim();
  const purchaseOrderId = paymentType === 'regular' ? document.getElementById('purchaseOrderSelect').value : null;
  const originalDocs = document.getElementById('originalDocs').files;
  const signedFile = document.getElementById('signedFileInput').files[0];

  if (paymentType === 'regular' && !purchaseOrderId) { createError.textContent = 'Vui lòng chọn phiếu mua hàng gốc đã duyệt xong.'; createError.classList.add('show'); return; }
  if (!amount || !content) { createError.textContent = 'Vui lòng nhập đầy đủ số tiền và nội dung.'; createError.classList.add('show'); return; }
  if (!originalDocs.length) { createError.textContent = 'Vui lòng đính kèm ít nhất 1 chứng từ gốc.'; createError.classList.add('show'); return; }

  const submitBtn = document.getElementById('submitCreate');
  submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...';

  try {
    const TEMPLATE = paymentType === 'trip' ? TEMPLATES.trip : TEMPLATES.regular;
    const docUrls = [];
    // Upload chứng từ gốc TRƯỚC — nhưng cần requester_id để đặt đường dẫn,
    // dùng PROFILE.id (chính người tạo, luôn đúng vì phiếu này do họ đứng tên).
    for (const f of originalDocs) {
      docUrls.push(await uploadFile(f, PROFILE.id, 'original', f.name));
    }
    let signedUrl = null;
    if (signedFile) signedUrl = await uploadFile(signedFile, PROFILE.id, 'requester');

    const { data: inserted, error } = await supabase.from('payment_requests').insert({
      requester_id: PROFILE.id, department_id: PROFILE.departmentId, center_id: PROFILE.centerId,
      template_id: TEMPLATE?.id || null, amount: Number(amount), content,
      purchase_order_id: purchaseOrderId, original_document_urls: docUrls,
      draft_file_url: signedUrl, requester_signed_at: signedUrl ? new Date().toISOString() : null,
      status: 'submitted',
    }).select('id, code').single();
    if (error) throw error;

    createModal.classList.remove('show');
    notifyDepartmentHeads('ACC', 'Có phiếu đề nghị thanh toán mới cần duyệt',
      `${PROFILE.fullName} vừa gửi phiếu ${inserted.code} (${fmtMoney(amount)}) — vào duyệt ngay.`, '/acc/payment-requests.html', PROFILE.id);
    // Cấp 1 thật sự là "Quản lý trực tiếp" (không nhất thiết là ACC) —
    // notifyDepartmentHeads ở trên báo cho ACC biết có phiếu mới (để theo
    // dõi chung), còn đây báo ĐÚNG người cần duyệt trước tiên.
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
