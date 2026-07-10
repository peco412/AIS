import { bootShell } from '/js/shell.js';
import { supabase, usernameToEmail, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

let PROFILE = null;
let LOOKUPS = { departments: [], positions: [], centers: [], roles: [] };
let ALL_ROWS = [];

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.employee_' + code, code) });

function fillSelect(el, items, { valueKey = 'id', labelKey = 'name', placeholder } = {}) {
  el.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    el.appendChild(opt);
  }
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    el.appendChild(opt);
  });
}

async function loadLookups() {
  const [{ data: departments }, { data: positions }, { data: centers }, { data: roles }, { data: divisions }] = await Promise.all([
    supabase.from('departments').select('id, code, name').order('name'),
    supabase.from('positions').select('id, name, department_id').order('name'),
    supabase.from('centers').select('id, name, division_id').order('name'),
    supabase.from('system_roles').select('id, code, name').order('name'),
    supabase.from('divisions').select('id, code').order('code'),
  ]);
  LOOKUPS = {
    departments: departments || [],
    positions: positions || [],
    centers: centers || [],
    roles: roles || [],
    divisions: divisions || [],
  };

  fillSelect(document.getElementById('filterDept'), LOOKUPS.departments, { placeholder: 'Tất cả phòng ban' });
  fillSelect(document.getElementById('filterCenter'), LOOKUPS.centers, { placeholder: 'Tất cả trung tâm' });
  fillSelect(document.getElementById('department'), LOOKUPS.departments, { placeholder: '— Chọn phòng ban —' });
  fillSelect(document.getElementById('role'), LOOKUPS.roles, { valueKey: 'id', labelKey: 'name', placeholder: '— Chọn vai trò —' });
  updateCenterOptions('');
}

// Chỉ hiện đúng trung tâm thuộc phân hệ đã chọn — tránh gán nhầm nhân viên
// ALOHA vào trung tâm iLingo hoặc ngược lại. Bỏ trống = khối văn phòng,
// không thuộc trung tâm nào (đúng nhân sự HR/ACC/BĐH... theo đề bài).
function updateCenterOptions(divisionCode) {
  const centerSelect = document.getElementById('center');
  if (!divisionCode) {
    centerSelect.innerHTML = '<option value="">— Không thuộc trung tâm nào (khối văn phòng) —</option>';
    centerSelect.disabled = true;
    return;
  }
  const division = LOOKUPS.divisions.find((d) => d.code === divisionCode);
  const centersInDivision = LOOKUPS.centers.filter((c) => c.division_id === division?.id);
  centerSelect.disabled = false;
  fillSelect(centerSelect, centersInDivision, { placeholder: '— Chọn trung tâm —' });
}

document.getElementById('division').addEventListener('change', (e) => updateCenterOptions(e.target.value));

function updatePositionOptions(departmentId) {
  const positions = LOOKUPS.positions.filter((p) => p.department_id === departmentId);
  fillSelect(document.getElementById('position'), positions, { placeholder: '— Chọn chức vụ —' });
}

document.getElementById('department').addEventListener('change', (e) => updatePositionOptions(e.target.value));

async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('employees')
    .select(`
      id, employee_code, full_name, phone, status,
      departments ( name ), positions ( name ), centers ( name )
    `)
    .order('employee_code');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Lỗi tải dữ liệu: ${error.message}</td></tr>`;
    return;
  }
  ALL_ROWS = data || [];
  applyFilters();
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
}

function applyFilters() {
  const dept = document.getElementById('filterDept').value;
  const center = document.getElementById('filterCenter').value;
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  const filtered = ALL_ROWS.filter((row) => {
    if (status && row.status !== status) return false;
    if (search && !(row.full_name.toLowerCase().includes(search) || row.employee_code.toLowerCase().includes(search))) return false;
    return true;
  });

  const tbody = document.getElementById('employeeTableBody');
  document.getElementById('resultCount').textContent = `${filtered.length} nhân viên`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Không tìm thấy nhân viên phù hợp.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((row) => `
    <tr>
      <td class="cell-code">${esc(row.employee_code)}</td>
      <td><span class="avatar-sm">${esc(initials(row.full_name))}</span>${esc(row.full_name)}</td>
      <td>${esc(row.positions?.name || '—')}</td>
      <td>${esc(row.departments?.name || '—')}</td>
      <td>${row.centers?.name ? esc(row.centers.name) : '<span class="cell-muted">Văn phòng</span>'}</td>
      <td class="cell-muted">${esc(row.phone || '—')}</td>
      <td><span class="badge badge-${row.status}">${esc(STATUS_LABEL[row.status] || row.status)}</span></td>
      <td><button class="btn btn-outline btn-sm" data-edit="${row.id}">Sửa</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.edit));
  });
}

['filterDept', 'filterCenter', 'filterStatus', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('input', applyFilters);
  document.getElementById(id).addEventListener('change', applyFilters);
});

// ---------------------------------------------------------------------
// Modal thêm / sửa
// ---------------------------------------------------------------------
const modal = document.getElementById('employeeModal');
const form = document.getElementById('employeeForm');
const formError = document.getElementById('formError');

function openAddModal() {
  form.reset();
  document.getElementById('employeeId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm nhân viên';
  document.getElementById('username').closest('.field').style.display = 'block';
  document.getElementById('tempPassword').closest('.field').style.display = 'block';
  updateCenterOptions('');
  formError.classList.remove('show');
  modal.classList.add('show');
}

// Tạo mật khẩu tạm ngẫu nhiên đủ mạnh (chữ hoa/thường/số), HR có thể bấm lại
// nhiều lần hoặc tự gõ tay đè lên nếu muốn đặt mật khẩu cụ thể.
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const bytes = new Uint32Array(8);
  crypto.getRandomValues(bytes);
  let pass = upper[bytes[0] % upper.length] + digits[bytes[1] % digits.length];
  for (let i = 2; i < 8; i++) pass += all[bytes[i] % all.length];
  return pass;
}
document.getElementById('btnGenPassword').addEventListener('click', () => {
  document.getElementById('tempPassword').value = generateTempPassword();
});

