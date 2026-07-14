import { supabase, esc, fmtMoney, fmtDate, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    const studentId = getSelectedStudentId(students);

    const { data: wallet } = await supabase.from('wallets').select('id').eq('student_id', studentId).maybeSingle();
    const listEl = document.getElementById('batchList');

    if (!wallet) {
      document.getElementById('totalBalance').textContent = '0 AIScoins';
      listEl.innerHTML = '<div class="empty-state">Chưa có lô nạp nào.</div>';
      return;
    }

    const { data: batches, error } = await supabase
      .from('wallet_topup_batches')
      .select('coin_amount, coin_remaining, discount_rate, conversion_rate, created_at')
      .eq('wallet_id', wallet.id)
      .gt('coin_remaining', 0)
      .order('created_at', { ascending: true }); // FIFO — cũ nhất trước, đúng thứ tự sẽ bị trừ

    if (error) { listEl.innerHTML = `<div class="empty-state">Lỗi: ${esc(error.message)}</div>`; return; }

    const total = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
    const totalVnd = (batches || []).reduce((s, b) => s + Number(b.coin_remaining) * Number(b.conversion_rate), 0);
    document.getElementById('totalBalance').textContent = `${fmtMoney(total)} AIScoins`;
    document.getElementById('totalBalanceVnd').textContent = `≈ ${fmtMoney(totalVnd)} VNĐ nếu quy đổi`;

    if (!batches || batches.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Không còn số dư nào.</div>';
      return;
    }

    listEl.innerHTML = batches.map((b) => `
      <div class="batch-row">
        <div class="batch-row__left">
          <div class="date">${fmtDate(b.created_at)}</div>
          <div class="meta">${fmtMoney(b.coin_remaining)} / ${fmtMoney(b.coin_amount)} còn lại · Chiết khấu ${(b.discount_rate * 100).toFixed(1)}%</div>
        </div>
        <div class="batch-row__right">
          <div class="coin">${fmtMoney(b.coin_remaining)}</div>
          <div class="vnd">≈ ${fmtMoney(b.coin_remaining * b.conversion_rate)} VNĐ</div>
        </div>
      </div>
    `).join('');

    await loadSpendHistory(wallet.id, studentId);
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();

// MOI: gop 3 nguon CHI TIEU tu vi (truoc day trang nay chi hien lo NAP,
// khong he co gi cho biet DA MUA/DA CHI o dau) — Dong hoc phi qua vi,
// Mua sam qua App, Rut vi (hoan tien) — sap xep chung theo thoi gian.
async function loadSpendHistory(walletId, studentId) {
  const listEl = document.getElementById('spendHistoryList');
  listEl.innerHTML = '<div class="empty-state">Đang tải...</div>';

  const [{ data: tuitionPayments }, { data: purchases }, { data: withdrawals }] = await Promise.all([
    supabase.from('debt_ledger').select('amount_coin, amount_vnd, created_at, invoices!inner(period_month, period_year, student_id)').eq('source', 'WALLET').eq('invoices.student_id', studentId).order('created_at', { ascending: false }).limit(30),
    supabase.from('wallet_purchase_requests').select('code, total_coin_amount, status, created_at, confirmed_at').eq('student_id', studentId).eq('status', 'confirmed').order('confirmed_at', { ascending: false }).limit(30),
    supabase.from('wallet_withdrawal_requests').select('actual_amount_vnd, preview_amount_vnd, status, created_at, approved_at').eq('wallet_id', walletId).eq('status', 'approved').order('approved_at', { ascending: false }).limit(30),
  ]);

  const events = [];
  (tuitionPayments || []).forEach((r) => {
    events.push({
      date: r.created_at, icon: '🎓', label: `Đóng học phí${r.invoices ? ` tháng ${r.invoices.period_month}/${r.invoices.period_year}` : ''}`,
      amount: -Number(r.amount_coin || 0),
    });
  });
  (purchases || []).forEach((r) => {
    events.push({ date: r.confirmed_at || r.created_at, icon: '🛍️', label: `Mua sắm — ${r.code}`, amount: -Number(r.total_coin_amount || 0) });
  });
  (withdrawals || []).forEach((r) => {
    events.push({ date: r.approved_at || r.created_at, icon: '↩️', label: 'Hoàn tiền (rút ví)', amount: -Number(r.actual_amount_vnd || r.preview_amount_vnd || 0) });
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  listEl.innerHTML = events.length === 0
    ? '<div class="empty-state">Chưa có giao dịch chi tiêu nào.</div>'
    : events.slice(0, 30).map((e) => `
      <div class="batch-row">
        <div class="batch-row__left">
          <div class="date">${e.icon} ${e.label}</div>
          <div class="meta">${fmtDate(e.date)}</div>
        </div>
        <div class="batch-row__right">
          <div class="coin" style="color:var(--danger, #e53e3e);">${fmtMoney(e.amount)}</div>
        </div>
      </div>
    `).join('');
}
