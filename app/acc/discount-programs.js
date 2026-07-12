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
    .select('id, code, name, scope, discount_rate, valid_from, valid_to, status, applies_to, applies_via, centers(name), programs(name), program_sublevels(name), program_courses(name)')
    .order('created_at', { ascending: false });

  if (error) { tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">Chưa có chương trình ưu đãi nào.</td></tr>'; return; }

  const APPLIES_LABEL = { all: 'Tất cả', program: 'Theo chương trình', sublevel: 'Theo cấp độ', course: 'Theo khoá' };
  const VIA_LABEL = { both: 'Cả hai', counter: 'Tại trung tâm', wallet: 'Tại ví' };
  const scopeRefName = (r) => r.programs?.name || r.program_sublevels?.name || r.program_courses?.name || '';

  tbody.innerHTML = data.map((r) => `
    <tr>
      <td class="cell-code mono">${esc(r.code || '—')}</td>
      <td>${esc(r.name)}</td>
      <td class="cell-muted">${esc(APPLIES_LABEL[r.applies_to] || r.applies_to)}${scopeRefName(r) ? ` — ${esc(scopeRefName(r))}` : ''}</td>
      <td><span class="badge badge-submitted" style="font-size:10px;">${esc(VIA_LABEL[r.applies_via] || r.applies_via)}</span></td>
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

async function loadBankSettings() {
  const tbody = document.getElementById('bankTableBody');
  const { data, error } = await supabase.from('bank_settings').select('id, bank_name, account_no, account_name, status:is_active, centers(name)').order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có tài khoản nào — phụ huynh sẽ KHÔNG nạp ví được cho tới khi thêm ít nhất 1 tài khoản.</td></tr>'; return; }

  tbody.innerHTML = data.map((b) => `
    <tr>
      <td>${esc(b.bank_name)}</td>
      <td class="mono">${esc(b.account_no)}</td>
      <td class="cell-muted">${esc(b.account_name)}</td>
      <td class="cell-muted">${b.centers?.name || 'Toàn hệ thống'}</td>
      <td><span class="badge badge-${b.status ? 'active' : 'inactive'}">${b.status ? 'Đang bật' : 'Đã tắt'}</span></td>
      <td>${IS_HEAD ? `<button class="btn btn-outline btn-sm" data-toggle-bank="${b.id}" data-status="${b.status}">${b.status ? 'Tắt' : 'Bật lại'}</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-toggle-bank]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.status !== 'true';
      const { error: toggleErr } = await supabase.from('bank_settings').update({ is_active: newStatus }).eq('id', btn.dataset.toggleBank);
      if (toggleErr) { alert('Lỗi: ' + toggleErr.message); return; }
      await loadBankSettings();
    });
  });
}

const bankModal = document.getElementById('bankModal');
document.getElementById('btnAddBank').addEventListener('click', async () => {
  document.getElementById('bankFormError').classList.remove('show');
  document.getElementById('bankBin').value = '';
  document.getElementById('bankName').value = '';
  document.getElementById('bankAccountNo').value = '';
  document.getElementById('bankAccountName').value = '';
  const { data: centers } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('bankCenter').innerHTML = '<option value="">— Toàn hệ thống —</option>' + (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  bankModal.classList.add('show');
});
document.getElementById('closeBankModal').addEventListener('click', () => bankModal.classList.remove('show'));
document.getElementById('cancelBankModal').addEventListener('click', () => bankModal.classList.remove('show'));

document.getElementById('btnSubmitBank').addEventListener('click', async () => {
  const errBox = document.getElementById('bankFormError');
  errBox.classList.remove('show');
  const payload = {
    bank_bin: document.getElementById('bankBin').value.trim(),
    bank_name: document.getElementById('bankName').value.trim(),
    account_no: document.getElementById('bankAccountNo').value.trim(),
    account_name: document.getElementById('bankAccountName').value.trim().toUpperCase(),
    center_id: document.getElementById('bankCenter').value || null,
  };
  if (!payload.bank_bin || !payload.bank_name || !payload.account_no || !payload.account_name) {
    errBox.textContent = 'Vui lòng nhập đầy đủ thông tin.'; errBox.classList.add('show'); return;
  }

  const { error } = await supabase.from('bank_settings').insert(payload);
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }
  bankModal.classList.remove('show');
  await loadBankSettings();
});

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
  document.getElementById('appliesToScopeWrap').style.display = 'none';
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('progScope').addEventListener('change', (e) => {
  document.getElementById('centerFieldWrap').style.display = e.target.value === 'center' ? 'block' : 'none';
});

document.getElementById('progAppliesTo').addEventListener('change', async (e) => {
  const wrap = document.getElementById('appliesToScopeWrap');
  const sel = document.getElementById('appliesToScopeSelect');
  const type = e.target.value;
  if (type === 'all') { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  sel.innerHTML = '<option value="">Đang tải...</option>';

  if (type === 'program') {
    const { data } = await supabase.from('programs').select('id, name').order('display_order');
    sel.innerHTML = (data || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  } else if (type === 'sublevel') {
    const { data } = await supabase.from('program_sublevels').select('id, name, program_levels(name, programs(name))').order('display_order');
    sel.innerHTML = (data || []).map((s) => `<option value="${s.id}">${esc(s.program_levels?.programs?.name || '')} — ${esc(s.program_levels?.name || '')} — ${esc(s.name)}</option>`).join('');
  } else if (type === 'course') {
    const { data } = await supabase.from('program_courses').select('id, name, program_sublevels(name, program_levels(name, programs(name)))').order('display_order');
    sel.innerHTML = (data || []).map((c) => `<option value="${c.id}">${esc(c.program_sublevels?.program_levels?.programs?.name || '')} — ${esc(c.name)}</option>`).join('');
  }
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

  const appliesTo = document.getElementById('progAppliesTo').value;
  const scopeRefId = document.getElementById('appliesToScopeSelect').value;

  const payload = {
    name: document.getElementById('progName').value.trim(),
    scope,
    center_id: scope === 'center' ? document.getElementById('progCenter').value : null,
    discount_rate: rate,
    valid_range: `[${new Date(from).toISOString()},${new Date(to).toISOString()})`,
    status: 'active',
    created_by: PROFILE.id,
    applies_to: appliesTo,
    applies_via: document.getElementById('progAppliesVia').value,
    program_id: appliesTo === 'program' ? scopeRefId : null,
    sublevel_id: appliesTo === 'sublevel' ? scopeRefId : null,
    course_id: appliesTo === 'course' ? scopeRefId : null,
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
    // Ma tran: He thong uu dai/Chiet khau vi chi Ke toan duoc ghi, BDH/Ky
    // thuat chi xem.
    IS_HEAD = (emp?.departments?.code === 'ACC' && profile.roleCode === 'DEPT_HEAD');

    if (!IS_HEAD) {
      document.getElementById('btnAdd').style.display = 'none';
      document.getElementById('btnAddBank').style.display = 'none';
    }

    await loadCenters();
    await Promise.all([loadRows(), loadStats(), loadAudit(), loadBankSettings()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
