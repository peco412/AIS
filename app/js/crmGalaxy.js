import { supabase, esc } from './supabase.js';

const WORLD_STORAGE_KEY = 'ais_current_world';

document.getElementById('btnBack').addEventListener('click', () => { window.location.href = '/world-select.html'; });

function enterCrm(centerId) {
  localStorage.setItem(WORLD_STORAGE_KEY, 'crm');
  if (centerId) localStorage.setItem('ais_selected_center', centerId);
  window.location.href = '/dashboard.html';
}

// Nen sao lap lanh phia sau (thuan trang tri, khong lien quan du lieu)
function renderBackgroundStars() {
  const svg = document.getElementById('bgStars');
  let html = '';
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 100, y = Math.random() * 100;
    const r = Math.random() * 1.4 + 0.4;
    const delay = (Math.random() * 3).toFixed(1);
    html += `<circle cx="${x}%" cy="${y}%" r="${r}" style="animation-delay:${delay}s"/>`;
  }
  svg.innerHTML = html;
}

async function renderGalaxy(profile) {
  const { data: centers, error } = await supabase.from('centers').select('id, name, code').eq('is_active', true).order('name');
  const sub = document.getElementById('gxSub');
  if (error || !centers || centers.length === 0) {
    sub.textContent = 'Không tải được danh sách trung tâm.';
    return;
  }
  sub.textContent = `${centers.length} trung tâm đang hoạt động — bấm vào 1 ngôi sao để vào`;

  const cx = 400, cy = 400;
  const n = centers.length;
  const baseR = Math.min(260, 140 + n * 6);
  const svg = document.getElementById('gxSvg');

  let html = '';
  // Vong tron quy dao mo
  html += `<circle class="orbit-line" cx="${cx}" cy="${cy}" r="${baseR}"/>`;

  // Duong noi tinh toan hinh (logo -> tung sao)
  const positions = centers.map((c, i) => {
    const angle = (2 * Math.PI / n) * i - Math.PI / 2;
    const rJitter = baseR + (i % 3) * 18;
    const x = cx + rJitter * Math.cos(angle);
    const y = cy + rJitter * Math.sin(angle) * 0.62;
    return { ...c, x, y };
  });

  positions.forEach((p) => {
    html += `<line class="constellation-line" x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`;
  });

  // Logo trung tam
  html += `
    <g class="logo-badge">
      <circle class="logo-badge__ring" cx="${cx}" cy="${cy}" r="46" fill="none" stroke="#e3c68a" stroke-width="1" stroke-dasharray="4 6" opacity="0.6"/>
      <circle cx="${cx}" cy="${cy}" r="38" fill="rgba(28,22,40,0.9)" stroke="#e3c68a" stroke-width="1.5"/>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" style="font-family:'Playfair Display',serif; font-weight:700; font-size:14px; fill:#fbf3e4;">AIS</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" style="font-family:'Be Vietnam Pro',sans-serif; font-size:8px; fill:#e3c68a; letter-spacing:0.1em;">OFFICE</text>
    </g>
  `;

  const colors = ['#8fd4f0', '#7fe0b8', '#e3c68a', '#f0a8c9', '#b89ee8', '#8fe0e0'];
  positions.forEach((p, i) => {
    const color = colors[i % colors.length];
    const isAccessible = !profile.isCenterManager || profile.centerId === p.id;
    html += `
      <g class="star-node ${isAccessible ? '' : 'star-node--locked'}" data-center="${p.id}" tabindex="${isAccessible ? '0' : '-1'}" role="button" aria-label="Vào trung tâm ${esc(p.name)}">
        <circle class="star-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${color}" style="color:${color};"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16" fill="${color}" opacity="0.18"/>
        <text class="star-label" x="${p.x.toFixed(1)}" y="${(p.y + 26).toFixed(1)}">${esc(p.name)}</text>
        ${isAccessible ? '' : `<text class="star-lock" x="${p.x.toFixed(1)}" y="${(p.y + 40).toFixed(1)}">🔒 Không có quyền</text>`}
      </g>
    `;
  });

  svg.innerHTML = html;

  svg.querySelectorAll('.star-node').forEach((node) => {
    node.addEventListener('click', () => {
      if (node.classList.contains('star-node--locked')) return;
      enterCrm(node.dataset.center);
    });
    node.addEventListener('keydown', (e) => {
      if (node.classList.contains('star-node--locked')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterCrm(node.dataset.center); }
    });
  });
}

(async () => {
  renderBackgroundStars();

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) { window.location.href = '/index.html'; return; }

  const { data: employee } = await supabase
    .from('employees')
    .select('id, center_id, system_roles ( code )')
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (!employee) return;
  const profile = {
    centerId: employee.center_id,
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
  };

  await renderGalaxy(profile);
})();
