import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('size_charts').select('*').order('display_order');
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function rangeText(min, max, unit) {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min} – ${max} ${unit}`;
  if (min != null) return `từ ${min} ${unit}`;
  return `đến ${max} ${unit}`;
}

function render() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = ALL_ROWS.length === 0
    ? '<tr><td colspan="4" class="empty-cell">Chưa có size nào — hệ thống sẽ không gợi ý được gì cả.</td></tr>'
    : ALL_ROWS.map((r) => `
      <tr>
        <td><strong>${esc(r.size_label)}</strong></td>
        <td class="cell-muted">${rangeText(r.min_height_cm, r.max_height_cm, 'cm')}</td>
        <td class="cell-muted">${rangeText(r.min_weight_kg, r.max_weight_kg, 'kg')}</td>
        <td>
          <button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>
          <button class="btn btn-outline btn-sm" data-delete="${r.id}">Xoá</button>
        </td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
  tbody.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Xoá size này? Sẽ không còn gợi ý được cho khoảng chiều cao/cân nặng tương ứng nữa.')) return;
    const { error } = await supabase.from('size_charts').delete().eq('id', b.dataset.delete);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));
}

const modal = document.getElementById('editModal');
const errBox = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('modalTitle').textContent = 'Thêm size';
  document.getElementById('sizeId').value = '';
  ['sizeLabel', 'minHeight', 'maxHeight', 'minWeight', 'maxWeight'].forEach((id) => { document.getElementById(id).value = ''; });
  errBox.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeEditModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelEditModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa size';
  document.getElementById('sizeId').value = row.id;
  document.getElementById('sizeLabel').value = row.size_label;
  document.getElementById('minHeight').value = row.min_height_cm ?? '';
  document.getElementById('maxHeight').value = row.max_height_cm ?? '';
  document.getElementById('minWeight').value = row.min_weight_kg ?? '';
  document.getElementById('maxWeight').value = row.max_weight_kg ?? '';
  errBox.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('submitEdit').addEventListener('click', async () => {
  errBox.classList.remove('show');
  const id = document.getElementById('sizeId').value;
  const label = document.getElementById('sizeLabel').value.trim();
  if (!label) { errBox.textContent = 'Vui lòng nhập tên size.'; errBox.classList.add('show'); return; }

  const payload = {
    size_label: label,
    min_height_cm: document.getElementById('minHeight').value || null,
    max_height_cm: document.getElementById('maxHeight').value || null,
    min_weight_kg: document.getElementById('minWeight').value || null,
    max_weight_kg: document.getElementById('maxWeight').value || null,
    updated_by: PROFILE.id, updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from('size_charts').update(payload).eq('id', id)
    : await supabase.from('size_charts').insert({ ...payload, display_order: ALL_ROWS.length });
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  modal.classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
