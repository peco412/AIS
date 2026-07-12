import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let CAN_EDIT = false;
let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('wallet_tier_discounts').select('*, employees(full_name)').order('min_amount');
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = ALL_ROWS.length === 0
    ? '<tr><td colspan="4" class="empty-cell">Chưa có bậc chiết khấu nào — mọi lượt nạp sẽ không có chiết khấu.</td></tr>'
    : ALL_ROWS.map((r) => `
      <tr>
        <td class="mono">${Number(r.min_amount).toLocaleString('vi-VN')} đ trở lên</td>
        <td class="mono" style="font-weight:700; color:var(--accent-deep);">${(r.discount_rate * 100).toFixed(1)}%</td>
        <td class="cell-muted" style="font-size:12px;">${r.updated_at ? new Date(r.updated_at).toLocaleString('vi-VN') : '—'}${r.employees?.full_name ? ` — ${esc(r.employees.full_name)}` : ''}</td>
        <td>
          ${CAN_EDIT ? `
            <button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>
            <button class="btn btn-outline btn-sm" data-delete="${r.id}">Xoá</button>
          ` : ''}
        </td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openEdit(btn.dataset.edit)));
  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Xoá bậc chiết khấu này? Các lượt nạp CŨ đã áp dụng bậc này vẫn giữ nguyên (không hồi tố), chỉ ảnh hưởng lượt nạp MỚI sau này.')) return;
    const { error } = await supabase.from('wallet_tier_discounts').delete().eq('id', btn.dataset.delete);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));
}

const modal = document.getElementById('createModal');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('modalTitle').textContent = 'Thêm bậc chiết khấu';
  document.getElementById('tierId').value = '';
  document.getElementById('minAmount').value = '';
  document.getElementById('discountRate').value = '';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa bậc chiết khấu';
  document.getElementById('tierId').value = row.id;
  document.getElementById('minAmount').value = row.min_amount;
  document.getElementById('discountRate').value = (row.discount_rate * 100).toFixed(1);
  formError.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('submitBtn').addEventListener('click', async () => {
  formError.classList.remove('show');
  const id = document.getElementById('tierId').value;
  const minAmount = Number(document.getElementById('minAmount').value);
  const rate = Number(document.getElementById('discountRate').value) / 100;
  if (!minAmount || rate < 0 || rate > 1) { formError.textContent = 'Vui lòng nhập đầy đủ và đúng giá trị.'; formError.classList.add('show'); return; }

  const payload = { min_amount: minAmount, discount_rate: rate, updated_by: PROFILE.id, updated_at: new Date().toISOString() };
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = id
    ? await supabase.from('wallet_tier_discounts').update(payload).eq('id', id)
    : await supabase.from('wallet_tier_discounts').insert(payload);
  btn.disabled = false; btn.textContent = 'Lưu';
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }

  modal.classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    if (profile.roleCode !== 'TECH' && profile.roleCode !== 'EXECUTIVE' && profile.departmentCode !== 'ACC') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kỹ thuật/Kế toán (ghi) và Ban điều hành (xem) mới dùng được trang này.</div>';
      return;
    }
    CAN_EDIT = profile.roleCode === 'TECH' || profile.departmentCode === 'ACC';
    if (!CAN_EDIT) document.getElementById('btnAdd').style.display = 'none';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
