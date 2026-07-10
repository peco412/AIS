import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') + ' đ'; }

function monthOptions() {
  const sel = document.getElementById('filterMonth');
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const opt = document.createElement('option');
    opt.value = `${d.getFullYear()}-${d.getMonth() + 1}`;
    opt.textContent = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
    sel.appendChild(opt);
  }
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);

  const { data: allocations, error } = await supabase
    .from('prepaid_expense_allocations')
    .select('id, amount, posted, posted_at, prepaid_expenses(total_amount, months, payment_requests(content))')
    .eq('period_year', year).eq('period_month', month)
    .order('id');

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  document.getElementById('resultCount').textContent = `${(allocations || []).length} khoản`;

  if (!allocations || allocations.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Không có khoản phân bổ nào trong tháng này.</td></tr>'; return; }

  tbody.innerHTML = allocations.map((a) => `
    <tr>
      <td>${esc(a.prepaid_expenses?.payment_requests?.content || '—')}</td>
      <td class="mono cell-muted">${fmtMoney(a.prepaid_expenses?.total_amount)}</td>
      <td class="cell-muted">${a.prepaid_expenses?.months} tháng</td>
      <td class="mono" style="font-weight:700;">${fmtMoney(a.amount)}</td>
      <td><span class="badge badge-${a.posted ? 'active' : 'submitted'}">${a.posted ? 'Đã ghi nhận' : 'Chưa ghi nhận'}</span></td>
      <td>${!a.posted ? `<button class="btn btn-accent btn-sm" data-post="${a.id}">Ghi nhận</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-post]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Ghi nhận chi phí kỳ này vào dòng tiền?')) return;
    const { error: err } = await supabase.rpc('post_prepaid_allocation', { p_allocation_id: btn.dataset.post, p_actor_id: PROFILE.id });
    if (err) { alert('Lỗi: ' + err.message); return; }
    await loadRows();
  }));
}

document.getElementById('filterMonth').addEventListener('change', loadRows);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };

    const canUse = PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    monthOptions();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
