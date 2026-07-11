import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') + ' đ'; }

function monthOptions() {
  const sel = document.getElementById('monthSelect');
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const opt = document.createElement('option');
    opt.value = `${d.getFullYear()}-${d.getMonth() + 1}`;
    opt.textContent = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
    sel.appendChild(opt);
  }
}

function row(label, value, opts = {}) {
  return `
    <div class="batch-row" ${opts.strong ? 'style="border-top:1px dashed var(--border); padding-top:10px; margin-top:4px;"' : ''}>
      <span class="cell-muted">${esc(label)}</span>
      <strong class="mono" style="${opts.color ? `color:${opts.color};` : ''} ${opts.strong ? 'font-size:16px;' : ''}">${value}</strong>
    </div>`;
}

async function loadPayslip(employeeId) {
  const [year, month] = document.getElementById('monthSelect').value.split('-').map(Number);
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty-cell">Đang tải dữ liệu...</div>';

  const { data, error } = await supabase.from('payroll')
    .select('*')
    .eq('employee_id', employeeId).eq('year', year).eq('month', month)
    .maybeSingle();

  if (error) { content.innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`; return; }
  if (!data) { content.innerHTML = '<div class="empty-cell">Chưa có bảng lương cho tháng này — Kế toán chưa chốt lương.</div>'; return; }

  content.innerHTML = `
    <div class="card">
      <h3>Thu nhập</h3>
      ${row('Lương cơ bản', fmtMoney(data.base_salary))}
      ${row('Thưởng hiệu suất', fmtMoney(data.performance_bonus))}
      ${row('Thưởng đột xuất', fmtMoney(data.urgent_bonus))}
      ${row('Trợ cấp nhà ở', fmtMoney(data.housing_allowance))}
      ${row('Trợ cấp xăng xe', fmtMoney(data.transport_allowance))}
      ${row('Trợ cấp khác', fmtMoney(data.other_allowance))}
    </div>
    <div class="card">
      <h3>Khấu trừ (theo dữ liệu chấm công)</h3>
      ${row('Số ngày nghỉ (có phép)', `${data.leave_days} ngày`)}
      ${row('Số ngày không chấm công', `${data.absent_days} ngày`)}
      ${row('Tiền phạt', fmtMoney(data.penalty_amount), { color: 'var(--danger)' })}
      ${row('Tạm ứng', fmtMoney(data.advance_deduction), { color: 'var(--danger)' })}
      ${row('Bảo hiểm (BHXH/BHYT/BHTN)', fmtMoney(data.insurance_deduction), { color: 'var(--danger)' })}
      ${row('Thuế TNCN', fmtMoney(data.tax_deduction), { color: 'var(--danger)' })}
    </div>
    <div class="card">
      ${row('Lương thực nhận', fmtMoney(data.net_salary), { strong: true, color: 'var(--success)' })}
      ${data.finalized_at ? `<div class="cell-muted" style="margin-top:8px; font-size:11.5px;">Đã chốt lúc ${new Date(data.finalized_at).toLocaleString('vi-VN')}</div>` : '<div class="cell-muted" style="margin-top:8px; font-size:11.5px;">Chưa chốt — số liệu có thể còn thay đổi.</div>'}
    </div>
  `;
}

document.getElementById('monthSelect').addEventListener('change', () => loadPayslip(window.__MY_EMPLOYEE_ID__));

(async () => {
  try {
    const { profile } = await bootShell();
    window.__MY_EMPLOYEE_ID__ = profile.id;
    monthOptions();
    await loadPayslip(profile.id);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
