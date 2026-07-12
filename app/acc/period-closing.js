import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

let PROFILE = null;
let IS_TECH_OR_EXEC = false;
let CASH_ACCOUNTS = [];

function populateSelectors() {
  const now = new Date();
  const yearSel = document.getElementById('selectYear');
  const monthSel = document.getElementById('selectMonth');
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    yearSel.innerHTML += `<option value="${y}">${y}</option>`;
  }
  for (let m = 1; m <= 12; m++) {
    monthSel.innerHTML += `<option value="${m}">Tháng ${m}</option>`;
  }
  monthSel.value = now.getMonth() + 1;
}

function selectedPeriod() {
  return { year: Number(document.getElementById('selectYear').value), month: Number(document.getElementById('selectMonth').value) };
}

async function loadCashAccounts() {
  const { data } = await supabase.from('chart_of_accounts').select('code, name').in('code', ['111', '112']);
  CASH_ACCOUNTS = data || [];
}

// So du LUY KE tinh den HET ky da chon (khong phai chi phat sinh trong
// ky) — vi day la tai khoan "so du" (asset), can biet TONG con lai tai
// thoi diem do, khong phai chi rieng thang do phat sinh bao nhieu.
async function computeGlBalance(accountCode, year, month) {
  const endDate = new Date(year, month, 0).toISOString().slice(0, 10); // ngay cuoi thang
  const { data, error } = await supabase
    .from('journal_entry_lines')
    .select('debit, credit, journal_entries!inner(entry_date)')
    .eq('account_code', accountCode)
    .lte('journal_entries.entry_date', endDate);
  if (error) { console.error(error); return 0; }
  return (data || []).reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
}

async function loadReconciliation() {
  const { year, month } = selectedPeriod();
  const rowsEl = document.getElementById('reconRows');
  rowsEl.innerHTML = '<div class="empty-cell">Đang tải...</div>';

  const { data: existing } = await supabase.from('reconciliation_records').select('*').eq('period_year', year).eq('period_month', month);

  const rows = await Promise.all(CASH_ACCOUNTS.map(async (acc) => {
    const glBalance = await computeGlBalance(acc.code, year, month);
    const rec = (existing || []).find((r) => r.account_code === acc.code);
    return { ...acc, glBalance, actualBalance: rec?.actual_balance ?? null };
  }));

  rowsEl.innerHTML = rows.map((r) => {
    const diff = r.actualBalance != null ? r.actualBalance - r.glBalance : null;
    return `
      <div class="recon-row">
        <div><strong>${esc(r.code)}</strong><div class="cell-muted" style="font-size:11px;">${esc(r.name)}</div></div>
        <div class="mono">${fmtMoney(r.glBalance)} đ</div>
        <div><input type="number" class="text-input actual-input" data-account="${r.code}" value="${r.actualBalance ?? ''}" placeholder="Nhập số thực tế..." /></div>
        <div class="${diff === null ? 'cell-muted' : diff === 0 ? 'recon-diff-ok' : 'recon-diff-bad'}" id="diff-${r.code}">
          ${diff === null ? 'Chưa đối soát' : diff === 0 ? '✓ Khớp' : `Lệch ${fmtMoney(diff)} đ`}
        </div>
        <div><button class="btn btn-outline btn-sm" data-save-recon="${r.code}">Lưu</button></div>
      </div>
    `;
  }).join('');

  rowsEl.querySelectorAll('[data-save-recon]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.saveRecon;
      const input = rowsEl.querySelector(`.actual-input[data-account="${code}"]`);
      const actualBalance = Number(input.value);
      const row = rows.find((r) => r.code === code);
      const { error } = await supabase.from('reconciliation_records').upsert({
        period_year: year, period_month: month, account_code: code,
        actual_balance: actualBalance, gl_balance: row.glBalance, reconciled_by: PROFILE.id, reconciled_at: new Date().toISOString(),
      }, { onConflict: 'period_year,period_month,account_code' });
      if (error) { alert('Lỗi: ' + error.message); return; }
      await loadReconciliation();
    });
  });
}

