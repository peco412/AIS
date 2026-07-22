import { supabase, esc, fmtMoney, fmtDate, bootParentShell } from './parentSupabase.js';

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    const studentIds = students.map((s) => s.id);

    const { data: wallet } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', studentIds[0]).maybeSingle();
    const listEl = document.getElementById('batchList');

    if (!wallet) {
      document.getElementById('totalBalance').textContent = '0 AIScoins';
      listEl.innerHTML = '<div class="empty-state">Chưa có lô nạp nào.</div>';
      await loadSpendHistory(null, studentIds);
      return;
    }

    const { data: batches, error } = await supabase
      .from('wallet_topup_batches')
      .select('coin_amount, coin_remaining, discount_rate, conversion_rate, created_at')
      .eq('wallet_id', wallet.wallet_id)
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

    await loadSpendHistory(wallet?.wallet_id, studentIds);
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();

// SUA — truoc day trang nay CHI hien giao dich qua VI (dong hoc phi qua
// vi, mua sam qua app, rut vi) — bo sot hoan toan hoc phi dong TIEN MAT/
// CHUYEN KHOAN tai quay, va Phieu ban le tai quay — phu huynh nhin vao
// day tuong nhu chua tung dong/mua gi neu lan do ho dong truc tiep tai
// quay chu khong qua vi. Gio gop CA 5 nguon, ghi ro kenh thanh toan cho
// tung dong (Vi/Tien mat/Chuyen khoan), va gop chung ca nha (khong chi 1
// con duoc chon) cho dung voi vi la vi CHUNG.
const SOURCE_LABEL = { WALLET: 'Ví AIScoins', CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản' };

async function loadSpendHistory(walletId, studentIds) {
  const listEl = document.getElementById('spendHistoryList');
  listEl.innerHTML = '<div class="empty-state">Đang tải...</div>';

  const queries = [
    supabase.from('debt_ledger').select('amount_vnd, source, created_at, invoices!inner(period_month, period_year, student_id, students(full_name))').in('invoices.student_id', studentIds).order('created_at', { ascending: false }).limit(40),
    supabase.from('wallet_purchase_requests').select('code, total_coin_amount, status, created_at, confirmed_at, students(full_name)').in('student_id', studentIds).eq('status', 'confirmed').order('confirmed_at', { ascending: false }).limit(30),
    supabase.from('retail_sales').select('code, total_amount, payment_method, sale_date, created_at, students(full_name)').in('student_id', studentIds).order('created_at', { ascending: false }).limit(30),
  ];
  if (walletId) {
    queries.push(supabase.from('wallet_withdrawal_requests').select('actual_amount_vnd, preview_amount_vnd, status, created_at, approved_at').eq('wallet_id', walletId).eq('status', 'approved').order('approved_at', { ascending: false }).limit(30));
  }
  const [{ data: tuitionPayments }, { data: purchases }, { data: retailSales }, withdrawalsResult] = await Promise.all(queries);
  const withdrawals = withdrawalsResult?.data;

  const events = [];
  (tuitionPayments || []).forEach((r) => {
    events.push({
      date: r.created_at,
      label: `Đóng học phí${r.invoices ? ` tháng ${r.invoices.period_month}/${r.invoices.period_year}` : ''}${r.invoices?.students ? ` — ${r.invoices.students.full_name}` : ''}`,
      amount: -Number(r.amount_vnd || 0), channel: SOURCE_LABEL[r.source] || r.source,
    });
  });
  (purchases || []).forEach((r) => {
    events.push({ date: r.confirmed_at || r.created_at, label: `Mua sắm qua App — ${r.code}${r.students ? ` — ${r.students.full_name}` : ''}`, amount: -Number(r.total_coin_amount || 0), channel: 'Ví AIScoins' });
  });
  (retailSales || []).forEach((r) => {
    events.push({ date: r.created_at, label: `Phiếu bán lẻ — ${r.code}${r.students ? ` — ${r.students.full_name}` : ''}`, amount: -Number(r.total_amount || 0), channel: SOURCE_LABEL[r.payment_method] || r.payment_method });
  });
  (withdrawals || []).forEach((r) => {
    events.push({ date: r.approved_at || r.created_at, label: 'Hoàn tiền (rút ví)', amount: -Number(r.actual_amount_vnd || r.preview_amount_vnd || 0), channel: 'Ví AIScoins' });
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  listEl.innerHTML = events.length === 0
    ? '<div class="empty-state">Chưa có giao dịch chi tiêu nào.</div>'
    : events.slice(0, 40).map((e) => `
      <div class="batch-row">
        <div class="batch-row__left">
          <div class="date">${esc(e.label)}</div>
          <div class="meta">${fmtDate(e.date)} · ${esc(e.channel)}</div>
        </div>
        <div class="batch-row__right">
          <div class="coin" style="color:var(--danger);">${fmtMoney(e.amount)} đ</div>
        </div>
      </div>
    `).join('');
}