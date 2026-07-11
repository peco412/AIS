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
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
