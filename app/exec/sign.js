import { bootShell } from '/js/shell.js';
import { esc } from '/js/supabase.js';
import { fetchPendingApprovals } from '/js/execApprovals.js';

function renderTable(rows, emptyMsg) {
  if (rows.length === 0) return `<tr><td colspan="5" class="empty-cell">${esc(emptyMsg)}</td></tr>`;
  return rows.map((r) => `
    <tr>
      <td>${esc(r.type)}</td>
      <td class="cell-code">${esc(r.code)}</td>
      <td>${esc(r.requester)}</td>
      <td><span class="badge ${r.backupOnly ? 'badge-submitted' : 'badge-approved_1'}">${esc(r.stepLabel)}</span></td>
      <td><a class="btn btn-accent btn-sm" href="${esc(r.href)}">Xử lý →</a></td>
    </tr>
  `).join('');
}

function render({ level1Rows, level2Rows }) {
  document.getElementById('countLevel2').textContent = level2Rows.length;
  document.getElementById('countLevel1').textContent = level1Rows.length;
  document.getElementById('level2Body').innerHTML = renderTable(level2Rows, '🎉 Không có hồ sơ nào đang chờ Ban điều hành duyệt cấp 2.');
  document.getElementById('level1Body').innerHTML = renderTable(level1Rows, 'Không có hồ sơ nào đang chờ ở cấp 1.');
}

(async () => {
  try {
    const { profile } = await bootShell();
    const rows = await fetchPendingApprovals(profile);
    render(rows);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
