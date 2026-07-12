import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

let PROFILE = null;
let CAN_EDIT = false;
let ALL_COMMISSIONS = [];

async function loadRules() {
  const { data } = await supabase.from('commission_rules').select('*, centers(name)').order('created_at', { ascending: false });
  const list = document.getElementById('rulesList');
  list.innerHTML = (data && data.length > 0)
    ? data.map((r) => `
      <div class="batch-row">
        <span><strong>${esc(r.name)}</strong> — ${(r.rate * 100).toFixed(1)}% ${r.centers?.name ? `(chỉ ${esc(r.centers.name)})` : '(toàn hệ thống)'} ${!r.is_active ? '<span class="cell-muted">(đã tắt)</span>' : ''}</span>
        ${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-toggle-rule="${r.id}" data-active="${r.is_active}">${r.is_active ? 'Tắt' : 'Bật'}</button>` : ''}
      </div>
    `).join('')
    : '<div class="empty-cell">Chưa có quy tắc hoa hồng nào — hoa hồng sẽ KHÔNG tự tính cho tới khi có quy tắc.</div>';

  list.querySelectorAll('[data-toggle-rule]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active === 'true';
      const { error } = await supabase.from('commission_rules').update({ is_active: !isActive }).eq('id', btn.dataset.toggleRule);
      if (error) { alert('Lỗi: ' + error.message); return; }
      await loadRules();
    });
  });
}

document.getElementById('btnAddRule')?.addEventListener('click', async () => {
  const name = prompt('Tên quy tắc (VD: "Hoa hồng chuẩn 2026"):');
  if (!name?.trim()) return;
  const rateStr = prompt('Tỷ lệ % trên hoá đơn đầu tiên (VD: 5 = 5%):', '5');
  const rate = Number(rateStr) / 100;
  if (isNaN(rate) || rate < 0 || rate > 1) { alert('Tỷ lệ không hợp lệ.'); return; }
  const { error } = await supabase.from('commission_rules').insert({ name: name.trim(), rate, created_by: PROFILE.id });
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadRules();
});

async function loadFilters() {
  const { data: consultants } = await supabase.from('employees').select('id, full_name, system_roles!inner(code)').eq('system_roles.code', 'CONSULTANT');
  const consultantSel = document.getElementById('filterConsultant');
  consultantSel.innerHTML = '<option value="">Tất cả tư vấn viên</option>' + (consultants || []).map((c) => `<option value="${c.id}">${esc(c.full_name)}</option>`).join('');
  if (!CAN_EDIT) { consultantSel.value = PROFILE.id; consultantSel.disabled = true; }

  const now = new Date();
  const periodSel = document.getElementById('filterPeriod');
  let opts = '';
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts += `<option value="${d.getFullYear()}-${d.getMonth() + 1}">Tháng ${d.getMonth() + 1}/${d.getFullYear()}</option>`;
  }
  periodSel.innerHTML = opts;
}

async function loadCommissions() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const [year, month] = document.getElementById('filterPeriod').value.split('-').map(Number);
  const consultantId = document.getElementById('filterConsultant').value;

  let query = supabase.from('commissions')
    .select('*, employees!consultant_id(full_name), students(full_name, student_code)')
    .eq('period_year', year).eq('period_month', month)
    .order('created_at', { ascending: false });
  if (consultantId) query = query.eq('consultant_id', consultantId);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_COMMISSIONS = data || [];

  tbody.innerHTML = ALL_COMMISSIONS.length > 0
    ? ALL_COMMISSIONS.map((r) => `
      <tr>
        <td>${esc(r.employees?.full_name || '—')}</td>
        <td>${esc(r.students?.full_name || '—')} <span class="cell-code mono" style="font-size:11px;">${esc(r.students?.student_code || '')}</span></td>
        <td class="cell-muted">${r.period_month}/${r.period_year}</td>
        <td class="mono" style="text-align:right;">${fmtMoney(r.base_amount)} đ (${(r.rate_applied * 100).toFixed(1)}%)</td>
        <td class="mono" style="text-align:right; font-weight:700; color:var(--accent-deep);">${fmtMoney(r.commission_amount)} đ</td>
        <td><span class="badge badge-${r.status === 'paid' ? 'active' : 'submitted'}">${r.status === 'paid' ? 'Đã trả' : 'Chờ trả'}</span></td>
      </tr>
    `).join('')
    : '<tr><td colspan="6" class="empty-cell">Không có hoa hồng nào trong kỳ này.</td></tr>';

  renderPayoutPanel(year, month, consultantId);
}

function renderPayoutPanel(year, month, consultantId) {
  const panel = document.getElementById('payoutPanel');
  if (!CAN_EDIT || !consultantId) { panel.innerHTML = ''; return; }
  const pending = ALL_COMMISSIONS.filter((c) => c.status === 'pending');
  const total = pending.reduce((s, c) => s + Number(c.commission_amount), 0);
  if (total === 0) { panel.innerHTML = '<p class="cell-muted">Không có hoa hồng nào chờ trả cho tư vấn viên này trong kỳ đã chọn.</p>'; return; }
  panel.innerHTML = `
    <p>Tổng hoa hồng <strong>chờ trả</strong> cho kỳ ${month}/${year}: <strong class="mono">${fmtMoney(total)} đ</strong></p>
    <button class="btn btn-accent" id="btnMarkPaid">Xác nhận đã trả (ghi sổ kế toán)</button>
  `;
  document.getElementById('btnMarkPaid').addEventListener('click', async () => {
    if (!confirm(`Xác nhận đã trả ${fmtMoney(total)} đ hoa hồng? Thao tác này sẽ ghi sổ kế toán ngay.`)) return;
    const { error } = await supabase.rpc('mark_commissions_paid', { p_consultant_id: consultantId, p_year: year, p_month: month, p_actor_id: PROFILE.id });
    if (error) { alert('Lỗi: ' + error.message); return; }
    alert('Đã ghi nhận trả hoa hồng thành công.');
    await loadCommissions();
  });
}

document.getElementById('filterConsultant').addEventListener('change', loadCommissions);
document.getElementById('filterPeriod').addEventListener('change', loadCommissions);

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_EDIT = profile.roleCode === 'TECH' || profile.roleCode === 'EXECUTIVE' || profile.departmentCode === 'ACC';
    if (!CAN_EDIT && profile.roleCode !== 'CONSULTANT') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Trang này chỉ dành cho Tư vấn viên (xem hoa hồng của mình) hoặc Kế toán/BĐH/Kỹ thuật.</div>';
      return;
    }
    if (!CAN_EDIT) document.getElementById('rulesPanel').style.display = 'none';
    await loadRules();
    await loadFilters();
    await loadCommissions();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
