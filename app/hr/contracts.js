import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, resolveFileUrl, triggerPush } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';
import { showConfirm, showPromptDialog } from '/js/confirmDialog.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.contract_' + code, code) });
const CONTRACT_TYPE_LABEL = { probation: 'Thử việc', full_time: 'Toàn thời gian', part_time: 'Bán thời gian', service: 'Hợp đồng dịch vụ' };

let PROFILE = null;
let TEMPLATE = null;
let ALL_ROWS = [];
let CAN_CREATE = false;
let IS_HR_HEAD = false;
let IS_EXEC = false;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }
function fmtMoney(n) { return n ? Number(n).toLocaleString('vi-VN') + ' đ' : '—'; }

async function loadTemplate() {
  const { data } = await supabase.from('document_templates').select('*').eq('code', '01.Hopdonglaodong').single();
  TEMPLATE = data;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('contracts')
    .select('id, code, status, draft_file_url, final_file_url, filled_data, updated_at, employee_id, employees!contracts_employee_id_fkey(full_name, employee_code, contract_type)')
    .order('updated_at', { ascending: false })
    .limit(300);

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

// LÀM LẠI 24/08/2026 — theo yêu cầu "quy về dạng giống các bước đơn xin
// nghỉ": (1) duyệt dựa trên dữ liệu (filled_data), tách khỏi việc ký PDF,
// (2) thêm khả năng từ chối (trước đây không có).
function actionFor(row) {
  if (row.status === 'draft' && row.employee_id === PROFILE.id) return { label: 'Xác nhận nội dung hợp đồng', next: 'submitted', signerField: 'employee' };
  if (row.status === 'submitted' && IS_HR_HEAD) return { label: 'Trưởng phòng NS duyệt', next: 'approved_1', signerField: 'hr_head' };
  if (row.status === 'approved_1' && IS_EXEC) return { label: 'Ban điều hành duyệt', next: 'approved_2', signerField: 'executive' };
  return null;
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} hợp đồng`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có hợp đồng nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => {
    const action = actionFor(r);
    return `
    <tr>
      <td class="cell-code">${esc(r.code)}</td>
      <td>${esc(r.employees?.full_name || '—')} <span class="cell-muted">(${esc(r.employees?.employee_code || '')})</span></td>
      <td>${esc(CONTRACT_TYPE_LABEL[r.employees?.contract_type] || r.employees?.contract_type || '—')}</td>
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
  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewContract(b.dataset.view)));
  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => approveRow(b.dataset.approve)));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectRow(b.dataset.reject)));
  tbody.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => signDocument(b.dataset.sign)));
}

// MỚI — xem nội dung hợp đồng (filled_data) để duyệt dựa trên dữ liệu
// thật, không bắt buộc phải mở PDF mới biết nội dung.
function viewDetail(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const d = row.filled_data || {};
  document.getElementById('detailViewTitle').textContent = `Hợp đồng ${row.code} — ${row.employees?.full_name || ''}`;
  document.getElementById('detailViewBody').innerHTML = `
    <div class="field-grid-2" style="margin-bottom:10px;">
      <div><div class="cell-muted" style="font-size:11.5px;">Loại hợp đồng</div><div>${esc(CONTRACT_TYPE_LABEL[row.employees?.contract_type] || row.employees?.contract_type || '—')}</div></div>
      <div><div class="cell-muted" style="font-size:11.5px;">Thời hạn</div><div>${fmtDate(d.startDate)}${d.endDate ? ` — ${fmtDate(d.endDate)}` : ' (không thời hạn)'}</div></div>
    </div>
    <div class="field-grid-2" style="margin-bottom:10px;">
      <div><div class="cell-muted" style="font-size:11.5px;">Chức danh</div><div>${esc(d.position || '—')}</div></div>
      <div><div class="cell-muted" style="font-size:11.5px;">Lương</div><div>${fmtMoney(d.salary)}</div></div>
    </div>
    <div style="margin-bottom:10px;"><div class="cell-muted" style="font-size:11.5px;">Nơi làm việc</div><div>${esc(d.workLocation || '—')}</div></div>
    ${d.notes ? `<div><div class="cell-muted" style="font-size:11.5px;">Ghi chú</div><div>${esc(d.notes)}</div></div>` : ''}
  `;
  document.getElementById('detailViewModal').classList.add('show');
}
document.getElementById('closeDetailViewModal').addEventListener('click', () => document.getElementById('detailViewModal').classList.remove('show'));

