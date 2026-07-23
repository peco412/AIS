import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';

document.getElementById('btnBack').addEventListener('click', () => { window.location.href = '/world-select.html'; });

function fmtMoney(n) { return new Intl.NumberFormat('vi-VN').format(Math.round(n || 0)); }

function hasAccessToSection(sectionName, profile) {
  const group = NAV_CONFIG.find((g) => g.section === sectionName);
  if (!group) return false;
  return group.items.some((item) => item.visible(profile));
}

// MOI — Lop ngoai cua Tang Dieu hanh: KPI tong quan, hien cho MOI NGUOI
// vao duoc toi tang nay xem (thong tin tong quan, khong phai du lieu
// nhay cam) — rieng "Trung tam Phe duyet" (lop trong) moi can quyen.
async function loadExecKpis() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [{ count: studentCount }, { data: revenueRows }] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'studying'),
    supabase.from('debt_ledger').select('amount_vnd').gte('created_at', monthStart),
  ]);
  document.getElementById('kpiStudents').textContent = studentCount ?? '—';
  document.getElementById('kpiRevenue').textContent = fmtMoney((revenueRows || []).reduce((s, r) => s + Number(r.amount_vnd), 0)) + ' đ';
}

function renderDepartmentDrilldown(profile) {
  const deptList = document.getElementById('deptList');
  document.querySelectorAll('.block-card').forEach((card) => {
    const section = card.dataset.section;
    const visible = hasAccessToSection(section, profile);
    if (!visible) {
      card.classList.add('block-card--locked');
      card.querySelector('.block-card__name').insertAdjacentHTML('afterend', '<div class="block-card__lock">🔒</div>');
      return;
    }
    card.addEventListener('click', () => {
      const group = NAV_CONFIG.find((g) => g.section === section);
      deptList.classList.add('is-visible');
      deptList.innerHTML = group.items.filter((it) => it.visible(profile)).map((it) => `
        <div class="dept-item" data-href="${it.href}"><div class="dept-item__name">${it.label}</div></div>
      `).join('') || '<div class="floor-desc">Không có mục nào.</div>';
      deptList.querySelectorAll('.dept-item').forEach((el) => {
        el.addEventListener('click', () => { window.location.href = el.dataset.href; });
      });
      deptList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
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
    departmentCode: employee.departments?.code || null,
    positionName: employee.positions?.name || '',
    roleCode: employee.system_roles?.code || 'STAFF',
    centerId: employee.centers?.id || null,
    centerName: employee.centers?.name || '',
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
  };

  await loadExecKpis();

  const btnApproval = document.getElementById('btnApprovalCenter');
  if (hasAccessToSection('Ban điều hành', profile)) {
    btnApproval.addEventListener('click', () => { window.location.href = '/exec/reports.html'; });
  } else {
    btnApproval.disabled = true;
    document.getElementById('execLockNote').innerHTML = '<div class="action-btn__lock">🔒 Không có quyền truy cập</div>';
  }

  renderDepartmentDrilldown(profile);
})();
