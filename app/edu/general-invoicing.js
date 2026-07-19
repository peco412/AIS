import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];
let ACTIVE_ROW = null;

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase.from('v_pending_invoice_students').select('*').order('class_start_date', { ascending: true });
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const q = document.getElementById('searchBox').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !q || r.full_name.toLowerCase().includes(q) || (r.phone || '').includes(q));
  document.getElementById('resultCount').textContent = `${rows.length} học sinh cần tạo hoá đơn`;

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="6" class="empty-cell">Không còn học sinh nào cần tạo hoá đơn tháng này</td></tr>'
    : rows.map((r) => `
        <tr>
          <td><strong>${esc(r.full_name)}</strong><div class="cell-muted" style="font-size:11px;">${esc(r.student_code || '')} · ${esc(r.phone || 'chưa có SĐT')}</div></td>
          <td class="cell-muted">${esc(r.class_name)}</td>
          <td class="cell-muted">${esc(r.center_name || '—')}</td>
          <td class="cell-muted">${esc(r.consultant_name || '—')}</td>
          <td class="cell-muted" style="font-size:12px;">${r.class_start_date ? new Date(r.class_start_date).toLocaleDateString('vi-VN') : '—'}</td>
          <td><button class="btn btn-accent btn-sm" data-create="${r.student_id}">Tạo hoá đơn</button></td>
        </tr>
      `).join('');

  tbody.querySelectorAll('[data-create]').forEach((btn) => btn.addEventListener('click', () => openCreateModal(btn.dataset.create)));
}

document.getElementById('searchBox').addEventListener('input', render);

const modal = document.getElementById('createModal');
const errBox = document.getElementById('createError');

function openCreateModal(studentId) {
  ACTIVE_ROW = ALL_ROWS.find((r) => r.student_id === studentId);
  errBox.classList.remove('show');
  document.getElementById('modalStudentName').textContent = ACTIVE_ROW.full_name;
  document.getElementById('modalPlanInfo').textContent = ACTIVE_ROW.course_id
    ? ''
    : 'Lớp học sinh này chưa gắn Khoá học cụ thể — vào trang Chương trình & Bảng giá khoá học để gắn trước khi tạo hoá đơn.';
  document.getElementById('paymentOption').value = '';
  document.getElementById('pricePreview').textContent = '—';
  document.getElementById('manualDiscountRate').value = 0;
  document.getElementById('specialCategory').value = '';
  document.getElementById('submitCreate').disabled = false;
  modal.classList.add('show');
}

async function previewPrice() {
  const option = document.getElementById('paymentOption').value;
  const previewEl = document.getElementById('pricePreview');
  if (!option || !ACTIVE_ROW?.course_id) { previewEl.textContent = '—'; return; }
  previewEl.textContent = 'Đang tính...';
  const { data: amount, error } = await supabase.rpc('calculate_payment_option_amount_for_course', {
    p_course_id: ACTIVE_ROW.course_id, p_option: option,
  });
  previewEl.textContent = error ? `Không tính được: ${error.message}` : `${new Intl.NumberFormat('vi-VN').format(amount)} đ`;
}
document.getElementById('paymentOption').addEventListener('change', previewPrice);

document.getElementById('closeCreateModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelCreateModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitCreate').addEventListener('click', async () => {
  errBox.classList.remove('show');
  const option = document.getElementById('paymentOption').value;
  if (!option) { errBox.textContent = 'Vui lòng chọn hình thức đóng học phí.'; errBox.classList.add('show'); return; }
  const manualRate = Number(document.getElementById('manualDiscountRate').value) / 100 || 0;
  const specialCategory = document.getElementById('specialCategory').value || null;

  const btn = document.getElementById('submitCreate');
  btn.disabled = true; btn.textContent = 'Đang tạo...';
  try {
    const { error } = await supabase.rpc('create_invoice_for_payment_option', {
      p_student_id: ACTIVE_ROW.student_id, p_option: option,
      p_manual_discount_rate: manualRate, p_special_category: specialCategory,
    });
    if (error) throw error;
    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo hoá đơn';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
