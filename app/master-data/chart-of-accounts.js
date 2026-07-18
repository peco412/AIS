import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const TYPE_LABEL = {
  asset: 'Tài sản', liability: 'Nợ phải trả', equity: 'Vốn chủ sở hữu', revenue: 'Doanh thu', expense: 'Chi phí',
};
const TYPE_BADGE = {
  asset: 'active', liability: 'partial', equity: 'partial', revenue: 'paid', expense: 'unpaid',
};

let PROFILE = null;
let ALL_ROWS = [];
let CAN_EDIT = false;

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('chart_of_accounts').select('*').order('code');
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const typeFilter = document.getElementById('filterType').value;
  const rows = ALL_ROWS.filter((r) => !typeFilter || r.account_type === typeFilter);
  document.getElementById('resultCount').textContent = `${rows.length} tài khoản`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Không có tài khoản phù hợp.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="mono"><strong>${esc(r.code)}</strong></td>
      <td>${esc(r.name)}</td>
      <td><span class="badge badge-${TYPE_BADGE[r.account_type]}">${TYPE_LABEL[r.account_type] || r.account_type}</span></td>
      <td>${r.is_active ? '<span class="badge badge-active">Đang dùng</span>' : '<span class="badge badge-unpaid">Ngừng dùng</span>'}</td>
      <td>${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-toggle="${esc(r.code)}" data-active="${r.is_active}">${r.is_active ? 'Ngừng dùng' : 'Bật lại'}</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
    const code = btn.dataset.toggle;
    const nextActive = btn.dataset.active !== 'true';
    if (!nextActive && !confirm(`Ngừng dùng tài khoản ${code}? Các bút toán cũ vẫn giữ nguyên, chỉ không cho chọn tài khoản này cho giao dịch mới.`)) return;
    const { error } = await supabase.from('chart_of_accounts').update({ is_active: nextActive }).eq('code', code);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));
}

document.getElementById('filterType').addEventListener('change', render);

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('formError').classList.remove('show');
  document.getElementById('acctCode').value = '';
  document.getElementById('acctName').value = '';
  document.getElementById('acctType').value = 'asset';
  document.getElementById('createModal').classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => document.getElementById('createModal').classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => document.getElementById('createModal').classList.remove('show'));

document.getElementById('submitBtn').addEventListener('click', async () => {
  const formError = document.getElementById('formError');
  formError.classList.remove('show');
  const code = document.getElementById('acctCode').value.trim();
  const name = document.getElementById('acctName').value.trim();
  const account_type = document.getElementById('acctType').value;
  if (!code || !name) {
    formError.textContent = 'Vui lòng nhập đủ Mã và Tên tài khoản.';
    formError.classList.add('show');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('chart_of_accounts').insert({ code, name, account_type });
  btn.disabled = false; btn.textContent = 'Thêm';

  if (error) {
    formError.textContent = error.code === '23505' ? `Mã tài khoản "${code}" đã tồn tại rồi.` : error.message;
    formError.classList.add('show');
    return;
  }
  document.getElementById('createModal').classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_EDIT = profile.roleCode === 'TECH' || profile.roleCode === 'EXECUTIVE';
    if (CAN_EDIT) document.getElementById('btnAdd').style.display = 'inline-flex';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
