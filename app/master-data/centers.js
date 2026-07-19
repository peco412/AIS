import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

async function loadDivisions() {
  const { data } = await supabase.from('divisions').select('id, name, code').order('name');
  document.getElementById('centerDivision').innerHTML = (data || []).map((d) => `<option value="${d.id}">${esc(d.name)} (${esc(d.code)})</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase.from('centers').select('*, divisions(name, code)').order('name');
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = ALL_ROWS.length === 0
    ? '<tr><td colspan="6" class="empty-cell">Chưa có trung tâm nào.</td></tr>'
    : ALL_ROWS.map((r) => `
      <tr>
        <td class="cell-code">${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        <td class="cell-muted">${esc(r.divisions?.name || '—')}</td>
        <td class="cell-muted">${esc(r.address || '—')}</td>
        <td><span class="badge badge-${r.is_active ? 'active' : 'archived'}">${r.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}</span></td>
        <td style="display:flex; gap:6px;">
          <button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>
          <button class="btn btn-outline btn-sm" data-delete="${r.id}" data-name="${esc(r.name)}" title="Chỉ xoá được nếu chưa có học sinh/nhân viên/lớp nào gắn với trung tâm này"><svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg></button>
        </td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openEdit(btn.dataset.edit)));
  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`Xoá trung tâm "${btn.dataset.name}"? Chỉ xoá được nếu KHÔNG còn học sinh/nhân viên/lớp học nào gắn với trung tâm này — nếu tạo nhầm và chưa dùng gì thì xoá được ngay, còn nếu đã có dữ liệu thì nên "Ngừng hoạt động" thay vì xoá.`)) return;
    const { error } = await supabase.from('centers').delete().eq('id', btn.dataset.delete);
    if (error) { alert('Không xoá được — trung tâm này vẫn còn dữ liệu gắn với nó, dùng "Ngừng hoạt động" thay vì xoá:\n' + error.message); return; }
    await loadRows();
  }));
}

const modal = document.getElementById('createModal');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('modalTitle').textContent = 'Thêm trung tâm';
  document.getElementById('centerId').value = '';
  document.getElementById('centerCode').value = '';
  document.getElementById('centerName').value = '';
  document.getElementById('centerAddress').value = '';
  document.getElementById('centerActive').checked = true;
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa trung tâm';
  document.getElementById('centerId').value = row.id;
  document.getElementById('centerCode').value = row.code;
  document.getElementById('centerName').value = row.name;
  document.getElementById('centerDivision').value = row.division_id;
  document.getElementById('centerAddress').value = row.address || '';
  document.getElementById('centerActive').checked = row.is_active;
  formError.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('submitBtn').addEventListener('click', async () => {
  formError.classList.remove('show');
  const id = document.getElementById('centerId').value;
  const payload = {
    code: document.getElementById('centerCode').value.trim().toUpperCase(),
    name: document.getElementById('centerName').value.trim(),
    division_id: document.getElementById('centerDivision').value,
    address: document.getElementById('centerAddress').value || null,
    is_active: document.getElementById('centerActive').checked,
  };
  if (!payload.code || !payload.name || !payload.division_id) {
    formError.textContent = 'Vui lòng nhập đầy đủ mã, tên và phân hệ.'; formError.classList.add('show'); return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('centers').update(payload).eq('id', id)
      : await supabase.from('centers').insert(payload);
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
    if (profile.roleCode !== 'TECH' && !['EXECUTIVE'].includes(profile.roleCode)) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kỹ thuật (ghi) và Ban điều hành (xem) mới dùng được trang này.</div>';
      return;
    }
    if (profile.roleCode !== 'TECH') document.getElementById('btnAdd').style.display = 'none';
    await loadDivisions();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
