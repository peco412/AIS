import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { showConfirm, showPromptDialog } from '/js/confirmDialog.js';

let PROFILE = null;
let SELECTED_EMPLOYEE = null; // { id, center_id }

function fmtDate(d) { return new Date(d).toLocaleDateString('vi-VN'); }
function fmtTime(d) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
function currentYearMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

async function loadEmployees() {
  const { data } = await supabase.from('employees').select('id, full_name, employee_code, center_id').eq('status', 'active').order('full_name');
  document.getElementById('filterEmployee').innerHTML = '<option value="">— Chọn nhân viên —</option>' +
    (data || []).map((e) => `<option value="${e.id}" data-center="${e.center_id || ''}">${esc(e.full_name)} (${esc(e.employee_code)})</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const empId = document.getElementById('filterEmployee').value;
  const month = document.getElementById('filterMonth').value;
  document.getElementById('btnAddRow').disabled = !empId;

  if (!empId || !month) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chọn nhân viên và tháng để xem chấm công.</td></tr>';
    return;
  }

  const [year, mon] = month.split('-').map(Number);
  const monthStart = new Date(year, mon - 1, 1).toISOString();
  const monthEnd = new Date(year, mon, 1).toISOString();

  const { data, error } = await supabase
    .from('attendance_checkins')
    .select('id, check_type, checked_at, is_manual, note, employees:adjusted_by(full_name)')
    .eq('employee_id', empId)
    .gte('checked_at', monthStart).lt('checked_at', monthEnd)
    .order('checked_at', { ascending: true });

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">⚠️ Không có lượt chấm công nào trong tháng — nhân viên này sẽ không hiện trong báo cáo lương nếu không điều chỉnh tay.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td>${fmtDate(r.checked_at)}</td>
      <td><span class="badge badge-${r.check_type === 'in' ? 'active' : 'draft'}">${r.check_type === 'in' ? 'Vào' : 'Ra'}</span></td>
      <td class="cell-code">${fmtTime(r.checked_at)}</td>
      <td>${r.is_manual ? `<span class="badge badge-submitted">Điều chỉnh tay${r.employees?.full_name ? ' — ' + esc(r.employees.full_name) : ''}</span>` : '<span class="cell-muted">Tự động (GPS)</span>'}</td>
      <td class="cell-muted">${r.note ? esc(r.note) : '—'}</td>
      <td>${r.is_manual ? `<button class="btn btn-outline btn-sm" data-delete="${r.id}">Xoá</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteRow(btn.dataset.delete));
  });
}

async function deleteRow(id) {
  if (!(await showConfirm('Xoá dòng chấm công điều chỉnh tay này?', { danger: true, confirmLabel: 'Xoá' }))) return;
  const { error } = await supabase.from('attendance_checkins').delete().eq('id', id);
  if (error) { alert('Xoá thất bại: ' + error.message); return; }
  await loadRows();
}

// ---------------------------------------------------------------------
// Modal them dong thu cong
// ---------------------------------------------------------------------
const addModal = document.getElementById('addModal');
document.getElementById('btnAddRow').addEventListener('click', () => {
  const select = document.getElementById('filterEmployee');
  const opt = select.options[select.selectedIndex];
  SELECTED_EMPLOYEE = { id: select.value, center_id: opt.dataset.center || null };
  document.getElementById('mAdjustDate').value = document.getElementById('filterMonth').value ? `${document.getElementById('filterMonth').value}-01` : '';
  document.getElementById('mAdjustTime').value = '08:00';
  document.getElementById('mAdjustNote').value = '';
  addModal.classList.add('show');
});
document.getElementById('mAdjustCancel').addEventListener('click', () => addModal.classList.remove('show'));

document.getElementById('mAdjustSave').addEventListener('click', async () => {
  const date = document.getElementById('mAdjustDate').value;
  const time = document.getElementById('mAdjustTime').value;
  const type = document.getElementById('mAdjustType').value;
  const note = document.getElementById('mAdjustNote').value.trim();

  if (!date || !time) { alert('Vui lòng chọn đủ ngày và giờ.'); return; }
  if (!note) { alert('Vui lòng ghi rõ lý do điều chỉnh — bắt buộc để đối soát sau này.'); return; }
  if (!SELECTED_EMPLOYEE.center_id) {
    // Nhan vien khoi van phong khong gan co dinh trung tam — vi
    // center_id tren attendance_checkins van bat buoc, hoi chon truc
    // tiep 1 trung tam de gan cho dong nay.
    const { data: centers } = await supabase.from('centers').select('id, name').order('name');
    const pick = await showPromptDialog('Nhân viên này không gắn cố định 1 trung tâm — nhập đúng tên trung tâm để gán cho dòng chấm công này:\n' + (centers || []).map((c) => c.name).join(', '), { title: 'Chọn trung tâm' });
    const matched = (centers || []).find((c) => c.name.toLowerCase() === (pick || '').trim().toLowerCase());
    if (!matched) { alert('Không xác định được trung tâm — huỷ thao tác.'); return; }
    SELECTED_EMPLOYEE.center_id = matched.id;
  }

  const btn = document.getElementById('mAdjustSave');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = await supabase.from('attendance_checkins').insert({
      employee_id: SELECTED_EMPLOYEE.id,
      center_id: SELECTED_EMPLOYEE.center_id,
      check_type: type,
      checked_at: new Date(`${date}T${time}:00`).toISOString(),
      is_manual: true,
      adjusted_by: PROFILE.id,
      note,
    });
    if (error) throw error;
    addModal.classList.remove('show');
    await loadRows();
  } catch (err) {
    alert('Lưu thất bại: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
});

document.getElementById('filterEmployee').addEventListener('change', loadRows);
document.getElementById('filterMonth').addEventListener('change', loadRows);

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    document.getElementById('filterMonth').value = currentYearMonth();
    await loadEmployees();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
