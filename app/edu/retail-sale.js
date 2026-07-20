import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let WORKING_CENTER_ID = null;
let ITEMS = [];
let RETAIL_STUDENT = null;
let retailItemCounter = 0;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function initCenterPicker() {
  if (PROFILE.centerId) { WORKING_CENTER_ID = PROFILE.centerId; return; }
  const { data: centers } = await supabase.from('centers').select('id, name').order('name');
  const sel = document.getElementById('filterCenter');
  sel.style.display = '';
  sel.innerHTML = (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  WORKING_CENTER_ID = centers?.[0]?.id || null;
  sel.addEventListener('change', () => { WORKING_CENTER_ID = sel.value; });
}

async function loadItems() {
  const { data } = await supabase.from('inventory_items').select('*').order('display_order');
  ITEMS = data || [];
}

// SUA: moi truong (san pham/size/so luong/uu dai) deu co tieu de rieng
// ro rang — truoc day o Ban hang tich hop trong trang Nhap xuat kho, o
// "% Giam" chi co placeholder (bien mat ngay khi go), nhin vao 1 o trong
// khong biet la lam gi. Gio la nhan <label> that, luon hien san.
function addRetailItemRow() {
  const id = `retail-item-${retailItemCounter++}`;
  const wrap = document.createElement('div');
  wrap.className = 'retail-item-row';
  wrap.dataset.rowId = id;
  wrap.innerHTML = `
    <div class="retail-item-row__grid">
      <div class="field"><label>Sản phẩm</label><select class="retail-item-select">${ITEMS.map((it) => `<option value="${it.id}" data-price="${it.price_vnd || 0}" data-has-size="${it.has_size}">${esc(it.name)} — ${fmtMoney(it.price_vnd || 0)} đ</option>`).join('')}</select></div>
      <div class="field"><label>Size (nếu có)</label><input type="text" class="retail-item-size" /></div>
      <div class="field"><label>Số lượng</label><input type="number" class="retail-item-qty" min="1" value="1" /></div>
      <div class="field"><label>Ưu đãi (%)</label><input type="number" class="retail-item-discount" min="0" max="100" value="0" /></div>
      <div class="field"><button type="button" class="btn btn-outline btn-sm retail-item-remove">Xoá</button></div>
    </div>
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

let retailSearchTimer;
document.getElementById('retailStudentSearch').addEventListener('input', (e) => {
  clearTimeout(retailSearchTimer);
  const q = e.target.value.trim();
  retailSearchTimer = setTimeout(async () => {
    if (!q) { document.getElementById('retailStudentResult').textContent = ''; RETAIL_STUDENT = null; return; }
    const { data } = await supabase.from('students').select('id, full_name, parent_name, phone').eq('center_id', WORKING_CENTER_ID).ilike('full_name', `%${q}%`).limit(1);
    if (data && data.length > 0) {
      RETAIL_STUDENT = data[0];
      document.getElementById('retailStudentResult').innerHTML = `<strong>${esc(data[0].full_name)}</strong> — tự điền PH/SĐT`;
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
    window.location.href = '/edu/inventory.html';
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Hoàn thành & Xuất kho';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    await initCenterPicker();
    await loadItems();
    addRetailItemRow();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
