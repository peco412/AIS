import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

let CURRENT_TAB = 'ledger';

const TAB_CONFIG = {
  ledger: {
    view: 'v_general_ledger',
    head: '<tr><th>Ngày</th><th>Diễn giải</th><th>Tài khoản</th><th style="text-align:right;">Nợ</th><th style="text-align:right;">Có</th><th style="text-align:right;">Số dư luỹ kế</th></tr>',
    row: (r) => `
      <tr>
        <td class="cell-muted" style="font-size:12px;">${new Date(r.entry_date).toLocaleDateString('vi-VN')}</td>
        <td>${esc(r.description)}</td>
        <td class="mono cell-code">${esc(r.account_code)} — ${esc(r.account_name)}</td>
        <td class="mono" style="text-align:right; color:${r.debit > 0 ? 'var(--ink)' : 'var(--muted)'};">${r.debit > 0 ? fmtMoney(r.debit) : '—'}</td>
        <td class="mono" style="text-align:right; color:${r.credit > 0 ? 'var(--ink)' : 'var(--muted)'};">${r.credit > 0 ? fmtMoney(r.credit) : '—'}</td>
        <td class="mono" style="text-align:right; font-weight:600;">${fmtMoney(r.running_balance)}</td>
      </tr>
    `,
  },
  cashbook: {
    view: 'v_cash_book',
    head: '<tr><th>Ngày</th><th>Diễn giải</th><th>Tài khoản</th><th style="text-align:right;">Thu (Nợ)</th><th style="text-align:right;">Chi (Có)</th><th style="text-align:right;">Tồn quỹ</th></tr>',
    row: (r) => `
      <tr>
        <td class="cell-muted" style="font-size:12px;">${new Date(r.entry_date).toLocaleDateString('vi-VN')}</td>
        <td>${esc(r.description)}</td>
        <td class="mono cell-code">${esc(r.account_code)}</td>
        <td class="mono" style="text-align:right; color:var(--success);">${r.debit > 0 ? fmtMoney(r.debit) : '—'}</td>
        <td class="mono" style="text-align:right; color:var(--danger);">${r.credit > 0 ? fmtMoney(r.credit) : '—'}</td>
        <td class="mono" style="text-align:right; font-weight:600;">${fmtMoney(r.running_balance)}</td>
      </tr>
    `,
  },
  receivables: {
    view: 'v_receivables_ledger',
    head: '<tr><th>Ngày</th><th>Học viên</th><th>Diễn giải</th><th style="text-align:right;">Phát sinh nợ</th><th style="text-align:right;">Đã thu</th><th style="text-align:right;">Còn nợ luỹ kế</th></tr>',
    row: (r) => `
      <tr>
        <td class="cell-muted" style="font-size:12px;">${new Date(r.entry_date).toLocaleDateString('vi-VN')}</td>
        <td>${esc(r.student_name || '—')} ${r.student_code ? `<span class="cell-code mono" style="font-size:11px;">${esc(r.student_code)}</span>` : ''}</td>
        <td class="cell-muted" style="font-size:12.5px;">${esc(r.description)}</td>
        <td class="mono" style="text-align:right; color:var(--danger);">${r.debit > 0 ? fmtMoney(r.debit) : '—'}</td>
        <td class="mono" style="text-align:right; color:var(--success);">${r.credit > 0 ? fmtMoney(r.credit) : '—'}</td>
        <td class="mono" style="text-align:right; font-weight:600;">${fmtMoney(r.running_balance)}</td>
      </tr>
    `,
  },
};

async function loadBalances() {
  const { data, error } = await supabase.from('v_account_balances').select('*');
  if (error) { document.getElementById('balanceGrid').innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`; return; }
  document.getElementById('balanceGrid').innerHTML = (data || []).map((a) => `
    <div class="balance-tile">
      <div class="balance-tile__code">${esc(a.code)}</div>
      <div class="balance-tile__name">${esc(a.name)}</div>
      <div class="balance-tile__value">${fmtMoney(a.balance)} đ</div>
    </div>
  `).join('');
}

async function loadTable() {
  const cfg = TAB_CONFIG[CURRENT_TAB];
  document.getElementById('tableHead').innerHTML = cfg.head;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;

  let query = supabase.from(cfg.view).select('*').order('entry_date', { ascending: false }).limit(300);
  if (from) query = query.gte('entry_date', from);
  if (to) query = query.lte('entry_date', to);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  document.getElementById('resultCount').textContent = `${(data || []).length} dòng`;
  tbody.innerHTML = (data && data.length > 0)
    ? data.map(cfg.row).join('')
    : '<tr><td colspan="7" class="empty-cell">Không có dữ liệu trong khoảng thời gian này.</td></tr>';
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    CURRENT_TAB = btn.dataset.tab;
    loadTable();
  });
});
document.getElementById('filterFrom').addEventListener('change', loadTable);
document.getElementById('filterTo').addEventListener('change', loadTable);

(async () => {
  try {
    const { profile } = await bootShell();
    if (profile.roleCode !== 'TECH' && profile.roleCode !== 'EXECUTIVE' && profile.departmentCode !== 'ACC') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành/Kỹ thuật mới dùng được trang này.</div>';
      return;
    }
    await loadBalances();
    await loadTable();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
