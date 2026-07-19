import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('departments').select('*').order('code');
  if (error) { tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">Chưa có phòng ban nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => `
    <tr data-id="${r.id}">
      <td class="mono"><strong>${esc(r.code)}</strong></td>
      <td><input type="text" class="text-input name-input" data-id="${r.id}" data-original="${esc(r.name)}" value="${esc(r.name)}" style="max-width:320px;" /></td>
      <td style="display:flex; gap:6px;">
        <button class="btn btn-outline btn-sm" data-save="${r.id}" style="display:none;">Lưu tên</button>
        <button class="btn btn-outline btn-sm" data-delete="${r.id}" data-code="${esc(r.code)}" title="Chỉ xoá được nếu chưa có nhân viên/dữ liệu nào gắn với phòng ban này"><svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg></button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.name-input').forEach((input) => {
    input.addEventListener('input', () => {
      const btn = tbody.querySelector(`[data-save="${input.dataset.id}"]`);
      btn.style.display = input.value.trim() !== input.dataset.original ? 'inline-flex' : 'none';
    });
  });

  tbody.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
    const input = tbody.querySelector(`.name-input[data-id="${btn.dataset.save}"]`);
    const newName = input.value.trim();
    if (!newName) { alert('Tên phòng ban không được để trống.'); return; }
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    const { error } = await supabase.from('departments').update({ name: newName }).eq('id', btn.dataset.save);
    btn.disabled = false; btn.textContent = 'Lưu tên';
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));

  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`Xoá phòng ban "${btn.dataset.code}"? Chỉ xoá được nếu KHÔNG còn nhân viên/menu/dữ liệu nào gắn với phòng ban này — nếu còn, hệ thống sẽ báo lỗi và không xoá.`)) return;
    const { error } = await supabase.from('departments').delete().eq('id', btn.dataset.delete);
    if (error) { alert('Không xoá được — phòng ban này vẫn còn dữ liệu gắn với nó:\n' + error.message); return; }
    await loadRows();
  }));
}

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('formError').classList.remove('show');
  document.getElementById('deptCode').value = '';
  document.getElementById('deptName').value = '';
  document.getElementById('createModal').classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => document.getElementById('createModal').classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => document.getElementById('createModal').classList.remove('show'));

document.getElementById('submitBtn').addEventListener('click', async () => {
  const formError = document.getElementById('formError');
  formError.classList.remove('show');
  const code = document.getElementById('deptCode').value.trim().toUpperCase();
  const name = document.getElementById('deptName').value.trim();
  if (!code || !name) {
    formError.textContent = 'Vui lòng nhập đủ Mã và Tên phòng ban.';
    formError.classList.add('show');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('departments').insert({ code, name });
  btn.disabled = false; btn.textContent = 'Thêm';

  if (error) {
    formError.textContent = error.code === '23505' ? `Mã phòng ban "${code}" đã tồn tại rồi.` : error.message;
    formError.classList.add('show');
    return;
  }
  document.getElementById('createModal').classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    await bootShell();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
