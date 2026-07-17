import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, openFile, resolveFileUrl } from '/js/supabase.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const CATEGORY_LABEL = {
  labor_contract: 'Hợp đồng lao động', service_contract: 'Hợp đồng dịch vụ', admin_paper: 'Giấy tờ hành chính',
  internal_proposal: 'Đề xuất nội bộ', other: 'File khác', payment_request: 'Phiếu đề nghị thanh toán',
  advance_request: 'Phiếu đề nghị tạm ứng', event_proposal: 'Trình sự kiện', purchase_request: 'Phiếu đề nghị mua sắm',
  communication_request: 'Yêu cầu truyền thông', facility_request: 'Yêu cầu cơ sở vật chất', template: 'Biểu mẫu',
};

const DEPT_CATEGORIES = {
  HR: ['labor_contract', 'service_contract', 'admin_paper', 'internal_proposal', 'other'],
  ACC: ['payment_request', 'advance_request', 'internal_proposal', 'other'],
  MKT: ['event_proposal', 'communication_request', 'internal_proposal', 'other'],
  FAC: ['purchase_request', 'facility_request', 'internal_proposal', 'other'],
  EDU: ['labor_contract', 'internal_proposal', 'other'],
  BDH: Object.keys(CATEGORY_LABEL),
  BCM: ['internal_proposal', 'other'],
  TECH: Object.keys(CATEGORY_LABEL),
};

let PROFILE = null;
let DEPARTMENTS = [];
let ACTIVE_DEPT = null;
let IS_EXEC_TECH = false;

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

function hasAccess(deptCode) {
  return IS_EXEC_TECH || deptCode === PROFILE.departmentCode;
}

function renderDeptList() {
  const ul = document.getElementById('deptList');
  ul.innerHTML = DEPARTMENTS.map((d) => `
    <li><button data-dept="${d.code}" class="${d.code === ACTIVE_DEPT ? 'active' : ''}">
      ${d.name}${hasAccess(d.code) ? '' : '<span class="lock"><svg class="icon icon--sm" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>'}
    </button></li>
  `).join('') + `<li><button data-dept="TEMPLATES" class="${ACTIVE_DEPT === 'TEMPLATES' ? 'active' : ''}">📁 Biểu mẫu</button></li>`;

  ul.querySelectorAll('[data-dept]').forEach((btn) => {
    btn.addEventListener('click', () => selectDept(btn.dataset.dept));
  });
}

function yearOptions() {
  const sel = document.getElementById('filterYear');
  const now = new Date().getFullYear();
  sel.innerHTML = '';
  for (let y = now; y >= now - 4; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = `Năm ${y}`;
    sel.appendChild(opt);
  }
}

function categoryOptions(deptCode) {
  const sel = document.getElementById('filterCategory');
  const cats = DEPT_CATEGORIES[deptCode] || Object.keys(CATEGORY_LABEL);
  sel.innerHTML = '<option value="">Tất cả loại tài liệu</option>' +
    cats.map((c) => `<option value="${c}">${CATEGORY_LABEL[c]}</option>`).join('');

  const uploadSel = document.getElementById('uploadCategory');
  uploadSel.innerHTML = cats.map((c) => `<option value="${c}">${CATEGORY_LABEL[c]}</option>`).join('');
}

async function selectDept(code) {
  ACTIVE_DEPT = code;
  renderDeptList();
  const content = document.getElementById('archiveContent');

  if (code === 'TEMPLATES') {
    document.getElementById('btnUpload').style.display = IS_EXEC_TECH ? 'inline-flex' : 'none';
    await loadTemplates();
    return;
  }

  if (!hasAccess(code)) {
    document.getElementById('tableBody').innerHTML =
      '<tr><td colspan="6"><div class="denied-box"><div class="big"><svg class="icon icon--sm" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>Bạn không có quyền thực hiện thao tác.</div></td></tr>';
    document.getElementById('resultCount').textContent = '';
    document.getElementById('btnUpload').style.display = 'none';
    return;
  }

  document.getElementById('btnUpload').style.display = 'inline-flex';
  categoryOptions(code);
  await loadFiles();
}

