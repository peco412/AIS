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
    if (!invoices || invoices.length === 0) { listEl.innerHTML = '<div class="empty-state">Không có khoản nợ nào.</div>'; return; }

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

    // ---------------------------------------------------------------
    // Lịch sử đóng học phí — TOÀN BỘ hoá đơn (kể cả đã đóng đủ), để phụ
    // huynh theo dõi lâu dài, không chỉ khoản đang nợ.
    // ---------------------------------------------------------------
    const { data: allInvoices } = await supabase.from('invoices').select('id, period_year, period_month, amount_vnd, status').eq('student_id', studentId).order('period_year', { ascending: false }).order('period_month', { ascending: false });
    const historyEl = document.getElementById('paymentHistory');
    if (!allInvoices || allInvoices.length === 0) {
      historyEl.innerHTML = '<div class="empty-state">Chưa có lịch sử nào.</div>';
    } else {
      const allInvoiceIds = allInvoices.map((i) => i.id);
      const { data: allLedger } = await supabase.from('debt_ledger').select('invoice_id, source, amount_vnd, created_at').in('invoice_id', allInvoiceIds).order('created_at', { ascending: false });
      const SOURCE_LABEL = { WALLET: 'Ví AIScoins', CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản' };

      historyEl.innerHTML = (allLedger || []).length === 0
        ? '<div class="empty-state">Chưa có giao dịch đóng học phí nào.</div>'
        : allLedger.map((l) => {
          const inv = allInvoices.find((i) => i.id === l.invoice_id);
          return `
            <div class="invoice-row">
              <div class="invoice-row__top">
                <span>Học phí ${inv ? `${inv.period_month}/${inv.period_year}` : ''}</span>
                <span>${fmtMoney(l.amount_vnd)} đ</span>
              </div>
              <div class="invoice-row__sub">${fmtDate(l.created_at)} · ${SOURCE_LABEL[l.source] || l.source}</div>
            </div>
          `;
        }).join('');
    }

    // ---------------------------------------------------------------
    // Lịch học — theo đúng lớp đang học hiện tại
    // ---------------------------------------------------------------
    const { data: student } = await supabase.from('students').select('class_id, classes(name, schedule_note, teacher_id, employees:teacher_id(full_name))').eq('id', studentId).single();
    const scheduleEl = document.getElementById('scheduleList');
    if (!student?.class_id) {
      scheduleEl.innerHTML = '<div class="empty-state">Chưa được xếp lớp.</div>';
    } else {
      scheduleEl.innerHTML = `
        <div class="invoice-row">
          <div class="invoice-row__top"><span>${esc(student.classes?.name || '—')}</span></div>
          <div class="invoice-row__sub">${esc(student.classes?.schedule_note || 'Chưa có lịch cụ thể')} · GV: ${esc(student.classes?.employees?.full_name || '—')}</div>
        </div>
      `;
    }

    // ---------------------------------------------------------------
    // Bảng điểm
    // ---------------------------------------------------------------
    const { data: grades } = await supabase.from('student_grades').select('term, score, ranking, final_status').eq('student_id', studentId).order('created_at', { ascending: false });
    const gradesEl = document.getElementById('gradesList');
    const FINAL_LABEL = { graduated: 'Tốt nghiệp', not_passed: 'Chưa đạt' };
    gradesEl.innerHTML = (!grades || grades.length === 0)
      ? '<div class="empty-state">Chưa có điểm nào.</div>'
      : grades.map((g) => `
        <div class="invoice-row">
          <div class="invoice-row__top"><span>${esc(g.term || 'Kỳ học')}</span><span>${g.score ?? '—'} điểm</span></div>
          <div class="invoice-row__sub">${esc(g.ranking || '')}${g.final_status ? ' · ' + (FINAL_LABEL[g.final_status] || g.final_status) : ''}</div>
        </div>
      `).join('');
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
