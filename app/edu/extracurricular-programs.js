import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let EDIT_ID = null;

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('progCenter').innerHTML = '<option value="">— Toàn hệ thống —</option>' + (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('extracurricular_programs').select('id, name, description, google_form_url, center_id, is_active, centers(name)').order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có chương trình ngoại khoá nào.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td><strong>${esc(r.name)}</strong>${r.description ? `<div class="cell-muted" style="font-size:11px;">${esc(r.description.slice(0, 80))}${r.description.length > 80 ? '…' : ''}</div>` : ''}</td>
      <td class="cell-muted">${r.center_id ? esc(r.centers?.name || '—') : 'Toàn hệ thống'}</td>
      <td><a href="${esc(r.google_form_url)}" target="_blank" class="cell-muted" style="font-size:12px;">Xem form ↗</a></td>
      <td><span class="badge badge-${r.is_active ? 'active' : 'inactive'}">${r.is_active ? 'Đang hiện' : 'Đã ẩn'}</span></td>
      <td>
        <button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>
        <button class="btn btn-outline btn-sm" data-toggle="${r.id}" data-status="${r.is_active}">${r.is_active ? 'Ẩn' : 'Hiện lại'}</button>
        <button class="btn btn-outline btn-sm" data-delete="${r.id}">Xoá</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openModal(data.find((r) => r.id === btn.dataset.edit))));
  tbody.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
    await supabase.from('extracurricular_programs').update({ is_active: btn.dataset.status !== 'true' }).eq('id', btn.dataset.toggle);
    await loadRows();
  }));
  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Xoá chương trình này? Không thể hoàn tác.')) return;
    await supabase.from('extracurricular_programs').delete().eq('id', btn.dataset.delete);
    await loadRows();
  }));
}

const modal = document.getElementById('programModal');
const formError = document.getElementById('formError');

function openModal(row) {
  EDIT_ID = row?.id || null;
  formError.classList.remove('show');
  document.getElementById('modalTitle').textContent = row ? 'Sửa chương trình ngoại khoá' : 'Thêm chương trình ngoại khoá';
  document.getElementById('progName').value = row?.name || '';
  document.getElementById('progDesc').value = row?.description || '';
  document.getElementById('progFormUrl').value = row?.google_form_url || '';
  document.getElementById('progCenter').value = row?.center_id || '';
  modal.classList.add('show');
}
document.getElementById('btnAdd').addEventListener('click', () => openModal(null));
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('btnSubmit').addEventListener('click', async () => {
  formError.classList.remove('show');
  const name = document.getElementById('progName').value.trim();
  const description = document.getElementById('progDesc').value.trim();
  const formUrl = document.getElementById('progFormUrl').value.trim();
  const centerId = document.getElementById('progCenter').value || null;
  if (!name || !formUrl) { formError.textContent = 'Vui lòng nhập đủ tên chương trình và link Google Form.'; formError.classList.add('show'); return; }
  if (!/^https?:\/\//i.test(formUrl)) { formError.textContent = 'Link đăng ký phải bắt đầu bằng http:// hoặc https://'; formError.classList.add('show'); return; }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const payload = { name, description: description || null, google_form_url: formUrl, center_id: centerId };
    const { error } = EDIT_ID
      ? await supabase.from('extracurricular_programs').update(payload).eq('id', EDIT_ID)
      : await supabase.from('extracurricular_programs').insert(payload);
    if (error) throw error;
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
    PROFILE = profile;
    await loadCenters();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
