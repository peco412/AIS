import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let WORKING_CENTER_ID = null;
let ITEMS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }
function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function initCenterPicker() {
  if (PROFILE.centerId) { WORKING_CENTER_ID = PROFILE.centerId; return; }
  const { data: centers } = await supabase.from('centers').select('id, name').order('name');
  const sel = document.getElementById('filterCenter');
  sel.style.display = '';
  sel.innerHTML = (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  WORKING_CENTER_ID = centers?.[0]?.id || null;
  sel.addEventListener('change', async () => {
    WORKING_CENTER_ID = sel.value;
    await Promise.all([loadStock(), loadTransactions()]);
  });
}

async function loadItems() {
  const { data } = await supabase.from('inventory_items').select('*').order('display_order');
  ITEMS = data || [];
  document.getElementById('txItem').innerHTML = ITEMS.map((it) => `<option value="${it.id}" data-has-size="${it.has_size}">${esc(it.name)} (${esc(it.code)})</option>`).join('');
}

async function loadWalletPurchases() {
  const tbody = document.getElementById('walletPurchaseBody');
  const { data, error } = await supabase
    .from('wallet_purchase_requests')
    .select('id, code, total_coin_amount, students(full_name), wallet_purchase_items(quantity, size, inventory_items(name))')
    .eq('center_id', WORKING_CENTER_ID).eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Không có đơn nào đang chờ.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td class="cell-code">${esc(r.code || '—')}</td>
      <td>${esc(r.students?.full_name || '—')}</td>
      <td class="cell-muted" style="font-size:12px;">${(r.wallet_purchase_items || []).map((it) => `${esc(it.inventory_items?.name)} ${it.size ? `(${esc(it.size)})` : ''} x${it.quantity}`).join(', ')}</td>
      <td class="mono">${fmtMoney(r.total_coin_amount)} coin</td>
      <td>
        <button class="btn btn-accent btn-sm" data-confirm-purchase="${r.id}">Xác nhận</button>
        <button class="btn btn-outline btn-sm" data-reject-purchase="${r.id}">Từ chối</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-confirm-purchase]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Xác nhận đã kiểm tra đủ hàng thực tế? Sẽ trừ ví + trừ kho ngay, không hoàn tác được.')) return;
    const { error: err } = await supabase.rpc('confirm_wallet_purchase', { p_request_id: b.dataset.confirmPurchase, p_confirmer_id: PROFILE.id });
    if (err) { alert('Lỗi: ' + err.message); return; }
    await Promise.all([loadWalletPurchases(), loadStock()]);
  }));
  tbody.querySelectorAll('[data-reject-purchase]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt('Lý do từ chối:');
    if (reason === null) return;
    const { error: err } = await supabase.rpc('reject_wallet_purchase', { p_request_id: b.dataset.rejectPurchase, p_confirmer_id: PROFILE.id, p_reason: reason });
    if (err) { alert('Lỗi: ' + err.message); return; }
    await loadWalletPurchases();
  }));
}