async function loadPeriodStatus() {
  const { year, month } = selectedPeriod();
  const { data } = await supabase.from('closed_periods').select('*').eq('period_year', year).eq('period_month', month).maybeSingle();

  const badge = document.getElementById('periodStatusBadge');
  const actionArea = document.getElementById('closeActionArea');

  if (data?.is_closed) {
    badge.innerHTML = `<span class="period-status period-status--closed">🔒 Đã khoá</span>`;
    actionArea.innerHTML = `
      <p class="cell-muted">Kỳ này đã khoá lúc ${new Date(data.closed_at).toLocaleString('vi-VN')}. Không thể ghi thêm bút toán.</p>
      ${IS_TECH_OR_EXEC ? `
        <div class="field"><label for="reopenReason">Lý do mở khoá lại (bắt buộc)</label><textarea id="reopenReason" rows="2" placeholder="VD: Phát hiện sai sót cần điều chỉnh hoá đơn XYZ..."></textarea></div>
        <button class="btn btn-outline" id="btnReopen" style="border-color:var(--danger); color:var(--danger);">🔓 Mở khoá lại (chỉ BĐH/Kỹ thuật)</button>
      ` : '<p class="cell-muted" style="font-size:12px;">Chỉ Ban điều hành/Kỹ thuật mới được mở khoá lại.</p>'}
    `;
    document.getElementById('btnReopen')?.addEventListener('click', async () => {
      const reason = document.getElementById('reopenReason').value.trim();
      if (!reason) { alert('Bắt buộc ghi lý do.'); return; }
      if (!confirm(`Xác nhận MỞ KHOÁ lại kỳ ${month}/${year}? Đây là thao tác nhạy cảm, sẽ được ghi lại đầy đủ.`)) return;
      const { error } = await supabase.rpc('reopen_period', { p_year: year, p_month: month, p_actor_id: PROFILE.id, p_reason: reason });
      if (error) { alert('Lỗi: ' + error.message); return; }
      await loadPeriodStatus();
      await loadHistory();
    });
  } else {
    badge.innerHTML = `<span class="period-status period-status--open">🔓 Đang mở</span>`;
    const unreconciled = document.querySelectorAll('.recon-diff-bad').length;
    actionArea.innerHTML = `
      ${unreconciled > 0 ? `<p style="color:var(--danger); font-size:13px;">⚠️ Còn ${unreconciled} tài khoản chưa khớp số đối soát — nên xử lý trước khi khoá.</p>` : ''}
      <button class="btn btn-accent" id="btnClose">🔒 Khoá sổ kỳ ${month}/${year}</button>
    `;
    document.getElementById('btnClose')?.addEventListener('click', async () => {
      if (!confirm(`Xác nhận KHOÁ SỔ kỳ ${month}/${year}? Sau khi khoá, không ai ghi thêm bút toán cho kỳ này được nữa (trừ khi BĐH/Kỹ thuật mở khoá lại).`)) return;
      const { error } = await supabase.rpc('close_period', { p_year: year, p_month: month, p_actor_id: PROFILE.id });
      if (error) { alert('Lỗi: ' + error.message); return; }
      await loadPeriodStatus();
      await loadHistory();
    });
  }
}

async function loadHistory() {
  const { data, error } = await supabase.from('closed_periods').select('*, closed_employee:employees!closed_by(full_name)').order('period_year', { ascending: false }).order('period_month', { ascending: false });
  const tbody = document.getElementById('historyBody');
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  tbody.innerHTML = (data && data.length > 0)
    ? data.map((r) => `
      <tr>
        <td><strong>${r.period_month}/${r.period_year}</strong></td>
        <td>${esc(r.closed_employee?.full_name || '—')}</td>
        <td class="cell-muted" style="font-size:12px;">${new Date(r.closed_at).toLocaleString('vi-VN')}</td>
        <td><span class="badge badge-${r.is_closed ? 'active' : 'rejected'}">${r.is_closed ? 'Đã khoá' : 'Đã mở lại'}</span></td>
        <td class="cell-muted" style="font-size:11.5px;">${r.reopen_reason ? `Lý do mở lại: ${esc(r.reopen_reason)}` : ''}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="empty-cell">Chưa có kỳ nào được khoá.</td></tr>';
}

document.getElementById('selectYear').addEventListener('change', async () => { await loadReconciliation(); await loadPeriodStatus(); });
document.getElementById('selectMonth').addEventListener('change', async () => { await loadReconciliation(); await loadPeriodStatus(); });

(async () => {
  try {
    const { profile } = await bootShell();
    if (profile.roleCode !== 'TECH' && profile.roleCode !== 'EXECUTIVE' && profile.departmentCode !== 'ACC') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành/Kỹ thuật mới dùng được trang này.</div>';
      return;
    }
    PROFILE = profile;
    IS_TECH_OR_EXEC = profile.roleCode === 'TECH' || profile.roleCode === 'EXECUTIVE';
    populateSelectors();
    await loadCashAccounts();
    await loadReconciliation();
    await loadPeriodStatus();
    await loadHistory();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
