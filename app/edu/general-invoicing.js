import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];
let ACTIVE_ROW = null;

const PLAN_LABEL = { monthly: 'Theo tháng', single_course: 'Theo khoá lẻ', sublevel: 'Trọn cấp độ con', none: 'Chưa chốt' };

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase.from('v_pending_invoice_students').select('*').order('class_start_date', { ascending: true });
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const q = document.getElementById('searchBox').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !q || r.full_name.toLowerCase().includes(q) || (r.phone || '').includes(q));
  document.getElementById('resultCount').textContent = `${rows.length} học sinh cần tạo hoá đơn`;

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="7" class="empty-cell">Không còn học sinh nào cần tạo hoá đơn tháng này 🎉</td></tr>'
    : rows.map((r) => {
      const plan = r.agreed_payment_plan || 'none';
      return `
        <tr>
          <td><strong>${esc(r.full_name)}</strong><div class="cell-muted" style="font-size:11px;">${esc(r.student_code || '')} · ${esc(r.phone || 'chưa có SĐT')}</div></td>
          <td class="cell-muted">${esc(r.class_name)}</td>
          <td class="cell-muted">${esc(r.center_name || '—')}</td>
          <td class="cell-muted">${esc(r.consultant_name || '—')}</td>
          <td><span class="plan-tag plan-tag--${plan}">${PLAN_LABEL[plan]}</span></td>
          <td class="cell-muted" style="font-size:12px;">${r.class_start_date ? new Date(r.class_start_date).toLocaleDateString('vi-VN') : '—'}</td>
          <td><button class="btn btn-accent btn-sm" data-create="${r.student_id}">Tạo hoá đơn</button></td>
        </tr>
      `;
    }).join('');

  tbody.querySelectorAll('[data-create]').forEach((btn) => btn.addEventListener('click', () => openCreateModal(btn.dataset.create)));
}

document.getElementById('searchBox').addEventListener('input', render);

const modal = document.getElementById('createModal');
const errBox = document.getElementById('createError');

async function openCreateModal(studentId) {
  ACTIVE_ROW = ALL_ROWS.find((r) => r.student_id === studentId);
  errBox.classList.remove('show');
  document.getElementById('modalStudentName').textContent = ACTIVE_ROW.full_name;
  document.getElementById('manualDiscountRate').value = 0;
  document.getElementById('specialCategory').value = '';
  document.getElementById('monthlyAmount').value = '';

  const plan = ACTIVE_ROW.agreed_payment_plan;
  document.getElementById('fieldsSublevel').style.display = 'none';
  document.getElementById('fieldsSingleCourse').style.display = 'none';
  document.getElementById('fieldsMonthly').style.display = 'none';

  if (!plan) {
    document.getElementById('modalPlanInfo').innerHTML = `<span style="color:var(--danger);">Học sinh này CHƯA được Tư vấn viên chốt hình thức đóng học phí — vào "Danh sách học viên" cập nhật trước khi tạo hoá đơn.</span>`;
    document.getElementById('submitCreate').disabled = true;
    modal.classList.add('show');
    return;
  }
  document.getElementById('submitCreate').disabled = false;
  document.getElementById('modalPlanInfo').textContent = `Tư vấn đã chốt: ${PLAN_LABEL[plan]}`;

  if (plan === 'sublevel') {
    document.getElementById('fieldsSublevel').style.display = 'block';
  } else if (plan === 'single_course') {
    document.getElementById('fieldsSingleCourse').style.display = 'block';
    const { data: courses } = await supabase.from('program_courses').select('id, name, price_vnd').eq('sublevel_id', ACTIVE_ROW.sublevel_id).order('display_order');
    document.getElementById('courseSelect').innerHTML = (courses || []).map((c) => `<option value="${c.id}">${esc(c.name)} — ${Number(c.price_vnd || 0).toLocaleString('vi-VN')} đ</option>`).join('');
  } else if (plan === 'monthly') {
    document.getElementById('fieldsMonthly').style.display = 'block';
  }

  modal.classList.add('show');
}

document.getElementById('closeCreateModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelCreateModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitCreate').addEventListener('click', async () => {
  errBox.classList.remove('show');
  const plan = ACTIVE_ROW.agreed_payment_plan;
  const manualRate = Number(document.getElementById('manualDiscountRate').value) / 100 || 0;
  const specialCategory = document.getElementById('specialCategory').value || null;

  const btn = document.getElementById('submitCreate');
  btn.disabled = true; btn.textContent = 'Đang tạo...';
  try {
    let error;
    if (plan === 'sublevel') {
      ({ error } = await supabase.rpc('create_payment_plan_invoice', {
        p_student_id: ACTIVE_ROW.student_id, p_plan_type: 'sublevel', p_scope_id: ACTIVE_ROW.sublevel_id,
        p_manual_discount_rate: manualRate, p_special_category: specialCategory,
      }));
    } else if (plan === 'single_course') {
      const courseId = document.getElementById('courseSelect').value;
      if (!courseId) { errBox.textContent = 'Vui lòng chọn khoá học.'; errBox.classList.add('show'); btn.disabled = false; btn.textContent = 'Tạo hoá đơn'; return; }
      ({ error } = await supabase.rpc('create_single_course_invoice', {
        p_student_id: ACTIVE_ROW.student_id, p_course_id: courseId,
        p_manual_discount_rate: manualRate, p_special_category: specialCategory,
      }));
    } else if (plan === 'monthly') {
      const amount = Number(document.getElementById('monthlyAmount').value);
      if (!amount || amount <= 0) { errBox.textContent = 'Vui lòng nhập đúng số tiền học phí.'; errBox.classList.add('show'); btn.disabled = false; btn.textContent = 'Tạo hoá đơn'; return; }
      ({ error } = await supabase.rpc('create_monthly_invoice', {
        p_student_id: ACTIVE_ROW.student_id, p_amount_vnd: amount, p_note: 'Đóng theo tháng (Tư vấn chốt)',
      }));
    }
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
