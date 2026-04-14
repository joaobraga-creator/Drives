// ─── Auth guard ───────────────────────────────────────────────────────────────
const facility  = sessionStorage.getItem('notused_facility');
const userEmail = sessionStorage.getItem('notused_email') || '';

if (!facility) window.location.href = 'index.html';

function logout() {
  sessionStorage.clear();
  window.location.href = 'index.html';
}

// ─── State ────────────────────────────────────────────────────────────────────
let allDrivers   = [];
let activeFilter = 'todos';

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('header-facility');
  if (el) el.textContent = facility;

  const emailEl = document.getElementById('header-email');
  if (emailEl) emailEl.textContent = userEmail;

  const dateEl = document.getElementById('header-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('pt-BR', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  // Event delegation — evita bugs de onclick inline com re-render do DOM
  document.getElementById('table-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx    = parseInt(btn.dataset.idx);
    const action = btn.dataset.action;
    const driver = allDrivers[idx];
    if (!driver) return;
    if (action === 'arrived')          markArrived(driver);
    else if (action === 'not-arrived') markNotArrived(driver);
    else if (action === 'undo')        undoEvent(driver);
  });

  loadDrivers();
});

// ─── Load drivers ─────────────────────────────────────────────────────────────
async function loadDrivers() {
  const tbody = document.getElementById('table-body');
  const btnR  = document.getElementById('btn-refresh');
  const icon  = document.getElementById('refresh-icon');

  btnR.classList.add('loading');
  icon.innerHTML = '<span class="spinner"></span>';
  renderSkeleton(tbody);

  try {
    const res  = await fetch(`/drivers/${encodeURIComponent(facility)}`);
    const data = await res.json();

    if (!res.ok) { renderError(tbody, data.detail || 'Erro ao carregar.'); return; }

    allDrivers = (data.drivers || []).map((d, i) => ({ ...d, _idx: i }));
    updateStats();
    applyFilters();

  } catch {
    renderError(tbody, 'Erro de conexão. Backend offline?');
  } finally {
    btnR.classList.remove('loading');
    icon.textContent = '↺';
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const total     = allDrivers.length;
  const arrived   = allDrivers.filter(d => d.event_type === 'ARRIVED').length;
  const naoChegou = allDrivers.filter(d => d.event_type === 'NOT_USED_CORRETO' || d.event_type === 'NOT_USED_INCORRETO').length;
  const nui       = allDrivers.filter(d => d.event_type === 'NOT_USED_INCORRETO').length;
  const pendentes = total - arrived - naoChegou;

  setText('stat-total',      total);
  setText('stat-arrived',    arrived);
  setText('stat-pendentes',  pendentes);
  setText('stat-nao-chegou', naoChegou);
  setText('stat-nui',        nui);

  const nuiCard = document.getElementById('stat-card-nui');
  if (nuiCard) nuiCard.style.display = nui > 0 ? '' : 'none';
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

  if (activeFilter === 'pendentes')  list = list.filter(d => !d.event_type);
  if (activeFilter === 'arrived')    list = list.filter(d => d.event_type === 'ARRIVED');
  if (activeFilter === 'nao-chegou') list = list.filter(d =>
    d.event_type === 'NOT_USED_CORRETO' || d.event_type === 'NOT_USED_INCORRETO'
  );

  if (search) {
    list = list.filter(d =>
      String(d.driver_id   || '').toLowerCase().includes(search) ||
      String(d.tipo_veiculo|| '').toLowerCase().includes(search) ||
      String(d.driver_type || '').toLowerCase().includes(search)
    );
  }

  renderTable(tbody, list);
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderTable(tbody, drivers) {
  if (!drivers.length) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state"><div class="icon">○</div><p>Nenhum motorista encontrado</p></div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = drivers.map((d, i) => buildRow(d, i + 1)).join('');
}

function buildRow(d, num) {
  const et = d.event_type;
  const rowClass = et === 'ARRIVED'              ? 'row-arrived'
                 : et === 'NOT_USED_INCORRETO'   ? 'row-nui'
                 : et === 'NOT_USED_CORRETO'     ? 'row-nuc'
                 : '';

  const chegada  = escHtml(d.horario_chegada || d.eta_planejado_operacao || '—');
  const statusBQ = d.status_driver || '—';
  const driverId = escHtml(String(d.driver_id  || '—'));
  const tipo     = escHtml(String(d.driver_type|| '—'));
  const svc      = escHtml(String(d.svc        || '—'));

  return `<tr class="${rowClass}" id="row-${driverId}">
    <td style="color:var(--muted);font-size:12px">${num}</td>
    <td style="font-family:monospace;font-weight:600">${driverId}</td>
    <td>${vehicleToBadge(d.tipo_veiculo)}</td>
    <td class="hide-mobile" style="color:var(--text2)">${tipo}</td>
    <td style="font-weight:600;color:var(--blue)">${chegada}</td>
    <td class="hide-mobile">${statusToDot(statusBQ)}${escHtml(statusBQ)}</td>
    <td class="hide-mobile" style="color:var(--muted)">${svc}</td>
    <td>${buildActionCell(d)}</td>
  </tr>`;
}

function buildActionCell(d) {
  const idx = d._idx;
  const et  = d.event_type;

  if (!et) {
    return `<div class="action-group">
      <button class="btn-arrived"     data-action="arrived"     data-idx="${idx}">✓ Chegou</button>
      <button class="btn-not-arrived" data-action="not-arrived" data-idx="${idx}">Não chegou</button>
    </div>`;
  }
  if (et === 'ARRIVED') {
    return `<div class="action-group">
      <span class="badge badge-arrived">✓ Chegou</span>
      <button class="btn-undo" data-action="undo" data-idx="${idx}">desfazer</button>
    </div>`;
  }
  if (et === 'NOT_USED_CORRETO') {
    return `<div class="action-group">
      <span class="badge badge-nuc">Não chegou</span>
      <span class="ofensor-tag ofensor-op">Operação</span>
      <button class="btn-undo" data-action="undo" data-idx="${idx}">desfazer</button>
    </div>`;
  }
  if (et === 'NOT_USED_INCORRETO') {
    return `<div class="action-group">
      <span class="badge badge-nui">⚠ NUI</span>
      <span class="ofensor-tag ofensor-driver">Driver</span>
      <button class="btn-undo" data-action="undo" data-idx="${idx}">desfazer</button>
    </div>`;
  }
  return '—';
}

// ─── Eventos ──────────────────────────────────────────────────────────────────
async function markArrived(driver) {
  const ok = await postEvent(String(driver.driver_id), 'ARRIVED', driver.horario_chegada, driver.data_eta);
  if (ok) { driver.event_type = 'ARRIVED'; refresh(); }
}

async function markNotArrived(driver) {
  const eventType = computeNotUsedType(driver);
  if (eventType === 'NOT_USED_INCORRETO') {
    const etaStr = driver.horario_chegada || driver.eta_planejado_operacao || 'N/A';
    const ok = confirm(
      `⚠ Atenção — Registro NUI\n\nO ETA deste driver é ${etaStr} e ainda não chegou.\n\nMarcar como "Não chegou" antes do ETA será salvo como NUI Incorreto e ficará visível para o administrador.\n\nDeseja continuar?`
    );
    if (!ok) return;
  }
  const posted = await postEvent(String(driver.driver_id), eventType, driver.horario_chegada, driver.data_eta);
  if (posted) { driver.event_type = eventType; refresh(); }
}

async function undoEvent(driver) {
  try {
    const res = await fetch('/event', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ facility, driver_id: String(driver.driver_id), email: userEmail })
    });
    if (!res.ok) return;
    driver.event_type = null;
    driver.clicked_at = null;
    refresh();
  } catch (err) {
    console.error('Erro ao desfazer:', err);
  }
}

