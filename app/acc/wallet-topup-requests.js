import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const STATUS_LABEL = { confirmed: 'Thành công', rejected: 'Thất bại', pending: 'Đang chờ' };
const STATUS_BADGE = { confirmed: 'active', rejected: 'rejected', pending: 'submitted' };

let PROFILE = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

// SUA: trang nay TRUOC DAY bat nhan vien tu doi chieu sao ke roi bam
// "Xac nhan" cho tung yeu cau — nay la THAO TAC THUA, vi webhook SePay
// da tu dong doi chieu + cong Coin ngay khi nhan duoc dung noi dung
// chuyen khoan (khong can ai bam gi ca). Truong hop THAT SU khong khop
// tu dong duoc thi da co rieng trang "Khac phuc su co nap vi" xu ly —
// trang nay tu day chi con la NHAT KY xem lai, khong co nut hanh dong
// nao nua.
async function loadStats() {
  const [{ count: confirmedCount }, { count: rejectedCount }, { count: pendingCount }] = await Promise.all([
    supabase.from('wallet_topup_requests').select('id', { count: 'exact', head: true }).eq('status', 'confirmed'),
    supabase.from('wallet_topup_requests').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    supabase.from('wallet_topup_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  document.getElementById('statConfirmed').textContent = confirmedCount ?? '—';
  document.getElementById('statRejected').textContent = rejectedCount ?? '—';
  document.getElementById('statPending').textContent = pendingCount ?? '—';
}

async function loadRows() {
  const status = document.getElementById('filterStatus').value;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('wallet_topup_requests')
    .select('id, coin_amount, transfer_content, status, created_at, students(full_name), parent_accounts(full_name, phone)')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  document.getElementById('resultCount').textContent = `${(data || []).length} lượt nạp`;

  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Không có yêu cầu nào.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td class="cell-muted">${fmtDateTime(r.created_at)}</td>
      <td>${esc(r.students?.full_name || '—')}</td>
      <td class="mono" style="font-weight:700; color:var(--accent-deep);">${esc(r.transfer_content)}</td>
      <td class="mono">${fmtMoney(r.coin_amount)} coin</td>
      <td class="cell-muted">${esc(r.parent_accounts?.full_name || '—')}<br>${esc(r.parent_accounts?.phone || '')}</td>
      <td><span class="badge badge-${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status] || r.status}</span></td>
    </tr>
  `).join('');
}

document.getElementById('filterStatus').addEventListener('change', loadRows);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };

    const canUse = PROFILE.isCenterManager || PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Quản lý trung tâm/Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    await loadStats();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
