import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
const METHOD_LABEL = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản' };

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }
function currentPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

async function hasPaidThisMonth(studentId) {
  const { year, month } = currentPeriod();
  const { count } = await supabase.from('tuition_payments').select('id', { count: 'exact', head: true })
    .eq('student_id', studentId).eq('period_year', year).eq('period_month', month);
  return (count ?? 0) > 0;
}

async function loadStats() {
  const { year, month } = currentPeriod();
  const [{ data: students }, { data: paidRows }] = await Promise.all([
    supabase.from('students').select('id, monthly_fee').eq('center_id', PROFILE.centerId).eq('status', 'studying').not('monthly_fee', 'is', null),
    supabase.from('tuition_payments').select('student_id, amount').eq('center_id', PROFILE.centerId).eq('period_year', year).eq('period_month', month),
  ]);

  const expectedTotal = (students || []).reduce((s, x) => s + Number(x.monthly_fee || 0), 0);
  const paidStudentIds = new Set((paidRows || []).map((r) => r.student_id));
  const collectedTotal = (paidRows || []).reduce((s, r) => s + Number(r.amount), 0);
  const overdueCount = (students || []).filter((s) => !paidStudentIds.has(s.id)).length;

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Dự kiến thu tháng này</div><div class="value mono">${fmtMoney(expectedTotal)} đ</div></div>
    <div class="stat-card"><div class="label">Đã thu tháng này</div><div class="value mono" style="color:var(--success);">${fmtMoney(collectedTotal)} đ</div></div>
    <div class="stat-card"><div class="label">Số HV chưa đóng</div><div class="value mono" style="color:${overdueCount > 0 ? 'var(--danger)' : 'var(--success)'};">${overdueCount}</div></div>
  `;
}

async function loadOverdue() {
  const tbody = document.getElementById('overdueTableBody');
  const { year, month } = currentPeriod();

  const { data: students } = await supabase
    .from('students')
    .select('id, full_name, phone, parent_name, monthly_fee, classes(name)')
    .eq('center_id', PROFILE.centerId).eq('status', 'studying').not('monthly_fee', 'is', null);

  const { data: paidRows } = await supabase.from('tuition_payments').select('student_id')
    .eq('center_id', PROFILE.centerId).eq('period_year', year).eq('period_month', month);
  const paidIds = new Set((paidRows || []).map((r) => r.student_id));

  const overdue = (students || []).filter((s) => !paidIds.has(s.id));
  tbody.innerHTML = overdue.length === 0
    ? '<tr><td colspan="5" class="empty-cell">🎉 Tất cả học viên đã đóng học phí tháng này.</td></tr>'
    : overdue.map((s) => `
      <tr>
        <td>${esc(s.full_name)}</td>
        <td class="cell-muted">${esc(s.classes?.name || '—')}</td>
        <td class="cell-muted">${esc(s.parent_name || '—')}</td>
        <td class="cell-code">${esc(s.phone || '—')}</td>
        <td class="mono">${fmtMoney(s.monthly_fee)} đ</td>
      </tr>
    `).join('');
}

async function loadHistory() {
  const tbody = document.getElementById('historyTableBody');
  const { data, error } = await supabase
    .from('tuition_payments')
    .select('payment_date, amount, method, note, students(full_name), employees:collected_by(full_name)')
    .eq('center_id', PROFILE.centerId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  tbody.innerHTML = (data || []).length === 0
    ? '<tr><td colspan="6" class="empty-cell">Chưa có lượt thu nào.</td></tr>'
    : data.map((r) => `
      <tr>
        <td class="cell-muted">${fmtDate(r.payment_date)}</td>
        <td>${esc(r.students?.full_name || '—')}</td>
        <td class="mono">${fmtMoney(r.amount)} đ</td>
        <td><span class="badge badge-draft">${esc(METHOD_LABEL[r.method] || r.method)}</span></td>
        <td class="cell-muted">${esc(r.employees?.full_name || '—')}</td>
        <td class="cell-muted">${esc(r.note || '—')}</td>
      </tr>
    `).join('');
}

async function search() {
  const q = document.getElementById('searchInput').value.trim();
  const wrap = document.getElementById('searchResults');
  const tbody = document.getElementById('searchTableBody');
  if (!q) { wrap.style.display = 'none'; return; }

  const { data, error } = await supabase
    .from('students')
    .select('id, full_name, phone, parent_name, monthly_fee, classes(name)')
    .eq('center_id', PROFILE.centerId)
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(20);

  wrap.style.display = 'block';
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Không tìm thấy học viên/phụ huynh phù hợp.</td></tr>'; return; }

  const rows = await Promise.all(data.map(async (s) => ({ ...s, paid: await hasPaidThisMonth(s.id) })));

  tbody.innerHTML = rows.map((s) => `
    <tr>
      <td>${esc(s.full_name)}</td>
      <td class="cell-muted">${esc(s.classes?.name || '—')}</td>
      <td class="cell-muted">${esc(s.parent_name || '—')}</td>
      <td class="cell-code">${esc(s.phone || '—')}</td>
      <td class="mono">${s.monthly_fee ? fmtMoney(s.monthly_fee) + ' đ' : '—'}</td>
      <td>${s.paid ? '<span class="badge badge-active">Đã đóng</span>' : '<span class="badge badge-rejected">Chưa đóng</span>'}</td>
      <td><button class="btn btn-accent btn-sm" data-collect="${s.id}" data-name="${esc(s.full_name)}" data-fee="${s.monthly_fee || ''}">Thu tiền</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-collect]').forEach((b) => b.addEventListener('click', () => openCollectModal(b.dataset.collect, b.dataset.name, b.dataset.fee)));
}

let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 300);
});

const modal = document.getElementById('collectModal');
const form = document.getElementById('collectForm');
const formError = document.getElementById('formError');

function openCollectModal(studentId, name, fee) {
  form.reset();
  document.getElementById('collectStudentId').value = studentId;
  document.getElementById('collectStudentInfo').textContent = `Học viên: ${name}`;
  document.getElementById('amount').value = fee || '';
  document.getElementById('periodMonth').value = new Date().toISOString().slice(0, 7);
  document.getElementById('paymentDate').value = new Date().toISOString().slice(0, 10);
  formError.classList.remove('show');
  modal.classList.add('show');
}
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const [py, pm] = document.getElementById('periodMonth').value.split('-').map(Number);

  const btn = document.getElementById('submitCollect');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = await supabase.from('tuition_payments').insert({
      student_id: document.getElementById('collectStudentId').value,
      center_id: PROFILE.centerId,
      amount: Number(document.getElementById('amount').value),
      method: document.getElementById('method').value,
      payment_date: document.getElementById('paymentDate').value,
      period_year: py,
      period_month: pm,
      note: document.getElementById('note').value || null,
      collected_by: PROFILE.id,
    });
    if (error) throw error;
    modal.classList.remove('show');
    await Promise.all([loadStats(), loadOverdue(), loadHistory(), search()]);
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Xác nhận thu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    if (!PROFILE.centerId) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Trang này dành cho Quản lý trung tâm — tài khoản của bạn chưa gắn với 1 trung tâm cụ thể.</div>';
      return;
    }
    await Promise.all([loadStats(), loadOverdue(), loadHistory()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
