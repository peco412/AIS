// =====================================================================
// QUẢN LÝ CHỨC VỤ (positions) — cho phép Nhân sự/Ban điều hành/Kỹ thuật
// bật/tắt cờ "is_teacher_eligible" ngay trên giao diện, thay vì phải nhờ
// kỹ thuật chạy SQL trực tiếp. Đây là cờ quyết định menu "Giáo viên" có
// hiện ra hay không cho nhân viên khối văn phòng kiêm dạy (xem shell.js).
//
// Lưu ý bảo mật: bảng "positions" hiện KHÔNG bật RLS (giống departments/
// centers/system_roles — các bảng danh mục dùng chung), nên việc chặn ai
// được sửa chỉ nằm ở tầng UI (điều hướng trong navConfig.js). Nếu cần chặn
// chắc chắn ở tầng DB, nên bật RLS + policy cho "positions" tương tự các
// bảng nghiệp vụ khác trong 08_rls_policies.sql.
// =====================================================================
import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let DEPARTMENTS = [];
let ALL_ROWS = [];

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

async function loadDepartments() {
  const { data, error } = await supabase.from('departments').select('id, code, name').order('name');
  DEPARTMENTS = data || [];
  fillSelect(document.getElementById('filterDept'), DEPARTMENTS, { placeholder: 'Tất cả phòng ban' });
  fillSelect(document.getElementById('positionDept'), DEPARTMENTS, { placeholder: '— Chọn phòng ban —' });
  if (error) console.error(error);
}

async function loadPositions() {
  const tbody = document.getElementById('positionTableBody');
  const listError = document.getElementById('listError');
  listError.classList.remove('show');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('positions')
    .select('id, name, approval_level, is_teacher_eligible, department_id, departments(name)')
    .order('name');

  if (error) {
    tbody.innerHTML = '';
    listError.textContent = 'Lỗi tải dữ liệu: ' + error.message;
    listError.classList.add('show');
    return;
  }

  // Đếm số nhân viên đang giữ mỗi chức vụ, để tránh xoá nhầm chức vụ đang dùng.
  const { data: counts } = await supabase.from('employees').select('position_id');
  const countMap = {};
  (counts || []).forEach((e) => { if (e.position_id) countMap[e.position_id] = (countMap[e.position_id] || 0) + 1; });

  ALL_ROWS = (data || []).map((r) => ({ ...r, employeeCount: countMap[r.id] || 0 }));
  render();
}

function render() {
  const dept = document.getElementById('filterDept').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  const filtered = ALL_ROWS.filter((row) => {
    if (dept && row.department_id !== dept) return false;
    if (search && !row.name.toLowerCase().includes(search)) return false;
    return true;
  });

  document.getElementById('resultCount').textContent = `${filtered.length} chức vụ`;

  const tbody = document.getElementById('positionTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Không tìm thấy chức vụ phù hợp.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((row) => `
    <tr>
      <td>${esc(row.name)}</td>
      <td class="cell-muted">${esc(row.departments?.name || '—')}</td>
      <td class="cell-code">${row.approval_level}</td>
      <td>
        <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" data-toggle-teach="${row.id}" ${row.is_teacher_eligible ? 'checked' : ''} />
        </label>
      </td>
      <td class="cell-muted">${row.employeeCount}</td>
      <td><button class="btn btn-outline btn-sm" data-edit="${row.id}">Sửa</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.edit));
  });

  // Toggle nhanh ngay trong bảng — không cần mở modal chỉ để bật/tắt 1 cờ.
  tbody.querySelectorAll('[data-toggle-teach]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const positionId = cb.dataset.toggleTeach;
      const listError = document.getElementById('listError');
      cb.disabled = true;
      const { error } = await supabase
        .from('positions')
        .update({ is_teacher_eligible: cb.checked })
        .eq('id', positionId);
      cb.disabled = false;
      if (error) {
        cb.checked = !cb.checked; // rollback UI nếu lưu thất bại
        listError.textContent = 'Không lưu được: ' + error.message;
        listError.classList.add('show');
        return;
      }
      const row = ALL_ROWS.find((r) => r.id === positionId);
      if (row) row.is_teacher_eligible = cb.checked;
    });
  });
}

['filterDept', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('input', render);
  document.getElementById(id).addEventListener('change', render);
});

// ---------------------------------------------------------------------
// Modal thêm / sửa
// ---------------------------------------------------------------------
const modal = document.getElementById('positionModal');
const form = document.getElementById('positionForm');
const formError = document.getElementById('formError');

function openAddModal() {
  form.reset();
  document.getElementById('positionId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm chức vụ';
  document.getElementById('approvalLevel').value = '0';
  formError.classList.remove('show');
  modal.classList.add('show');
}

function openEditModal(positionId) {
  const row = ALL_ROWS.find((r) => r.id === positionId);
  if (!row) return;
  formError.classList.remove('show');
  document.getElementById('modalTitle').textContent = `Sửa chức vụ — ${row.name}`;
  document.getElementById('positionId').value = row.id;
  document.getElementById('positionName').value = row.name;
  document.getElementById('positionDept').value = row.department_id || '';
  document.getElementById('approvalLevel').value = String(row.approval_level);
  document.getElementById('isTeacherEligible').checked = !!row.is_teacher_eligible;
  modal.classList.add('show');
}

function closeModal() { modal.classList.remove('show'); }
document.getElementById('btnAddPosition').addEventListener('click', openAddModal);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelModal').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');

  const positionId = document.getElementById('positionId').value;
  const payload = {
    name: document.getElementById('positionName').value.trim(),
    department_id: document.getElementById('positionDept').value || null,
    approval_level: Number(document.getElementById('approvalLevel').value),
    is_teacher_eligible: document.getElementById('isTeacherEligible').checked,
  };

  if (!payload.department_id) {
    formError.textContent = 'Vui lòng chọn phòng ban.';
    formError.classList.add('show');
    return;
  }

  const submitBtn = document.getElementById('submitPosition');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang lưu...';

  try {
    if (positionId) {
      const { error } = await supabase.from('positions').update(payload).eq('id', positionId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('positions').insert(payload);
      if (error) throw error;
    }
    closeModal();
    await loadPositions();
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
    const allowed = ['HR', 'TECH'].includes(PROFILE.departmentCode) || ['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode);
    if (!allowed) {
      document.querySelector('.main').innerHTML =
        '<div class="empty-cell">🔒 Chỉ Nhân sự, Ban điều hành, Kỹ thuật mới quản lý được chức vụ.</div>';
      return;
    }
    await loadDepartments();
    await loadPositions();
  } catch (e) {
    // bootShell tự điều hướng nếu chưa đăng nhập
  }
})();
