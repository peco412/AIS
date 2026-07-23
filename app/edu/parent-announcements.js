import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let EDIT_ID = null;

function fmtDateTime(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('annCenter').innerHTML = '<option value="">— Toàn hệ thống —</option>' + (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('parent_announcements').select('id, title, content, center_id, is_active, created_at, centers(name)').order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có thông báo nào.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td><strong>${esc(r.title)}</strong><div class="cell-muted" style="font-size:11px;">${esc((r.content || '').slice(0, 80))}${r.content.length > 80 ? '…' : ''}</div></td>
      <td class="cell-muted">${r.center_id ? esc(r.centers?.name || '—') : 'Toàn hệ thống'}</td>
      <td class="cell-muted" style="font-size:12px;">${fmtDateTime(r.created_at)}</td>
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
    await supabase.from('parent_announcements').update({ is_active: btn.dataset.status !== 'true' }).eq('id', btn.dataset.toggle);
    await loadRows();
  }));
  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Xoá thông báo này? Không thể hoàn tác.')) return;
    await supabase.from('parent_announcements').delete().eq('id', btn.dataset.delete);
    await loadRows();
  }));
}

const modal = document.getElementById('announcementModal');
const formError = document.getElementById('formError');

function openModal(row) {
  EDIT_ID = row?.id || null;
  formError.classList.remove('show');
  document.getElementById('modalTitle').textContent = row ? 'Sửa thông báo' : 'Đăng thông báo';
  document.getElementById('annTitle').value = row?.title || '';
  document.getElementById('annContent').value = row?.content || '';
  document.getElementById('annCenter').value = row?.center_id || '';
  modal.classList.add('show');
}
document.getElementById('btnAdd').addEventListener('click', () => openModal(null));
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('btnSubmit').addEventListener('click', async () => {
  formError.classList.remove('show');
  const title = document.getElementById('annTitle').value.trim();
  const content = document.getElementById('annContent').value.trim();
  const centerId = document.getElementById('annCenter').value || null;
  if (!title || !content) { formError.textContent = 'Vui lòng nhập đủ tiêu đề và nội dung.'; formError.classList.add('show'); return; }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const payload = { title, content, center_id: centerId };
    const { error } = EDIT_ID
      ? await supabase.from('parent_announcements').update(payload).eq('id', EDIT_ID)
      : await supabase.from('parent_announcements').insert(payload);
    if (error) throw error;
    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Đăng thông báo';
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