async function viewContract(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const stored = row.final_file_url || row.draft_file_url;
  if (!stored) { alert('Chưa có file để xem.'); return; }
  try {
    const url = await resolveFileUrl(stored, 1800);
    openPdfEditor({ pdfUrl: url, readOnly: true, title: `Xem hợp đồng ${row.code}` });
  } catch (e) {
    alert('Không thể mở file: ' + (e.message || 'Có lỗi xảy ra.'));
  }
}

async function uploadContractFile(fileOrBlob, employeeId, suffix) {
  const path = `contracts/${employeeId}/${Date.now()}_${suffix}.pdf`;
  await uploadPrivateFile(path, fileOrBlob, { contentType: 'application/pdf', upsert: true });
  return path;
}

// LÀM LẠI 24/08/2026 — "duyệt dữ liệu" và "ký vào mẫu đơn" giờ là 2 hành
// động ĐỘC LẬP (giống đơn nghỉ phép) — không còn bắt buộc mở PDF ký mới
// duyệt được. Có .select() để phát hiện RLS âm thầm chặn (0 dòng cập
// nhật, error vẫn null — lỗi kinh điển Supabase/PostgREST).
async function approveRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  if (!(await showConfirm(`${action.label} cho hợp đồng "${row.code}" của ${row.employees?.full_name || ''}?`, { confirmLabel: 'Duyệt' }))) return;

  const nowIso = new Date().toISOString();
  const updatePayload = { status: action.next };
  if (action.signerField === 'employee') { updatePayload.employee_signed_at = nowIso; updatePayload.employee_signed_by = PROFILE.id; }
  if (action.signerField === 'hr_head') { updatePayload.hr_head_signed_at = nowIso; updatePayload.hr_head_signed_by = PROFILE.id; }
  if (action.signerField === 'executive') { updatePayload.executive_signed_at = nowIso; updatePayload.executive_signed_by = PROFILE.id; }

  const { data, error } = await supabase.from('contracts').update(updatePayload).eq('id', row.id).select('id');
  if (error) { alert('Lỗi: ' + error.message); return; }
  if (!data || data.length === 0) {
    alert('Không thể duyệt hợp đồng này — có thể bạn không đúng quyền ở cấp hiện tại, hoặc hợp đồng đã được xử lý trước đó. Tải lại trang và kiểm tra lại.');
    await loadRows();
    return;
  }

  // Duyệt cấp cuối (Ban điều hành) -> tự động lưu vào Kho lưu trữ (nếu đã
  // có file) — final_file_url chỉ được điền khi ký (xem signDocument),
  // nên nếu chưa từng ký, hợp đồng vẫn duyệt xong về mặt dữ liệu nhưng
  // chưa có file lưu trữ — nhắc rõ cho người duyệt biết.
  if (action.signerField === 'executive') {
    if (row.draft_file_url) {
      const now = new Date();
      await supabase.from('archive_files').insert({
        department_id: PROFILE.hrDepartmentId, category: 'labor_contract', year: now.getFullYear(), month: now.getMonth() + 1,
        file_name: `${row.code}.pdf`, file_url: row.draft_file_url, related_table: 'contracts', related_id: row.id, uploaded_by: PROFILE.id,
      });
      await supabase.from('contracts').update({ final_file_url: row.draft_file_url }).eq('id', row.id);
    } else {
      alert('Đã duyệt xong dữ liệu. Lưu ý: hợp đồng CHƯA có file PDF nào được ký — dùng nút "✍️ Ký vào mẫu đơn" để hoàn tất và lưu vào Kho lưu trữ.');
    }
  } else {
    await notifyNextLevel(row, action.signerField);
  }

  await loadRows();
}

