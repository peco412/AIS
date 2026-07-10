import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let ALL_ROWS = [];

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data: links, error } = await supabase
    .from('parent_student_links')
    .select('parent_accounts(full_name, phone), students(id, full_name, center_id, centers(name))');

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!links || links.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có liên kết nào.</td></tr>'; return; }

  const studentIds = links.map((l) => l.students?.id).filter(Boolean);
  const { data: wallets } = await supabase.from('wallets').select('id, student_id').in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']);
  const walletByStudent = {};
  (wallets || []).forEach((w) => { walletByStudent[w.student_id] = w.id; });
  const walletIds = Object.values(walletByStudent);

  let balanceByWallet = {};
  if (walletIds.length > 0) {
    const { data: batches } = await supabase.from('wallet_topup_batches').select('wallet_id, coin_remaining').in('wallet_id', walletIds);
    (batches || []).forEach((b) => { balanceByWallet[b.wallet_id] = (balanceByWallet[b.wallet_id] || 0) + Number(b.coin_remaining); });
  }

  ALL_ROWS = links.filter((l) => l.students).map((l) => ({
    parentName: l.parent_accounts?.full_name || '—',
    phone: l.parent_accounts?.phone || '—',
    studentName: l.students.full_name,
    centerId: l.students.center_id,
    centerName: l.students.centers?.name || '—',
    balance: balanceByWallet[walletByStudent[l.students.id]] || 0,
  }));

  render();
}

function render() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const centerId = document.getElementById('filterCenter').value;

  const rows = ALL_ROWS.filter((r) => {
    if (centerId && r.centerId !== centerId) return false;
    if (!q) return true;
    return r.parentName.toLowerCase().includes(q) || r.studentName.toLowerCase().includes(q) || r.phone.includes(q);
  });

  document.getElementById('resultCount').textContent = `${rows.length} liên kết`;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="5" class="empty-cell">Không có kết quả nào.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td>${esc(r.parentName)}</td>
        <td class="mono cell-muted">${esc(r.phone)}</td>
        <td>${esc(r.studentName)}</td>
        <td class="cell-muted">${esc(r.centerName)}</td>
        <td class="mono" style="text-align:right; font-weight:600;">${fmtMoney(r.balance)} coin</td>
      </tr>
    `).join('');
}

document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('filterCenter').addEventListener('change', render);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('departments(code)').eq('id', profile.id).single();
    const canUse = emp?.departments?.code === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    await loadCenters();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
