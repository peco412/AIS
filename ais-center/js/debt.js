import { supabase, esc, fmtMoney, fmtDate, bootParentShell } from './parentSupabase.js';

// MỚI: gộp chung thông tin học phí/lịch học/bảng điểm của TẤT CẢ con đang
// liên kết trong 1 màn hình duy nhất, thay vì phải chuyển qua lại giữa
// từng con (trang này vốn không có bộ chuyển học sinh riêng, phụ huynh
// phải quay lại trang khác để đổi "con đang chọn" rồi vào lại đây — rất
// bất tiện khi có từ 2 con trở lên). Ví AIScoins đã dùng chung 1 ví gia
// đình từ trước — trang này áp dụng đúng tinh thần đó cho học phí/điểm.
(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    const studentIds = students.map((s) => s.id);
    const studentMap = Object.fromEntries(students.map((s) => [s.id, s.full_name]));
    const nameOf = (id) => esc(studentMap[id] || '—');

    document.getElementById('childrenNames').textContent = students.map((s) => s.full_name).join(', ');

    // ---------------------------------------------------------------
    // Tổng quan + Các khoản đang nợ — TẤT CẢ con, có ghi rõ tên từng
    // khoản là của con nào ngay trên mỗi dòng.
    // ---------------------------------------------------------------
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('id, student_id, period_year, period_month, amount_vnd, status, due_date')
      .in('student_id', studentIds)
      .in('status', ['unpaid', 'partially_paid'])
      .order('due_date', { ascending: true });

    const listEl = document.getElementById('invoiceList');
    if (error) { listEl.innerHTML = `<div class="empty-state">Lỗi: ${esc(error.message)}</div>`; return; }

    if (!invoices || invoices.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Không có khoản nợ nào.</div>';
      document.getElementById('totalDueValue').textContent = '0 đ';
    } else {
      const invoiceIds = invoices.map((i) => i.id);
      const { data: ledgerRows } = await supabase.from('debt_ledger').select('invoice_id, source, amount_vnd, amount_coin').in('invoice_id', invoiceIds);

      let totalRemaining = 0;
      listEl.innerHTML = invoices.map((inv) => {
        const paidRows = (ledgerRows || []).filter((l) => l.invoice_id === inv.id);
        const paidVnd = paidRows.reduce((s, l) => s + Number(l.amount_vnd), 0);
        const remaining = Number(inv.amount_vnd) - paidVnd;
        const usedWallet = paidRows.some((l) => l.source === 'WALLET');
        totalRemaining += remaining;

        return `
          <div class="invoice-row">
            <div class="invoice-row__top">
              <span>${nameOf(inv.student_id)} — Học phí tháng ${inv.period_month}/${inv.period_year}</span>
              <span class="badge ${inv.status === 'unpaid' ? 'unpaid' : 'partial'}">${inv.status === 'unpaid' ? 'Chưa đóng' : 'Một phần'}</span>
            </div>
            <div class="invoice-row__sub">
              Hạn chót: ${fmtDate(inv.due_date)} · Còn thiếu: <strong>${fmtMoney(remaining)} VNĐ</strong>
              ${usedWallet ? ' (đã đóng dở qua Ví)' : ''}
            </div>
          </div>
        `;
      }).join('');
      document.getElementById('totalDueValue').textContent = `${fmtMoney(totalRemaining)} đ`;
    }

    // ---------------------------------------------------------------
    // Lịch sử đóng học phí — TOÀN BỘ hoá đơn của TẤT CẢ con (kể cả đã
    // đóng đủ), mỗi dòng ghi rõ của con nào.
    // ---------------------------------------------------------------
    const { data: allInvoices } = await supabase
      .from('invoices')
      .select('id, student_id, period_year, period_month, amount_vnd, status')
      .in('student_id', studentIds)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });
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
                <span>${inv ? nameOf(inv.student_id) + ' — ' : ''}Học phí ${inv ? `${inv.period_month}/${inv.period_year}` : ''}</span>
                <span>${fmtMoney(l.amount_vnd)} đ</span>
              </div>
              <div class="invoice-row__sub">${fmtDate(l.created_at)} · ${SOURCE_LABEL[l.source] || l.source}</div>
            </div>
          `;
        }).join('');
    }

    // ---------------------------------------------------------------
    // Lịch học — của TỪNG con, mỗi dòng ghi rõ tên con.
    // ---------------------------------------------------------------
    const { data: studentClasses } = await supabase
      .from('students')
      .select('id, full_name, class_id, classes(name, schedule_note, teacher_id, employees:teacher_id(full_name))')
      .in('id', studentIds);
    const scheduleEl = document.getElementById('scheduleList');
    const withClass = (studentClasses || []).filter((s) => s.class_id);
    scheduleEl.innerHTML = withClass.length === 0
      ? '<div class="empty-state">Chưa được xếp lớp.</div>'
      : withClass.map((s) => `
        <div class="invoice-row">
          <div class="invoice-row__top"><span>${esc(s.full_name)} — ${esc(s.classes?.name || '—')}</span></div>
          <div class="invoice-row__sub">${esc(s.classes?.schedule_note || 'Chưa có lịch cụ thể')} · GV: ${esc(s.classes?.employees?.full_name || '—')}</div>
        </div>
      `).join('');

    // ---------------------------------------------------------------
    // Bảng điểm — của TẤT CẢ con, mỗi dòng ghi rõ tên con.
    // ---------------------------------------------------------------
    const { data: grades } = await supabase
      .from('student_grades')
      .select('student_id, term, score, ranking, final_status')
      .in('student_id', studentIds)
      .order('created_at', { ascending: false });
    const gradesEl = document.getElementById('gradesList');
    const FINAL_LABEL = { graduated: 'Tốt nghiệp', not_passed: 'Chưa đạt' };
    gradesEl.innerHTML = (!grades || grades.length === 0)
      ? '<div class="empty-state">Chưa có điểm nào.</div>'
      : grades.map((g) => `
        <div class="invoice-row">
          <div class="invoice-row__top"><span>${nameOf(g.student_id)} — ${esc(g.term || 'Kỳ học')}</span><span>${g.score ?? '—'} điểm</span></div>
          <div class="invoice-row__sub">${esc(g.ranking || '')}${g.final_status ? ' · ' + (FINAL_LABEL[g.final_status] || g.final_status) : ''}</div>
        </div>
      `).join('');
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
