import { supabase, esc, fmtMoney, bootParentShell, getSelectedStudentId, setSelectedStudentId } from './parentSupabase.js';

let STUDENTS = [];
let SELECTED_ID = null;

function renderSwitcher() {
  const el = document.getElementById('studentSwitcher');
  if (STUDENTS.length <= 1) { el.style.display = 'none'; return; }
  el.innerHTML = STUDENTS.map((s) => `
    <button class="student-chip ${s.id === SELECTED_ID ? 'active' : ''}" data-id="${s.id}">${esc(s.full_name)}</button>
  `).join('');
  el.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => { setSelectedStudentId(btn.dataset.id); SELECTED_ID = btn.dataset.id; renderSwitcher(); loadBalance(); });
  });
}

function updateOwnerLabel() {
  // Luon hien ten hoc sinh (ke ca khi chi co 1 con) de phu huynh yen tam
  // dung la vi cua con minh - truoc day chi hien qua studentSwitcher,
  // ma switcher lai bi an khi STUDENTS.length <= 1.
  const el = document.getElementById('walletOwnerLabel');
  if (!el) return;
  const student = STUDENTS.find((s) => s.id === SELECTED_ID);
  el.textContent = student ? student.full_name : '—';
}

async function loadBalance() {
  updateOwnerLabel();
  const { data: wallet } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', SELECTED_ID).maybeSingle();

  if (!wallet) {
    document.getElementById('balanceValue').textContent = '0 AIScoins';
    document.getElementById('balanceValueVnd').textContent = '';
    return;
  }

  // Vi la vi CHUNG cua ca gia dinh - neu co nhieu con dang dung chung 1
  // vi nay, hien ro ten tat ca de phu huynh biet so du nay dung chung
  // cho nhung con nao (khong chi rieng con dang chon).
  const { data: members } = await supabase
    .from('wallet_students')
    .select('students(full_name)')
    .eq('wallet_id', wallet.wallet_id);
  if (members && members.length > 1) {
    const names = members.map((m) => m.students?.full_name).filter(Boolean).join(', ');
    const el = document.getElementById('walletOwnerLabel');
    if (el) el.textContent = `Ví chung — ${names}`;
  }

  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining, conversion_rate').eq('wallet_id', wallet.wallet_id);
  const total = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
  const totalVnd = (batches || []).reduce((s, b) => s + Number(b.coin_remaining) * Number(b.conversion_rate), 0);
  document.getElementById('balanceValue').textContent = `${fmtMoney(total)} AIScoins`;
  document.getElementById('balanceValueVnd').textContent = `≈ ${fmtMoney(totalVnd)} VNĐ nếu quy đổi`;
}

(async () => {
  try {
    const { students } = await bootParentShell();
    STUDENTS = students;
    if (STUDENTS.length === 0) {
      document.getElementById('noStudentNotice').style.display = 'block';
      return;
    }

    document.getElementById('content').style.display = 'block';
    SELECTED_ID = getSelectedStudentId(STUDENTS);
    renderSwitcher();
    await loadBalance();
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();