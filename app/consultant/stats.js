import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

(async () => {
  try {
    const { profile } = await bootShell();

    const { data, error } = await supabase
      .from('crm_leads')
      .select('status, consultant_id, employees(full_name)')
      .eq('center_id', profile.centerId);

    if (error) {
      document.getElementById('statCards').innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`;
      return;
    }

    const rows = data || [];
    const counts = { potential: 0, success: 0, rejected: 0 };
    rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const total = rows.length;
    const rate = total ? Math.round((counts.success / total) * 100) : 0;

    document.getElementById('statCards').innerHTML = `
      <div class="stat-card"><div class="label">Tổng hồ sơ (trung tâm)</div><div class="value mono">${total}</div></div>
      <div class="stat-card"><div class="label">Tiềm năng</div><div class="value mono">${counts.potential}</div></div>
      <div class="stat-card"><div class="label">Thành công</div><div class="value mono">${counts.success}</div></div>
      <div class="stat-card"><div class="label">Tỷ lệ chốt chung</div><div class="value mono">${rate}%</div></div>
    `;

    const byConsultant = {};
    rows.forEach((r) => {
      const name = r.employees?.full_name || 'Chưa gán';
      if (!byConsultant[name]) byConsultant[name] = { total: 0, potential: 0, success: 0, rejected: 0 };
      byConsultant[name].total += 1;
      byConsultant[name][r.status] = (byConsultant[name][r.status] || 0) + 1;
    });

    const entries = Object.entries(byConsultant).sort((a, b) => b[1].total - a[1].total);
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = entries.length === 0
      ? '<tr><td colspan="6" class="empty-cell">Chưa có dữ liệu.</td></tr>'
      : entries.map(([name, v]) => `
        <tr>
          <td>${esc(name)}</td>
          <td class="cell-code">${v.total}</td>
          <td class="cell-code">${v.potential || 0}</td>
          <td class="cell-code">${v.success || 0}</td>
          <td class="cell-code">${v.rejected || 0}</td>
          <td class="cell-code">${v.total ? Math.round(((v.success || 0) / v.total) * 100) : 0}%</td>
        </tr>
      `).join('');
  } catch (e) { /* bootShell tự điều hướng */ }
})();
