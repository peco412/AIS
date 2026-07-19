import { supabase, esc, fmtMoney, bootParentShell } from './parentSupabase.js';

let STUDENTS = [];

// SUA: bo nut chuyen doi con — vi la vi CHUNG ca gia dinh tu truoc, bam
// chuyen qua lai giua cac con truoc day KHONG lam doi gi ca (van ra dung
// 1 vi, 1 so du) — chi gay roi vi tuong la co the xem rieng tung con.
// Nhan ten TAT CA con dang dung chung vi ngay tu dau, khong can chon gi.
function updateOwnerLabel(names) {
  const el = document.getElementById('walletOwnerLabel');
  if (!el) return;
  el.textContent = names.length > 1 ? `Ví chung — ${names.join(', ')}` : (names[0] || '—');
}

async function loadBalance() {
  if (STUDENTS.length === 0) return;
  const { data: wallet } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', STUDENTS[0].id).maybeSingle();

  if (!wallet) {
    updateOwnerLabel(STUDENTS.map((s) => s.full_name));
    document.getElementById('balanceValue').textContent = '0 AIScoins';
    document.getElementById('balanceValueVnd').textContent = '';
    return;
  }

  // Vi la vi CHUNG cua ca gia dinh - lay dung danh sach TAT CA con dang
  // dung chung vi nay tu wallet_students (khong chi dua vao STUDENTS o
  // trang nay, phong truong hop co con chua duoc bootParentShell tra ve
  // vi ly do khac nhưng van chung vi).
  const { data: members } = await supabase
    .from('wallet_students')
    .select('students(full_name)')
    .eq('wallet_id', wallet.wallet_id);
  const names = (members || []).map((m) => m.students?.full_name).filter(Boolean);
  updateOwnerLabel(names.length > 0 ? names : STUDENTS.map((s) => s.full_name));

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
    await loadBalance();
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();