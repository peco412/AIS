import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let IS_HEAD = false;

function fmtDateTime(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }
function fmtPercent(r) { return `${(Number(r) * 100).toFixed(1)}%`; }

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('progCenter').innerHTML = (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadStats() {
  const now = new Date().toISOString();
  const { data: activeSystem } = await supabase.from('discount_programs_view').select('id, discount_rate')
    .eq('scope', 'system').eq('status', 'active').lte('valid_from', now).gte('valid_to', now).maybeSingle();
  const { count: activeCenterCount } = await supabase.from('discount_programs').select('id', { count: 'exact', head: true }).eq('scope', 'center').eq('status', 'active');

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Ưu đãi Toàn hệ thống</div><div class="value mono">${activeSystem ? fmtPercent(activeSystem.discount_rate) : 'Không có'}</div></div>
    <div class="stat-card"><div class="label">Số ưu đãi Trung tâm đang bật</div><div class="value mono">${activeCenterCount ?? 0}</div></div>
  `;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('discount_programs_view')
    .select('id, name, scope, discount_rate, valid_from, valid_to, status, centers(name)')
    .order('created_at', { ascending: false });

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có chương trình ưu đãi nào.</td></tr>'; return; }

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td>${esc(r.name)}</td>
      <td class="cell-muted">${r.scope === 'system' ? 'Toàn hệ thống' : esc(r.centers?.name || '—')}</td>
      <td class="mono">${fmtPercent(r.discount_rate)}</td>
      <td class="cell-muted" style="font-size:12px;">${fmtDateTime(r.valid_from)} → ${fmtDateTime(r.valid_to)}</td>
      <td><span class="badge badge-${r.status === 'active' ? 'active' : 'inactive'}">${r.status === 'active' ? 'Đang bật' : 'Đã tắt'}</span></td>
      <td>
        ${IS_HEAD ? `<button class="btn btn-outline btn-sm" data-toggle="${r.id}" data-status="${r.status}">${r.status === 'active' ? 'Tắt' : 'Bật lại'}</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleProgram(btn.dataset.toggle, btn.dataset.status));
  });
}

async function toggleProgram(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  const { error } = await supabase.from('discount_programs').update({ status: newStatus }).eq('id', id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  await Promise.all([loadRows(), loadStats()]);
}

async function loadAudit() {
  const tbody = document.getElementById('auditBody');
  const { data, error } = await supabase
    .from('discount_program_audit_log')
    .select('created_at, action, employees:actor_id(full_name), discount_programs:program_id(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  tbody.innerHTML = (data || []).length === 0
    ? '<tr><td colspan="4" class="empty-cell">Chưa có nhật ký nào.</td></tr>'
    : data.map((r) => `
      <tr>
        <td class="cell-muted">${fmtDateTime(r.created_at)}</td>
        <td>${esc(r.employees?.full_name || '—')}</td>
        <td><span class="badge badge-draft">${esc(r.action)}</span></td>
        <td class="cell-muted">${esc(r.discount_programs?.name || '—')}</td>
      </tr>
    `).join('');
}

const modal = document.getElementById('createModal');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  document.getElementById('programForm').reset();
  formError.classList.remove('show');
  document.getElementById('centerFieldWrap').style.display = 'none';
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('progScope').addEventListener('change', (e) => {
  document.getElementById('centerFieldWrap').style.display = e.target.value === 'center' ? 'block' : 'none';
});

document.getElementById('programForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');

  const scope = document.getElementById('progScope').value;
  const rate = Number(document.getElementById('progRate').value) / 100;
  const from = document.getElementById('progFrom').value;
  const to = document.getElementById('progTo').value;

  if (rate <= 0 || rate > 0.40) {
    formError.textContent = 'Chiết khấu phải trong khoảng 0.1% - 40%.';
    formError.classList.add('show');
    return;
  }

  const payload = {
    name: document.getElementById('progName').value.trim(),
    scope,
    center_id: scope === 'center' ? document.getElementById('progCenter').value : null,
    discount_rate: rate,
    valid_range: `[${new Date(from).toISOString()},${new Date(to).toISOString()})`,
    status: 'active',
    created_by: PROFILE.id,
  };

  const btn = document.getElementById('submitProgram');
  btn.disabled = true; btn.textContent = 'Đang tạo...';
  try {
    const { error } = await supabase.from('discount_programs').insert(payload);
    if (error) throw error; // trigger loại trừ lẫn nhau sẽ tự raise exception rõ ràng nếu vi phạm
    modal.classList.remove('show');
    await Promise.all([loadRows(), loadStats(), loadAudit()]);
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo chương trình';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    PROFILE = profile;
    IS_HEAD = ['EXECUTIVE', 'TECH'].includes(profile.roleCode)
      || (emp?.departments?.code === 'ACC' && profile.roleCode === 'DEPT_HEAD');

    if (!IS_HEAD) {
      document.getElementById('btnAdd').style.display = 'none';
    }

    await loadCenters();
    await Promise.all([loadRows(), loadStats(), loadAudit()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
