import { supabase } from './supabase.js';

const WORLD_STORAGE_KEY = 'ais_current_world';

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function enterWorld(world) {
  localStorage.setItem(WORLD_STORAGE_KEY, world);
  window.location.href = '/dashboard.html';
}

document.querySelectorAll('.ws-building').forEach((el) => {
  el.addEventListener('click', (e) => { e.preventDefault(); enterWorld(el.dataset.world); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterWorld(el.dataset.world); }
  });
});
document.getElementById('btnSkip').addEventListener('click', () => enterWorld('erp'));

(async () => {
  document.getElementById('greetingEyebrow').textContent = timeGreeting();

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) { window.location.href = '/index.html'; return; }

  const { data: employee } = await supabase
    .from('employees')
    .select('full_name')
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  document.getElementById('userNameSpan').textContent = employee?.full_name || '';
})();
