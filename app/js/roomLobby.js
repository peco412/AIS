import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';

const ICONS = {
  '/directory.html': '📇',
  '/profile.html': '👤',
  '/my-payroll.html': '💵',
  '/meetings.html': '🗓️',
  '/attendance-checkin.html': '📍',
  '/hr/late-clockin-requests.html': '⏰',
  '/acc/purchase-orders.html': '🧾',
  '/proposals.html': '💡',
  '/archive.html': '📚',
  '/permission-requests.html': '🔑',
};

document.getElementById('btnBack').addEventListener('click', () => { window.location.href = '/world-select.html'; });

(async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) { window.location.href = '/index.html'; return; }

  const { data: employee } = await supabase
    .from('employees')
    .select(`
      id, center_id,
      departments ( code ), positions ( name ),
      system_roles ( code ), centers ( id, name )
    `)
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (!employee) return;
  const profile = {
    departmentCode: employee.departments?.code || null,
    positionName: employee.positions?.name || '',
    roleCode: employee.system_roles?.code || 'STAFF',
    centerId: employee.centers?.id || null,
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
  };

  const group = NAV_CONFIG.find((g) => g.section === 'Chức năng cá nhân');
  const grid = document.getElementById('roomGrid');
  grid.innerHTML = group.items.map((item) => {
    const visible = item.visible(profile);
    const icon = ICONS[item.href] || '✨';
    return `
      <div class="room-item ${visible ? '' : 'room-item--locked'}" data-href="${item.href}" tabindex="${visible ? '0' : '-1'}" role="button">
        <div class="room-item__icon">${icon}</div>
        <div class="room-item__name">${item.label}</div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.room-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.classList.contains('room-item--locked')) return;
      window.location.href = el.dataset.href;
    });
    el.addEventListener('keydown', (e) => {
      if (el.classList.contains('room-item--locked')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = el.dataset.href; }
    });
  });
})();