async function openEditModal(employeeId) {
  formError.classList.remove('show');
  const { data: row, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .single();
  if (error || !row) return;

  document.getElementById('modalTitle').textContent = `Sửa nhân viên — ${row.employee_code}`;
  document.getElementById('employeeId').value = row.id;
  document.getElementById('fullName').value = row.full_name || '';
  document.getElementById('phone').value = row.phone || '';
  document.getElementById('email').value = row.email || '';
  document.getElementById('dob').value = row.dob || '';
  document.getElementById('department').value = row.department_id || '';
  updatePositionOptions(row.department_id);
  document.getElementById('position').value = row.position_id || '';

  // Suy ra phân hệ từ trung tâm hiện tại của nhân viên (nếu có) để hiện đúng
  // danh sách trung tâm tương ứng trước khi set giá trị center thật.
  const centerRow = LOOKUPS.centers.find((c) => c.id === row.center_id);
  const divisionOfCenter = LOOKUPS.divisions.find((d) => d.id === centerRow?.division_id);
  document.getElementById('division').value = divisionOfCenter?.code || '';
  updateCenterOptions(divisionOfCenter?.code || '');
  document.getElementById('center').value = row.center_id || '';

  document.getElementById('role').value = row.role_id || '';
  document.getElementById('status').value = row.status || 'active';
  document.getElementById('contractType').value = row.contract_type || 'full_time';
  document.getElementById('hireDate').value = row.hire_date || '';
  document.getElementById('isForeignTeacher').checked = !!row.is_foreign_teacher;
  document.getElementById('isAcademicBoard').checked = !!row.is_academic_board;
  document.getElementById('canTeach').checked = !!row.can_teach;
  document.getElementById('hometown').value = row.hometown || '';
  document.getElementById('idCardNumber').value = row.id_card_number || '';
  document.getElementById('address').value = row.address || '';
  document.getElementById('emergencyName').value = row.emergency_contact_name || '';
  document.getElementById('emergencyPhone').value = row.emergency_contact_phone || '';
  document.getElementById('note').value = row.note || '';
  document.getElementById('username').closest('.field').style.display = 'none'; // không đổi username khi sửa
  document.getElementById('tempPassword').closest('.field').style.display = 'none';

  modal.classList.add('show');
}

function closeModal() { modal.classList.remove('show'); }
document.getElementById('btnAddEmployee').addEventListener('click', openAddModal);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelModal').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');

  const employeeId = document.getElementById('employeeId').value;
  const payload = {
    full_name: document.getElementById('fullName').value.trim(),
    phone: document.getElementById('phone').value.trim() || null,
    email: document.getElementById('email').value.trim() || null,
    dob: document.getElementById('dob').value || null,
    department_id: document.getElementById('department').value || null,
    position_id: document.getElementById('position').value || null,
    center_id: document.getElementById('center').value || null,
    role_id: document.getElementById('role').value || null,
    status: document.getElementById('status').value,
    contract_type: document.getElementById('contractType').value,
    hire_date: document.getElementById('hireDate').value || null,
    is_foreign_teacher: document.getElementById('isForeignTeacher').checked,
    is_academic_board: document.getElementById('isAcademicBoard').checked,
    can_teach: document.getElementById('canTeach').checked,
    hometown: document.getElementById('hometown').value.trim() || null,
    id_card_number: document.getElementById('idCardNumber').value.trim() || null,
    address: document.getElementById('address').value.trim() || null,
    emergency_contact_name: document.getElementById('emergencyName').value.trim() || null,
    emergency_contact_phone: document.getElementById('emergencyPhone').value.trim() || null,
    note: document.getElementById('note').value.trim() || null,
  };

  const submitBtn = document.getElementById('submitEmployee');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang lưu...';

  try {
    if (employeeId) {
      const { error } = await supabase.from('employees').update(payload).eq('id', employeeId);
      if (error) throw error;
    } else {
      const username = document.getElementById('username').value.trim();
      if (!username) throw new Error('Vui lòng nhập tên đăng nhập cho nhân viên mới.');
      const tempPassword = document.getElementById('tempPassword').value.trim() || generateTempPassword();

      // Tạo tài khoản đăng nhập (auth.users) đòi hỏi quyền service_role,
      // KHÔNG thể gọi trực tiếp bằng anon key từ trình duyệt vì lý do bảo mật.
      // -> gọi Supabase Edge Function "create-employee-account" (xem
      // supabase/functions/create-employee-account/index.ts) đứng ra làm việc này.
      const { data: fnResult, error: fnError } = await supabase.functions.invoke('create-employee-account', {
        body: { email: usernameToEmail(username), employee: payload, tempPassword },
      });
      if (fnError) throw fnError;
      if (fnResult?.error) throw new Error(fnResult.error);

      closeModal();
      await loadEmployees();
      alert(`Đã tạo nhân viên ${fnResult.employee_code}.\nTên đăng nhập: ${username}\nMật khẩu tạm: ${fnResult.temp_password}\n\nVui lòng cung cấp cho nhân viên để đăng nhập lần đầu (hệ thống sẽ bắt buộc đổi mật khẩu ngay sau đó).`);
      return;
    }

    closeModal();
    await loadEmployees();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra, vui lòng thử lại.';
    formError.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Lưu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    await loadLookups();
    await loadEmployees();
  } catch (e) {
    // bootShell tự điều hướng nếu chưa đăng nhập
  }
})();
