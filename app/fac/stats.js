import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const CONDITION_LABEL = { good: 'Tốt', needs_repair: 'Cần sửa chữa', broken: 'Hỏng', disposed: 'Đã thanh lý' };
let PROFILE = null;
let ALL_ROWS = [];

async function loadLookups() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  document.getElementById('assetCenter').innerHTML = '<option value="">— Chọn trung tâm —</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('facility_assets')
    .select('id, asset_name, category, quantity, condition, purchased_date, note, center_id, centers(name)')
    .order('updated_at', { ascending: false });

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  renderStats();
  render();
}

function renderStats() {
  const totalAssets = ALL_ROWS.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const needsRepair = ALL_ROWS.filter((r) => r.condition === 'needs_repair').reduce((s, r) => s + r.quantity, 0);
  const broken = ALL_ROWS.filter((r) => r.condition === 'broken').reduce((s, r) => s + r.quantity, 0);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng số lượng tài sản</div><div class="value mono">${totalAssets}</div></div>
    <div class="stat-card"><div class="label">Cần sửa chữa</div><div class="value mono" style="color:var(--warning);">${needsRepair}</div></div>
    <div class="stat-card"><div class="label">Hỏng</div><div class="value mono" style="color:var(--danger);">${broken}</div></div>
    <div class="stat-card"><div class="label">Số dòng tài sản</div><div class="value mono">${ALL_ROWS.length}</div></div>
  `;
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const center = document.getElementById('filterCenter').value;
  const condition = document.getElementById('filterCondition').value;
  const rows = ALL_ROWS.filter((r) =>
    (!search || r.asset_name.toLowerCase().includes(search)) &&
    (!center || r.center_id === center) &&
    (!condition || r.condition === condition)
  );
  document.getElementById('resultCount').textContent = `${rows.length} tài sản`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có tài sản nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.asset_name)}</td>
      <td class="cell-muted">${esc(r.category || '—')}</td>
      <td class="cell-muted">${esc(r.centers?.name || '—')}</td>
      <td class="cell-code">${r.quantity}</td>
      <td><span class="badge badge-${r.condition === 'good' ? 'active' : r.condition === 'disposed' ? 'archived' : 'rejected'}">${CONDITION_LABEL[r.condition] || r.condition}</span></td>
      <td><button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
}

['filterCenter', 'filterCondition'].forEach((id) => document.getElementById(id).addEventListener('change', render));
document.getElementById('searchInput').addEventListener('input', render);

const modal = document.getElementById('assetModal');
const form = document.getElementById('assetForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('assetId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm tài sản';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa tài sản';
  document.getElementById('assetId').value = row.id;
  document.getElementById('assetName').value = row.asset_name;
  document.getElementById('category').value = row.category || '';
  document.getElementById('quantity').value = row.quantity;
  document.getElementById('assetCenter').value = row.center_id;
  document.getElementById('condition').value = row.condition || 'good';
  document.getElementById('purchasedDate').value = row.purchased_date || '';
  document.getElementById('note').value = row.note || '';
  formError.classList.remove('show');
  modal.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('assetId').value;
  const payload = {
    asset_name: document.getElementById('assetName').value.trim(),
    category: document.getElementById('category').value || null,
    quantity: Number(document.getElementById('quantity').value),
    center_id: document.getElementById('assetCenter').value,
    condition: document.getElementById('condition').value,
    purchased_date: document.getElementById('purchasedDate').value || null,
    note: document.getElementById('note').value || null,
  };
  const btn = document.getElementById('submitAsset');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('facility_assets').update(payload).eq('id', id)
      : await supabase.from('facility_assets').insert(payload);
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
    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