async function loadStock() {
  const tbody = document.getElementById('stockBody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tải...</td></tr>';

  const { data, error } = await supabase.from('inventory_stock_view').select('item_id, size, stock_quantity').eq('center_id', WORKING_CENTER_ID);
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  const itemMap = {}; ITEMS.forEach((it) => { itemMap[it.id] = it; });
  const rows = (data || []).filter((r) => r.stock_quantity !== 0).sort((a, b) => (itemMap[a.item_id]?.display_order || 0) - (itemMap[b.item_id]?.display_order || 0));

  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="4" class="empty-cell">Kho trống hoặc chưa có phiếu nào.</td></tr>'
    : rows.map((r) => {
      const item = itemMap[r.item_id];
      return `
        <tr>
          <td class="cell-code">${esc(item?.code || '—')}</td>
          <td>${esc(item?.name || '—')}</td>
          <td class="cell-muted">${esc(r.size || '—')}</td>
          <td class="mono" style="text-align:right; font-weight:700; color:${r.stock_quantity < 0 ? 'var(--danger)' : 'var(--ink)'};">${r.stock_quantity}</td>
        </tr>
      `;
    }).join('');
}

async function loadTransactions() {
  const tbody = document.getElementById('txBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Đang tải...</td></tr>';

  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('code, transaction_type, size, quantity, transaction_date, note, inventory_items(code, name), employees(full_name)')
    .eq('center_id', WORKING_CENTER_ID)
    .order('transaction_date', { ascending: false })
    .limit(100);

  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  document.getElementById('resultCount').textContent = `${(data || []).length} phiếu gần nhất`;

  tbody.innerHTML = (data || []).length === 0
    ? '<tr><td colspan="8" class="empty-cell">Chưa có phiếu nào.</td></tr>'
    : data.map((r) => `
      <tr>
        <td class="cell-code">${esc(r.code || '—')}</td>
        <td class="cell-muted">${fmtDate(r.transaction_date)}</td>
        <td><span class="badge badge-${r.transaction_type === 'in' ? 'active' : 'submitted'}">${r.transaction_type === 'in' ? 'Nhập' : 'Xuất'}</span></td>
        <td>${esc(r.inventory_items?.name || '—')}</td>
        <td class="cell-muted">${esc(r.size || '—')}</td>
        <td class="mono">${r.quantity}</td>
        <td class="cell-muted">${esc(r.employees?.full_name || '—')}</td>
        <td class="cell-muted">${esc(r.note || '—')}</td>
      </tr>
    `).join('');
}

// ---------------------------------------------------------------------
// Tạo phiếu nhập/xuất
// ---------------------------------------------------------------------
const txModal = document.getElementById('txModal');

function openTxModal(type) {
  document.getElementById('txFormError').classList.remove('show');
  document.getElementById('txType').value = type;
  document.getElementById('txModalTitle').textContent = type === 'in' ? 'Phiếu nhập kho' : 'Phiếu xuất kho';
  document.getElementById('txQuantity').value = '';
  document.getElementById('txDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('txNote').value = '';
  toggleSizeField();
  txModal.classList.add('show');
}
document.getElementById('btnStockIn').addEventListener('click', () => openTxModal('in'));
document.getElementById('btnStockOut').addEventListener('click', () => openTxModal('out'));
document.getElementById('closeTxModal').addEventListener('click', () => txModal.classList.remove('show'));
document.getElementById('cancelTxModal').addEventListener('click', () => txModal.classList.remove('show'));

// ---------------------------------------------------------------------
// Sản phẩm mới — tự do tạo thêm, không còn giới hạn 8 mặt hàng mặc định
// ---------------------------------------------------------------------
const productModal = document.getElementById('productModal');
document.getElementById('btnNewProduct').addEventListener('click', () => {
  document.getElementById('productFormError').classList.remove('show');
  document.getElementById('productName').value = '';
  document.getElementById('productUnit').value = '';
  document.getElementById('productPrice').value = '';
  document.getElementById('productHasSize').checked = false;
  productModal.classList.add('show');
});
document.getElementById('closeProductModal').addEventListener('click', () => productModal.classList.remove('show'));
document.getElementById('cancelProductModal').addEventListener('click', () => productModal.classList.remove('show'));

document.getElementById('btnSubmitProduct').addEventListener('click', async () => {
  const errBox = document.getElementById('productFormError');
  errBox.classList.remove('show');
  const name = document.getElementById('productName').value.trim();
  const unit = document.getElementById('productUnit').value.trim();
  const price = Number(document.getElementById('productPrice').value);
  if (!name || !unit || !price) { errBox.textContent = 'Vui lòng nhập đầy đủ.'; errBox.classList.add('show'); return; }

  const code = 'SP-' + Date.now().toString(36).toUpperCase();
  const { error } = await supabase.from('inventory_items').insert({
    code, name, unit, price_vnd: price,
    has_size: document.getElementById('productHasSize').checked,
    product_group: document.getElementById('productGroup').value,
    is_custom: true,
  });
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  productModal.classList.remove('show');
  await loadItems();
});

// ---------------------------------------------------------------------
// Phiếu bán lẻ tại quầy — nhiều dòng sản phẩm, tự trừ kho + hạch toán
// doanh thu ngay khi bấm "Hoàn thành".
// ---------------------------------------------------------------------
const retailModal = document.getElementById('retailModal');
let RETAIL_STUDENT = null;
let retailItemCounter = 0;

function addRetailItemRow() {
  const id = `retail-item-${retailItemCounter++}`;
  const wrap = document.createElement('div');
  wrap.className = 'field-grid-2';
  wrap.style.cssText = 'border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:8px;';
  wrap.dataset.rowId = id;
  wrap.innerHTML = `
    <div class="field" style="grid-column: span 2;">
      <select class="retail-item-select">${ITEMS.map((it) => `<option value="${it.id}" data-price="${it.price_vnd || 0}" data-has-size="${it.has_size}">${esc(it.name)} — ${fmtMoney(it.price_vnd || 0)} đ</option>`).join('')}</select>
    </div>
    <div class="field"><input type="text" class="retail-item-size" placeholder="Size (nếu có)" /></div>
    <div class="field"><input type="number" class="retail-item-qty" placeholder="Số lượng" min="1" value="1" /></div>
    <div class="field"><input type="number" class="retail-item-discount" placeholder="% Giảm" min="0" max="100" value="0" /></div>
    <div class="field"><button type="button" class="btn btn-outline btn-sm retail-item-remove">Xoá dòng</button></div>
  `;
  document.getElementById('retailItemsList').appendChild(wrap);
  wrap.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', updateRetailTotal));
  wrap.querySelector('.retail-item-remove').addEventListener('click', () => { wrap.remove(); updateRetailTotal(); });
  updateRetailTotal();
}

function updateRetailTotal() {
  let total = 0;
  document.querySelectorAll('#retailItemsList > div').forEach((row) => {
    const opt = row.querySelector('.retail-item-select').selectedOptions[0];
    const price = Number(opt?.dataset.price || 0);
    const qty = Number(row.querySelector('.retail-item-qty').value) || 0;
    const discount = Number(row.querySelector('.retail-item-discount').value) || 0;
    total += qty * price * (1 - discount / 100);
  });
  document.getElementById('retailTotalPreview').textContent = `${fmtMoney(total)} đ`;
}

document.getElementById('btnAddRetailItem').addEventListener('click', addRetailItemRow);

document.getElementById('btnRetailSale').addEventListener('click', () => {
  document.getElementById('retailFormError').classList.remove('show');
  document.getElementById('retailStudentSearch').value = '';
  document.getElementById('retailStudentResult').textContent = '';
  document.getElementById('retailCustomerName').value = '';
  document.getElementById('retailPhone').value = '';
  document.getElementById('retailReason').value = '';
  document.getElementById('retailItemsList').innerHTML = '';
  RETAIL_STUDENT = null;
  addRetailItemRow();
  retailModal.classList.add('show');
});
document.getElementById('closeRetailModal').addEventListener('click', () => retailModal.classList.remove('show'));
document.getElementById('cancelRetailModal').addEventListener('click', () => retailModal.classList.remove('show'));

let retailSearchTimer;
document.getElementById('retailStudentSearch').addEventListener('input', (e) => {
  clearTimeout(retailSearchTimer);
  const q = e.target.value.trim();
  retailSearchTimer = setTimeout(async () => {
    if (!q) { document.getElementById('retailStudentResult').textContent = ''; RETAIL_STUDENT = null; return; }
    const { data } = await supabase.from('students').select('id, full_name, parent_name, phone').eq('center_id', WORKING_CENTER_ID).ilike('full_name', `%${q}%`).limit(1);
    if (data && data.length > 0) {
      RETAIL_STUDENT = data[0];
      document.getElementById('retailStudentResult').innerHTML = `✅ <strong>${esc(data[0].full_name)}</strong> — tự điền PH/SĐT`;
      document.getElementById('retailCustomerName').value = data[0].full_name;
      document.getElementById('retailPhone').value = data[0].phone || '';
    } else {
      RETAIL_STUDENT = null;
      document.getElementById('retailStudentResult').textContent = 'Không tìm thấy — sẽ tính là khách vãng lai.';
    }
  }, 350);
});

document.getElementById('btnSubmitRetail').addEventListener('click', async () => {
  const errBox = document.getElementById('retailFormError');
  errBox.classList.remove('show');

  const rows = Array.from(document.querySelectorAll('#retailItemsList > div'));
  if (rows.length === 0) { errBox.textContent = 'Vui lòng thêm ít nhất 1 dòng sản phẩm.'; errBox.classList.add('show'); return; }
  const customerName = document.getElementById('retailCustomerName').value.trim();
  if (!customerName) { errBox.textContent = 'Vui lòng nhập tên khách hàng.'; errBox.classList.add('show'); return; }

  const btn = document.getElementById('btnSubmitRetail');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { data: sale, error: saleErr } = await supabase.from('retail_sales').insert({
      student_id: RETAIL_STUDENT?.id || null,
      customer_name: customerName,
      parent_name: RETAIL_STUDENT?.parent_name || null,
      phone: document.getElementById('retailPhone').value || null,
      center_id: WORKING_CENTER_ID,
      performed_by: PROFILE.id,
      payment_method: document.getElementById('retailMethod').value,
      reason: document.getElementById('retailReason').value || null,
    }).select('id').single();
    if (saleErr) throw saleErr;

    const itemPayloads = rows.map((row) => {
      const opt = row.querySelector('.retail-item-select').selectedOptions[0];
      return {
        sale_id: sale.id, item_id: opt.value,
        size: row.querySelector('.retail-item-size').value || null,
        quantity: Number(row.querySelector('.retail-item-qty').value) || 1,
        unit_price: Number(opt.dataset.price || 0),
        discount_percent: Number(row.querySelector('.retail-item-discount').value) || 0,
      };
    });
    const { error: itemsErr } = await supabase.from('retail_sale_items').insert(itemPayloads);
    if (itemsErr) throw itemsErr;

    const { error: finalizeErr } = await supabase.rpc('finalize_retail_sale', { p_sale_id: sale.id });
    if (finalizeErr) throw finalizeErr;

    alert('Đã hoàn thành phiếu bán lẻ — đã trừ kho và ghi nhận doanh thu.');
    retailModal.classList.remove('show');
    await Promise.all([loadStock(), loadTransactions()]);
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Hoàn thành & Xuất kho';
  }
});

function toggleSizeField() {
  const opt = document.getElementById('txItem').selectedOptions[0];
  const hasSize = opt?.dataset.hasSize === 'true';
  document.getElementById('txSizeField').style.display = hasSize ? 'block' : 'none';
}
document.getElementById('txItem').addEventListener('change', toggleSizeField);

document.getElementById('btnSubmitTx').addEventListener('click', async () => {
  const errBox = document.getElementById('txFormError');
  errBox.classList.remove('show');

  const itemOpt = document.getElementById('txItem').selectedOptions[0];
  const hasSize = itemOpt?.dataset.hasSize === 'true';
  const payload = {
    transaction_type: document.getElementById('txType').value,
    item_id: document.getElementById('txItem').value,
    size: hasSize ? document.getElementById('txSize').value : null,
    quantity: Number(document.getElementById('txQuantity').value),
    center_id: WORKING_CENTER_ID,
    performed_by: PROFILE.id,
    transaction_date: document.getElementById('txDate').value,
    note: document.getElementById('txNote').value || null,
  };
  if (!payload.quantity || payload.quantity <= 0) { errBox.textContent = 'Vui lòng nhập số lượng hợp lệ.'; errBox.classList.add('show'); return; }

  // Xuất kho không cho vượt quá tồn kho hiện có — kiểm tra phía client để
  // báo sớm (RLS/DB không tự chặn số âm, tránh kho bị âm ngoài ý muốn).
  if (payload.transaction_type === 'out') {
    const { data: stockRows } = await supabase.from('inventory_stock_view').select('stock_quantity')
      .eq('center_id', WORKING_CENTER_ID).eq('item_id', payload.item_id).eq('size', payload.size || '');
    const currentStock = stockRows?.[0]?.stock_quantity || 0;
    if (payload.quantity > currentStock) {
      errBox.textContent = `Kho chỉ còn ${currentStock} — không thể xuất ${payload.quantity}.`;
      errBox.classList.add('show');
      return;
    }
  }

  const btn = document.getElementById('btnSubmitTx');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('inventory_transactions').insert(payload);
  btn.disabled = false; btn.textContent = 'Lưu phiếu';
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  txModal.classList.remove('show');
  await Promise.all([loadStock(), loadTransactions()]);
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    await initCenterPicker();
    await loadItems();
    await Promise.all([loadWalletPurchases(), loadStock(), loadTransactions()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
