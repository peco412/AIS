import { supabase, esc, fmtMoney, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

let STUDENT_ID = null;
let ITEMS = [];
let SUGGESTED_SIZE = null;
const CART = {}; // itemId -> { qty, size }

// Goi y SIZE tu dong theo chieu cao/can nang — doi voi CA cac o size da
// co san du lieu (dung 1 lan cho tat ca san pham can size, khong phai
// nhap tay tung san pham 1 nhu truoc).
async function suggestSize() {
  const height = Number(document.getElementById('childHeight').value) || null;
  const weight = Number(document.getElementById('childWeight').value) || null;
  const hint = document.getElementById('sizeSuggestHint');
  if (!height && !weight) { hint.textContent = ''; SUGGESTED_SIZE = null; return; }

  const { data, error } = await supabase.rpc('suggest_size', { p_height_cm: height, p_weight_kg: weight });
  if (error || !data) {
    hint.textContent = 'Không tìm được size gợi ý phù hợp — vui lòng chọn tay.';
    SUGGESTED_SIZE = null;
    return;
  }
  SUGGESTED_SIZE = data;
  hint.innerHTML = `Gợi ý size: <strong>${esc(data)}</strong> (có thể sửa tay nếu muốn chọn size khác)`;

  // Tu dien vao MOI o size con TRONG (chua duoc phu huynh tu go tay
  // truoc do) — khong ghi de neu ho da tu chinh size rieng cho san
  // pham nao do.
  document.querySelectorAll('.shop-item__size').forEach((input) => {
    if (!input.value) input.value = data;
  });
}
document.getElementById('childHeight').addEventListener('input', suggestSize);
document.getElementById('childWeight').addEventListener('input', suggestSize);

async function loadItems() {
  const { data } = await supabase.from('inventory_items').select('id, name, price_vnd, has_size').order('display_order');
  ITEMS = data || [];

  const list = document.getElementById('itemsList');
  list.innerHTML = ITEMS.map((it) => `
    <div class="shop-item" data-item="${it.id}">
      <div class="shop-item__name">
        <div>${esc(it.name)}</div>
        <div class="shop-item__price">${fmtMoney(it.price_vnd)} coin</div>
      </div>
      ${it.has_size ? `<input type="text" class="shop-item__size" placeholder="Size" data-size-for="${it.id}" value="${esc(SUGGESTED_SIZE || '')}" />` : ''}
      <div class="shop-item__qty">
        <button data-minus="${it.id}">−</button>
        <span id="qty-${it.id}">0</span>
        <button data-plus="${it.id}">+</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-plus]').forEach((btn) => btn.addEventListener('click', () => changeQty(btn.dataset.plus, 1)));
  list.querySelectorAll('[data-minus]').forEach((btn) => btn.addEventListener('click', () => changeQty(btn.dataset.minus, -1)));
}

function changeQty(itemId, delta) {
  const current = CART[itemId]?.qty || 0;
  const next = Math.max(0, current + delta);
  const sizeInput = document.querySelector(`[data-size-for="${itemId}"]`);
  CART[itemId] = { qty: next, size: sizeInput?.value || null };
  document.getElementById(`qty-${itemId}`).textContent = next;
  if (next === 0) delete CART[itemId];
  updateTotal();
}

function updateTotal() {
  let total = 0;
  Object.entries(CART).forEach(([itemId, { qty }]) => {
    const item = ITEMS.find((i) => i.id === itemId);
    if (item) total += Number(item.price_vnd) * qty;
  });
  document.getElementById('cartTotal').textContent = `${fmtMoney(total)} coin`;
}

document.getElementById('btnSubmitOrder').addEventListener('click', async () => {
  const errBox = document.getElementById('shopError');
  errBox.classList.remove('show');

  // Đọc lại size ngay lúc gửi (phòng trường hợp phụ huynh nhập size sau khi đã bấm +)
  const items = Object.entries(CART).map(([itemId, { qty }]) => {
    const sizeInput = document.querySelector(`[data-size-for="${itemId}"]`);
    return { item_id: itemId, quantity: qty, size: sizeInput?.value || null };
  });
  if (items.length === 0) { errBox.textContent = 'Vui lòng chọn ít nhất 1 sản phẩm.'; errBox.classList.add('show'); return; }

  const btn = document.getElementById('btnSubmitOrder');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const { error } = await supabase.rpc('create_wallet_purchase_request', { p_student_id: STUDENT_ID, p_items: items });
    if (error) throw error;
    alert('Đã gửi yêu cầu mua hàng — chờ trung tâm kiểm tra hàng và xác nhận, ví sẽ tự trừ tiền khi được duyệt.');
    window.location.href = 'wallet.html';
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi yêu cầu mua hàng';
  }
});

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    STUDENT_ID = getSelectedStudentId(students);
    await loadItems();
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
