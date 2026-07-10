import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let IS_ACC = false;
let IS_CENTER_STAFF = false;
let SELECTED_STUDENT = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

// ---------------------------------------------------------------------
// Yêu cầu rút Ví — 2 bước: Trung tâm xác nhận -> Kế toán duyệt
// ---------------------------------------------------------------------
const WALLET_STATUS_LABEL = { pending: 'Chờ trung tâm xác nhận', center_confirmed: 'Chờ Kế toán duyệt', approved: 'Đã hoàn', rejected: 'Từ chối' };
const WALLET_STATUS_BADGE = { pending: 'submitted', center_confirmed: 'approved_1', approved: 'active', rejected: 'rejected' };

async function loadWalletRequests() {
  const tbody = document.getElementById('walletBody');
  const { data, error } = await supabase
    .from('wallet_withdrawal_requests')
    .select('id, preview_amount_vnd, actual_amount_vnd, status, created_at, wallets(student_id, students(full_name))')
    .in('status', ['pending', 'center_confirmed'])
    .order('created_at', { ascending: true });

  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Không có yêu cầu nào đang chờ.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td>${esc(r.wallets?.students?.full_name || '—')}</td>
      <td class="mono">${fmtMoney(r.preview_amount_vnd)} đ</td>
      <td><span class="badge badge-${WALLET_STATUS_BADGE[r.status]}">${WALLET_STATUS_LABEL[r.status]}</span></td>
      <td>
        ${(r.status === 'pending' && IS_CENTER_STAFF) ? `<button class="btn btn-accent btn-sm" data-confirm="${r.id}">Xác nhận</button>` : ''}
        ${(r.status === 'center_confirmed' && IS_ACC) ? `<button class="btn btn-accent btn-sm" data-approve="${r.id}">Duyệt hoàn</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Xác nhận yêu cầu rút ví này để chuyển sang Kế toán duyệt?')) return;
    const { error: err } = await supabase.rpc('center_confirm_withdrawal', { p_request_id: b.dataset.confirm, p_confirmer_id: PROFILE.id });
    if (err) { alert('Lỗi: ' + err.message); return; }
    await loadWalletRequests();
  }));
  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Duyệt hoàn tiền ví này? Sẽ tất toán ví, không hoàn tác được.')) return;
    const { error: err } = await supabase.rpc('approve_wallet_withdrawal', { p_request_id: b.dataset.approve, p_approver_id: PROFILE.id });
    if (err) { alert('Lỗi: ' + err.message); return; }
    alert('Đã duyệt. Vui lòng chuyển tiền hoàn thực tế cho phụ huynh.');
    await loadWalletRequests();
  }));
}

// ---------------------------------------------------------------------
// Yêu cầu hoàn tiền mặt/Chuyển khoản
// ---------------------------------------------------------------------
const COUNTER_STATUS_LABEL = { pending: 'Chờ duyệt', approved: 'Đã hoàn', rejected: 'Từ chối' };
const COUNTER_STATUS_BADGE = { pending: 'submitted', approved: 'active', rejected: 'rejected' };

async function loadCounterRequests() {
  const tbody = document.getElementById('counterBody');
  const { data, error } = await supabase
    .from('tuition_refund_requests')
    .select('id, code, amount_paid, refund_amount, status, students(full_name)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có yêu cầu nào.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td class="cell-code">${esc(r.code || '—')}</td>
      <td>${esc(r.students?.full_name || '—')}</td>
      <td class="mono">${fmtMoney(r.amount_paid)} đ</td>
      <td class="mono" style="font-weight:700;">${fmtMoney(r.refund_amount)} đ</td>
      <td><span class="badge badge-${COUNTER_STATUS_BADGE[r.status]}">${COUNTER_STATUS_LABEL[r.status]}</span></td>
      <td>
        ${(r.status === 'pending' && IS_ACC) ? `
          <button class="btn btn-accent btn-sm" data-approve-counter="${r.id}">Duyệt</button>
          <button class="btn btn-outline btn-sm" data-reject-counter="${r.id}">Từ chối</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-approve-counter]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Duyệt hoàn phí này?')) return;
    const { error: err } = await supabase.rpc('approve_tuition_refund', { p_request_id: b.dataset.approveCounter, p_approver_id: PROFILE.id });
    if (err) { alert('Lỗi: ' + err.message); return; }
    alert('Đã duyệt. Vui lòng chuyển tiền hoàn thực tế cho phụ huynh.');
    await loadCounterRequests();
  }));
  tbody.querySelectorAll('[data-reject-counter]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt('Lý do từ chối:');
    if (reason === null) return;
    const { error: err } = await supabase.rpc('reject_tuition_refund', { p_request_id: b.dataset.rejectCounter, p_approver_id: PROFILE.id, p_reason: reason });
    if (err) { alert('Lỗi: ' + err.message); return; }
    await loadCounterRequests();
  }));
}

