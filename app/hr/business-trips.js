import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, openFile } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { attachPlaceAutocomplete, computeDrivingDistanceKm } from '/js/googleMaps.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.' + code, code) });
let PROFILE = null;
let IS_DIRECT_MANAGER_MAP = {}; // employee_id -> có phải quản lý trực tiếp của người này không (tính theo từng dòng)
let IS_HR = false;
let IS_EXEC = false;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

// Xác định "quản lý trực tiếp" của TỪNG người gửi đơn — không cố định 1
// giá trị chung, vì mỗi đơn có thể do người ở phòng ban/trung tâm khác
// nhau gửi, "quản lý trực tiếp" là Trưởng/Phó phòng CÙNG phòng ban đó
// (hoặc Quản lý trung tâm nếu người gửi thuộc trung tâm, không phòng ban).
function computeActionLabel(row) {
  if (row.status === 'submitted' && IS_DIRECT_MANAGER_MAP[row.employee_id]) return { label: 'Quản lý trực tiếp duyệt', next: 'approved_1', field: 'manager' };
  if (row.status === 'approved_1' && IS_HR) return { label: 'Phòng Nhân sự duyệt', next: 'approved_2', field: 'hr' };
  if (row.status === 'approved_2' && IS_EXEC) return { label: 'Ban điều hành duyệt', next: 'approved_3', field: 'executive' };
  return null;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;

  let query = supabase
    .from('business_trips')
    .select('id, code, title, destination_address, distance_km, trip_date, days, status, employee_id, attachment_url, employees!business_trips_employee_id_fkey(full_name, employee_code, department_id, center_id)')
    .order('created_at', { ascending: false });
  if (scope === 'mine') query = query.eq('employee_id', PROFILE.id);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];

  // Tính trước xem PROFILE hiện tại có phải "quản lý trực tiếp" của từng
  // người gửi đơn hay không (so department_id/center_id với hồ sơ mình).
  IS_DIRECT_MANAGER_MAP = {};
  (data || []).forEach((r) => {
    const emp = r.employees;
    if (!emp) return;
    const isManager = emp.department_id
      ? (emp.department_id === PROFILE.departmentId && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode))
      : (emp.center_id === PROFILE.centerId && PROFILE.roleCode === 'CENTER_MANAGER');
    IS_DIRECT_MANAGER_MAP[r.employee_id] = isManager;
  });

  render();
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} đơn`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Chưa có đơn nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => {
    const action = computeActionLabel(r);
    return `
    <tr>
      <td class="cell-code">${esc(r.code)}</td>
      <td>${esc(r.employees?.full_name || '—')}</td>
      <td>${esc(r.title)}</td>
      <td class="cell-muted">${esc(r.destination_address || '—')}</td>
      <td>${r.distance_km ? r.distance_km + ' km' : '—'}</td>
      <td>${fmtDate(r.trip_date)}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td>
        ${r.attachment_url ? `<button class="btn btn-outline btn-sm" data-open="${esc(r.attachment_url)}">Xem đính kèm</button>` : ''}
        ${action ? `
          <button class="btn btn-accent btn-sm" data-approve="${r.id}" data-next="${action.next}" data-field="${action.field}">${action.label}</button>
          <button class="btn btn-outline btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
      </td>
    </tr>
  `;
  }).join('');

  tbody.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.approve, b.dataset.next, b.dataset.field)));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.reject, 'rejected', null)));
}

async function decide(id, status, field) {
  const payload = { status };
  if (field === 'manager') { payload.manager_signed_by = PROFILE.id; payload.manager_signed_at = new Date().toISOString(); }
  if (field === 'hr') { payload.hr_signed_by = PROFILE.id; payload.hr_signed_at = new Date().toISOString(); }
  if (field === 'executive') { payload.approved_by = PROFILE.id; payload.approved_at = new Date().toISOString(); }

  const { error } = await supabase.from('business_trips').update(payload).eq('id', id);
  if (error) { alert('Không thể cập nhật: ' + error.message); return; }
  await loadRows();
}

document.getElementById('viewScope').addEventListener('change', loadRows);

const modal = document.getElementById('tripModal');
const form = document.getElementById('tripForm');
const formError = document.getElementById('formError');
document.getElementById('btnAdd').addEventListener('click', () => { form.reset(); formError.classList.remove('show'); modal.classList.add('show'); });
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

// Gợi ý địa điểm qua Google Places + tự tính quãng đường lái xe
attachPlaceAutocomplete(document.getElementById('origin'));
attachPlaceAutocomplete(document.getElementById('destination'));

document.getElementById('btnCalcDistance').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const origin = document.getElementById('origin').value.trim();
  const destination = document.getElementById('destination').value.trim();
  if (!origin || !destination) { alert('Vui lòng nhập cả nơi xuất phát và nơi đến trước.'); return; }

  btn.disabled = true; btn.textContent = 'Đang tính...';
  const { km, error } = await computeDrivingDistanceKm(origin, destination);
  btn.disabled = false; btn.textContent = '📍 Tính tự động';

  if (km == null) { alert(`Không tính được quãng đường tự động:\n${error || 'không rõ lý do'}\n\nVui lòng nhập tay.`); return; }
  document.getElementById('distance').value = km;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const submitBtn = document.getElementById('submitTrip');
  submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...';

  try {
    let attachmentUrl = null;
    const file = document.getElementById('attachment').files[0];
    if (file) {
      const path = `business-trips/${PROFILE.id}/${Date.now()}_${file.name}`;
      attachmentUrl = await uploadPrivateFile(path, file);
    }

    const { error } = await supabase.from('business_trips').insert({
      employee_id: PROFILE.id,
      title: document.getElementById('title').value.trim(),
      content: document.getElementById('content').value || null,
      origin_address: document.getElementById('origin').value || null,
      destination_address: document.getElementById('destination').value.trim(),
      distance_km: document.getElementById('distance').value || null,
      trip_date: document.getElementById('tripDate').value,
      days: Number(document.getElementById('days').value),
      attachment_url: attachmentUrl,
      status: 'submitted',
    });
    if (error) throw error;
    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Gửi đơn';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentId: emp?.department_id, centerId: emp?.center_id, departmentCode: emp?.departments?.code };
    IS_HR = (PROFILE.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode));
    // Ma tran moi: duyet CAP CUOI (Ban dieu hanh) chi tinh dung EXECUTIVE,
    // KHONG con tinh TECH nhu truoc (TECH gio chi con quyen R o hau het
    // luong duyet nghiep vu).
    IS_EXEC = profile.roleCode === 'EXECUTIVE';
    // TECH van duoc XEM tat ca (dung "R" trong ma tran), chi khong duoc
    // DUYET (da tach rieng qua IS_EXEC o tren, khong lien quan gi scope xem).
    if (IS_HR || IS_EXEC || profile.roleCode === 'TECH' || ['DEPT_HEAD', 'DEPT_DEPUTY', 'CENTER_MANAGER'].includes(profile.roleCode)) {
      document.getElementById('deptScopeOption').style.display = 'block';
    }
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
