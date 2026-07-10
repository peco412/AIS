import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const ROOT_CODES = new Set(['BOARD_OUTSIDE', 'CAT_A', 'CAT_B', 'CAT_C', 'CAT_D']);
let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase.from('expense_categories').select('*').order('display_order');
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = ALL_ROWS.map((r) => `
    <tr>
      <td class="cell-code mono">${esc(r.code)}</td>
      <td>${esc(r.name)}</td>
      <td>${ROOT_CODES.has(r.code) ? '<span class="badge badge-active">Mục gốc</span>' : '<span class="badge badge-submitted">Phụ mục</span>'}</td>
      <td>${!ROOT_CODES.has(r.code) ? `<button class="btn btn-outline btn-sm" data-delete="${r.id}">Xoá</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Xoá phụ mục này? Các phiếu mua hàng đã dùng phụ mục này vẫn giữ nguyên dữ liệu cũ.')) return;
    const { error } = await supabase.from('expense_categories').delete().eq('id', btn.dataset.delete);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));
}

const modal = document.getElementById('createModal');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('catCode').value = '';
  document.getElementById('catName').value = '';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitBtn').addEventListener('click', async () => {
  formError.classList.remove('show');
  const code = document.getElementById('catCode').value.trim().toUpperCase().replace(/\s+/g, '_');
  const name = document.getElementById('catName').value.trim();
  if (!code || !name) { formError.textContent = 'Vui lòng nhập đầy đủ mã và tên.'; formError.classList.add('show'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('expense_categories').insert({
    code, name, is_custom: true, display_order: 100 + ALL_ROWS.length,
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
    if (profile.roleCode !== 'TECH') document.getElementById('btnAdd').style.display = 'none';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
