import { bootShell } from '/js/shell.js';
import { supabase, esc, notifyDepartmentHeads } from '/js/supabase.js';

let PROFILE = null;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

const TABS = {
  payment: { form: 'paymentForm' },
  comm: { form: 'commForm' },
  fac: { form: 'facForm' },
};

document.querySelectorAll('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.replace('btn-accent', 'btn-outline'));
    btn.classList.replace('btn-outline', 'btn-accent');
    Object.values(TABS).forEach((t) => { document.getElementById(t.form).style.display = 'none'; });
    document.getElementById(TABS[btn.dataset.tab].form).style.display = '';
  });
});

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('payCenter').innerHTML = '<option value="">— Không áp dụng —</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadOrders() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const [{ data: pay }, { data: comm }, { data: fac }] = await Promise.all([
    supabase.from('payment_requests').select('id, code, status, created_at').eq('requester_id', PROFILE.id),
    supabase.from('communication_requests').select('id, code, title, status, created_at').eq('requester_id', PROFILE.id),
    supabase.from('facility_requests').select('id, code, title, status, created_at').eq('requester_id', PROFILE.id),
  ]);

  const rows = [
    ...(pay || []).map((r) => ({ kind: '💳 Thanh toán', label: r.code, status: r.status, created_at: r.created_at, href: '/acc/payment-requests.html' })),
    ...(comm || []).map((r) => ({ kind: '📣 Truyền thông', label: `${r.code} — ${r.title}`, status: r.status, created_at: r.created_at, href: '/mkt/requests.html' })),
    ...(fac || []).map((r) => ({ kind: '🛠 CSVC', label: `${r.code} — ${r.title}`, status: r.status, created_at: r.created_at, href: '/fac/requests.html' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Chưa có lệnh yêu cầu nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.kind}</td>
      <td><a href="${r.href}">${esc(r.label)}</a></td>
      <td><span class="badge badge-${r.status === 'approved_2' || r.status === 'done' ? 'active' : r.status === 'rejected' ? 'rejected' : 'submitted'}">${esc(r.status)}</span></td>
      <td class="cell-muted">${fmtDate(r.created_at)}</td>
    </tr>
  `).join('');
}

document.getElementById('paymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('paymentError');
  errBox.classList.remove('show');
  const { data: template } = await supabase.from('document_templates').select('id').eq('code', '02.Phieudenghithanhtoan').single();
  const { error } = await supabase.from('payment_requests').insert({
    requester_id: PROFILE.id,
    department_id: PROFILE.departmentId,
    center_id: document.getElementById('payCenter').value || null,
    template_id: template?.id || null,
    amount: Number(document.getElementById('payAmount').value),
    content: document.getElementById('payContent').value.trim(),
    status: 'draft',
  });
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }
  alert('Đã tạo lệnh đề nghị thanh toán. Vào "Phiếu đề nghị thanh toán" (phòng Kế toán) để ký số và đính kèm chứng từ.');
  e.target.reset();
  await loadOrders();
});

document.getElementById('commForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('commError');
  errBox.classList.remove('show');
  const { error } = await supabase.from('communication_requests').insert({
    requester_id: PROFILE.id,
    department_id: PROFILE.departmentId,
    request_type: document.getElementById('commType').value,
    priority: document.getElementById('commPriority').value,
    title: document.getElementById('commTitle').value.trim(),
    deadline: document.getElementById('commDeadline').value || null,
  });
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }
  notifyDepartmentHeads('MKT', 'Có yêu cầu truyền thông mới cần phân việc (từ Ban điều hành)',
    `${PROFILE.fullName} vừa gửi yêu cầu "${document.getElementById('commTitle').value.trim()}" — vào Phân việc để giao cho nhân sự xử lý.`, '/mkt/tasks.html', PROFILE.id);
  e.target.reset();
  await loadOrders();
});

document.getElementById('facForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('facError');
  errBox.classList.remove('show');
  const { error } = await supabase.from('facility_requests').insert({
    requester_id: PROFILE.id,
    department_id: PROFILE.departmentId,
    request_type: document.getElementById('facType').value,
    title: document.getElementById('facTitle').value.trim(),
  });
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }
  notifyDepartmentHeads('FAC', 'Có yêu cầu CSVC mới cần phân việc (từ Ban điều hành)',
    `${PROFILE.fullName} vừa gửi yêu cầu "${document.getElementById('facTitle').value.trim()}" — vào Phân việc để giao cho nhân sự xử lý.`, '/fac/tasks.html', PROFILE.id);
  e.target.reset();
  await loadOrders();
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentId: emp?.department_id };
    await loadCenters();
    await loadOrders();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
