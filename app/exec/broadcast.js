import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : ''; }
const SCOPE_LABEL = { system: 'Toàn hệ thống', center: 'Trung tâm', department: 'Phòng ban', personal: 'Cá nhân' };

async function loadLookups() {
  const [{ data: centers }, { data: depts }] = await Promise.all([
    supabase.from('centers').select('id, name').order('name'),
    supabase.from('departments').select('id, name').order('name'),
  ]);
  document.getElementById('centerSelect').innerHTML = (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  document.getElementById('deptSelect').innerHTML = (depts || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
}

document.getElementById('scope').addEventListener('change', (e) => {
  document.getElementById('centerField').style.display = e.target.value === 'center' ? 'block' : 'none';
  document.getElementById('deptField').style.display = e.target.value === 'department' ? 'block' : 'none';
});

async function loadRecent() {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, scope, title, created_at, centers(name), departments(name)')
    .neq('scope', 'personal')
    .order('created_at', { ascending: false })
    .limit(10);
  const box = document.getElementById('recentList');
  if (error) { box.innerHTML = `Lỗi: ${error.message}`; return; }
  if (!data || data.length === 0) { box.innerHTML = 'Chưa có thông báo nào.'; return; }
  box.innerHTML = data.map((n) => `
    <div style="padding:10px 0; border-bottom:1px solid var(--border);">
      <strong style="font-size:13.5px;">${esc(n.title)}</strong>
      <div class="cell-muted" style="margin-top:2px;">
        ${esc(SCOPE_LABEL[n.scope])}${n.centers ? ' · ' + esc(n.centers.name) : ''}${n.departments ? ' · ' + esc(n.departments.name) : ''} · ${fmtDate(n.created_at)}
      </div>
    </div>
  `).join('');
}

document.getElementById('broadcastForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formError = document.getElementById('formError');
  formError.classList.remove('show');

  const scope = document.getElementById('scope').value;
  const payload = {
    scope, title: document.getElementById('title').value.trim(),
    content: document.getElementById('content').value || null,
    created_by: PROFILE.id,
  };
  if (scope === 'center') payload.center_id = document.getElementById('centerSelect').value;
  if (scope === 'department') payload.department_id = document.getElementById('deptSelect').value;

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  const { error } = await supabase.from('notifications').insert(payload);
  btn.disabled = false; btn.textContent = 'Ban hành thông báo';

  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  e.target.reset();
  document.getElementById('centerField').style.display = 'none';
  document.getElementById('deptField').style.display = 'none';
  await loadRecent();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    const allowed = ['DEPT_HEAD', 'DEPT_DEPUTY', 'EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!allowed) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không có quyền thực hiện thao tác.</div>';
      return;
    }
    await loadLookups();
    await loadRecent();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
