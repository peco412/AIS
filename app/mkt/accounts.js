import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('internal_accounts')
    .select('id, platform, account_name, username, note, managed_by, employees(full_name)')
    .order('platform');

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) =>
    !search || r.platform.toLowerCase().includes(search) || r.account_name.toLowerCase().includes(search));

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có tài khoản nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.platform)}</td>
      <td>${esc(r.account_name)}</td>
      <td class="cell-code">${esc(r.username || '—')}</td>
      <td class="cell-muted">${esc(r.employees?.full_name || '—')}</td>
      <td>
        <span class="cell-code" id="secret-${r.id}">••••••••</span>
        <button class="btn btn-outline btn-sm" data-reveal="${r.id}">Hiện</button>
      </td>
      <td><button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
  tbody.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => reveal(b.dataset.reveal, b)));
}

async function reveal(id, btn) {
  btn.disabled = true;
  const { data, error } = await supabase.rpc('reveal_internal_account_secret', { p_account_id: id });
  btn.disabled = false;
  if (error) { alert('Không thể xem mật khẩu: ' + error.message); return; }
  document.getElementById(`secret-${id}`).textContent = data || '(chưa đặt mật khẩu)';
  btn.textContent = 'Ẩn';
  btn.onclick = () => { document.getElementById(`secret-${id}`).textContent = '••••••••'; render(); };
}

document.getElementById('searchInput').addEventListener('input', render);

const modal = document.getElementById('acctModal');
const form = document.getElementById('acctForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('acctId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm tài khoản nội bộ';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa tài khoản nội bộ';
  document.getElementById('acctId').value = row.id;
  document.getElementById('platform').value = row.platform;
  document.getElementById('accountName').value = row.account_name;
  document.getElementById('username').value = row.username || '';
  document.getElementById('secret').value = '';
  document.getElementById('note').value = row.note || '';
  formError.classList.remove('show');
  modal.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('acctId').value;
  const secret = document.getElementById('secret').value;
  const payload = {
    platform: document.getElementById('platform').value.trim(),
    account_name: document.getElementById('accountName').value.trim(),
    username: document.getElementById('username').value || null,
    note: document.getElementById('note').value || null,
    managed_by: PROFILE.id,
  };

  const btn = document.getElementById('submitAcct');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    let accountId = id;
    if (id) {
      const { error } = await supabase.from('internal_accounts').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('internal_accounts').insert(payload).select('id').single();
      if (error) throw error;
      accountId = data.id;
    }
    if (secret) {
      const { error: secErr } = await supabase.rpc('set_internal_account_secret', { p_account_id: accountId, p_secret: secret });
      if (secErr) throw secErr;
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
    PROFILE = profile;
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