async function postEvent(driverId, eventType, etaTime, etaDate) {
  try {
    const res = await fetch('/event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        facility,
        driver_id:  String(driverId),
        event_type: eventType,
        email:      userEmail,
        eta_time:   etaTime || null,
        eta_date:   etaDate || null
      })
    });
    return res.ok;
  } catch { return false; }
}

function refresh() {
  updateStats();
  applyFilters();
}

// ─── Lógica ETA ───────────────────────────────────────────────────────────────
function computeNotUsedType(driver) {
  const etaDate = driver.data_eta;
  const etaTime = driver.horario_chegada || driver.eta_planejado_operacao;

  if (!etaDate || !etaTime) return 'NOT_USED_CORRETO';

  try {
    // etaTime formato HH:MM:SS, etaDate formato YYYY-MM-DD
    const etaDateTime = new Date(`${etaDate}T${etaTime}`);
    if (isNaN(etaDateTime.getTime())) return 'NOT_USED_CORRETO';
    return new Date() < etaDateTime ? 'NOT_USED_INCORRETO' : 'NOT_USED_CORRETO';
  } catch {
    return 'NOT_USED_CORRETO';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function vehicleToBadge(desc) {
  const s = String(desc || '').toLowerCase();
  if (s.includes('moto'))
    return `<span class="badge badge-moto">Moto</span>`;
  if (s.includes('carro') || s.includes('passeio') || s.includes('car'))
    return `<span class="badge badge-carro">Carro</span>`;
  if (s.includes('walker') || s.includes('pedestre'))
    return `<span class="badge badge-walker">Walker</span>`;
  return `<span class="badge badge-other">${escHtml(desc || '—')}</span>`;
}

function statusToDot(status) {
  const s = String(status || '').toUpperCase();
  if (s.includes('ACTIVE') || s.includes('ATIVO'))
    return `<span class="status-dot dot-active"></span>`;
  if (s.includes('PEND'))
    return `<span class="status-dot dot-pending"></span>`;
  if (s.includes('CANCEL'))
    return `<span class="status-dot dot-cancelled"></span>`;
  return `<span class="status-dot dot-unknown"></span>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])
  );
}

function renderSkeleton(tbody) {
  tbody.innerHTML = Array(8).fill(0).map(() => `
    <tr class="skeleton-row">
      ${Array(8).fill(0).map(() =>
        `<td><div class="skeleton-bar" style="width:${40 + Math.floor(Math.random()*50)}px"></div></td>`
      ).join('')}
    </tr>`).join('');
}

function renderError(tbody, msg) {
  tbody.innerHTML = `<tr><td colspan="8">
    <div class="empty-state">
      <div class="icon">⚠</div>
      <p style="color:var(--red)">${escHtml(msg)}</p>
    </div></td></tr>`;
}
