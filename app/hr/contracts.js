import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, resolveFileUrl } from '/js/supabase.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const STATUS_LABEL = {
  draft: 'Chờ nhân viên ký', submitted: 'Chờ trưởng phòng NS ký',
  approved_1: 'Chờ ban điều hành ký', approved_2: 'Đã lưu trữ', archived: 'Đã lưu trữ', rejected: 'Từ chối',
};

let PROFILE = null;
let TEMPLATE = null;
let ALL_ROWS = [];
let CAN_CREATE = false;
let IS_HR_HEAD = false;
let IS_EXEC = false;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

async function loadTemplate() {
  const { data } = await supabase.from('document_templates').select('*').eq('code', '01.Hopdonglaodong').single();
  TEMPLATE = data;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('contracts')
    .select('id, code, status, contract_type, draft_file_url, final_file_url, updated_at, employee_id, employees(full_name, employee_code)')
    .order('updated_at', { ascending: false });

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function actionFor(row) {
  if (row.status === 'draft' && row.employee_id === PROFILE.id) return { label: 'Ký hợp đồng', next: 'submitted', signerField: 'employee' };
  if (row.status === 'submitted' && IS_HR_HEAD) return { label: 'Trưởng phòng NS ký', next: 'approved_1', signerField: 'hr_head' };
  if (row.status === 'approved_1' && IS_EXEC) return { label: 'Ban điều hành ký', next: 'approved_2', signerField: 'executive' };
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
      <td>${esc(r.contract_type || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td class="cell-muted">${fmtDate(r.updated_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-view="${r.id}">Xem</button>
        ${action ? `<button class="btn btn-accent btn-sm" data-sign="${r.id}">${action.label}</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewContract(b.dataset.view)));
  tbody.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => signContract(b.dataset.sign)));
}

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

async function uploadContractFile(blob, employeeId, suffix) {
  const path = `contracts/${employeeId}/${Date.now()}_${suffix}.pdf`;
  const { error } = await supabase.storage.from('attachments').upload(path, blob, { contentType: 'application/pdf' });
  if (error) throw error;
  return path;
}

async function signContract(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;

  if (!PROFILE.signatureUrl) {
    alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.');
    return;
  }

  const sourceStored = row.draft_file_url; // luôn ký chồng lên file hiện hành
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
    title: `Ký hợp đồng ${row.code} — ${action.label}`,
    onSave: async (blob) => {
      const newUrl = await uploadContractFile(blob, row.employee_id, action.signerField);
      const updatePayload = { draft_file_url: newUrl, status: action.next };
      const nowIso = new Date().toISOString();
      if (action.signerField === 'employee') { updatePayload.employee_signed_at = nowIso; updatePayload.employee_signed_by = PROFILE.id; }
      if (action.signerField === 'hr_head') { updatePayload.hr_head_signed_at = nowIso; updatePayload.hr_head_signed_by = PROFILE.id; }
      if (action.signerField === 'executive') {
        updatePayload.executive_signed_at = nowIso;
        updatePayload.executive_signed_by = PROFILE.id;
        updatePayload.final_file_url = newUrl;
      }

      const { error } = await supabase.from('contracts').update(updatePayload).eq('id', row.id);
      if (error) throw error;

      // Ký cấp cuối (ban điều hành) -> tự động lưu vào Kho lưu trữ hệ thống
      if (action.signerField === 'executive') {
        const now = new Date();
        await supabase.from('archive_files').insert({
          department_id: PROFILE.hrDepartmentId,
          category: 'labor_contract',
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          file_name: `${row.code}.pdf`,
          file_url: newUrl,
          related_table: 'contracts',
          related_id: row.id,
          uploaded_by: PROFILE.id,
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
  createModal.classList.add('show');
}
document.getElementById('btnAdd').addEventListener('click', openCreateModal);
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));
createModal.addEventListener('click', (e) => { if (e.target === createModal) createModal.classList.remove('show'); });

document.getElementById('openFillEditor').addEventListener('click', async () => {
  if (!TEMPLATE) { createError.textContent = 'Chưa cấu hình biểu mẫu 01.Hopdonglaodong trong Kho lưu trữ > Biểu mẫu.'; createError.classList.add('show'); return; }
  const employeeId = document.getElementById('employeeSelect').value;
  const contractType = document.getElementById('contractTypeSelect').value;
  if (!employeeId) return;

  createModal.classList.remove('show');

  let templateUrl;
  try {
    templateUrl = await resolveFileUrl(TEMPLATE.file_url, 1800);
  } catch (e) {
    alert('Không thể mở biểu mẫu: ' + (e.message || 'Có lỗi xảy ra.'));
    return;
  }

  await openPdfEditor({
    pdfUrl: templateUrl,
    signatureUrl: null, // bước điền nội dung, chưa ký
    title: 'Điền nội dung hợp đồng lao động',
    onSave: async (blob) => {
      const fileUrl = await uploadContractFile(blob, employeeId, 'draft');
      const { error } = await supabase.from('contracts').insert({
        employee_id: employeeId,
        template_id: TEMPLATE.id,
        contract_type: contractType,
        draft_file_url: fileUrl,
        status: 'draft',
      });
      if (error) throw error;
      await loadRows();
    },
  });
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
    IS_EXEC = ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    CAN_CREATE = profile.departmentCode === 'HR' || IS_EXEC;
    document.getElementById('btnAdd').style.display = CAN_CREATE ? 'inline-flex' : 'none';

    await loadTemplate();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
