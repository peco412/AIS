import { supabase, esc } from '/js/supabase.js';

const METHOD_LABEL = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản' };

function fmtMoney(n) { return `${new Intl.NumberFormat('vi-VN').format(Math.round(n || 0))} đ`; }

async function loadSale() {
  const params = new URLSearchParams(window.location.search);
  const saleId = params.get('id');
  if (!saleId) { document.getElementById('docBox').innerHTML = '<p>Thiếu mã phiếu.</p>'; return; }

  const { data: sale, error } = await supabase
    .from('retail_sales')
    .select('id, code, customer_name, phone, reason, payment_method, total_amount, sale_date, created_at, centers(name, address), employees:performed_by(full_name)')
    .eq('id', saleId)
    .single();

  if (error || !sale) { document.getElementById('docBox').innerHTML = `<p>Không tìm thấy phiếu. ${esc(error?.message || '')}</p>`; return; }

  const { data: items } = await supabase
    .from('retail_sale_items')
    .select('quantity, size, unit_price, discount_percent, net_amount, inventory_items(name)')
    .eq('sale_id', saleId);

  document.getElementById('centerName').textContent = sale.centers?.name || '—';
  document.getElementById('centerAddress').textContent = sale.centers?.address || '';
  document.getElementById('saleCode').textContent = sale.code || '(chưa có mã)';
  document.getElementById('saleDate').textContent = `Ngày bán: ${new Date(sale.sale_date).toLocaleDateString('vi-VN')}`;

  document.getElementById('customerName').textContent = sale.customer_name || '—';
  document.getElementById('customerPhone').textContent = sale.phone || '—';
  document.getElementById('saleReason').textContent = sale.reason || '—';

  document.getElementById('itemsBody').innerHTML = (items || []).map((it) => `
    <tr>
      <td>${esc(it.inventory_items?.name || '—')}</td>
      <td>${esc(it.size || '—')}</td>
      <td>${it.quantity}</td>
      <td style="text-align:right;">${it.discount_percent > 0 ? `-${it.discount_percent}%` : '—'}</td>
      <td style="text-align:right;">${fmtMoney(it.net_amount)}</td>
    </tr>
  `).join('');
  document.getElementById('totalAmount').textContent = fmtMoney(sale.total_amount);
  document.getElementById('paymentMethod').textContent = METHOD_LABEL[sale.payment_method] || sale.payment_method;
  if (sale.employees?.full_name) document.getElementById('sellerName').textContent = sale.employees.full_name;
}

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/login.html'; return; }
  await loadSale();
})();
