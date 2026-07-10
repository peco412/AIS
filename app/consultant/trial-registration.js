import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadClasses() {
  const { data } = await supabase.from('classes').select('id, name').eq('center_id', PROFILE.centerId).eq('status', 'active').order('name');
  document.getElementById('classSelect').innerHTML = (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('students')
    .select('id, full_name, dob, parent_name, phone, trial_start_date, trial_end_date, trial_sessions_count, classes(name)')
    .eq('center_id', PROFILE.centerId)
    .eq('status', 'trial')
    .order('created_at', { ascending: false });

  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !q || r.full_name.toLowerCase().includes(q));
  document.getElementById('resultCount').textContent = `${rows.length} học viên đang học thử`;

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="7" class="empty-cell">Chưa có học viên học thử nào.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td>${esc(r.full_name)}</td>
        <td class="cell-muted">${fmtDate(r.dob)}</td>
        <td class="cell-muted">${esc(r.parent_name || '—')}</td>
        <td class="mono cell-muted">${esc(r.phone || '—')}</td>
        <td>${esc(r.classes?.name || '—')}</td>
        <td class="cell-muted">${fmtDate(r.trial_start_date)} → ${fmtDate(r.trial_end_date)}</td>
        <td class="mono" style="text-align:center;">${r.trial_sessions_count ?? '—'}</td>
      </tr>
    `).join('');
}

document.getElementById('searchInput').addEventListener('input', render);

const modal = document.getElementById('createModal');
document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('formError').classList.remove('show');
  document.getElementById('studentName').value = '';
  document.getElementById('dob').value = '';
  document.getElementById('parentName').value = '';
  document.getElementById('phone').value = '';
  document.getElementById('trialStart').value = new Date().toISOString().slice(0, 10);
  document.getElementById('trialEnd').value = '';
  document.getElementById('trialSessions').value = '';
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitBtn').addEventListener('click', async () => {
  const errBox = document.getElementById('formError');
  errBox.classList.remove('show');

  const payload = {
    full_name: document.getElementById('studentName').value.trim(),
    dob: document.getElementById('dob').value,
    parent_name: document.getElementById('parentName').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    class_id: document.getElementById('classSelect').value,
    trial_start_date: document.getElementById('trialStart').value,
    trial_end_date: document.getElementById('trialEnd').value,
    trial_sessions_count: Number(document.getElementById('trialSessions').value),
    center_id: PROFILE.centerId,
    status: 'trial',
    enrollment_date: new Date().toISOString().slice(0, 10),
  };
  if (!payload.full_name || !payload.dob || !payload.parent_name || !payload.phone || !payload.class_id || !payload.trial_start_date || !payload.trial_end_date || !payload.trial_sessions_count) {
    errBox.textContent = 'Vui lòng nhập đầy đủ thông tin.'; errBox.classList.add('show'); return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('students').insert(payload);
  btn.disabled = false; btn.textContent = 'Đăng ký';
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  modal.classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id };

    if (!PROFILE.centerId) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Tài khoản của bạn chưa gắn với trung tâm nào.</div>';
      return;
    }
    await loadClasses();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
