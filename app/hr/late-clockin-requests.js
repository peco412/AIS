import { bootShell } from '/js/shell.js';
import { supabase, esc, notifyDepartmentHeads } from '/js/supabase.js';
import { t } from '/js/i18n.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.' + code, { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }[code] || code) });
const STATUS_BADGE = { pending: 'submitted', approved: 'active', rejected: 'rejected' };

let PROFILE = null;
let IS_HR_DEPUTY = false;

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;

  let query = supabase.from('late_clockin_requests')
    .select('id, code, late_date, reason, status, employee_id, employees!late_clockin_requests_employee_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (scope === 'mine') query = query.eq('employee_id', PROFILE.id);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có đơn nào.</td></tr>'; return; }

  document.getElementById('resultCount').textContent = `${data.length} đơn`;

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td class="cell-code">${esc(r.code || '—')}</td>
      <td>${esc(r.employees?.full_name || '—')}</td>
      <td class="cell-muted">${fmtDate(r.late_date)}</td>
      <td class="cell-muted">${esc(r.reason)}</td>
      <td><span class="badge badge-${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status]}</span></td>
      <td>
        ${(r.status === 'pending' && IS_HR_DEPUTY) ? `
          <button class="btn btn-accent btn-sm" data-approve="${r.id}">Duyệt</button>
          <button class="btn btn-outline btn-sm" data-reject="${r.id}">Từ chối</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.approve, 'approved')));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.reject, 'rejected')));
}

async function decide(id, status) {
  if (!confirm(status === 'approved' ? 'Duyệt đơn này? Ngày chấm công trễ sẽ được tính là đúng giờ khi tính lương.' : 'Từ chối đơn này?')) return;
  const { error } = await supabase.from('late_clockin_requests').update({ status, approved_by: PROFILE.id, approved_at: new Date().toISOString() }).eq('id', id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadRows();
}

document.getElementById('viewScope').addEventListener('change', loadRows);

const modal = document.getElementById('createModal');
document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('formError').classList.remove('show');
  document.getElementById('lateDate').value = '';
  document.getElementById('reason').value = '';
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitBtn').addEventListener('click', async () => {
  const errBox = document.getElementById('formError');
  errBox.classList.remove('show');
  const lateDate = document.getElementById('lateDate').value;
  const reason = document.getElementById('reason').value.trim();
  if (!lateDate || !reason) { errBox.textContent = 'Vui lòng nhập đầy đủ.'; errBox.classList.add('show'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const { error } = await supabase.from('late_clockin_requests').insert({ employee_id: PROFILE.id, late_date: lateDate, reason });
    if (error) throw error;
    notifyDepartmentHeads('HR', 'Có đơn xin chấm công trễ mới',
      `${PROFILE.fullName} vừa gửi đơn xin chấm công trễ ngày ${new Date(lateDate).toLocaleDateString('vi-VN')} — cần Phó phòng Nhân sự duyệt.`, '/hr/late-clockin-requests.html');
    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi đơn';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };
    // Ma tran phan quyen moi: DUY NHAT Pho phong Nhan su duoc duyet - kể
    // cả BĐH/Kỹ thuật cũng KHÔNG được (đúng đặc tả X cho cả 2 ô này).
    IS_HR_DEPUTY = (PROFILE.departmentCode === 'HR' && profile.roleCode === 'DEPT_DEPUTY');
    if (IS_HR_DEPUTY) document.getElementById('allScopeOption').style.display = 'block';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