// MỚI — trước đây KHÔNG có cách từ chối hợp đồng.
async function rejectRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  const reason = await showPromptDialog(`Lý do từ chối hợp đồng "${row.code}" của ${row.employees?.full_name || ''}:`, { title: 'Từ chối hợp đồng', required: true });
  if (reason === null) return;

  const { data, error } = await supabase.from('contracts').update({
    status: 'rejected', reject_reason: reason, rejected_by: PROFILE.id, rejected_at: new Date().toISOString(),
  }).eq('id', row.id).select('id');
  if (error) { alert('Lỗi: ' + error.message); return; }
  if (!data || data.length === 0) {
    alert('Không thể từ chối — có thể bạn không đúng quyền ở cấp hiện tại, hoặc hợp đồng đã được xử lý trước đó.');
    await loadRows();
    return;
  }

  const notifPayload = {
    scope: 'personal', target_employee_id: row.employee_id,
    title: `Hợp đồng "${row.code}" đã bị từ chối`,
    content: `Lý do: ${reason}`,
  };
  await supabase.from('notifications').insert({ ...notifPayload, created_by: PROFILE.id });
  triggerPush(notifPayload);
  await loadRows();
}

// MỚI — báo cho ĐÚNG người ở cấp tiếp theo, tránh "im lặng" khiến quản lý
// không biết đến lượt mình duyệt (giống đơn nghỉ phép).
async function notifyNextLevel(row, justApprovedField) {
  let targetIds = [];
  if (justApprovedField === 'employee') {
    const { data: hrDept } = await supabase.from('departments').select('id').eq('code', 'HR').single();
    const { data } = await supabase.from('employees').select('id, system_roles(code)').eq('department_id', hrDept?.id);
    targetIds = (data || []).filter((e) => ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(e.system_roles?.code)).map((e) => e.id);
  } else if (justApprovedField === 'hr_head') {
    const { data } = await supabase.from('employees').select('id, system_roles(code)');
    targetIds = (data || []).filter((e) => e.system_roles?.code === 'EXECUTIVE').map((e) => e.id);
  }
  for (const employeeId of targetIds) {
    const notif = { scope: 'personal', target_employee_id: employeeId, title: `Hợp đồng "${row.code}" cần duyệt`, content: `Hợp đồng của ${row.employees?.full_name || ''} đã qua cấp trước, đang chờ bạn duyệt.`, link_url: '/hr/contracts.html', created_by: PROFILE.id };
    await supabase.from('notifications').insert(notif);
    triggerPush(notif);
  }
}

// MỚI — "Ký vào mẫu đơn" TÁCH RIÊNG khỏi việc duyệt. Mở đúng file đã có
// (hoặc biểu mẫu gốc nếu hợp đồng này chưa từng được ký lần nào) để ký
// thêm — KHÔNG đổi status/cấp duyệt, chỉ cập nhật draft_file_url.
async function signDocument(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!PROFILE.signatureUrl) { alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.'); return; }

  const sourceStored = row.draft_file_url || TEMPLATE?.file_url;
  if (!sourceStored) { alert('Chưa có biểu mẫu để ký — chưa có file đính kèm và cũng chưa có biểu mẫu gốc cho hợp đồng lao động.'); return; }

  let sourceUrl, signatureUrl;
  try {
    sourceUrl = await resolveFileUrl(sourceStored, 1800);
    signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
  } catch (e) {
    alert('Không thể mở file để ký: ' + (e.message || 'Có lỗi xảy ra.'));
    return;
  }

  await openPdfEditor({
    pdfUrl: sourceUrl,
    signatureUrl,
    title: `Ký vào mẫu đơn — hợp đồng ${row.code}`,
    fieldMap: !row.draft_file_url ? (TEMPLATE?.field_map || []) : undefined,
    onSave: async (blob) => {
      const newUrl = await uploadContractFile(blob, row.employee_id, 'signed');
      const updatePayload = { draft_file_url: newUrl };
      if (row.status === 'approved_2') updatePayload.final_file_url = newUrl; // đã duyệt xong hết -> file mới nhất luôn là bản chính thức
      await supabase.from('contracts').update(updatePayload).eq('id', row.id);
      if (row.status === 'approved_2') {
        const now = new Date();
        await supabase.from('archive_files').insert({
          department_id: PROFILE.hrDepartmentId, category: 'labor_contract', year: now.getFullYear(), month: now.getMonth() + 1,
          file_name: `${row.code}.pdf`, file_url: newUrl, related_table: 'contracts', related_id: row.id, uploaded_by: PROFILE.id,
        });
      }
      await loadRows();
    },
  });
}

// ---------------------------------------------------------------------
// Tạo hợp đồng mới
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');
const createError = document.getElementById('createError');

