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
    .select('code, receipt_code, transaction_type, size, quantity, transaction_date, note, inventory_items(code, name), employees(full_name)')
    .eq('center_id', WORKING_CENTER_ID)
    .order('transaction_date', { ascending: false })
    .limit(300);

  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  // GOP THEO MA PHIEU — truoc day moi DONG SAN PHAM la 1 hang rieng, 1
  // hoa don 3 mon hien thanh 3 dong voi 3 ma khac nhau, gay nham lan. Gio
  // gop lai dung 1 dong/phieu, liet ke ro cac mat hang ben trong.
  const receiptMap = new Map();
  (data || []).forEach((r) => {
    const key = r.receipt_code || r.code;
    if (!receiptMap.has(key)) {
      receiptMap.set(key, {
        receipt_code: key, transaction_type: r.transaction_type, transaction_date: r.transaction_date,
        performer: r.employees?.full_name, note: r.note, items: [],
      });
    }
    receiptMap.get(key).items.push({ name: r.inventory_items?.name, size: r.size, quantity: r.quantity });
  });
  const receipts = Array.from(receiptMap.values());

  document.getElementById('resultCount').textContent = `${receipts.length} phiếu gần nhất (${(data || []).length} dòng sản phẩm)`;

  tbody.innerHTML = receipts.length === 0
    ? '<tr><td colspan="8" class="empty-cell">Chưa có phiếu nào.</td></tr>'
    : receipts.map((rc) => `
      <tr>
        <td class="cell-code">${esc(rc.receipt_code || '—')}</td>
        <td class="cell-muted">${fmtDate(rc.transaction_date)}</td>
        <td><span class="badge badge-${rc.transaction_type === 'in' ? 'active' : 'submitted'}">${rc.transaction_type === 'in' ? 'Nhập' : 'Xuất'}</span></td>
        <td colspan="2">${rc.items.map((it) => `${esc(it.name || '—')}${it.size ? ` (${esc(it.size)})` : ''} ×${it.quantity}`).join('<br/>')}</td>
        <td class="mono">${rc.items.reduce((s, it) => s + it.quantity, 0)}</td>
        <td class="cell-muted">${esc(rc.performer || '—')}</td>
        <td class="cell-muted">${esc(rc.note || '—')}</td>
      </tr>
    `).join('');
}

// ---------------------------------------------------------------------
// Tạo phiếu nhập/xuất — NHIEU DONG 1 luc (truoc day chi 1 mon/phieu, rat
// cham khi can nhap nhieu san pham — gio dung chung mau voi Ban le,
// them bao nhieu dong tuy y, luu 1 lan cho tat ca).
// ---------------------------------------------------------------------
const txModal = document.getElementById('txModal');
let txRowCounter = 0;

const SIZE_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

function addTxItemRow() {
  const id = `tx-item-${txRowCounter++}`;
  const wrap = document.createElement('div');
  wrap.className = 'field-grid-2';
  wrap.style.cssText = 'border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:8px; align-items:end;';
  wrap.dataset.rowId = id;
  wrap.innerHTML = `
    <div class="field" style="grid-column: span 2;">
      <label>Mặt hàng</label>
      <select class="tx-item-select">${ITEMS.map((it) => `<option value="${it.id}" data-has-size="${it.has_size}">${esc(it.name)}</option>`).join('')}</select>
    </div>
    <div class="field tx-item-size-field" style="display:none;">
      <label>Size</label>
      <select class="tx-item-size">${SIZE_OPTIONS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Số lượng</label><input type="number" class="tx-item-qty" min="1" value="1" /></div>
    <div class="field"><button type="button" class="btn btn-outline btn-sm tx-item-remove">Xoá dòng</button></div>
  `;
  document.getElementById('txItemsList').appendChild(wrap);

  const select = wrap.querySelector('.tx-item-select');
  const sizeField = wrap.querySelector('.tx-item-size-field');
  const toggleThisRowSize = () => {
    sizeField.style.display = select.selectedOptions[0]?.dataset.hasSize === 'true' ? 'block' : 'none';
  };
  select.addEventListener('change', toggleThisRowSize);
  toggleThisRowSize();

  wrap.querySelector('.tx-item-remove').addEventListener('click', () => wrap.remove());
}
document.getElementById('btnAddTxRow').addEventListener('click', addTxItemRow);

