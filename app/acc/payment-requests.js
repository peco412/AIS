import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl, openFile, notifyDepartmentHeads } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';

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
    .order('updated_at', { ascending: false });
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

// Đã thêm cấp "Quản lý trực tiếp" theo đúng đặc tả "duyệt 3 cấp: quản lý
// trực tiếp, phòng kế toán, ban điều hành" — trước đây thiếu hẳn, đi
// thẳng từ người gửi sang Kế toán.
function actionFor(row) {
  if (row.status === 'draft' && row.requester_id === PROFILE.id) return { label: 'Ký & đính kèm chứng từ', step: 'requester' };
  if (row.status === 'submitted' && DIRECT_MANAGER_MAP[row.requester_id]) return { label: 'Quản lý trực tiếp ký', step: 'manager', next: 'approved_1' };
  if (row.status === 'approved_1' && (IS_ACC_HEAD || IS_EXEC)) return { label: 'Kế toán ký', step: 'accountant', next: 'approved_2' };
  if (row.status === 'approved_2' && IS_EXEC) return { label: 'Ban điều hành ký', step: 'executive', next: 'approved_3' };
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
        <button class="btn btn-outline btn-sm" data-view="${r.id}">Xem</button>
        ${r.original_document_urls?.length ? `<button class="btn btn-outline btn-sm" data-docs="${r.id}">Chứng từ gốc (${r.original_document_urls.length})</button>` : ''}
        ${action ? `<button class="btn btn-accent btn-sm" data-act="${r.id}">${esc(action.label)}</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
  tbody.querySelectorAll('[data-docs]').forEach((b) => b.addEventListener('click', () => viewOriginalDocs(b.dataset.docs)));
  tbody.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act)));
}

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
  const { error } = await supabase.storage.from('attachments').upload(path, fileOrBlob, { contentType: 'application/pdf' });
  if (error) throw error;
  return path;
}

let PENDING_ORIGINAL_DOCS_FOR = null; // id của phiếu đang chờ đính kèm chứng từ gốc

async function runAction(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;

  if (!PROFILE.signatureUrl) {
    alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.');
    return;
  }

  if (action.step === 'requester') {
    let pdfUrl, signatureUrl;
    try {
      pdfUrl = await resolveFileUrl(row.draft_file_url, 1800);
      signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
    } catch (e) {
      alert('Không thể mở file để ký: ' + (e.message || 'Có lỗi xảy ra.'));
      return;
    }
    await openPdfEditor({
      pdfUrl,
      signatureUrl,
      title: `Ký phiếu đề nghị thanh toán ${row.code}`,
      onSave: async (blob) => {
        const newUrl = await uploadFile(blob, row.requester_id, 'requester');
        const { error } = await supabase.from('payment_requests')
          .update({ draft_file_url: newUrl, requester_signed_at: new Date().toISOString() })
          .eq('id', row.id);
        if (error) throw error;
        await loadRows();
        PENDING_ORIGINAL_DOCS_FOR = row.id;
        document.getElementById('originalDocs').value = '';
        document.getElementById('docsError').classList.remove('show');
        document.getElementById('originalDocsModal').classList.add('show');
      },
    });
    return;
  }

  // Kế toán ký / Ban điều hành ký — dùng chung logic
  let pdfUrl, signatureUrl;
  try {
    pdfUrl = await resolveFileUrl(row.draft_file_url, 1800);
    signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
  } catch (e) {
    alert('Không thể mở file để ký: ' + (e.message || 'Có lỗi xảy ra.'));
    return;
  }

  await openPdfEditor({
    pdfUrl,
    signatureUrl,
    title: `${action.label} — ${row.code}`,
    onSave: async (blob) => {
      const newUrl = await uploadFile(blob, row.requester_id, action.step);
      const nowIso = new Date().toISOString();
      const updatePayload = { draft_file_url: newUrl, status: action.next };
      if (action.step === 'manager') { updatePayload.manager_signed_at = nowIso; updatePayload.manager_signed_by = PROFILE.id; }
      if (action.step === 'accountant') { updatePayload.accountant_signed_at = nowIso; updatePayload.accountant_signed_by = PROFILE.id; }
      if (action.step === 'executive') {
        updatePayload.executive_signed_at = nowIso;
        updatePayload.executive_signed_by = PROFILE.id;
        updatePayload.final_file_url = newUrl;
      }
      const { error } = await supabase.from('payment_requests').update(updatePayload).eq('id', row.id);
      if (error) throw error;

      if (action.step === 'executive') {
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
// Modal đính kèm chứng từ gốc -> chuyển trạng thái sang 'submitted'
// ---------------------------------------------------------------------
const docsModal = document.getElementById('originalDocsModal');
document.getElementById('closeDocsModal').addEventListener('click', () => docsModal.classList.remove('show'));
document.getElementById('cancelDocs').addEventListener('click', () => docsModal.classList.remove('show'));

document.getElementById('submitDocs').addEventListener('click', async () => {
  const docsError = document.getElementById('docsError');
  docsError.classList.remove('show');
  const files = document.getElementById('originalDocs').files;
  if (!files.length) { docsError.textContent = 'Vui lòng chọn ít nhất 1 chứng từ.'; docsError.classList.add('show'); return; }

  const btn = document.getElementById('submitDocs');
  btn.disabled = true; btn.textContent = 'Đang tải lên...';
  try {
    const row = ALL_ROWS.find((r) => r.id === PENDING_ORIGINAL_DOCS_FOR);
    const urls = [];
    for (const f of files) {
      urls.push(await uploadFile(f, row.requester_id, 'original', f.name));
    }
    const { error } = await supabase.from('payment_requests')
      .update({ original_document_urls: urls, status: 'submitted' })
      .eq('id', row.id);
    if (error) throw error;
    notifyDepartmentHeads('ACC', 'Có phiếu đề nghị thanh toán mới cần phân việc',
      `${PROFILE.fullName} vừa gửi phiếu ${row.code} (${fmtMoney(row.amount)}) — vào Phân việc để giao cho nhân sự xử lý.`, '/acc/tasks.html');
    docsModal.classList.remove('show');
    await loadRows();
  } catch (err) {
    docsError.textContent = err.message || 'Có lỗi xảy ra.';
    docsError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi phiếu cho kế toán';
  }
});

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
  await togglePoField();
  createModal.classList.add('show');
});
document.getElementById('paymentType').addEventListener('change', togglePoField);
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

// "Chi tieu phai co goc" — CHỈ áp dụng cho loại "thông thường" (mua sắm
// hàng hoá/dịch vụ); loại "công tác phí" vẫn nhập tay tự do vì bản chất
// là hoàn ứng đi lại, không có phiếu mua hàng tương ứng.
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
  // Loại bỏ phiếu mua hàng đã được dùng làm gốc cho 1 phiếu thanh toán khác rồi
  const { data: used } = await supabase.from('payment_requests').select('purchase_order_id').not('purchase_order_id', 'is', null);
  const usedIds = new Set((used || []).map((u) => u.purchase_order_id));

  const available = (data || []).filter((po) => !usedIds.has(po.id));
  const sel = document.getElementById('purchaseOrderSelect');
  sel.innerHTML = available.length === 0
    ? '<option value="">— Chưa có phiếu mua hàng nào đã duyệt xong —</option>'
    : available.map((po) => `<option value="${po.id}" data-amount="${po.total_amount}" data-center="${po.center_id || ''}" data-category="${po.expense_category_id || ''}">${esc(po.code)} — ${esc(po.suppliers?.name || '')} — ${Number(po.total_amount).toLocaleString('vi-VN')} đ</option>`).join('');

  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    document.getElementById('amount').value = opt?.dataset.amount || '';
  };
  sel.dispatchEvent(new Event('change'));
}

document.getElementById('openFillEditor').addEventListener('click', async () => {
  const paymentType = document.getElementById('paymentType').value; // 'regular' | 'trip'
  const TEMPLATE = paymentType === 'trip' ? TEMPLATES.trip : TEMPLATES.regular;
  const templateCode = paymentType === 'trip' ? '01.phieudenghithanhtoancongtacphi' : '02.Phieudenghithanhtoan';
  if (!TEMPLATE) { createError.textContent = `Chưa cấu hình biểu mẫu ${templateCode} trong Kho lưu trữ > Biểu mẫu.`; createError.classList.add('show'); return; }
  const amount = document.getElementById('amount').value;
  const content = document.getElementById('content').value.trim();
  const purchaseOrderId = paymentType === 'regular' ? document.getElementById('purchaseOrderSelect').value : null;
  if (paymentType === 'regular' && !purchaseOrderId) { createError.textContent = 'Vui lòng chọn phiếu mua hàng gốc đã duyệt xong.'; createError.classList.add('show'); return; }
  if (!amount || !content) { createError.textContent = 'Vui lòng nhập đầy đủ số tiền và nội dung.'; createError.classList.add('show'); return; }

  createModal.classList.remove('show');

  let pdfUrl, signatureUrl;
  try {
    pdfUrl = await resolveFileUrl(TEMPLATE.file_url, 1800);
    signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
  } catch (e) {
    alert('Không thể mở biểu mẫu: ' + (e.message || 'Có lỗi xảy ra.'));
    return;
  }

  await openPdfEditor({
    pdfUrl,
    signatureUrl,
    title: paymentType === 'trip' ? 'Điền & ký phiếu đề nghị thanh toán công tác phí' : 'Điền & ký phiếu đề nghị thanh toán',
    fieldMap: TEMPLATE.field_map || [],
    onSave: async (blob) => {
      const fileUrl = await uploadFile(blob, PROFILE.id, 'draft');
      const { data: created, error } = await supabase.from('payment_requests').insert({
        requester_id: PROFILE.id, department_id: PROFILE.departmentId, center_id: PROFILE.centerId,
        template_id: TEMPLATE.id, amount: Number(amount), content, draft_file_url: fileUrl,
        purchase_order_id: purchaseOrderId,
        requester_signed_at: new Date().toISOString(), status: 'draft',
      }).select('id').single();
      if (error) throw error;
      await loadRows();
    },
  });
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
    IS_EXEC = ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (IS_ACC_HEAD || IS_EXEC) document.getElementById('deptScopeOption').style.display = 'block';

    await loadTemplate();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
