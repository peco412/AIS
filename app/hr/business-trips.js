import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, openFile } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { attachPlaceAutocomplete, computeDrivingDistanceKm } from '/js/googleMaps.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.' + code, code) });
let PROFILE = null;
let CAN_APPROVE = false;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const scope = document.getElementById('viewScope').value;

  let query = supabase
    .from('business_trips')
    .select('id, code, title, destination_address, distance_km, trip_date, days, status, employee_id, attachment_url, employees!business_trips_employee_id_fkey(full_name, employee_code)')
    .order('created_at', { ascending: false });
  if (scope === 'mine') query = query.eq('employee_id', PROFILE.id);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_ROWS.length} đơn`;
  const tbody = document.getElementById('tableBody');
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Chưa có đơn nào.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((r) => `
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
        ${CAN_APPROVE && r.status === 'submitted'
          ? `<button class="btn btn-accent btn-sm" data-approve="${r.id}">Duyệt</button>
             <button class="btn btn-outline btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
  tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.approve, 'approved_2')));
  tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.reject, 'rejected')));
}

async function decide(id, status) {
  const { error } = await supabase.from('business_trips')
    .update({ status, approved_by: PROFILE.id, approved_at: new Date().toISOString() }).eq('id', id);
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
  const km = await computeDrivingDistanceKm(origin, destination);
  btn.disabled = false; btn.textContent = '📍 Tính tự động';

  if (km == null) { alert('Không tính được quãng đường tự động, vui lòng nhập tay.'); return; }
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
    PROFILE = profile;
    CAN_APPROVE = (profile.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode))
      || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (CAN_APPROVE) document.getElementById('deptScopeOption').style.display = 'block';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
