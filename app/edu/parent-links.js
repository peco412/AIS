import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ACTIVE_STUDENT = null;
let FOUND_PARENT = null;

async function searchStudents() {
  const q = document.getElementById('searchStudent').value.trim();
  const tbody = document.getElementById('tableBody');
  if (!q) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Nhập tên học sinh để tìm kiếm...</td></tr>'; return; }

  tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tìm...</td></tr>';

  let query = supabase.from('students').select('id, full_name, centers(name)').ilike('full_name', `%${q}%`).limit(20);
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data: students, error } = await query;

  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!students || students.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Không tìm thấy học sinh nào.</td></tr>'; return; }

  const studentIds = students.map((s) => s.id);
  const { data: links } = await supabase.from('parent_student_links').select('student_id, relationship, parent_accounts(full_name, phone)').in('student_id', studentIds);

  tbody.innerHTML = students.map((s) => {
    const studentLinks = (links || []).filter((l) => l.student_id === s.id);
    const parentsText = studentLinks.length === 0
      ? '<span class="cell-muted">Chưa liên kết</span>'
      : studentLinks.map((l) => `${esc(l.parent_accounts?.full_name || '—')} (${esc(l.relationship || '')}) — ${esc(l.parent_accounts?.phone || '')}`).join('<br>');

    return `
      <tr>
        <td>${esc(s.full_name)}</td>
        <td class="cell-muted">${esc(s.centers?.name || '—')}</td>
        <td style="font-size:12.5px;">${parentsText}</td>
        <td><button class="btn btn-accent btn-sm" data-link="${s.id}" data-name="${esc(s.full_name)}">+ Liên kết</button></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-link]').forEach((btn) => {
    btn.addEventListener('click', () => openLinkModal(btn.dataset.link, btn.dataset.name));
  });
}

let searchTimer;
document.getElementById('searchStudent').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchStudents, 350);
});

const modal = document.getElementById('linkModal');
const formError = document.getElementById('formError');

function openLinkModal(studentId, studentName) {
  ACTIVE_STUDENT = studentId;
  FOUND_PARENT = null;
  formError.classList.remove('show');
  document.getElementById('linkStudentInfo').textContent = `Học sinh: ${studentName}`;
  document.getElementById('parentPhone').value = '';
  document.getElementById('parentName').value = '';
  document.getElementById('foundParentBox').style.display = 'none';
  document.getElementById('newParentFields').style.display = 'none';
  document.getElementById('btnSearchParent').style.display = 'inline-flex';
  document.getElementById('btnConfirmLink').style.display = 'none';
  modal.classList.add('show');
}
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('btnSearchParent').addEventListener('click', async () => {
  formError.classList.remove('show');
  const phone = document.getElementById('parentPhone').value.trim();
  if (!phone) { formError.textContent = 'Vui lòng nhập số điện thoại.'; formError.classList.add('show'); return; }

  const { data: parent } = await supabase.from('parent_accounts').select('*').eq('phone', phone).maybeSingle();

  if (parent) {
    FOUND_PARENT = parent;
    document.getElementById('foundParentBox').style.display = 'block';
    document.getElementById('foundParentBox').textContent = `✅ Đã tìm thấy tài khoản: ${parent.full_name} (${parent.phone})${parent.auth_user_id ? '' : ' — chưa từng đăng nhập App'}`;
    document.getElementById('newParentFields').style.display = 'none';
  } else {
    FOUND_PARENT = null;
    document.getElementById('foundParentBox').style.display = 'block';
    document.getElementById('foundParentBox').textContent = 'Chưa có tài khoản nào với SĐT này — sẽ tạo hồ sơ mới (phụ huynh dùng đúng SĐT này để đăng nhập App lần đầu sẽ tự liên kết vào hồ sơ này).';
    document.getElementById('newParentFields').style.display = 'block';
  }

  document.getElementById('btnSearchParent').style.display = 'none';
  document.getElementById('btnConfirmLink').style.display = 'inline-flex';
});

document.getElementById('btnConfirmLink').addEventListener('click', async () => {
  formError.classList.remove('show');
  const phone = document.getElementById('parentPhone').value.trim();
  const relationship = document.getElementById('relationship').value;

  const btn = document.getElementById('btnConfirmLink');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    let parentId = FOUND_PARENT?.id;

    if (!parentId) {
      const name = document.getElementById('parentName').value.trim();
      if (!name) throw new Error('Vui lòng nhập họ tên phụ huynh.');
      const { data: created, error: createErr } = await supabase.from('parent_accounts')
        .insert({ full_name: name, phone }).select('id').single();
      if (createErr) throw createErr;
      parentId = created.id;
    }

    const { error: linkErr } = await supabase.from('parent_student_links')
      .insert({ parent_account_id: parentId, student_id: ACTIVE_STUDENT, relationship });
    if (linkErr) throw linkErr;

    modal.classList.remove('show');
    await searchStudents();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Xác nhận liên kết';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };

    const canUse = PROFILE.isCenterManager || PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Quản lý trung tâm/Kế toán/Ban điều hành mới dùng được trang này.</div>';
    }
  } catch (e) { /* bootShell tự điều hướng */ }
})();
