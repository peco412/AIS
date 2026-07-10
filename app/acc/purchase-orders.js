import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

let PROFILE = null;
let IS_ACC = false;
let IS_EXEC = false;
let ALL_ROWS = [];
let SUPPLIERS = [];
let DIRECT_MANAGER_MAP = {};
let poItemCounter = 0;

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.' + code, code) });
const STATUS_BADGE = { draft: 'draft', approved_1: 'submitted', approved_2: 'approved_1', approved_3: 'active', rejected: 'rejected' };

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') + ' đ'; }

async function loadLookups() {
  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');
  SUPPLIERS = suppliers || [];
  document.getElementById('supplierSelect').innerHTML = SUPPLIERS.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

  const { data: categories } = await supabase.from('expense_categories').select('id, name').order('display_order');
  document.getElementById('expenseCategory').innerHTML = (categories || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;

  let query = supabase
    .from('purchase_orders')
    .select('id, code, total_amount, status, requester_id, suppliers(name), expense_categories(name), employees!purchase_orders_requester_id_fkey(full_name, department_id, center_id)')
    .order('created_at', { ascending: false });
  if (scope === 'mine') query = query.eq('requester_id', PROFILE.id);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];

  DIRECT_MANAGER_MAP = {};
  (data || []).forEach((r) => {
    const emp = r.employees;
    if (!emp) return;
    DIRECT_MANAGER_MAP[r.requester_id] = emp.department_id
      ? (emp.department_id === PROFILE.departmentId && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode))
      : (emp.center_id === PROFILE.centerId && PROFILE.roleCode === 'CENTER_MANAGER');
  });

  render();
}

function actionFor(row) {
  if (row.status === 'draft' && DIRECT_MANAGER_MAP[row.requester_id]) return { label: 'Quản lý trực tiếp duyệt', next: 'approved_1', field: 'manager' };
  if (row.status === 'approved_1' && (IS_ACC || IS_EXEC)) return { label: 'Kế toán duyệt', next: 'approved_2', field: 'accountant' };
  if (row.status === 'approved_2' && IS_EXEC) return { label: 'Ban điều hành ký', next: 'approved_3', field: 'executive' };
  return null;
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} phiếu`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có phiếu nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => {
    const action = actionFor(r);
    return `
    <tr>
      <td class="cell-code">${esc(r.code || '—')}</td>
      <td>${esc(r.suppliers?.name || '—')}</td>
      <td class="cell-muted">${esc(r.employees?.full_name || '—')}</td>
      <td class="cell-muted">${esc(r.expense_categories?.name || '—')}</td>
      <td class="mono">${fmtMoney(r.total_amount)}</td>
      <td><span class="badge badge-${STATUS_BADGE[r.status]}">${esc(STATUS_LABEL[r.status])}</span></td>
      <td>
        ${action ? `
          <button class="btn btn-accent btn-sm" data-approve="${r.id}" data-next="${action.next}" data-field="${action.field}">${action.label}</button>
          <button class="btn btn-outline btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
      </td>
    </tr>
  `;
  }).join('');

  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.approve, b.dataset.next, b.dataset.field)));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.reject, 'rejected', null)));
}

