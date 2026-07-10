import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase.from('suppliers').select('*, employees(full_name)').order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !q || r.name.toLowerCase().includes(q));
  document.getElementById('resultCount').textContent = `${rows.length} nhà cung cấp`;

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="7" class="empty-cell">Chưa có nhà cung cấp nào.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td class="cell-code">${esc(r.code || '—')}</td>
        <td>${esc(r.name)}</td>
        <td class="cell-muted">${esc(r.category || '—')}</td>
        <td class="mono cell-muted">${esc(r.phone || '—')}</td>
        <td class="cell-muted">${esc(r.email || '—')}</td>
        <td class="cell-muted">${esc(r.employees?.full_name || '—')}</td>
        <td><button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button></td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openEdit(btn.dataset.edit)));
}

document.getElementById('searchInput').addEventListener('input', render);

const modal = document.getElementById('createModal');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('modalTitle').textContent = 'Thêm nhà cung cấp';
  document.getElementById('supplierId').value = '';
  document.getElementById('supplierName').value = '';
  document.getElementById('supplierCategory').value = '';
  document.getElementById('supplierPhone').value = '';
  document.getElementById('supplierEmail').value = '';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa nhà cung cấp';
  document.getElementById('supplierId').value = row.id;
  document.getElementById('supplierName').value = row.name;
  document.getElementById('supplierCategory').value = row.category || '';
  document.getElementById('supplierPhone').value = row.phone || '';
  document.getElementById('supplierEmail').value = row.email || '';
  formError.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('submitBtn').addEventListener('click', async () => {
  formError.classList.remove('show');
  const id = document.getElementById('supplierId').value;
  const name = document.getElementById('supplierName').value.trim();
  if (!name) { formError.textContent = 'Vui lòng nhập tên nhà cung cấp.'; formError.classList.add('show'); return; }

  const payload = {
    name,
    category: document.getElementById('supplierCategory').value || null,
    phone: document.getElementById('supplierPhone').value || null,
    email: document.getElementById('supplierEmail').value || null,
  };

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    if (id) {
      const { error } = await supabase.from('suppliers').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('suppliers').insert({ ...payload, created_by: PROFILE.id });
      if (error) throw error;
    }
    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };

    const canUse = PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
