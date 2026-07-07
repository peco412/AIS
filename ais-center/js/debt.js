import { supabase, esc, fmtMoney, fmtDate, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    const studentId = getSelectedStudentId(students);

    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('id, period_year, period_month, amount_vnd, status, due_date')
      .eq('student_id', studentId)
      .in('status', ['unpaid', 'partially_paid'])
      .order('due_date', { ascending: true });

    const listEl = document.getElementById('invoiceList');
    if (error) { listEl.innerHTML = `<div class="empty-state">Lỗi: ${esc(error.message)}</div>`; return; }
    if (!invoices || invoices.length === 0) { listEl.innerHTML = '<div class="empty-state">🎉 Không có khoản nợ nào.</div>'; return; }

    // Với mỗi hoá đơn, lấy đúng đơn vị đã dùng để đóng phần dở (nếu có) để
    // hiển thị đúng đơn vị theo mục 5.3 (AIScoins nếu qua ví, VNĐ nếu tại quầy)
    const invoiceIds = invoices.map((i) => i.id);
    const { data: ledgerRows } = await supabase.from('debt_ledger').select('invoice_id, source, amount_vnd, amount_coin').in('invoice_id', invoiceIds);

    listEl.innerHTML = invoices.map((inv) => {
      const paidRows = (ledgerRows || []).filter((l) => l.invoice_id === inv.id);
      const paidVnd = paidRows.reduce((s, l) => s + Number(l.amount_vnd), 0);
      const remaining = Number(inv.amount_vnd) - paidVnd;
      const usedWallet = paidRows.some((l) => l.source === 'WALLET');

      return `
        <div class="invoice-row">
          <div class="invoice-row__top">
            <span>Học phí tháng ${inv.period_month}/${inv.period_year}</span>
            <span class="badge ${inv.status === 'unpaid' ? 'unpaid' : 'partial'}">${inv.status === 'unpaid' ? 'Chưa đóng' : 'Một phần'}</span>
          </div>
          <div class="invoice-row__sub">
            Hạn chót: ${fmtDate(inv.due_date)} · Còn thiếu: <strong>${fmtMoney(remaining)} VNĐ</strong>
            ${usedWallet ? ' (đã đóng dở qua Ví)' : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
