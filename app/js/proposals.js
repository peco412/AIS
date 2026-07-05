import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, resolveFileUrl, triggerPush } from '/js/supabase.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const STATUS_LABEL = {
  draft: 'Nháp', submitted: 'Chờ trưởng phòng duyệt', approved_1: 'Chờ ban điều hành duyệt',
  approved_2: 'Đã duyệt & lưu trữ', archived: 'Đã duyệt & lưu trữ', rejected: 'Từ chối',
};

let PROFILE = null;
let ALL_ROWS = [];
let IS_EXEC = false;
let CURRENT_PAGE = 1;
const PAGE_SIZE = 20;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;
  const monthValue = document.getElementById('filterMonth').value; // "yyyy-mm" hoặc rỗng

  let query = supabase
    .from('internal_proposals')
    .select('id, code, title, status, file_url, created_at, updated_at, employee_id, department_id, departments(name, code), employees!internal_proposals_employee_id_fkey(full_name, employee_code)')
    .order('updated_at', { ascending: false });
  if (scope === 'mine') query = query.eq('employee_id', PROFILE.id);
  else if (PROFILE.departmentId) query = query.eq('department_id', PROFILE.departmentId);

  if (monthValue) {
    const [y, m] = monthValue.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = new Date(y, m, 1).toISOString().slice(0, 10); // ngày 1 tháng kế tiếp
    query = query.gte('created_at', from).lt('created_at', to);
  }

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  CURRENT_PAGE = 1;
  render();
}

function isDeptHeadOf(row) {
  return row.department_id === PROFILE.departmentId && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
}

function actionFor(row) {
  if (row.status === 'draft' && row.employee_id === PROFILE.id) return { label: 'Ký & gửi duyệt', step: 'owner', next: 'submitted' };
  if (row.status === 'submitted' && (isDeptHeadOf(row) || IS_EXEC)) return { label: 'Trưởng phòng duyệt', step: 'level1', next: 'approved_1' };
  if (row.status === 'approved_1' && IS_EXEC) return { label: 'Ban điều hành duyệt', step: 'level2', next: 'approved_2' };
  return null;
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} đề xuất`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có đề xuất nào trong khoảng thời gian này.</td></tr>'; renderPagination(); return; }

  const totalPages = Math.max(1, Math.ceil(ALL_ROWS.length / PAGE_SIZE));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const pageRows = ALL_ROWS.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageRows.map((r) => {
    const action = actionFor(r);
    return `
    <tr>
      <td class="cell-code">${esc(r.code)}</td>
      <td>${esc(r.employees?.full_name || '—')}</td>
      <td>${esc(r.title)}</td>
      <td class="cell-muted">${esc(r.departments?.name || '—')}</td>
      <td><span class="badge badge-${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>
      <td class="cell-muted">${fmtDate(r.updated_at)}</td>
      <td>
        ${r.file_url ? `<button class="btn btn-outline btn-sm" data-view="${r.id}">Xem</button>` : ''}
        ${action ? `<button class="btn btn-accent btn-sm" data-act="${r.id}">${action.label}</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
  tbody.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act)));
  renderPagination();
}

// Nếu đề xuất quá nhiều, tách trang 1, 2, 3... (20 dòng/trang) thay vì
// hiện hết trong 1 bảng dài.
function renderPagination() {
  const el = document.getElementById('pagination');
  const totalPages = Math.max(1, Math.ceil(ALL_ROWS.length / PAGE_SIZE));
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  for (let p = 1; p <= totalPages; p++) {
    html += `<button class="btn btn-sm ${p === CURRENT_PAGE ? 'btn-accent' : 'btn-outline'}" data-page="${p}" style="min-width:36px;">${p}</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { CURRENT_PAGE = Number(b.dataset.page); render(); }));
}

async function viewRow(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row.file_url) return;
  try {
    const url = await resolveFileUrl(row.file_url, 1800);
    openPdfEditor({ pdfUrl: url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), readOnly: true, title: `Xem đề xuất ${row.code}` });
  } catch (e) {
    alert('Không thể mở file: ' + (e.message || 'Có lỗi xảy ra.'));
  }
}