// ---------------------------------------------------------------------
// Tạo yêu cầu hoàn tiền mặt/CK mới
// ---------------------------------------------------------------------
const counterModal = document.getElementById('counterRefundModal');
document.getElementById('btnNewCounterRefund').addEventListener('click', () => {
  document.getElementById('counterFormError').classList.remove('show');
  SELECTED_STUDENT = null;
  document.getElementById('refundStudentSearch').value = '';
  document.getElementById('refundStudentResult').textContent = '';
  document.getElementById('refundAmountPaid').value = '';
  document.getElementById('refundCoursesCompleted').value = '';
  document.getElementById('refundCourseFee').value = '';
  document.getElementById('refundPromoRate').value = '0';
  document.getElementById('refundReason').value = '';
  document.getElementById('refundPreview').textContent = '';
  counterModal.classList.add('show');
});
document.getElementById('closeCounterModal').addEventListener('click', () => counterModal.classList.remove('show'));
document.getElementById('cancelCounterModal').addEventListener('click', () => counterModal.classList.remove('show'));

let studentSearchTimer;
document.getElementById('refundStudentSearch').addEventListener('input', (e) => {
  clearTimeout(studentSearchTimer);
  const q = e.target.value.trim();
  studentSearchTimer = setTimeout(async () => {
    if (!q) { document.getElementById('refundStudentResult').textContent = ''; SELECTED_STUDENT = null; return; }
    const { data } = await supabase.from('students').select('id, full_name').ilike('full_name', `%${q}%`).limit(1);
    if (data && data.length > 0) {
      SELECTED_STUDENT = data[0];
      document.getElementById('refundStudentResult').innerHTML = `✅ <strong>${esc(data[0].full_name)}</strong>`;
    } else {
      SELECTED_STUDENT = null;
      document.getElementById('refundStudentResult').textContent = 'Không tìm thấy học sinh.';
    }
  }, 350);
});

function updateRefundPreview() {
  const paid = Number(document.getElementById('refundAmountPaid').value) || 0;
  const completed = Number(document.getElementById('refundCoursesCompleted').value) || 0;
  const fee = Number(document.getElementById('refundCourseFee').value) || 0;
  const promo = Number(document.getElementById('refundPromoRate').value) || 0;
  // So tien hoan = So tien thuc nap - (So khoa da hoc x Hoc phi don khoa goc x (1 - % khuyen mai))
  const refund = paid - (completed * fee * (1 - promo / 100));
  document.getElementById('refundPreview').textContent = `Số tiền hoàn dự kiến: ${fmtMoney(Math.max(0, refund))} đ`;
  return refund;
}
['refundAmountPaid', 'refundCoursesCompleted', 'refundCourseFee', 'refundPromoRate'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateRefundPreview);
});

document.getElementById('btnSubmitCounterRefund').addEventListener('click', async () => {
  const errBox = document.getElementById('counterFormError');
  errBox.classList.remove('show');
  if (!SELECTED_STUDENT) { errBox.textContent = 'Vui lòng tìm và chọn đúng học sinh.'; errBox.classList.add('show'); return; }

  const refund = updateRefundPreview();
  const payload = {
    student_id: SELECTED_STUDENT.id,
    source: document.getElementById('refundSource').value,
    amount_paid: Number(document.getElementById('refundAmountPaid').value) || 0,
    courses_completed: Number(document.getElementById('refundCoursesCompleted').value) || 0,
    course_fee: Number(document.getElementById('refundCourseFee').value) || 0,
    promo_rate: (Number(document.getElementById('refundPromoRate').value) || 0) / 100,
    refund_amount: Math.max(0, refund),
    reason: document.getElementById('refundReason').value || null,
    requested_by: PROFILE.id,
  };
  if (!payload.amount_paid) { errBox.textContent = 'Vui lòng nhập số tiền thực đã nạp.'; errBox.classList.add('show'); return; }

  const btn = document.getElementById('btnSubmitCounterRefund');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const { error } = await supabase.from('tuition_refund_requests').insert(payload);
    if (error) throw error;
    counterModal.classList.remove('show');
    await loadCounterRequests();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi yêu cầu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };
    IS_ACC = PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    IS_CENTER_STAFF = ['CENTER_MANAGER', 'CONSULTANT'].includes(profile.roleCode) || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);

    if (!IS_CENTER_STAFF) document.getElementById('btnNewCounterRefund').style.display = 'none';

    await Promise.all([loadWalletRequests(), loadCounterRequests()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