async function openCreateModal() {
  createError.classList.remove('show');
  const { data: employees } = await supabase.from('employees').select('id, employee_code, full_name').order('employee_code');
  const sel = document.getElementById('employeeSelect');
  sel.innerHTML = (employees || []).map((e) => `<option value="${e.id}">${esc(e.employee_code)} — ${esc(e.full_name)}</option>`).join('');
  document.getElementById('contractStartDate').value = '';
  document.getElementById('contractEndDate').value = '';
  document.getElementById('contractPosition').value = '';
  document.getElementById('contractSalary').value = '';
  document.getElementById('contractWorkLocation').value = '';
  document.getElementById('contractNotes').value = '';
  createModal.classList.add('show');
}
document.getElementById('btnAdd').addEventListener('click', openCreateModal);
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));
createModal.addEventListener('click', (e) => { if (e.target === createModal) createModal.classList.remove('show'); });

// LÀM LẠI 24/08/2026 — "Gửi hợp đồng" giờ chỉ gửi DỮ LIỆU (đủ để nhân
// viên/cấp trên duyệt ngay) — KHÔNG còn bắt buộc điền lên PDF ngay lúc
// tạo. Ký vào mẫu đơn là việc RIÊNG, làm sau.
document.getElementById('submitCreate').addEventListener('click', async () => {
  createError.classList.remove('show');
  const employeeId = document.getElementById('employeeSelect').value;
  const contractType = document.getElementById('contractTypeSelect').value;
  const startDate = document.getElementById('contractStartDate').value;
  if (!employeeId || !startDate) { createError.textContent = 'Vui lòng chọn nhân viên và nhập ngày bắt đầu.'; createError.classList.add('show'); return; }

  const filledData = {
    startDate,
    endDate: document.getElementById('contractEndDate').value || null,
    position: document.getElementById('contractPosition').value.trim() || null,
    salary: Number(document.getElementById('contractSalary').value) || null,
    workLocation: document.getElementById('contractWorkLocation').value.trim() || null,
    notes: document.getElementById('contractNotes').value.trim() || null,
  };

  const submitBtn = document.getElementById('submitCreate');
  submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...';

  // "contract_type" nam o bang employees (phan loai chung cua nhan vien),
  // KHONG phai 1 cot tren bang contracts (moi contracts la 1 van ban cu the).
  const { error: empErr } = await supabase.from('employees').update({ contract_type: contractType }).eq('id', employeeId);
  if (empErr) { createError.textContent = 'Lỗi: ' + empErr.message; createError.classList.add('show'); submitBtn.disabled = false; submitBtn.textContent = 'Gửi hợp đồng'; return; }

  const { data: inserted, error } = await supabase.from('contracts').insert({
    employee_id: employeeId, template_id: TEMPLATE?.id || null, filled_data: filledData, status: 'draft',
  }).select('id, code').single();
  if (error) { createError.textContent = 'Lỗi: ' + error.message; createError.classList.add('show'); submitBtn.disabled = false; submitBtn.textContent = 'Gửi hợp đồng'; return; }

  createModal.classList.remove('show');
  submitBtn.disabled = false; submitBtn.textContent = 'Gửi hợp đồng';

  const notif = { scope: 'personal', target_employee_id: employeeId, title: 'Có hợp đồng lao động mới cần xác nhận', content: `Hợp đồng ${inserted.code} đã được tạo — vào xác nhận nội dung.`, link_url: '/hr/contracts.html', created_by: PROFILE.id };
  await supabase.from('notifications').insert(notif);
  triggerPush(notif);

  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: hrDept } = await supabase.from('departments').select('id').eq('code', 'HR').single();
    PROFILE = { ...profile, hrDepartmentId: hrDept?.id };

    // lấy signature_url thật (bootShell chưa fetch trường này)
    const { data: emp } = await supabase.from('employees').select('signature_url').eq('id', profile.id).single();
    PROFILE.signatureUrl = emp?.signature_url || null;

    IS_HR_HEAD = profile.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode);
    // CHUẨN HOÁ 22/08/2026: TECH chỉ xem, không thao tác duyệt trong hệ
    // thống thật — chỉ EXECUTIVE, khớp các luồng phê duyệt khác.
    IS_EXEC = profile.roleCode === 'EXECUTIVE';
    CAN_CREATE = profile.departmentCode === 'HR' || IS_EXEC;
    document.getElementById('btnAdd').style.display = CAN_CREATE ? 'inline-flex' : 'none';

    await loadTemplate();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
