import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ACTIVE_REQUEST_ID = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

async function loadRows() {
  const status = document.getElementById('filterStatus').value;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('wallet_topup_requests')
    .select('id, coin_amount, transfer_content, status, created_at, wallets(student_id, students(full_name)), parent_accounts(full_name, phone)')
    .eq('status', status)
    .order('created_at', { ascending: status === 'pending' });

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  document.getElementById('resultCount').textContent = `${(data || []).length} yêu cầu`;

  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Không có yêu cầu nào.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td class="cell-muted">${fmtDateTime(r.created_at)}</td>
      <td>${esc(r.wallets?.students?.full_name || '—')}</td>
      <td class="mono" style="font-weight:700; color:var(--accent-deep);">${esc(r.transfer_content)}</td>
      <td class="mono">${fmtMoney(r.coin_amount)} coin</td>
      <td class="cell-muted">${esc(r.parent_accounts?.full_name || '—')}<br>${esc(r.parent_accounts?.phone || '')}</td>
      <td>
        ${r.status === 'pending' ? `
          <button class="btn btn-accent btn-sm" data-confirm="${r.id}">✅ Xác nhận</button>
          <button class="btn btn-outline btn-sm" data-reject="${r.id}">✕ Từ chối</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-confirm]').forEach((btn) => btn.addEventListener('click', () => confirmRequest(btn.dataset.confirm)));
  tbody.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => openRejectModal(btn.dataset.reject)));
}

async function confirmRequest(id) {
  if (!confirm('Xác nhận đã thấy đúng khoản chuyển khoản này trong sao kê ngân hàng? Sau khi xác nhận sẽ CỘNG NGAY AIScoins vào ví, không hoàn tác được.')) return;

  const { error } = await supabase.rpc('confirm_topup_request', { p_request_id: id, p_approver_id: PROFILE.id });
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadRows();
}

const rejectModal = document.getElementById('rejectModal');
function openRejectModal(id) {
  ACTIVE_REQUEST_ID = id;
  document.getElementById('rejectReason').value = '';
  rejectModal.classList.add('show');
}
document.getElementById('closeRejectModal').addEventListener('click', () => rejectModal.classList.remove('show'));
document.getElementById('cancelRejectModal').addEventListener('click', () => rejectModal.classList.remove('show'));

document.getElementById('btnSubmitReject').addEventListener('click', async () => {
  const reason = document.getElementById('rejectReason').value.trim();
  const { error } = await supabase.rpc('reject_topup_request', { p_request_id: ACTIVE_REQUEST_ID, p_approver_id: PROFILE.id, p_reason: reason || null });
  if (error) { alert('Lỗi: ' + error.message); return; }
  rejectModal.classList.remove('show');
  await loadRows();
});

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
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
