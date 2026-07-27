import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';

// MOI — gop 12 muc du lieu goc thanh 4 "ngan" theo NOI DUNG, de tim hon
// thay vi 1 danh sach dai — dung dung href de phan nhom, khong tao du
// lieu moi.
const CATEGORIES = [
  { name: 'Tổ chức', icon: '🏢', hrefs: ['/master-data/centers.html', '/master-data/departments.html', '/master-data/system-roles.html', '/master-data/divisions.html'] },
  { name: 'Tài chính', icon: '💰', hrefs: ['/acc/suppliers.html', '/master-data/expense-categories.html', '/master-data/chart-of-accounts.html', '/master-data/wallet-tier-discounts.html'] },
  { name: 'Học vụ', icon: '🎓', hrefs: ['/master-data/program-pricing.html', '/master-data/program-plan-discounts.html'] },
  { name: 'Vật tư & Kho', icon: '📦', hrefs: ['/master-data/size-chart.html', '/master-data/inventory-items.html'] },
];

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

  const group = NAV_CONFIG.find((g) => g.section === 'Cấu hình dữ liệu gốc');
  const itemsByHref = {};
  group.items.forEach((item) => { itemsByHref[item.href] = item; });

  const panel = document.getElementById('vaultPanel');
  panel.innerHTML = CATEGORIES.map((cat, ci) => {
    const items = cat.hrefs.map((h) => itemsByHref[h]).filter(Boolean);
    const anyVisible = items.some((it) => it.visible(profile));
    return `
      <div class="drawer" data-cat="${ci}" ${anyVisible ? '' : 'style="opacity:0.5; cursor:not-allowed;"'}>
        <div class="drawer__icon">${cat.icon}</div>
        <div class="drawer__text">
          <div class="drawer__name">${cat.name}</div>
          <div class="drawer__count">${items.length} mục${anyVisible ? '' : ' — 🔒 Không có quyền'}</div>
        </div>
        <div class="drawer__arrow">▸</div>
      </div>
      <div class="drawer-items" id="drawerItems${ci}">
        ${items.map((it) => {
          const visible = it.visible(profile);
          return `<div class="drawer-item ${visible ? '' : 'drawer-item--locked'}" data-href="${it.href}">
            <div class="drawer-item__name">${it.label}</div>
            ${visible ? '' : '<div class="drawer-item__lock">🔒</div>'}
          </div>`;
        }).join('')}
      </div>
    `;
  }).join('');

  panel.querySelectorAll('.drawer').forEach((drawer) => {
    const ci = drawer.dataset.cat;
    const itemsBox = document.getElementById(`drawerItems${ci}`);
    const anyVisible = CATEGORIES[ci].hrefs.some((h) => itemsByHref[h]?.visible(profile));
    if (!anyVisible) return; // khoa het thi khong cho mo ngan
    drawer.addEventListener('click', () => {
      const isOpen = itemsBox.classList.toggle('is-visible');
      drawer.classList.toggle('is-open', isOpen);
    });
  });

  panel.querySelectorAll('.drawer-item').forEach((el) => {
    if (el.classList.contains('drawer-item--locked')) return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = el.dataset.href;
    });
  });
})();
