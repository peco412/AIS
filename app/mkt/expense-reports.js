import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let chartInstance = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

function last6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `T${d.getMonth() + 1}/${d.getFullYear()}` });
  }
  return months;
}

async function loadChart() {
  const months = last6Months();
  const startDate = `${months[0].year}-${String(months[0].month).padStart(2, '0')}-01`;

  const { data } = await supabase.from('mkt_ad_expenses').select('platform, amount, spend_date').gte('spend_date', startDate);

  const byMonth = {};
  months.forEach((m) => { byMonth[m.label] = 0; });
  const byPlatform = {};

  (data || []).forEach((e) => {
    const d = new Date(e.spend_date);
    const label = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    if (label in byMonth) byMonth[label] += Number(e.amount);
    byPlatform[e.platform] = (byPlatform[e.platform] || 0) + Number(e.amount);
  });

  const total = Object.values(byMonth).reduce((a, b) => a + b, 0);
  const topPlatform = Object.entries(byPlatform).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng chi phí (6 tháng)</div><div class="value mono" style="font-size:20px;">${fmtMoney(total)} đ</div></div>
    <div class="stat-card"><div class="label">Nền tảng chi nhiều nhất</div><div class="value" style="font-size:18px;">${topPlatform ? esc(topPlatform[0]) : '—'}</div></div>
    <div class="stat-card"><div class="label">Trung bình / tháng</div><div class="value mono" style="font-size:20px;">${fmtMoney(total / 6)} đ</div></div>
  `;

  const labels = months.map((m) => m.label);
  const ctx = document.getElementById('expenseChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Chi phí quảng cáo', data: labels.map((l) => byMonth[l]), backgroundColor: '#0094D9' }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}

async function loadTable() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase
    .from('mkt_ad_expenses')
    .select('id, platform, amount, spend_date, note, centers(name)')
    .order('spend_date', { ascending: false })
    .limit(50);

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có chi phí nào được ghi nhận.</td></tr>'; return; }

  tbody.innerHTML = data.map((e) => `
    <tr>
      <td class="cell-code">${fmtDate(e.spend_date)}</td>
      <td>${esc(e.platform)}</td>
      <td class="cell-muted">${esc(e.centers?.name || '—')}</td>
      <td class="cell-code">${fmtMoney(e.amount)} đ</td>
      <td class="cell-muted">${esc(e.note || '—')}</td>
    </tr>
  `).join('');
}

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('center').innerHTML = '<option value="">— Không áp dụng —</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

document.getElementById('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('formError');
  errBox.classList.remove('show');
  const { error } = await supabase.from('mkt_ad_expenses').insert({
    platform: document.getElementById('platform').value.trim(),
    amount: Number(document.getElementById('amount').value),
    spend_date: document.getElementById('spendDate').value,
    center_id: document.getElementById('center').value || null,
    note: document.getElementById('note').value || null,
    created_by: PROFILE.id,
  });
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }
  e.target.reset();
  await Promise.all([loadChart(), loadTable()]);
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    document.getElementById('spendDate').value = new Date().toISOString().slice(0, 10);
    await loadCenters();
    await Promise.all([loadChart(), loadTable()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
