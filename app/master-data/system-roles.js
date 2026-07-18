import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('system_roles').select('*').order('code');
  if (error) { tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">Chưa có vai trò nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => `
    <tr data-id="${r.id}">
      <td class="mono"><strong>${esc(r.code)}</strong></td>
      <td><input type="text" class="text-input name-input" data-id="${r.id}" data-original="${esc(r.name)}" value="${esc(r.name)}" style="max-width:320px;" /></td>
      <td><button class="btn btn-outline btn-sm" data-save="${r.id}" style="display:none;">Lưu tên</button></td>
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
    if (!newName) { alert('Tên vai trò không được để trống.'); return; }
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    const { error } = await supabase.from('system_roles').update({ name: newName }).eq('id', btn.dataset.save);
    btn.disabled = false; btn.textContent = 'Lưu tên';
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));
}

(async () => {
  try {
    await bootShell();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
