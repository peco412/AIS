import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_REQUESTS = [];
let MANUAL_STUDENT = null;

// ===================== PHẦN A — Xử lý lại yêu cầu bị kẹt =====================

async function loadRequests() {
  const tbody = document.getElementById('requestsBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('wallet_topup_requests')
    .select('id, transfer_content, coin_amount, status, created_at, wallets(student_id, students(full_name))')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_REQUESTS = data || [];
  renderRequests();
}

function renderRequests() {
  const statusFilter = document.getElementById('filterStatus').value;
  const search = document.getElementById('searchRequest').value.trim().toLowerCase();

  const rows = ALL_REQUESTS.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const hay = `${r.transfer_content} ${r.wallets?.students?.full_name || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const STATUS_LABEL = { pending: 'Đang chờ xử lý', confirmed: 'Đã xác nhận', rejected: 'Đã từ chối' };
  const STATUS_BADGE = { pending: 'submitted', confirmed: 'active', rejected: 'rejected' };

  const tbody = document.getElementById('requestsBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="6" class="empty-cell">Không có yêu cầu nào khớp bộ lọc.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td class="mono cell-code">${esc(r.transfer_content)}</td>
        <td>${esc(r.wallets?.students?.full_name || '—')}</td>
        <td class="mono">${Number(r.coin_amount).toLocaleString('vi-VN')} coin</td>
        <td class="cell-muted" style="font-size:12px;">${new Date(r.created_at).toLocaleString('vi-VN')}</td>
        <td><span class="badge badge-${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status]}</span></td>
        <td>${r.status !== 'confirmed' ? `<button class="btn btn-accent btn-sm" data-process="${r.id}" data-status="${r.status}">Xử lý lại</button>` : ''}</td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-process]').forEach((btn) => {
    btn.addEventListener('click', () => processRequest(btn.dataset.process, btn.dataset.status));
  });
}

async function processRequest(requestId, status) {
  const note = prompt('Ghi chú xác minh (bắt buộc) — VD: "Đã kiểm tra sao kê ngân hàng, tiền đã về lúc 14:32 20/8":');
  if (note === null) return; // huỷ
  if (!note.trim()) { alert('Bắt buộc ghi chú xác minh trước khi xử lý.'); return; }
  if (!confirm('Xác nhận tiền ĐÃ THỰC SỰ về tài khoản và cộng Coin ngay bây giờ? Thao tác này không thể hoàn tác.')) return;

  try {
    if (status === 'pending') {
      const { error } = await supabase.rpc('confirm_topup_request', { p_request_id: requestId, p_approver_id: PROFILE.id });
      if (error) throw error;
    } else if (status === 'rejected') {
      const { error } = await supabase.rpc('reprocess_rejected_topup', { p_request_id: requestId, p_approver_id: PROFILE.id, p_note: note });
      if (error) throw error;
    }
    alert('Đã xử lý thành công — Coin đã được cộng vào ví.');
    await loadRequests();
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
  }
}

document.getElementById('searchRequest').addEventListener('input', renderRequests);
document.getElementById('filterStatus').addEventListener('change', renderRequests);

// ===================== PHẦN B — Nạp thủ công =====================

let searchTimeout;
document.getElementById('manualSearchStudent').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  const resultsEl = document.getElementById('manualSearchResults');
  if (!q) { resultsEl.style.display = 'none'; return; }
  searchTimeout = setTimeout(async () => {
    const { data } = await supabase.from('students').select('id, full_name, center_id, centers(name)').ilike('full_name', `%${q}%`).limit(6);
    if (!data || data.length === 0) {
      resultsEl.style.display = 'block';
      resultsEl.innerHTML = '<div class="empty-cell">Không tìm thấy học sinh nào.</div>';
      return;
    }
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = data.map((s) => `
      <button type="button" class="btn btn-outline btn-sm" data-student="${s.id}" data-name="${esc(s.full_name)}" data-center="${esc(s.centers?.name || '—')}" style="margin: 2px 6px 2px 0;">
        ${esc(s.full_name)} — ${esc(s.centers?.name || 'chưa gắn trung tâm')}
      </button>
    `).join('');
    resultsEl.querySelectorAll('[data-student]').forEach((btn) => {
      btn.addEventListener('click', () => {
        MANUAL_STUDENT = { id: btn.dataset.student, full_name: btn.dataset.name, center: btn.dataset.center };
        document.getElementById('manualSelectedStudent').style.display = 'block';
        document.getElementById('manualSelectedStudent').textContent = `Đã chọn: ${btn.dataset.name} — ${btn.dataset.center}`;
        resultsEl.style.display = 'none';
        document.getElementById('manualSearchStudent').value = '';
        document.getElementById('btnManualSubmit').disabled = false;
      });
    });
  }, 300);
});

document.getElementById('btnManualSubmit').addEventListener('click', async () => {
  const errBox = document.getElementById('manualError');
  errBox.classList.remove('show');

  const coinAmount = Number(document.getElementById('manualCoinAmount').value);
  const method = document.getElementById('manualMethod').value;
  const reason = document.getElementById('manualReason').value.trim();

  if (!MANUAL_STUDENT) { errBox.textContent = 'Vui lòng chọn học sinh.'; errBox.classList.add('show'); return; }
  if (!coinAmount || coinAmount <= 0) { errBox.textContent = 'Vui lòng nhập đúng số Coin.'; errBox.classList.add('show'); return; }
  if (!reason) { errBox.textContent = 'Bắt buộc ghi rõ lý do.'; errBox.classList.add('show'); return; }
  if (!confirm(`Xác nhận cộng ${coinAmount.toLocaleString('vi-VN')} Coin vào ví của ${MANUAL_STUDENT.full_name}?\n\nLý do: ${reason}\n\nThao tác này không thể hoàn tác.`)) return;

  const btn = document.getElementById('btnManualSubmit');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('topup_wallet', {
      p_student_id: MANUAL_STUDENT.id, p_coin_amount: coinAmount, p_method: method,
      p_created_by: PROFILE.id, p_case_discount_rate: 0, p_case_discount_note: null,
      p_reason: reason,
    });
    if (error) throw error;
    alert('Đã cộng Coin thành công.');
    MANUAL_STUDENT = null;
    document.getElementById('manualSelectedStudent').style.display = 'none';
    document.getElementById('manualCoinAmount').value = '';
    document.getElementById('manualReason').value = '';
    btn.disabled = true;
  } catch (err) {
    errBox.textContent = `Lỗi: ${err.message}`;
    errBox.classList.add('show');
  } finally {
    btn.textContent = 'Xác nhận cộng Coin';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    if (profile.roleCode !== 'TECH' && profile.departmentCode !== 'ACC' && profile.roleCode !== 'EXECUTIVE') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành/Kỹ thuật mới dùng được trang này.</div>';
      return;
    }
    PROFILE = profile;
    await loadRequests();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
