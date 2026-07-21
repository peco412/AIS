import { supabase, esc } from '/js/supabase.js';

const STATUS_LABEL = { draft: 'Chờ chọn hình thức', unpaid: 'Chưa đóng', partially_paid: 'Đã đóng một phần', paid: 'Đã đóng đủ', void: 'Đã huỷ' };

function fmtMoney(n) { return `${new Intl.NumberFormat('vi-VN').format(Math.round(n || 0))} đ`; }

async function loadInvoice() {
  const params = new URLSearchParams(window.location.search);
  const invoiceId = params.get('id');
  if (!invoiceId) { document.getElementById('docBox').innerHTML = '<p>Thiếu mã hoá đơn.</p>'; return; }

  const { data: inv, error } = await supabase
    .from('invoices')
    .select(`
      id, invoice_code, period_year, period_month, amount_vnd, manual_discount_vnd, manual_discount_reason, status, created_at,
      applied_discount_program_id, discount_programs(name),
      students(full_name, parent_name, phone, centers(name, address)),
      classes(name)
    `)
    .eq('id', invoiceId)
    .single();

  if (error || !inv) { document.getElementById('docBox').innerHTML = `<p>Không tìm thấy hoá đơn. ${esc(error?.message || '')}</p>`; return; }

  const { data: ledgerRows } = await supabase.from('debt_ledger').select('amount_vnd, created_at, employees:created_by(full_name)').eq('invoice_id', invoiceId);
  const paid = (ledgerRows || []).reduce((s, l) => s + Number(l.amount_vnd), 0);
  const net = Number(inv.amount_vnd) - Number(inv.manual_discount_vnd || 0);

  document.getElementById('centerName').textContent = inv.students?.centers?.name || '—';
  document.getElementById('centerAddress').textContent = inv.students?.centers?.address || '';
  document.getElementById('invoiceCode').textContent = inv.invoice_code || '(chưa có mã)';
  document.getElementById('invoiceDate').textContent = `Kỳ ${inv.period_month}/${inv.period_year} — Ngày lập: ${new Date(inv.created_at).toLocaleDateString('vi-VN')}`;

  document.getElementById('studentName').textContent = inv.students?.full_name || '—';
  document.getElementById('parentName').textContent = inv.students?.parent_name || '—';
  document.getElementById('studentPhone').textContent = inv.students?.phone || '—';
  document.getElementById('className').textContent = inv.classes?.name || '—';

  const itemsBody = document.getElementById('itemsBody');
  let rows = `<tr><td>Học phí — Kỳ ${inv.period_month}/${inv.period_year}</td><td style="text-align:right;">${fmtMoney(inv.amount_vnd)}</td></tr>`;
  if (inv.manual_discount_vnd > 0) {
    const discountLabel = inv.discount_programs?.name || inv.manual_discount_reason || 'Ưu đãi';
    rows += `<tr><td>Ưu đãi — ${esc(discountLabel)}</td><td style="text-align:right; color:#c0392b;">- ${fmtMoney(inv.manual_discount_vnd)}</td></tr>`;
  }
  itemsBody.innerHTML = rows;
  document.getElementById('totalAmount').textContent = fmtMoney(net);

  document.getElementById('paidAmount').textContent = fmtMoney(paid);
  document.getElementById('remainingAmount').textContent = fmtMoney(net - paid);
  document.getElementById('statusDisplay').textContent = STATUS_LABEL[inv.status] || inv.status;

  const lastCollector = ledgerRows && ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].employees?.full_name : null;
  if (lastCollector) document.getElementById('collectorName').textContent = lastCollector;
}

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/login.html'; return; }
  await loadInvoice();
})();
