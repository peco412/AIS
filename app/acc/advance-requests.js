import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl, notifyDepartmentHeads } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.advance_' + code, code) });

let PROFILE = null;
let TEMPLATE = null;
let ACC_DEPT_ID = null;
let ALL_ROWS = [];
let IS_ACC_HEAD = false;
let IS_EXEC = false;
let DIRECT_MANAGER_MAP = {}; // requester_id -> mình có phải quản lý trực tiếp người đó không

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
    .order('updated_at', { ascending: false });
  if (scope === 'mine') query = query.eq('requester_id', PROFILE.id);
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];

  // Kiem tra khoan nao da hoan ung roi, de an nut "Hoan ung" cho dung.
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

// Đã thêm cấp "Quản lý trực tiếp" làm bước ĐẦU TIÊN theo đúng đặc tả
// "duyệt 3 cấp: quản lý trực tiếp, phòng kế toán, ban điều hành" — trước
// đây chỉ có 2 cấp (Kế toán -> BĐH), bỏ sót hẳn cấp quản lý trực tiếp.
function actionFor(row) {
  if (row.status === 'draft' && DIRECT_MANAGER_MAP[row.requester_id]) return { label: 'Quản lý trực tiếp ký', step: 'manager', next: 'approved_1' };
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
      <td class="cell-muted">${esc(r.reason || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td class="cell-muted">${fmtDate(r.updated_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-view="${r.id}">Xem</button>
        ${action ? `<button class="btn btn-accent btn-sm" data-act="${r.id}">${action.label}</button>` : ''}
        ${r.status === 'approved_3' && !r.hasSettlement && (IS_ACC_HEAD || IS_EXEC) ? `<button class="btn btn-outline btn-sm" data-settle="${r.id}">Hoàn ứng</button>` : ''}
        ${r.hasSettlement ? `<span class="badge badge-active" style="font-size:10px;">Đã hoàn ứng</span>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
  tbody.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act)));
  tbody.querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', () => settleRow(b.dataset.settle)));
}

async function settleRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const actualSpentStr = prompt(`Khoản tạm ứng "${row.code}" — ${fmtMoney(row.amount)} đ.\n\nSố tiền THỰC SỰ đã chi (có chứng từ):`, row.amount);
  if (actualSpentStr === null) return;
  const actualSpent = Number(actualSpentStr);
  if (isNaN(actualSpent) || actualSpent < 0) { alert('Số tiền không hợp lệ.'); return; }
  const notes = prompt('Diễn giải các khoản đã chi (VD: "Mua văn phòng phẩm 2tr, taxi công tác 500k..."):', '');

  const diff = row.amount - actualSpent;
  const diffMsg = diff > 0 ? `Nhân viên cần TRẢ LẠI ${fmtMoney(diff)} đ.` : diff < 0 ? `Công ty cần BÙ THÊM ${fmtMoney(Math.abs(diff))} đ.` : 'Khớp đúng 100% số tạm ứng.';
  if (!confirm(`Xác nhận hoàn ứng?\n\nTạm ứng: ${fmtMoney(row.amount)} đ\nThực chi: ${fmtMoney(actualSpent)} đ\n${diffMsg}\n\nThao tác này sẽ ghi sổ kế toán ngay.`)) return;

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
  const { error } = await supabase.storage.from('attachments').upload(path, fileOrBlob, { contentType: 'application/pdf' });
  if (error) throw error;
  return path;
}

async function runAction(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;

  if (!PROFILE.signatureUrl) {
    alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.');
    return;
  }

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
        // SUA LOI THAT: buoc duyet cuoi (chi tien that su) truoc day CHI
        // doi trang thai suong, KHONG GHI SO KE TOAN GI CA — "Tam ung"
        // hoan toan vo hinh voi Bao cao tai chinh/So cai. Bo status khoi
        // update thang, de approve_advance_final() tu lo (vua doi trang
        // thai VUA ghi No 141/Co 111-112 dung 1 cho, khong tach roi 2
        // buoc de tranh lech nhau.
        delete updatePayload.status;
      }
      const { error } = await supabase.from('advance_requests').update(updatePayload).eq('id', row.id);
      if (error) throw error;

      if (action.step === 'executive') {
        const { error: glError } = await supabase.rpc('approve_advance_final', { p_request_id: row.id, p_approver_id: PROFILE.id });
        if (glError) throw glError;
      }

      if (action.step === 'executive') {
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
// Tạo phiếu mới — người điền ký ngay lúc tạo (theo đúng đề bài: "người
// điền ký số rồi bấm lưu"), sau đó kế toán mới thao tác tiếp.
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');
const createError = document.getElementById('createError');
document.getElementById('btnAdd').addEventListener('click', () => {
  createError.classList.remove('show');
  document.getElementById('amount').value = '';
  document.getElementById('reason').value = '';
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

document.getElementById('openFillEditor').addEventListener('click', async () => {
  if (!TEMPLATE) { createError.textContent = 'Chưa cấu hình biểu mẫu 03.Phieudenghitamung trong Kho lưu trữ > Biểu mẫu.'; createError.classList.add('show'); return; }
  if (!PROFILE.signatureUrl) { createError.textContent = 'Bạn chưa có chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước.'; createError.classList.add('show'); return; }
  const amount = document.getElementById('amount').value;
  const reason = document.getElementById('reason').value.trim();
  if (!amount || !reason) { createError.textContent = 'Vui lòng nhập đầy đủ số tiền và lý do.'; createError.classList.add('show'); return; }

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
    title: 'Điền & ký phiếu đề nghị tạm ứng',
    fieldMap: TEMPLATE.field_map || [],
    onSave: async (blob) => {
      const fileUrl = await uploadFile(blob, PROFILE.id, 'draft');
      const { error } = await supabase.from('advance_requests').insert({
        requester_id: PROFILE.id, department_id: PROFILE.departmentId, center_id: PROFILE.centerId,
        template_id: TEMPLATE.id, amount: Number(amount), reason, draft_file_url: fileUrl,
        requester_signed_at: new Date().toISOString(), status: 'draft',
      });
      if (error) throw error;
      notifyDepartmentHeads('ACC', 'Có phiếu đề nghị tạm ứng mới cần phân việc',
        `${PROFILE.fullName} vừa gửi phiếu tạm ứng (${fmtMoney(Number(amount))}) — vào Phân việc để giao cho nhân sự xử lý.`, '/acc/tasks.html', PROFILE.id);
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
    // Ma tran moi: duyet CAP CUOI (BDH) chi tinh EXECUTIVE, khong con TECH.
    IS_EXEC = profile.roleCode === 'EXECUTIVE';
    if (IS_ACC_HEAD || IS_EXEC || profile.roleCode === 'TECH') document.getElementById('deptScopeOption').style.display = 'block';

    await loadTemplate();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
