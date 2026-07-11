import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let CAN_EDIT = false;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function loadPricing() {
  const container = document.getElementById('programGroups');
  container.innerHTML = '<div class="empty-cell">Đang tải dữ liệu...</div>';

  // Tải đủ 4 tầng trong 1 câu, PostgREST tự lồng đúng cấu trúc cha-con.
  const { data: programs, error } = await supabase
    .from('programs')
    .select(`
      id, name, display_order,
      program_levels (
        id, name, display_order,
        program_sublevels (
          id, name, display_order,
          program_courses ( id, name, price_vnd, display_order )
        )
      )
    `)
    .order('display_order');

  if (error) { container.innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`; return; }
  if (!programs || programs.length === 0) { container.innerHTML = '<div class="empty-cell">Chưa có chương trình học nào.</div>'; return; }

  container.innerHTML = programs.map((prog) => renderProgram(prog)).join('');

  if (CAN_EDIT) {
    container.querySelectorAll('.price-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const { error: err } = await supabase.from('program_courses').update({ price_vnd: Number(input.value) || 0 }).eq('id', input.dataset.course);
        if (err) { alert('Lỗi: ' + err.message); return; }
        await loadPricing(); // tải lại để cập nhật đúng các mức tổng
      });
    });
  }
}

function renderProgram(prog) {
  const levels = (prog.program_levels || []).sort((a, b) => a.display_order - b.display_order);
  let programTotal = 0;

  const levelsHtml = levels.map((level) => {
    const sublevels = (level.program_sublevels || []).sort((a, b) => a.display_order - b.display_order);
    let levelTotal = 0;

    const sublevelsHtml = sublevels.map((sl) => {
      const courses = (sl.program_courses || []).sort((a, b) => a.display_order - b.display_order);
      const slTotal = courses.reduce((s, c) => s + Number(c.price_vnd || 0), 0);
      levelTotal += slTotal;

      const coursesHtml = courses.map((c) => `
        <span class="course-chip">
          ${esc(c.name)}:
          ${CAN_EDIT
            ? `<input type="number" class="price-input" data-course="${c.id}" value="${c.price_vnd || 0}" />`
            : `<strong class="mono">${fmtMoney(c.price_vnd)} đ</strong>`}
        </span>
      `).join('');

      // Chỉ hiện dòng tổng "Cấp độ con" khi có TỪ 2 khoá trở lên (1 khoá thì
      // tổng = chính giá khoá đó, hiện thêm dòng tổng chỉ gây rối mắt thừa).
      return `
        <div class="sublevel-row"><span class="sublevel-row__name">↳ ${esc(sl.name)}</span>${courses.length > 1 ? `<span class="mono cell-muted">Tổng: ${fmtMoney(slTotal)} đ</span>` : ''}</div>
        <div class="course-list">${coursesHtml}</div>
      `;
    }).join('');

    programTotal += levelTotal;

    return `
      <div class="level-block">
        <div class="level-block__title">${esc(level.name)} <span class="cell-muted" style="text-transform:none; font-weight:400;">— trọn cấp độ: ${fmtMoney(levelTotal)} đ</span></div>
        ${sublevelsHtml}
      </div>
    `;
  }).join('');

  return `
    <details class="program-group">
      <summary><span class="name">${esc(prog.name)}</span><span class="total">Trọn chương trình: ${fmtMoney(programTotal)} đ</span></summary>
      ${levelsHtml}
    </details>
  `;
}

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    // Ma tran: trang gia khoa hoc thuoc "Cau hinh Master Data" - Ky thuat
    // duoc sua, rieng BDH (EXECUTIVE) chi con quyen xem (khong sua duoc).
    CAN_EDIT = emp?.departments?.code === 'ACC' || profile.roleCode === 'TECH';
    await loadPricing();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