// Lưu đè đúng nghĩa: dùng path cố định theo id đề xuất + upsert:true,
// KHÔNG tạo file mới mỗi lần ký (đúng yêu cầu "lưu đè xoá bản cũ"). Lưu
// PATH vào DB, không lưu public URL (bucket private).
async function overwriteProposalFile(proposalId, blob) {
  const path = `internal-proposals/${proposalId}/current.pdf`;
  const { error } = await supabase.storage.from('attachments').upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

async function finalizeApproval(row) {
  // Duyệt cấp 2 xong: gửi thông báo cho đúng phòng ban + lưu vào kho lưu trữ
  const notifPayload = {
    scope: 'department', department_id: row.department_id,
    title: `Đề xuất "${row.title}" đã được duyệt`,
    content: `Đề xuất ${row.code} của ${row.employees?.full_name || ''} đã được Ban điều hành phê duyệt.`,
    created_by: PROFILE.id,
  };
  await supabase.from('notifications').insert(notifPayload);
  triggerPush(notifPayload);
  if (row.file_url) {
    const now = new Date();
    await supabase.from('archive_files').insert({
      department_id: row.department_id, category: 'internal_proposal', year: now.getFullYear(), month: now.getMonth() + 1,
      file_name: `${row.code}.pdf`, file_url: row.file_url, related_table: 'internal_proposals', related_id: row.id, uploaded_by: PROFILE.id,
    });
  }
}

async function runAction(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;

  // Không có file PDF -> duyệt trực tiếp, không cần mở trình ký
  if (!row.file_url) {
    await applyStatus(row, action, null);
    return;
  }

  if (!PROFILE.signatureUrl) { alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.'); return; }

  let pdfUrl, signatureUrl;
  try {
    pdfUrl = await resolveFileUrl(row.file_url, 1800);
    signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
  } catch (e) {
    alert('Không thể mở file để ký: ' + (e.message || 'Có lỗi xảy ra.'));
    return;
  }

  await openPdfEditor({
    pdfUrl: pdfUrl + (pdfUrl.includes('?') ? '&' : '?') + 't=' + Date.now(),
    signatureUrl,
    title: `${action.label} — ${row.code} (kéo chữ ký vào vị trí bất kỳ)`,
    onSave: async (blob) => {
      const newUrl = await overwriteProposalFile(row.id, blob);
      await applyStatus(row, action, newUrl);
    },
  });
}

async function applyStatus(row, action, newFileUrl) {
  const nowIso = new Date().toISOString();
  const updatePayload = { status: action.next };
  if (newFileUrl) updatePayload.file_url = newFileUrl;
  if (action.step === 'level1') { updatePayload.level1_approver_id = PROFILE.id; updatePayload.level1_approved_at = nowIso; }
  if (action.step === 'level2') { updatePayload.level2_approver_id = PROFILE.id; updatePayload.level2_approved_at = nowIso; }

  const { error } = await supabase.from('internal_proposals').update(updatePayload).eq('id', row.id);
  if (error) { alert('Lỗi: ' + error.message); return; }

  if (action.step === 'level2') await finalizeApproval({ ...row, file_url: newFileUrl || row.file_url });
  await loadRows();
}

// ---------------------------------------------------------------------
// Tạo mới
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');
const createError = document.getElementById('createError');
document.getElementById('btnAdd').addEventListener('click', () => {
  createError.classList.remove('show');
  document.getElementById('title').value = '';
  document.getElementById('content').value = '';
  document.getElementById('proposalFile').value = '';
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));
createModal.addEventListener('click', (e) => { if (e.target === createModal) createModal.classList.remove('show'); });

document.getElementById('submitCreate').addEventListener('click', async () => {
  createError.classList.remove('show');
  const title = document.getElementById('title').value.trim();
  const content = document.getElementById('content').value.trim();
  if (!title || !content) { createError.textContent = 'Vui lòng nhập đầy đủ tiêu đề và nội dung.'; createError.classList.add('show'); return; }

  const btn = document.getElementById('submitCreate');
  btn.disabled = true; btn.textContent = 'Đang tạo...';
  try {
    const { data: inserted, error } = await supabase.from('internal_proposals').insert({
      employee_id: PROFILE.id, department_id: PROFILE.departmentId, center_id: PROFILE.centerId,
      title, content, status: 'draft',
    }).select('id').single();
    if (error) throw error;

    const file = document.getElementById('proposalFile').files[0];
    if (file) {
      const url = await overwriteProposalFile(inserted.id, file);
      await supabase.from('internal_proposals').update({ file_url: url }).eq('id', inserted.id);
    }
    createModal.classList.remove('show');
    await loadRows();
  } catch (err) {
    createError.textContent = err.message || 'Có lỗi xảy ra.';
    createError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo đề xuất';
  }
});

document.getElementById('viewScope').addEventListener('change', loadRows);
document.getElementById('filterMonth').addEventListener('change', loadRows);
document.getElementById('btnClearMonth').addEventListener('click', () => {
  document.getElementById('filterMonth').value = '';
  loadRows();
});

(async () => {
  try {
    document.getElementById('filterMonth').value = new Date().toISOString().slice(0, 7);
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('signature_url, department_id, center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, signatureUrl: emp?.signature_url || null, departmentId: emp?.department_id, centerId: emp?.center_id };
    IS_EXEC = ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (['DEPT_HEAD', 'DEPT_DEPUTY', 'EXECUTIVE', 'TECH'].includes(profile.roleCode)) {
      document.getElementById('deptScopeOption').style.display = 'block';
    }
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