async function decide(id, status, field) {
  if (!confirm(status === 'rejected' ? 'Từ chối phiếu này?' : 'Xác nhận duyệt phiếu này?')) return;
  const payload = { status };
  if (field === 'manager') { payload.manager_signed_by = PROFILE.id; payload.manager_signed_at = new Date().toISOString(); }
  if (field === 'accountant') { payload.accountant_signed_by = PROFILE.id; payload.accountant_signed_at = new Date().toISOString(); }
  if (field === 'executive') { payload.executive_signed_by = PROFILE.id; payload.executive_signed_at = new Date().toISOString(); }

  const { error } = await supabase.from('purchase_orders').update(payload).eq('id', id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadRows();
}

document.getElementById('viewScope').addEventListener('change', loadRows);

// ---------------------------------------------------------------------
// Tạo phiếu mua hàng mới
// ---------------------------------------------------------------------
const createModal = document.getElementById('createModal');

function addPoItemRow() {
  const id = `po-item-${poItemCounter++}`;
  const wrap = document.createElement('div');
  wrap.className = 'field-grid-2';
  wrap.style.cssText = 'border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:8px;';
  wrap.dataset.rowId = id;
  wrap.innerHTML = `
    <div class="field" style="grid-column: span 2;"><input type="text" class="po-item-desc" placeholder="Mô tả hàng hoá/dịch vụ" /></div>
    <div class="field"><input type="number" class="po-item-qty" placeholder="Số lượng" min="0.01" step="0.01" value="1" /></div>
    <div class="field"><input type="number" class="po-item-price" placeholder="Đơn giá" min="0" /></div>
    <div class="field"><button type="button" class="btn btn-outline btn-sm po-item-remove">Xoá dòng</button></div>
  `;
  document.getElementById('poItemsList').appendChild(wrap);
  wrap.querySelectorAll('input').forEach((el) => el.addEventListener('input', updatePoTotal));
  wrap.querySelector('.po-item-remove').addEventListener('click', () => { wrap.remove(); updatePoTotal(); });
  updatePoTotal();
}

function updatePoTotal() {
  let total = 0;
  document.querySelectorAll('#poItemsList > div').forEach((row) => {
    const qty = Number(row.querySelector('.po-item-qty').value) || 0;
    const price = Number(row.querySelector('.po-item-price').value) || 0;
    total += qty * price;
  });
  document.getElementById('poTotalPreview').textContent = fmtMoney(total);
}

document.getElementById('btnAddPoItem').addEventListener('click', addPoItemRow);

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('createError').classList.remove('show');
  document.getElementById('purchaseDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('poNote').value = '';
  document.getElementById('poItemsList').innerHTML = '';
  addPoItemRow();
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreateModal').addEventListener('click', () => createModal.classList.remove('show'));

document.getElementById('btnSubmitPo').addEventListener('click', async () => {
  const errBox = document.getElementById('createError');
  errBox.classList.remove('show');

  const rows = Array.from(document.querySelectorAll('#poItemsList > div'));
  if (rows.length === 0) { errBox.textContent = 'Vui lòng thêm ít nhất 1 dòng hàng hoá.'; errBox.classList.add('show'); return; }

  const btn = document.getElementById('btnSubmitPo');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { data: po, error: poErr } = await supabase.from('purchase_orders').insert({
      supplier_id: document.getElementById('supplierSelect').value,
      expense_category_id: document.getElementById('expenseCategory').value,
      purchase_date: document.getElementById('purchaseDate').value,
      note: document.getElementById('poNote').value || null,
      requester_id: PROFILE.id,
      department_id: PROFILE.departmentId,
      center_id: PROFILE.centerId,
      status: 'draft',
    }).select('id').single();
    if (poErr) throw poErr;

    const itemPayloads = rows.map((row) => ({
      order_id: po.id,
      description: row.querySelector('.po-item-desc').value.trim() || 'Hàng hoá/dịch vụ',
      quantity: Number(row.querySelector('.po-item-qty').value) || 1,
      unit_price: Number(row.querySelector('.po-item-price').value) || 0,
    }));
    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(itemPayloads);
    if (itemsErr) throw itemsErr;

    createModal.classList.remove('show');
    await loadRows();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo phiếu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentId: emp?.department_id, centerId: emp?.center_id, departmentCode: emp?.departments?.code };
    IS_ACC = PROFILE.departmentCode === 'ACC' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode);
    IS_EXEC = ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (IS_ACC || IS_EXEC || ['DEPT_HEAD', 'DEPT_DEPUTY', 'CENTER_MANAGER'].includes(profile.roleCode)) {
      document.getElementById('allScopeOption').style.display = 'block';
    }

    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
