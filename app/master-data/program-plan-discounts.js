import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let CAN_EDIT = false;

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const [{ data: programs }, { data: discounts }, { data: availability }] = await Promise.all([
    supabase.from('programs').select('id, name').order('display_order'),
    supabase.from('program_plan_discounts').select('program_id, plan_type, discount_rate'),
    supabase.from('program_plan_availability').select('program_id, plan_type, is_available'),
  ]);

  if (!programs || programs.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có chương trình nào.</td></tr>'; return; }

  const discountByKey = {};
  (discounts || []).forEach((d) => { discountByKey[`${d.program_id}:${d.plan_type}`] = d.discount_rate; });
  const availByKey = {};
  (availability || []).forEach((a) => { availByKey[`${a.program_id}:${a.plan_type}`] = a.is_available; });

  tbody.innerHTML = programs.map((p) => {
    // Mac dinh KHONG co dong = duoc phep (true) — dung cach hieu da ghi
    // ro trong migration (chi Mam non/Mau giao/Tre em co dong false).
    const byMonthOk = availByKey[`${p.id}:BY_MONTH`] ?? true;
    const halfOk = availByKey[`${p.id}:HALF_COURSE`] ?? true;
    const combo2Rate = discountByKey[`${p.id}:COMBO_2_COURSES`];
    const fullRate = discountByKey[`${p.id}:FULL_SUB_LEVEL`];

    return `
      <tr data-program="${p.id}">
        <td><strong>${esc(p.name)}</strong></td>
        <td><input type="checkbox" class="chk-by-month" ${byMonthOk ? 'checked' : ''} ${CAN_EDIT ? '' : 'disabled'} /></td>
        <td><input type="checkbox" class="chk-half" ${halfOk ? 'checked' : ''} ${CAN_EDIT ? '' : 'disabled'} /></td>
        <td>${CAN_EDIT
          ? `<input type="number" class="rate-combo2" min="0" max="90" step="0.5" value="${combo2Rate != null ? (combo2Rate * 100).toFixed(1) : ''}" placeholder="—" style="width:80px;" /> %`
          : (combo2Rate != null ? `<strong class="mono">${(combo2Rate * 100).toFixed(1)}%</strong>` : '<span class="cell-muted">—</span>')}
        </td>
        <td>${CAN_EDIT
          ? `<input type="number" class="rate-full" min="0" max="90" step="0.5" value="${fullRate != null ? (fullRate * 100).toFixed(1) : ''}" placeholder="—" style="width:80px;" /> %`
          : (fullRate != null ? `<strong class="mono">${(fullRate * 100).toFixed(1)}%</strong>` : '<span class="cell-muted">—</span>')}
        </td>
        <td>${CAN_EDIT ? `<button class="btn btn-accent btn-sm" data-save="${p.id}">Lưu</button>` : ''}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const programId = btn.dataset.save;
      const byMonthOk = tr.querySelector('.chk-by-month').checked;
      const halfOk = tr.querySelector('.chk-half').checked;
      const combo2Input = tr.querySelector('.rate-combo2').value;
      const fullInput = tr.querySelector('.rate-full').value;

      btn.disabled = true; btn.textContent = 'Đang lưu...';
      try {
        await Promise.all([
          supabase.from('program_plan_availability').upsert(
            { program_id: programId, plan_type: 'BY_MONTH', is_available: byMonthOk }, { onConflict: 'program_id,plan_type' }
          ),
          supabase.from('program_plan_availability').upsert(
            { program_id: programId, plan_type: 'HALF_COURSE', is_available: halfOk }, { onConflict: 'program_id,plan_type' }
          ),
          combo2Input !== ''
            ? supabase.from('program_plan_discounts').upsert(
                { program_id: programId, plan_type: 'COMBO_2_COURSES', discount_rate: Number(combo2Input) / 100, updated_by: PROFILE.id, updated_at: new Date().toISOString() },
                { onConflict: 'program_id,plan_type' }
              )
            : Promise.resolve(),
          fullInput !== ''
            ? supabase.from('program_plan_discounts').upsert(
                { program_id: programId, plan_type: 'FULL_SUB_LEVEL', discount_rate: Number(fullInput) / 100, updated_by: PROFILE.id, updated_at: new Date().toISOString() },
                { onConflict: 'program_id,plan_type' }
              )
            : Promise.resolve(),
        ]);
      } catch (err) {
        alert('Lỗi: ' + (err.message || 'Có lỗi xảy ra.'));
      }
      btn.disabled = false; btn.textContent = 'Lưu';
      await loadRows();
    });
  });
}

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_EDIT = profile.roleCode === 'TECH' || profile.roleCode === 'EXECUTIVE';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
