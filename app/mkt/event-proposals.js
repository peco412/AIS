import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.event_' + code, code) });

let PROFILE = null;
let TEMPLATE = null;
let MKT_DEPT_ID = null;
let ALL_ROWS = [];
let IS_MKT_HEAD = false;
let IS_EXEC = false;
let IS_CENTER_MANAGER = false;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

async function loadTemplate() {
  const { data } = await supabase.from('document_templates').select('*').eq('code', '04.Phieutrinhsukien').single();
  TEMPLATE = data;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;

  let query = supabase
    .from('event_proposals')
    .select('id, code, status, draft_file_url, final_file_url, updated_at, center_manager_id, center_id, centers(name), employees:center_manager_id(full_name)')
    .order('updated_at', { ascending: false });
  if (scope === 'mine') query = query.eq('center_manager_id', PROFILE.id);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function actionFor(row) {
  if (row.status === 'draft' && (IS_MKT_HEAD || IS_EXEC)) return { label: 'Truyền thông duyệt', step: 'mkt', next: 'approved_1' };
  if (row.status === 'approved_1' && IS_EXEC) return { label: 'Ban điều hành duyệt', step: 'executive', next: 'approved_2' };
  return null;
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} phiếu`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có phiếu nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => {
    const action = actionFor(r);
    return `
    <tr>
      <td class="cell-code">${esc(r.code)}</td>
      <td>${esc(r.centers?.name || '—')}</td>
      <td>${esc(r.employees?.full_name || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td class="cell-muted">${fmtDate(r.updated_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-view="${r.id}">Xem</button>
        ${action ? `<button class="btn btn-accent btn-sm" data-act="${r.id}">${esc(action.label)}</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
  tbody.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act)));
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

async function uploadFile(fileOrBlob, managerId, suffix) {
  const path = `event-proposals/${managerId}/${Date.now()}_${suffix}.pdf`;
  const { error } = await supabase.storage.from('attachments').upload(path, fileOrBlob, { contentType: 'application/pdf' });
  if (error) throw error;
  return path;
}

async function runAction(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;
  if (!PROFILE.signatureUrl) { alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.'); return; }

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
      const newUrl = await uploadFile(blob, row.center_manager_id, action.step);
      const nowIso = new Date().toISOString();
      const updatePayload = { draft_file_url: newUrl, status: action.next };
      if (action.step === 'mkt') { updatePayload.mkt_approved_by = PROFILE.id; updatePayload.mkt_approved_at = nowIso; }
      if (action.step === 'executive') {
        updatePayload.executive_approved_by = PROFILE.id;
        updatePayload.executive_approved_at = nowIso;
        updatePayload.final_file_url = newUrl;
      }
      const { error } = await supabase.from('event_proposals').update(updatePayload).eq('id', row.id);
      if (error) throw error;

      if (action.step === 'executive') {
        const now = new Date();
        await supabase.from('archive_files').insert({
          department_id: MKT_DEPT_ID, category: 'event_proposal', year: now.getFullYear(), month: now.getMonth() + 1,
          file_name: `${row.code}.pdf`, file_url: newUrl, related_table: 'event_proposals', related_id: row.id, uploaded_by: PROFILE.id,
        });
      }
      await loadRows();
    },
  });
}

// ---------------------------------------------------------------------
// Tạo mới — chỉ Quản lý trung tâm
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');
const createError = document.getElementById('createError');
document.getElementById('btnAdd').addEventListener('click', () => {
  if (!IS_CENTER_MANAGER) { alert('Chỉ Quản lý trung tâm mới có thể trình sự kiện.'); return; }
  createError.classList.remove('show');
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

document.getElementById('openFillEditor').addEventListener('click', async () => {
  if (!TEMPLATE) { createError.textContent = 'Chưa cấu hình biểu mẫu 04.Phieutrinhsukien trong Kho lưu trữ > Biểu mẫu.'; createError.classList.add('show'); return; }
  if (!PROFILE.signatureUrl) { createError.textContent = 'Bạn chưa có chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước.'; createError.classList.add('show'); return; }

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
    title: 'Điền & ký Trình sự kiện',
    fieldMap: TEMPLATE.field_map || [],
    onSave: async (blob) => {
      const fileUrl = await uploadFile(blob, PROFILE.id, 'draft');
      const { error } = await supabase.from('event_proposals').insert({
        center_manager_id: PROFILE.id, center_id: PROFILE.centerId, template_id: TEMPLATE.id,
        draft_file_url: fileUrl, manager_signed_at: new Date().toISOString(), status: 'draft',
      });
      if (error) throw error;
      await loadRows();
    },
  });
});

document.getElementById('viewScope').addEventListener('change', loadRows);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: mktDept } = await supabase.from('departments').select('id').eq('code', 'MKT').single();
    MKT_DEPT_ID = mktDept?.id;

    const { data: emp } = await supabase.from('employees').select('signature_url, center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, signatureUrl: emp?.signature_url || null, centerId: emp?.center_id };

    IS_CENTER_MANAGER = profile.isCenterManager;
    IS_MKT_HEAD = profile.departmentCode === 'MKT' && profile.roleCode === 'DEPT_HEAD'; // đặc tả chỉ ghi Trưởng phòng, không có Phó phòng
    IS_EXEC = ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (IS_MKT_HEAD || IS_EXEC) document.getElementById('deptScopeOption').style.display = 'block';
    document.getElementById('btnAdd').style.display = IS_CENTER_MANAGER ? 'inline-flex' : 'none';

    await loadTemplate();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
