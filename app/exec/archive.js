import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, openFile } from '/js/supabase.js';

let PROFILE = null;
let BDH_DEPT_ID = null;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

function fillYearFilter() {
  const now = new Date().getFullYear();
  const sel = document.getElementById('filterYear');
  sel.innerHTML = '<option value="">Tất cả năm</option>' +
    Array.from({ length: 5 }, (_, i) => now - i).map((y) => `<option value="${y}">${y}</option>`).join('');
  const monthSel = document.getElementById('filterMonth');
  monthSel.innerHTML = '<option value="">Cả năm</option>' +
    Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<option value="${m}">Tháng ${m}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase
    .from('archive_files')
    .select('id, file_name, file_url, year, month, created_at, employees(full_name)')
    .eq('department_id', BDH_DEPT_ID)
    .order('created_at', { ascending: false });

  const year = document.getElementById('filterYear').value;
  const month = document.getElementById('filterMonth').value;
  if (year) query = query.eq('year', Number(year));
  if (month) query = query.eq('month', Number(month));

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !search || r.file_name.toLowerCase().includes(search));
  document.getElementById('resultCount').textContent = `${rows.length} file`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có file nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.file_name)}</td>
      <td class="cell-code">${r.month}/${r.year}</td>
      <td class="cell-muted">${esc(r.employees?.full_name || '—')}</td>
      <td class="cell-muted">${fmtDate(r.created_at)}</td>
      <td><button class="btn btn-outline btn-sm" data-open="${esc(r.file_url)}">Xem</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
}

['filterYear', 'filterMonth'].forEach((id) => document.getElementById(id).addEventListener('change', loadRows));
document.getElementById('searchInput').addEventListener('input', render);

const modal = document.getElementById('uploadModal');
const form = document.getElementById('uploadForm');
const errBox = document.getElementById('uploadError');

document.getElementById('btnUpload').addEventListener('click', () => {
  form.reset();
  document.getElementById('fileYear').value = new Date().getFullYear();
  document.getElementById('fileMonth').value = new Date().getMonth() + 1;
  errBox.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeUploadModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelUpload').addEventListener('click', () => modal.classList.remove('show'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.classList.remove('show');
  const file = document.getElementById('uploadFile').files[0];
  if (!file) return;

  const btn = document.getElementById('submitUpload');
  btn.disabled = true; btn.textContent = 'Đang tải lên...';
  try {
    const path = `executive-archive/${Date.now()}-${file.name}`;
    const storedPath = await uploadPrivateFile(path, file);

    const { error } = await supabase.from('archive_files').insert({
      department_id: BDH_DEPT_ID,
      category: 'other',
      year: Number(document.getElementById('fileYear').value),
      month: Number(document.getElementById('fileMonth').value),
      file_name: document.getElementById('fileName').value.trim(),
      file_url: storedPath,
      uploaded_by: PROFILE.id,
    });
    if (error) throw error;

    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tải lên';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    const { data: dept } = await supabase.from('departments').select('id').eq('code', 'BDH').single();
    BDH_DEPT_ID = dept?.id;
    fillYearFilter();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
