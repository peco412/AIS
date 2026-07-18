import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

async function loadRows() {
  const container = document.getElementById('divisionCards');
  const { data, error } = await supabase.from('divisions').select('*').order('code');
  if (error) { container.innerHTML = `<div class="empty-cell">Lỗi: ${error.message}</div>`; return; }

  container.innerHTML = (data || []).map((d) => `
    <div class="division-card" data-id="${d.id}">
      <div class="division-card__swatch" style="background:${esc(d.theme_color)};"></div>
      <div class="field"><label>Mã khối</label><input type="text" class="text-input" value="${esc(d.code)}" disabled /></div>
      <div class="field"><label>Tên hiển thị</label><input type="text" class="text-input name-input" data-id="${d.id}" data-original="${esc(d.name)}" value="${esc(d.name)}" /></div>
      <div class="field"><label>Màu chủ đạo</label><input type="text" class="text-input color-input" data-id="${d.id}" data-original="${esc(d.theme_color)}" value="${esc(d.theme_color)}" placeholder="#0094D9" /></div>
      <button class="btn btn-outline btn-sm" data-save="${d.id}" style="display:none; align-self:flex-end;">Lưu</button>
    </div>
  `).join('');

  container.querySelectorAll('.name-input, .color-input').forEach((input) => {
    input.addEventListener('input', () => {
      const card = input.closest('.division-card');
      const nameInput = card.querySelector('.name-input');
      const colorInput = card.querySelector('.color-input');
      const dirty = nameInput.value.trim() !== nameInput.dataset.original || colorInput.value.trim() !== colorInput.dataset.original;
      card.querySelector('[data-save]').style.display = dirty ? 'inline-flex' : 'none';
      if (input.classList.contains('color-input')) card.querySelector('.division-card__swatch').style.background = input.value;
    });
  });

  container.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('.division-card');
    const name = card.querySelector('.name-input').value.trim();
    const theme_color = card.querySelector('.color-input').value.trim();
    if (!name || !theme_color) { alert('Vui lòng nhập đủ tên và mã màu.'); return; }
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    const { error } = await supabase.from('divisions').update({ name, theme_color }).eq('id', btn.dataset.save);
    btn.disabled = false; btn.textContent = 'Lưu';
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }));
}

(async () => {
  try {
    await bootShell();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
