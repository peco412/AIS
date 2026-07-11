import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const ROOT_CODES = ['BOARD_OUTSIDE', 'CAT_A', 'CAT_B', 'CAT_C', 'CAT_D'];
let ALL_ROWS = [];
let CAN_EDIT = false;

async function loadRows() {
  const container = document.getElementById('categoryGroups');
  const { data, error } = await supabase.from('expense_categories').select('*').order('display_order');
  if (error) { container.innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const container = document.getElementById('categoryGroups');
  const roots = ALL_ROWS.filter((r) => ROOT_CODES.includes(r.code));

  container.innerHTML = roots.map((root) => {
    // Phu muc THUOC DUNG mục gốc nay - ap dung chung toan he thong,
    // khong tach rieng theo trung tam nao ca.
    const children = ALL_ROWS.filter((r) => r.parent_code === root.code);
    return `
      <div class="expense-group">
        <div class="expense-group__header">
          <span>${esc(root.name)}</span>
          <span class="cell-muted" style="font-weight:400; font-size:11.5px;">${children.length} phụ mục</span>
        </div>
        ${children.length === 0 ? '<div class="expense-group__empty">Chưa có phụ mục nào trong nhóm này.</div>' : children.map((c) => `
          <div class="expense-group__sub">
            <span>↳ <strong>${esc(c.name)}</strong> <span class="cell-muted mono" style="font-size:11px;">(${esc(c.code)})</span></span>
            ${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-delete="${c.id}">Xoá</button>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Xoá phụ mục này? Các phiếu mua hàng đã dùng phụ mục này vẫn giữ nguyên dữ liệu cũ.')) return;
    const { error } = await supabase.from('expense_categories').delete().eq('id', btn.dataset.delete);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));
}

const modal = document.getElementById('createModal');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  const rootSel = document.getElementById('catParent');
  rootSel.innerHTML = ALL_ROWS.filter((r) => ROOT_CODES.includes(r.code)).map((r) => `<option value="${esc(r.code)}">${esc(r.name)}</option>`).join('');
  document.getElementById('catCode').value = '';
  document.getElementById('catName').value = '';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitBtn').addEventListener('click', async () => {
  formError.classList.remove('show');
  const parentCode = document.getElementById('catParent').value;
  const code = document.getElementById('catCode').value.trim().toUpperCase().replace(/\s+/g, '_');
  const name = document.getElementById('catName').value.trim();
  if (!parentCode || !code || !name) { formError.textContent = 'Vui lòng nhập đầy đủ.'; formError.classList.add('show'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('expense_categories').insert({
    code, name, parent_code: parentCode, is_custom: true, display_order: 100 + ALL_ROWS.length,
  });
  btn.disabled = false; btn.textContent = 'Thêm';
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }

  modal.classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    if (profile.roleCode !== 'TECH' && profile.roleCode !== 'EXECUTIVE') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kỹ thuật (ghi) và Ban điều hành (xem) mới dùng được trang này.</div>';
      return;
    }
    CAN_EDIT = profile.roleCode === 'TECH';
    if (!CAN_EDIT) document.getElementById('btnAdd').style.display = 'none';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
