import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const GROUP_LABEL = { education: 'Sản phẩm giáo dục', media: 'Sản phẩm truyền thông' };
let PROFILE = null;
let CAN_EDIT = false;
let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('inventory_items').select('*').order('product_group').order('display_order');
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const groupFilter = document.getElementById('filterGroup').value;
  const rows = ALL_ROWS.filter((r) => !groupFilter || r.product_group === groupFilter);
  document.getElementById('resultCount').textContent = `${rows.length} sản phẩm`;

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="7" class="empty-cell">Chưa có sản phẩm nào.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td class="cell-code mono">${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        <td class="cell-muted">${esc(GROUP_LABEL[r.product_group] || r.product_group)}</td>
        <td class="cell-muted">${esc(r.unit || '—')}</td>
        <td>${r.has_size ? 'Có' : '—'}</td>
        <td class="mono">${Number(r.price_vnd || 0).toLocaleString('vi-VN')} đ</td>
        <td>${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button> <button class="btn btn-outline btn-sm" data-delete="${r.id}" data-name="${esc(r.name)}" title="Xoá sản phẩm"><svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg></button>` : ''}</td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openEdit(btn.dataset.edit)));
  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`Xoá sản phẩm "${btn.dataset.name}"? Chỉ xoá được nếu sản phẩm này chưa từng phát sinh giao dịch kho/mua hàng nào — nếu đã dùng rồi, hệ thống sẽ báo lỗi và không xoá.`)) return;
    const { error } = await supabase.from('inventory_items').delete().eq('id', btn.dataset.delete);
    if (error) { alert('Không xoá được — sản phẩm này đã có giao dịch gắn với nó:\n' + error.message); return; }
    await loadRows();
  }));
}

document.getElementById('filterGroup').addEventListener('change', render);

const modal = document.getElementById('productModal');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('modalTitle').textContent = 'Thêm sản phẩm mới';
  document.getElementById('itemId').value = '';
  document.getElementById('productName').value = '';
  document.getElementById('productUnit').value = '';
  document.getElementById('productPrice').value = '';
  document.getElementById('productHasSize').checked = false;
  document.getElementById('productGroup').value = 'media';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa sản phẩm';
  document.getElementById('itemId').value = row.id;
  document.getElementById('productName').value = row.name;
  document.getElementById('productUnit').value = row.unit || '';
  document.getElementById('productPrice').value = row.price_vnd || 0;
  document.getElementById('productHasSize').checked = row.has_size;
  document.getElementById('productGroup').value = row.product_group || 'media';
  formError.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('btnSubmitProduct').addEventListener('click', async () => {
  formError.classList.remove('show');
  const id = document.getElementById('itemId').value;
  const name = document.getElementById('productName').value.trim();
  const unit = document.getElementById('productUnit').value.trim();
  const price = Number(document.getElementById('productPrice').value);
  if (!name || !unit || !price) { formError.textContent = 'Vui lòng nhập đầy đủ.'; formError.classList.add('show'); return; }

  const payload = {
    name, unit, price_vnd: price,
    has_size: document.getElementById('productHasSize').checked,
    product_group: document.getElementById('productGroup').value,
  };

  const btn = document.getElementById('btnSubmitProduct');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  let err;
  if (id) {
    ({ error: err } = await supabase.from('inventory_items').update(payload).eq('id', id));
  } else {
    const code = 'SP-' + Date.now().toString(36).toUpperCase();
    ({ error: err } = await supabase.from('inventory_items').insert({ ...payload, code, is_custom: true }));
  }
  btn.disabled = false; btn.textContent = 'Lưu';
  if (err) { formError.textContent = err.message; formError.classList.add('show'); return; }

  modal.classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_EDIT = profile.roleCode === 'TECH';
    if (!CAN_EDIT) document.getElementById('btnAdd').style.display = 'none';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
