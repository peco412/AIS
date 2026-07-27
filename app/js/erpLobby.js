import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';

const WORLD_STORAGE_KEY = 'ais_current_world';

function enterErp() {
  localStorage.setItem(WORLD_STORAGE_KEY, 'erp');
  window.location.href = '/dashboard.html';
}

document.getElementById('btnBack').addEventListener('click', () => { window.location.href = '/world-select.html'; });

document.getElementById('btnFloorExec').addEventListener('click', (e) => {
  if (e.currentTarget.disabled) return;
  enterErp();
});

document.getElementById('btnFloorDept').addEventListener('click', () => {
  document.getElementById('deptList').classList.add('is-visible');
  document.getElementById('btnFloorDept').style.display = 'none';
});

document.querySelectorAll('.dept-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    enterErp();
  });
});

// MOI — kiem tra quyen THEO TUNG MUC (khong chi theo the gioi) — 1 khu
// vuc (tang/phong ban) duoc coi la "co quyen" neu co it nhat 1 muc trong
// do nguoi nay xem duoc, dung chinh logic canAccess ma menu that dang
// dung (item.visible(profile)), tranh viet luat rieng de bi lech.
function hasAccessToSection(sectionName, profile) {
  const group = NAV_CONFIG.find((g) => g.section === sectionName);
  if (!group) return false;
  return group.items.some((item) => item.visible(profile));
}

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
    id: employee.id,
    departmentCode: employee.departments?.code || null,
    positionName: employee.positions?.name || '',
    roleCode: employee.system_roles?.code || 'STAFF',
    centerId: employee.centers?.id || null,
    centerName: employee.centers?.name || '',
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
  };

  if (!hasAccessToSection('Ban điều hành', profile)) {
    const btn = document.getElementById('btnFloorExec');
    btn.disabled = true;
    btn.querySelector('.floor-btn__desc').insertAdjacentHTML('afterend', '<div class="floor-btn__lock">🔒 Không có quyền truy cập</div>');
  }

  const deptSections = ['Phòng nhân sự', 'Phòng kế toán', 'Phòng truyền thông', 'Phòng cơ sở vật chất'];
  const anyDeptAccessible = deptSections.some((s) => hasAccessToSection(s, profile));
  if (!anyDeptAccessible) {
    const btn = document.getElementById('btnFloorDept');
    btn.disabled = true;
    btn.querySelector('.floor-btn__desc').insertAdjacentHTML('afterend', '<div class="floor-btn__lock">🔒 Không có quyền truy cập</div>');
  }

  document.querySelectorAll('.dept-btn').forEach((btn) => {
    if (hasAccessToSection(btn.dataset.section, profile)) return;
    btn.disabled = true;
    btn.querySelector('.dept-btn__name').insertAdjacentHTML('afterend', '<div class="dept-btn__lock">🔒</div>');
  });
})();
