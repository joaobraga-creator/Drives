// ─── Auth guard ───────────────────────────────────────────────────────────────
const userEmail = sessionStorage.getItem('notused_email') || '';
const isAdmin   = sessionStorage.getItem('notused_is_admin') === 'true';

if (!isAdmin) window.location.href = 'index.html';

function logout() {
  sessionStorage.clear();
  window.location.href = 'index.html';
}

// ─── State ────────────────────────────────────────────────────────────────────
let allEvents = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const emailEl = document.getElementById('header-email');
  if (emailEl) emailEl.textContent = userEmail;
  loadData();
});

async function loadData() {
  await Promise.all([loadSummary(), loadEvents()]);
}

// ─── Summary (facility cards) ─────────────────────────────────────────────────
async function loadSummary() {
  try {
    const res  = await fetch(`/admin/summary?email=${encodeURIComponent(userEmail)}`);
    const data = await res.json();
    if (!res.ok) return;
    renderFacilityCards(data.summary || []);
  } catch {}
}

function renderFacilityCards(summary) {
  const container = document.getElementById('facility-cards');

  if (!summary.length) {
    container.innerHTML = `<div style="color:var(--muted);font-size:13px;grid-column:1/-1;padding:8px 0">
      Nenhum evento registrado ainda. Os facilities aparecerão aqui assim que os operadores começarem a usar o sistema.
    </div>`;
    return;
  }

  container.innerHTML = summary.map(f => {
    const hasNui = (f.nui || 0) > 0;
    return `
      <div class="facility-card ${hasNui ? 'has-nui' : ''}" onclick="drillFacility('${esc(f.facility)}')">
        <div class="fc-name">${esc(f.facility)}</div>
        <div class="fc-stats">
          <div class="fcs-item">
            <div class="fcs-val" style="color:var(--green)">${f.arrived || 0}</div>
            <div class="fcs-lbl">Chegaram</div>
          </div>
          <div class="fcs-item">
            <div class="fcs-val" style="color:var(--muted)">${f.nuc || 0}</div>
            <div class="fcs-lbl">NUC</div>
          </div>
          <div class="fcs-item">
            <div class="fcs-val" style="color:${hasNui ? 'var(--orange)' : 'var(--muted)'}">${f.nui || 0}</div>
            <div class="fcs-lbl">NUI ⚠</div>
          </div>
          <div class="fcs-item">
            <div class="fcs-val" style="color:var(--blue)">${f.total || 0}</div>
            <div class="fcs-lbl">Total</div>
          </div>
        </div>
        ${hasNui ? `<div class="fc-nui-note">${f.nui} driver(s) marcados antes do ETA previsto</div>` : ''}
      </div>
    `;
  }).join('');
}

// ─── Events table ─────────────────────────────────────────────────────────────
async function loadEvents() {
  try {
    const res  = await fetch(`/admin/events?email=${encodeURIComponent(userEmail)}&limit=500`);
    const data = await res.json();
    if (!res.ok) return;
    allEvents = data.events || [];
    populateFacilityFilter();
    renderEventsTable(allEvents);
    checkNuiBanner();
  } catch {}
}

function checkNuiBanner() {
  const nui     = allEvents.filter(e => e.event_type === 'NOT_USED_INCORRETO');
  const banner  = document.getElementById('nui-banner');
  const bannerT = document.getElementById('nui-banner-text');
  if (nui.length > 0) {
    bannerT.textContent = `${nui.length} registro(s) NUI Incorreto detectado(s) — facilities marcaram drivers como "não chegou" antes do ETA previsto.`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function populateFacilityFilter() {
  const select     = document.getElementById('filter-facility');
  const existing   = new Set(Array.from(select.options).map(o => o.value));
  const facilities = [...new Set(allEvents.map(e => e.facility))].sort();
  facilities.forEach(f => {
    if (!existing.has(f)) {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      select.appendChild(opt);
    }
  });
}

function applyEventFilter() {
  const facFilter  = document.getElementById('filter-facility').value;
  const typeFilter = document.getElementById('filter-type').value;
  let list = allEvents.slice();
  if (facFilter)  list = list.filter(e => e.facility  === facFilter);
  if (typeFilter) list = list.filter(e => e.event_type === typeFilter);
  renderEventsTable(list);
}

function drillFacility(facility) {
  document.getElementById('filter-facility').value = facility;
  applyEventFilter();
  document.getElementById('events-tbody').closest('.table-wrapper')
    .scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderEventsTable(events) {
  const tbody = document.getElementById('events-tbody');

  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state"><div class="icon">○</div><p>Nenhum evento encontrado</p></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = events.map((e, i) => {
    const rowClass  = e.event_type === 'NOT_USED_INCORRETO' ? 'row-nui' : '';
    const etaStr    = e.eta_time ? `${e.eta_date || ''} ${e.eta_time}`.trim() : '—';
    const clickedAt = e.clicked_at
      ? new Date(e.clicked_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : '—';

    return `<tr class="${rowClass}">
      <td style="color:var(--muted);font-size:12px">${i + 1}</td>
      <td style="font-weight:700">${esc(e.facility)}</td>
      <td style="font-family:monospace;font-weight:600">${esc(e.driver_id)}</td>
      <td>${eventTypeBadge(e.event_type)}</td>
      <td style="color:var(--blue);font-family:monospace">${esc(etaStr)}</td>
      <td style="color:var(--text2)">${clickedAt}</td>
      <td class="hide-mobile" style="color:var(--muted)">${esc(e.email || '—')}</td>
    </tr>`;
  }).join('');
}

function eventTypeBadge(type) {
  if (type === 'ARRIVED')            return `<span class="badge badge-arrived">✓ Chegou</span>`;
  if (type === 'NOT_USED_CORRETO')   return `<span class="badge badge-nuc">Não chegou</span>`;
  if (type === 'NOT_USED_INCORRETO') return `<span class="badge badge-nui">⚠ NUI</span>`;
  return `<span class="badge badge-other">${esc(type || '—')}</span>`;
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])
  );
}