async function loadFiles() {
  const dept = DEPARTMENTS.find((d) => d.code === ACTIVE_DEPT);
  if (!dept) return;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const year = document.getElementById('filterYear').value;
  const month = document.getElementById('filterMonth').value;
  const category = document.getElementById('filterCategory').value;
  const search = document.getElementById('searchInput').value.trim();

  let query = supabase
    .from('archive_files')
    .select('id, file_name, category, year, month, file_url, created_at, uploaded_by, employees(full_name)')
    .eq('department_id', dept.id)
    .order('created_at', { ascending: false });

  if (year) query = query.eq('year', Number(year));
  if (month) query = query.eq('month', Number(month));
  if (category) query = query.eq('category', category);
  if (search) query = query.ilike('file_name', `%${search}%`);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }

  document.getElementById('resultCount').textContent = `${data.length} tài liệu`;
  if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Không có tài liệu phù hợp.</td></tr>'; return; }

  tbody.innerHTML = data.map((f) => `
    <tr>
      <td>${esc(f.file_name)}</td>
      <td><span class="badge badge-draft">${esc(CATEGORY_LABEL[f.category] || f.category)}</span></td>
      <td class="cell-muted">${f.month}/${f.year}</td>
      <td class="cell-muted">${esc(f.employees?.full_name || '—')}</td>
      <td class="cell-muted">${fmtDate(f.created_at)}</td>
      <td><button class="btn btn-outline btn-sm" data-open="${esc(f.file_url)}">Xem / tải</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
}

async function loadTemplates() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  document.getElementById('resultCount').textContent = '';

  const { data, error } = await supabase.from('document_templates').select('*').order('code');
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }

  const canDesign = PROFILE && (
    ['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) ||
    (PROFILE.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode))
  );

  tbody.innerHTML = data.map((t) => `
    <tr>
      <td>${esc(t.name)}</td>
      <td><span class="cell-code">${esc(t.code)}</span></td>
      <td class="cell-muted">${t.field_map?.length ? `${t.field_map.length} vị trí đã lưu` : 'Chưa thiết kế vị trí'}</td>
      <td class="cell-muted">Hệ thống</td>
      <td class="cell-muted">${fmtDate(t.updated_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-open="${esc(t.file_url)}">Xem / tải</button>
        ${canDesign ? `<button class="btn btn-outline btn-sm" data-design="${t.id}" data-url="${esc(t.file_url)}">📐 Thiết kế vị trí</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-cell">Chưa có biểu mẫu.</td></tr>';
  tbody.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
  tbody.querySelectorAll('[data-design]').forEach((b) => b.addEventListener('click', () => openTemplateDesigner(b.dataset.design, b.dataset.url)));
}

// Cho TECH/HR đặt sẵn vị trí ký/điền 1 lần cho mỗi loại biểu mẫu — những
// lần điền/ký sau (hợp đồng, phiếu thanh toán...) sẽ tự có sẵn đúng chỗ.
async function openTemplateDesigner(templateId, storedUrl) {
  let pdfUrl;
  try {
    pdfUrl = await resolveFileUrl(storedUrl, 1800);
  } catch (e) {
    alert('Không thể mở biểu mẫu: ' + (e.message || 'Có lỗi xảy ra.'));
    return;
  }
  await openPdfEditor({
    pdfUrl,
    signatureUrl: PROFILE.signatureUrl || null,
    title: 'Thiết kế vị trí ký/điền cho biểu mẫu',
    isTemplateDesigner: true,
    onSave: async () => {}, // không dùng nút Lưu thường ở chế độ này
    onSaveFieldMap: async (fieldMap) => {
      const { error } = await supabase.from('document_templates').update({ field_map: fieldMap }).eq('id', templateId);
      if (error) throw error;
      await loadTemplates();
    },
  });
}

['filterYear', 'filterMonth', 'filterCategory', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('change', () => { if (ACTIVE_DEPT && ACTIVE_DEPT !== 'TEMPLATES') loadFiles(); });
  document.getElementById(id).addEventListener('input', () => { if (ACTIVE_DEPT && ACTIVE_DEPT !== 'TEMPLATES') loadFiles(); });
});

// ---------------------------------------------------------------------
// Tải file lên
// ---------------------------------------------------------------------
const uploadModal = document.getElementById('uploadModal');
const uploadError = document.getElementById('uploadError');

document.getElementById('btnUpload').addEventListener('click', () => {
  uploadError.classList.remove('show');
  document.getElementById('uploadForm').reset();
  uploadModal.classList.add('show');
});
document.getElementById('closeUploadModal').addEventListener('click', () => uploadModal.classList.remove('show'));
document.getElementById('cancelUpload').addEventListener('click', () => uploadModal.classList.remove('show'));
uploadModal.addEventListener('click', (e) => { if (e.target === uploadModal) uploadModal.classList.remove('show'); });

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  uploadError.classList.remove('show');
  const submitBtn = document.getElementById('submitUpload');
  submitBtn.disabled = true; submitBtn.textContent = 'Đang tải lên...';

  try {
    const file = document.getElementById('uploadFile').files[0];
    if (!file) throw new Error('Vui lòng chọn file.');

    if (ACTIVE_DEPT === 'TEMPLATES') {
      const path = `templates/${Date.now()}_${file.name}`;
      const storedPath = await uploadPrivateFile(path, file);
      const { error } = await supabase.from('document_templates').insert({ code: file.name, name: file.name, file_url: storedPath });
      if (error) throw error;
      await loadTemplates();
    } else {
      const dept = DEPARTMENTS.find((d) => d.code === ACTIVE_DEPT);
      const now = new Date();
      const path = `archive/${dept.code}/${now.getFullYear()}/${now.getMonth() + 1}/${Date.now()}_${file.name}`;
      const storedPath = await uploadPrivateFile(path, file);

      const { error } = await supabase.from('archive_files').insert({
        department_id: dept.id,
        category: document.getElementById('uploadCategory').value,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        file_name: file.name,
        file_url: storedPath,
        uploaded_by: PROFILE.id,
      });
      if (error) throw error;
      await loadFiles();
    }
    uploadModal.classList.remove('show');
  } catch (err) {
    uploadError.textContent = err.message || 'Có lỗi xảy ra.';
    uploadError.classList.add('show');
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Tải lên';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    IS_EXEC_TECH = ['EXECUTIVE', 'TECH'].includes(profile.roleCode);

    const { data: depts } = await supabase.from('departments').select('id, code, name').order('name');
    DEPARTMENTS = depts || [];
    yearOptions();
    renderDeptList();

    // Mặc định mở phòng ban của chính người dùng (hoặc phòng đầu tiên nếu là exec/tech)
    const defaultDept = DEPARTMENTS.find((d) => d.code === profile.departmentCode)?.code || DEPARTMENTS[0]?.code;
    if (defaultDept) await selectDept(defaultDept);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
