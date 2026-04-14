const API = 'http://localhost:8000';

// ─── Auth guard ───────────────────────────────────────────────────────────────
const facility = sessionStorage.getItem('notused_facility');
const userEmail = sessionStorage.getItem('notused_email');

if (!facility) {
  window.location.href = 'index.html';
}

function logout() {
  sessionStorage.clear();
  window.location.href = 'index.html';
}

// ─── State ────────────────────────────────────────────────────────────────────
let allDrivers   = [];
let activeFilter = 'todos';

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Header
  const facilityEl = document.getElementById('header-facility');
  if (facilityEl) facilityEl.textContent = '/ ' + facility;

  const dateEl = document.getElementById('header-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  loadDrivers();
});

// ─── Load drivers ─────────────────────────────────────────────────────────────
async function loadDrivers() {
  const tbody    = document.getElementById('table-body');
  const btnRefresh = document.getElementById('btn-refresh');
  const refreshIcon = document.getElementById('refresh-icon');

  btnRefresh.classList.add('loading');
  refreshIcon.innerHTML = '<span class="spinner"></span>';
  renderSkeleton(tbody);

  try {
    const res  = await fetch(`${API}/drivers/${encodeURIComponent(facility)}`);
    const data = await res.json();

    if (!res.ok) {
      renderError(tbody, data.detail || 'Erro ao carregar motoristas.');
      return;
    }

    allDrivers = data.drivers || [];
    updateStats();
    applyFilters();

  } catch (err) {
    renderError(tbody, 'Erro de conexão. Verifique o backend.');
  } finally {
    btnRefresh.classList.remove('loading');
    refreshIcon.textContent = '↺';
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const total        = allDrivers.length;
  const confirmados  = allDrivers.filter(d => d.confirmado).length;
  const cancelados   = allDrivers.filter(d => isCancelled(d)).length;
  const pendentes    = total - confirmados - cancelados;
  const rotas        = allDrivers.reduce((s, d) => s + (Number(d.total_planejado_geral) || 0), 0);

  setText('stat-total',       total);
  setText('stat-confirmados', confirmados);
  setText('stat-pendentes',   pendentes);
  setText('stat-cancelados',  cancelados);
  setText('stat-rotas',       rotas || '—');
}

function isCancelled(d) {
  const s = String(d.status_driver || '').toUpperCase();
  const c = String(d.cancellation  || '').toUpperCase();
  return s.includes('CANCEL') || c === 'TRUE' || c === '1';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  applyFilters();
}

function applyFilters() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const tbody  = document.getElementById('table-body');

  let list = allDrivers.slice();

  if (activeFilter === 'confirmados') list = list.filter(d => d.confirmado);
  if (activeFilter === 'cancelados')  list = list.filter(d => isCancelled(d));
  if (activeFilter === 'pendentes')   list = list.filter(d => !d.confirmado && !isCancelled(d));

  if (search) {
    list = list.filter(d =>
      String(d.driver_id || '').toLowerCase().includes(search) ||
      String(d.tipo_veiculo || '').toLowerCase().includes(search) ||
      String(d.driver_type || '').toLowerCase().includes(search)
    );
  }

  renderTable(tbody, list);
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderTable(tbody, drivers) {
  if (!drivers.length) {
    tbody.innerHTML = `
      <tr><td colspan="10">
        <div class="empty-state">
          <div class="icon">○</div>
          <div>Nenhum motorista encontrado</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = drivers.map((d, i) => buildRow(d, i + 1)).join('');
}

function buildRow(d, num) {
  const cancelled  = isCancelled(d);
  const confirmed  = d.confirmado;
  const rowClass   = confirmed ? 'confirmed' : '';

  const chegada = d.horario_chegada || d.eta_planejado_operacao || '—';
  const dataEta = d.data_eta || '—';

  const statusDot  = statusToDot(d.status_driver, cancelled);
  const statusText = d.status_driver || '—';

  const vehicleBadge = vehicleToBadge(d.tipo_veiculo);

  const driverId = escHtml(String(d.driver_id || '—'));
  const tipo     = escHtml(String(d.driver_type || '—'));
  const cat      = escHtml(String(d.driver_category || '—'));
  const svc      = escHtml(String(d.svc || '—'));

  const actionBtn = confirmed
    ? `<button class="btn-confirmed" onclick="toggleConfirm('${driverId}', ${confirmed})" title="Clique para desfazer">✓ Confirmado</button>`
    : `<button class="btn-confirm"    onclick="toggleConfirm('${driverId}', ${confirmed})">Confirmar</button>`;

  return `<tr class="${rowClass}" id="row-${driverId}">
    <td class="mono" style="color:var(--muted)">${num}</td>
    <td class="mono">${driverId}</td>
    <td>${vehicleBadge}</td>
    <td class="hide-mobile">${tipo}</td>
    <td class="hide-mobile" style="color:var(--muted)">${cat}</td>
    <td class="mono" style="color:var(--accent)">${escHtml(chegada)}</td>
    <td class="hide-mobile mono" style="color:var(--muted)">${escHtml(dataEta)}</td>
    <td>${statusDot}${escHtml(statusText)}</td>
    <td class="hide-mobile mono" style="color:var(--muted)">${svc}</td>
    <td>${actionBtn}</td>
  </tr>`;
}

// ─── Confirm / Undo ───────────────────────────────────────────────────────────
async function toggleConfirm(driverId, isConfirmed) {
  const method = isConfirmed ? 'DELETE' : 'POST';

  try {
    const res = await fetch(`${API}/confirm`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facility, driver_id: String(driverId) })
    });

    if (!res.ok) return;

    // Atualiza estado local
    const idx = allDrivers.findIndex(d => String(d.driver_id) === String(driverId));
    if (idx !== -1) allDrivers[idx].confirmado = !isConfirmed;

    updateStats();
    applyFilters();

  } catch (err) {
    console.error('Erro ao confirmar:', err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function vehicleToBadge(desc) {
  const s = String(desc || '').toLowerCase();
  if (s.includes('moto'))   return `<span class="badge badge-moto">Moto</span>`;
  if (s.includes('carro') || s.includes('passeio') || s.includes('car'))
                             return `<span class="badge badge-carro">Carro</span>`;
  if (s.includes('walker') || s.includes('pedestre'))
                             return `<span class="badge badge-walker">Walker</span>`;
  return `<span class="badge badge-other">${escHtml(desc || '—')}</span>`;
}

function statusToDot(status, cancelled) {
  if (cancelled) return `<span class="status-dot dot-cancelled"></span>`;
  const s = String(status || '').toUpperCase();
  if (s.includes('ACTIVE') || s.includes('ATIVO')) return `<span class="status-dot dot-active"></span>`;
  if (s.includes('PEND'))  return `<span class="status-dot dot-pending"></span>`;
  if (s.includes('CANCEL'))return `<span class="status-dot dot-cancelled"></span>`;
  return `<span class="status-dot dot-unknown"></span>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function renderSkeleton(tbody) {
  const rows = Array(8).fill(0).map(() => `
    <tr class="skeleton-row">
      ${Array(10).fill('<td><div class="skeleton-bar" style="width:' + (40 + Math.random()*50).toFixed(0) + 'px"></div></td>').join('')}
    </tr>`).join('');
  tbody.innerHTML = rows;
}

function renderError(tbody, msg) {
  tbody.innerHTML = `
    <tr><td colspan="10">
      <div class="empty-state">
        <div class="icon">⚠</div>
        <div style="color:var(--red)">${escHtml(msg)}</div>
      </div>
    </td></tr>`;
}
