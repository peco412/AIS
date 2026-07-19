import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.student_' + code, code) });
let PROFILE = null;
let CLASSES = [], LEVELS = [];
let ALL_ROWS = [];

function fillSelect(el, items, { valueKey = 'id', labelKey = 'name', placeholder } = {}) {
  el.innerHTML = '';
  if (placeholder) el.innerHTML += `<option value="">${placeholder}</option>`;
  items.forEach((i) => { el.innerHTML += `<option value="${i[valueKey]}">${i[labelKey]}</option>`; });
}

async function loadLookups() {
  const [{ data: classes }, { data: levels }, { data: consultants }] = await Promise.all([
    supabase.from('classes').select('id, name, course_id').eq('center_id', PROFILE.centerId).order('name'),
    supabase.from('program_levels').select('id, name').order('display_order'),
    supabase.from('employees').select('id, full_name, system_roles!inner(code)').eq('system_roles.code', 'CONSULTANT').eq('center_id', PROFILE.centerId),
  ]);
  CLASSES = classes || []; LEVELS = levels || [];
  fillSelect(document.getElementById('filterClass'), CLASSES, { placeholder: 'Tất cả các lớp' });
  fillSelect(document.getElementById('classSelect'), CLASSES, { placeholder: '— Chưa phân lớp —' });
  fillSelect(document.getElementById('entryLevel'), LEVELS, { placeholder: '—' });
  fillSelect(document.getElementById('sourceConsultant'), consultants || [], { labelKey: 'full_name', placeholder: '— Không qua tư vấn viên nào —' });
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const { data, error } = await supabase
    .from('students')
    .select('id, student_code, full_name, dob, parent_name, phone, status, class_id, classes(name)')
    .eq('center_id', PROFILE.centerId)
    .order('full_name');
  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

function render() {
  const cls = document.getElementById('filterClass').value;
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  const rows = ALL_ROWS.filter((r) =>
    (!cls || r.class_id === cls) &&
    (!status || r.status === status) &&
    (!search || r.full_name.toLowerCase().includes(search) || (r.parent_name || '').toLowerCase().includes(search))
  );
  document.getElementById('resultCount').textContent = `${rows.length} học viên`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Không có học viên nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-code mono">${esc(r.student_code || '—')}</td>
      <td><span class="avatar-sm">${esc((r.full_name || '?').trim().split(/\s+/).slice(-2).map(w=>w[0]).join('').toUpperCase())}</span>${esc(r.full_name)}</td>
      <td class="cell-muted">${fmtDate(r.dob)}</td>
      <td>${r.classes?.name ? esc(r.classes.name) : '<span class="cell-muted">Chưa phân lớp</span>'}</td>
      <td class="cell-muted">${esc(r.parent_name || '—')}</td>
      <td class="cell-muted">${esc(r.phone || '—')}</td>
      <td><span class="badge badge-${r.status === 'studying' ? 'active' : r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td style="display:flex; gap:6px;">
        <button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>
        ${r.class_id ? `<button class="btn btn-outline btn-sm" data-transfer="${r.id}" title="Chuyển sang lớp khác, tự đối soát học phí">Đổi lớp</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
  tbody.querySelectorAll('[data-transfer]').forEach((b) => b.addEventListener('click', () => openTransfer(b.dataset.transfer)));
}

['filterClass', 'filterStatus', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('change', render);
  document.getElementById(id).addEventListener('input', render);
});

// ---------------------------------------------------------------------
// Modal thêm/sửa
// ---------------------------------------------------------------------
const modal = document.getElementById('studentModal');
const form = document.getElementById('studentForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('studentId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm học viên';
  document.getElementById('enrollmentDate').value = new Date().toISOString().slice(0, 10);
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

async function openEdit(id) {
  const { data: row } = await supabase.from('students').select('*').eq('id', id).single();
  if (!row) return;
  document.getElementById('modalTitle').textContent = `Sửa học viên — ${row.full_name}`;
  document.getElementById('studentId').value = row.id;
  document.getElementById('fullName').value = row.full_name;
  document.getElementById('dob').value = row.dob || '';
  document.getElementById('currentSchool').value = row.current_school || '';
  document.getElementById('entryLevel').value = row.entry_level_id || '';
  document.getElementById('sourceConsultant').value = row.source_consultant_id || '';
  document.getElementById('agreedPaymentPlan').value = row.agreed_payment_plan || '';
  document.getElementById('classSelect').value = row.class_id || '';
  document.getElementById('parentName').value = row.parent_name || '';
  document.getElementById('email').value = row.email || '';
  document.getElementById('phone').value = row.phone || '';
  document.getElementById('backupPhone').value = row.backup_phone || '';
  document.getElementById('enrollmentDate').value = row.enrollment_date || '';
  document.getElementById('status').value = row.status;
  formError.classList.remove('show');
  modal.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('studentId').value;
  const payload = {
    full_name: document.getElementById('fullName').value.trim(),
    dob: document.getElementById('dob').value || null,
    current_school: document.getElementById('currentSchool').value || null,
    entry_level_id: document.getElementById('entryLevel').value || null,
    source_consultant_id: document.getElementById('sourceConsultant').value || null,
    agreed_payment_plan: document.getElementById('agreedPaymentPlan').value || null,
    class_id: document.getElementById('classSelect').value || null,
    parent_name: document.getElementById('parentName').value || null,
    email: document.getElementById('email').value || null,
    phone: document.getElementById('phone').value || null,
    backup_phone: document.getElementById('backupPhone').value || null,
    enrollment_date: document.getElementById('enrollmentDate').value || null,
    status: document.getElementById('status').value,
    center_id: PROFILE.centerId,
  };

  const btn = document.getElementById('submitStudent');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('students').update(payload).eq('id', id)
      : await supabase.from('students').insert(payload);
    if (error) throw error;
    modal.classList.remove('show');
    await loadLookups(); // sĩ số lớp có thể đã đổi (trigger tự cập nhật)
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
});

// ---------------------------------------------------------------------
// Modal "Đổi lớp" — MỚI: chuyển học viên ĐANG CÓ LỚP sang lớp khác, tự
// động huỷ hoá đơn cũ + đối soát học phí (dư cộng ví, thiếu lên hoá đơn
// mới) qua hàm transfer_student_class() — không sửa thẳng lớp như form
// "Sửa học viên" nữa, tránh bỏ sót phần đối soát tiền.
// ---------------------------------------------------------------------
const PAYMENT_OPTION_LABELS = {
  BY_MONTH: 'Theo tháng', BY_COURSE: 'Theo khoá hiện tại',
  COMBO_2_COURSES: 'Đóng 2 khoá liền', FULL_SUB_LEVEL: 'Trọn cấp độ con',
};
let TRANSFER_STUDENT = null;

async function openTransfer(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  if (!row) return;
  TRANSFER_STUDENT = row;

  document.getElementById('transferError').classList.remove('show');
  document.getElementById('transferStudentName').textContent = row.full_name;
  document.getElementById('transferCurrentClass').textContent = row.classes?.name || '—';
  fillSelect(document.getElementById('transferNewClass'), CLASSES.filter((c) => c.id !== row.class_id), { placeholder: '— Chọn lớp mới —' });
  document.getElementById('transferPaymentOption').value = '';
  document.getElementById('transferPricePreview').textContent = '';
  document.getElementById('transferOverride').checked = false;
  document.getElementById('transferOverrideRow').style.display = ['EXECUTIVE', 'TECH', 'CENTER_MANAGER'].includes(PROFILE.roleCode) ? 'flex' : 'none';
  document.getElementById('transferModal').classList.add('show');
}

async function previewTransferPrice() {
  const previewEl = document.getElementById('transferPricePreview');
  const option = document.getElementById('transferPaymentOption').value;
  const newClassId = document.getElementById('transferNewClass').value;
  if (!option || !newClassId) { previewEl.textContent = ''; return; }

  const newClass = CLASSES.find((c) => c.id === newClassId);
  if (!newClass?.course_id) { previewEl.textContent = 'Lớp này chưa gắn Khoá học cụ thể — không tính được giá.'; return; }

  previewEl.textContent = 'Đang tính...';
  const { data: amount, error } = await supabase.rpc('calculate_payment_option_amount_for_course', {
    p_course_id: newClass.course_id, p_option: option,
  });
  previewEl.textContent = error ? `Không tính được: ${error.message}` : `${new Intl.NumberFormat('vi-VN').format(amount)} đ`;
}
document.getElementById('transferPaymentOption').addEventListener('change', previewTransferPrice);
document.getElementById('transferNewClass').addEventListener('change', previewTransferPrice);

document.getElementById('closeTransferModal').addEventListener('click', () => document.getElementById('transferModal').classList.remove('show'));
document.getElementById('cancelTransferModal').addEventListener('click', () => document.getElementById('transferModal').classList.remove('show'));

document.getElementById('submitTransfer').addEventListener('click', async () => {
  const errBox = document.getElementById('transferError');
  errBox.classList.remove('show');
  const newClassId = document.getElementById('transferNewClass').value;
  const option = document.getElementById('transferPaymentOption').value;
  if (!newClassId || !option) {
    errBox.textContent = 'Vui lòng chọn lớp mới và hình thức đóng học phí.';
    errBox.classList.add('show');
    return;
  }

  const btn = document.getElementById('submitTransfer');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  const { error } = await supabase.rpc('transfer_student_class', {
    p_student_id: TRANSFER_STUDENT.id, p_new_class_id: newClassId, p_new_payment_option: option,
    p_override_sequence: document.getElementById('transferOverride').checked,
  });
  btn.disabled = false; btn.textContent = 'Xác nhận đổi lớp';

  if (error) {
    errBox.textContent = error.message;
    errBox.classList.add('show');
    return;
  }
  document.getElementById('transferModal').classList.remove('show');
  await loadLookups();
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('center_id, centers(name)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id };

    if (!PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(profile.roleCode)) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không thuộc trung tâm nào để quản lý học viên.</div>';
      return;
    }
    document.getElementById('centerHint').textContent = `Trung tâm: ${emp?.centers?.name || '—'}`;

    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