function openTxModal(type) {
  document.getElementById('txFormError').classList.remove('show');
  document.getElementById('txType').value = type;
  document.getElementById('txModalTitle').textContent = type === 'in' ? 'Phiếu nhập kho' : 'Phiếu xuất kho';
  document.getElementById('txDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('txNote').value = '';
  document.getElementById('txItemsList').innerHTML = '';
  txRowCounter = 0;
  addTxItemRow(); // luon co san 1 dong de bat dau, khong bat go phai tu bam "+ Them"
  txModal.classList.add('show');
}
document.getElementById('btnStockIn').addEventListener('click', () => openTxModal('in'));
document.getElementById('btnStockOut').addEventListener('click', () => openTxModal('out'));
document.getElementById('closeTxModal').addEventListener('click', () => txModal.classList.remove('show'));
document.getElementById('cancelTxModal').addEventListener('click', () => txModal.classList.remove('show'));

// ---------------------------------------------------------------------
// Sản phẩm mới đã CHUYỂN HẲN sang trang riêng trong Cấu hình dữ liệu gốc
// (master-data/inventory-items.html) — trang vận hành này chỉ còn tập
// trung vào nhập/xuất/bán lẻ, không quản lý danh mục gốc nữa.

// ---------------------------------------------------------------------
document.getElementById('btnSubmitTx').addEventListener('click', async () => {
  const errBox = document.getElementById('txFormError');
  errBox.classList.remove('show');

  const rows = Array.from(document.querySelectorAll('#txItemsList > div'));
  if (rows.length === 0) { errBox.textContent = 'Vui lòng thêm ít nhất 1 mặt hàng.'; errBox.classList.add('show'); return; }

  const type = document.getElementById('txType').value;
  const date = document.getElementById('txDate').value;
  const note = document.getElementById('txNote').value || null;

  const payloads = rows.map((row) => {
    const select = row.querySelector('.tx-item-select');
    const hasSize = select.selectedOptions[0]?.dataset.hasSize === 'true';
    return {
      transaction_type: type,
      item_id: select.value,
      item_name: select.selectedOptions[0].textContent,
      size: hasSize ? row.querySelector('.tx-item-size').value : null,
      quantity: Number(row.querySelector('.tx-item-qty').value) || 0,
      center_id: WORKING_CENTER_ID,
      performed_by: PROFILE.id,
      transaction_date: date,
      note,
    };
  });

  const invalid = payloads.find((p) => !p.quantity || p.quantity <= 0);
  if (invalid) { errBox.textContent = `Số lượng không hợp lệ cho "${invalid.item_name}".`; errBox.classList.add('show'); return; }

  // Xuat kho khong cho vuot qua ton kho hien co — kiem tra tung dong
  // TRUOC khi luu bat ky dong nao, tranh luu dang do (mot so dong thanh
  // cong, dong khac bi tu choi giua chung gay du lieu lech nhau).
  if (type === 'out') {
    for (const p of payloads) {
      const { data: stockRows } = await supabase.from('inventory_stock_view').select('stock_quantity')
        .eq('center_id', WORKING_CENTER_ID).eq('item_id', p.item_id).eq('size', p.size || '');
      const currentStock = stockRows?.[0]?.stock_quantity || 0;
      if (p.quantity > currentStock) {
        errBox.textContent = `"${p.item_name}"${p.size ? ` (size ${p.size})` : ''}: kho chỉ còn ${currentStock} — không thể xuất ${p.quantity}.`;
        errBox.classList.add('show');
        return;
      }
    }
  }

  const btn = document.getElementById('btnSubmitTx');
  btn.disabled = true; btn.textContent = 'Đang lưu...';

  // MOI: sinh 1 MA PHIEU CHUNG cho ca phieu (nhieu dong) — truoc day moi
  // dong tu sinh ma rieng qua trigger, khien "Log xuat kho" hien 1 hoa
  // don thanh nhieu dong ma khac nhau, khong gop lai duoc.
  const { data: receiptCode, error: codeErr } = await supabase.rpc('generate_inventory_receipt_code', { p_type: type });
  if (codeErr) { errBox.textContent = 'Lỗi sinh mã phiếu: ' + codeErr.message; errBox.classList.add('show'); btn.disabled = false; btn.textContent = 'Lưu phiếu (tất cả dòng)'; return; }

  const insertPayloads = payloads.map(({ item_name, ...p }) => ({ ...p, receipt_code: receiptCode }));
  const { error } = await supabase.from('inventory_transactions').insert(insertPayloads);
  btn.disabled = false; btn.textContent = 'Lưu phiếu (tất cả dòng)';
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  txModal.classList.remove('show');
  await Promise.all([loadStock(), loadTransactions()]);
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    // Ma tran: "San pham" thuoc Cau hinh Master Data - chi Ky thuat duoc
    // tao moi danh muc san pham goc, Quan ly trung tam van nhap/xuat kho
    // binh thuong (khac hoan toan voi VIEC TAO SAN PHAM MOI).
    // Quan ly danh muc san pham goc gio thuoc rieng trang Master Data,
    // khong con o day nua.
    await initCenterPicker();
    await loadItems();
    await Promise.all([loadWalletPurchases(), loadStock(), loadTransactions()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
