(function () {
  'use strict';

  // ── Auth guard ────────────────────────────────────────────────────────────────
  const facility   = sessionStorage.getItem('notused_facility')   || '';
  const placeName  = sessionStorage.getItem('notused_place_name') || '';

  if (!facility) { window.location.replace('index.html'); return; }

  // ── State ─────────────────────────────────────────────────────────────────────
  let allDrivers  = [];
  let modalDriver = null;
  let html5QrCode  = null;

  // ── Init ──────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    const facilityEl = document.getElementById('header-facility');
    if (facilityEl) facilityEl.textContent = facility;
    const placeNameEl = document.getElementById('header-place-name');
    if (placeNameEl && placeName) placeNameEl.textContent = placeName;
    const dateEl = document.getElementById('count-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    loadDrivers();
  });

  // ── Logout ────────────────────────────────────────────────────────────────────
  window.logout = function () {
    sessionStorage.clear();
    window.location.replace('index.html');
  };

  // ── Load drivers ──────────────────────────────────────────────────────────────
  window.loadDrivers = async function () {
    const container = document.getElementById('cards-container');
    const btnR      = document.getElementById('btn-refresh');
    const icon      = document.getElementById('refresh-icon');

    btnR.classList.add('spinning');
    icon.textContent = '↺';
    renderSkeleton(container);

    try {
      const res  = await fetch('/drivers/' + encodeURIComponent(facility));
      const data = await res.json();

      if (!res.ok) { renderError(container, data.detail || 'Erro ao carregar.'); return; }

      allDrivers = (data.drivers || []).map(function (d, i) { return Object.assign({}, d, { _idx: i }); });
      updateStats();
      applyFilters();

    } catch (_) {
      renderError(container, 'Erro de conexao. Backend offline?');
    } finally {
      btnR.classList.remove('spinning');
    }
  };

  // ── Stats ─────────────────────────────────────────────────────────────────────
  function updateStats() {
    var el = document.getElementById('stat-total');
    if (el) el.textContent = String(allDrivers.length);
  }

  // ── Search ────────────────────────────────────────────────────────────────────
  window.applyFilters = function () {
    var search = (document.getElementById('search-input').value || '').toLowerCase().trim();
    var list   = search
      ? allDrivers.filter(function (d) {
          return String(d.driver_id    || '').toLowerCase().includes(search) ||
                 String(d.tipo_veiculo || '').toLowerCase().includes(search);
        })
      : allDrivers.slice();
    renderCards(document.getElementById('cards-container'), list);
  };

  // ── Render cards ──────────────────────────────────────────────────────────────
  function renderCards(container, drivers) {
    if (!drivers.length) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">&#x25CB;</div><p>Nenhum motorista encontrado</p></div>';
      return;
    }
    container.innerHTML = drivers.map(buildCard).join('');
  }

  function buildCard(d) {
    var et       = d.event_type;
    var driverId = escHtml(String(d.driver_id || ''));
    var etaTime  = formatTime(d.horario_chegada || d.eta_planejado_operacao);
    var now      = new Date();
    var isPast   = computeIsLate(d, now);
    var deltaStr = computeDelta(d, now);

    var cardClass = et === 'ARRIVED'            ? 'driver-card arrived'
                  : et === 'NOT_USED_INCORRETO' ? 'driver-card nui'
                  : et === 'NOT_USED_CORRETO'   ? 'driver-card not-used'
                  : 'driver-card';

    var etaTimeClass = et ? '' : (isPast ? 'eta-time past' : 'eta-time');
    var deltaHtml    = (!et && deltaStr)
      ? '<span class="eta-delta ' + (isPast ? 'past' : 'early') + '">' + escHtml(deltaStr) + '</span>'
      : '';

    var svcHtml = d.svc
      ? '<span class="meta-chip">' + escHtml(String(d.svc)) + '</span>'
      : '';
    var regionalHtml = d.regional
      ? '<span class="meta-chip">' + escHtml(String(d.regional)) + '</span>'
      : '';

    return '<div class="' + cardClass + '" id="card-' + driverId + '">' +
      '<div class="card-top">' +
        '<div>' +
          '<div class="card-id">' + driverId + '</div>' +
          '<div class="card-secondary">' + vehicleToBadge(d.tipo_veiculo) + '</div>' +
        '</div>' +
        '<div>' + statusBadge(et) + '</div>' +
      '</div>' +
      '<div class="card-eta">' +
        '<span class="eta-icon">&#x23F0;</span>' +
        '<div>' +
          '<div class="eta-label">ETA previsto</div>' +
          '<div class="' + etaTimeClass + '">' + escHtml(etaTime) + '</div>' +
        '</div>' +
        deltaHtml +
      '</div>' +
      (svcHtml || regionalHtml
        ? '<div class="card-meta">' + svcHtml + regionalHtml + '</div>'
        : '') +
    '</div>';
  }

  // ── QR Code ───────────────────────────────────────────────────────────────────
  window.openQR = function () {
    var overlay = document.getElementById('qr-overlay');
    overlay.classList.add('open');

    if (typeof Html5Qrcode === 'undefined') {
      showToast('Biblioteca de QR nao carregada.');
      closeQR();
      return;
    }

    html5QrCode = new Html5Qrcode('qr-reader');
    html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
      onQRScan,
      function (_err) {}
    ).catch(function () {
      showToast('Camera nao disponivel');
      closeQR();
    });
  };

  window.closeQR = function () {
    var overlay = document.getElementById('qr-overlay');
    overlay.classList.remove('open');
    if (html5QrCode) {
      html5QrCode.stop().catch(function () {});
      html5QrCode = null;
    }
  };

  function onQRScan(decodedText) {
    closeQR();

    var raw = String(decodedText || '').trim();
    if (!raw || raw.length > 50) { showToast('QR code invalido'); return; }
    if (!/^[\w\-]+$/.test(raw))  { showToast('QR code invalido'); return; }

    var driver = allDrivers.find(function (d) { return String(d.driver_id) === raw; });
    if (driver) {
      showDriverModal(driver);
    } else {
      showToast('Driver nao encontrado: ' + escHtml(raw));
    }
  }

  // ── Driver modal ──────────────────────────────────────────────────────────────
  function showDriverModal(driver) {
    modalDriver = driver;
    var modal   = document.getElementById('driver-modal');
    var content = document.getElementById('modal-content');

    var et      = driver.event_type;
    var etaTime = formatTime(driver.horario_chegada || driver.eta_planejado_operacao);
    var id      = escHtml(String(driver.driver_id || ''));
    var vehicle = escHtml(String(driver.tipo_veiculo || '—'));
    var svc     = driver.svc     ? '<span class="meta-chip">' + escHtml(String(driver.svc))     + '</span>' : '';
    var regional = driver.regional ? '<span class="meta-chip">' + escHtml(String(driver.regional)) + '</span>' : '';

    content.innerHTML =
      '<div class="modal-driver-id">' + id + '</div>' +
      '<div class="modal-vehicle">' + vehicleToBadge(driver.tipo_veiculo) + ' ' + vehicle + '</div>' +
      '<div class="modal-eta-block">' +
        '<div class="modal-eta-label">ETA previsto</div>' +
        '<div class="modal-eta-time">' + escHtml(etaTime) + '</div>' +
      '</div>' +
      (svc || regional ? '<div class="modal-meta">' + svc + regional + '</div>' : '') +
      '<div class="modal-status-block">' + statusBadge(et) + '</div>';

    modal.classList.add('open');
  }

  window.closeModal = function () {
    document.getElementById('driver-modal').classList.remove('open');
    modalDriver = null;
  };

  // ── ETA helpers ───────────────────────────────────────────────────────────────
  function computeIsLate(driver, atTime) {
    var etaDate = driver.data_eta;
    var etaTime = driver.horario_chegada || driver.eta_planejado_operacao;
    if (!etaDate || !etaTime) return false;
    try {
      var eta = new Date(etaDate + 'T' + etaTime);
      var t   = atTime || new Date();
      return !isNaN(eta.getTime()) && t > eta;
    } catch (_) { return false; }
  }

  function computeDelta(driver, now) {
    var etaDate = driver.data_eta;
    var etaTime = driver.horario_chegada || driver.eta_planejado_operacao;
    if (!etaDate || !etaTime || driver.event_type) return '';
    try {
      var eta     = new Date(etaDate + 'T' + etaTime);
      if (isNaN(eta.getTime())) return '';
      var diffMin = Math.round((eta.getTime() - now.getTime()) / 60000);
      if (diffMin > 0)  return '+' + diffMin + 'min';
      if (diffMin < 0)  return diffMin + 'min';
      return 'agora';
    } catch (_) { return ''; }
  }

  function formatTime(raw) {
    if (!raw) return '—';
    var parts = String(raw).split(':');
    if (parts.length >= 2) return parts[0] + ':' + parts[1];
    return String(raw);
  }

  // ── Toast ─────────────────────────────────────────────────────────────────────
  var _toastTimer = null;
  function showToast(msg) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  // ── Render helpers ────────────────────────────────────────────────────────────
  function vehicleToBadge(desc) {
    var s = String(desc || '').toLowerCase();
    if (s.includes('moto'))                                    return '<span class="badge badge-moto">&#x1F3CD; Moto</span>';
    if (s.includes('carro') || s.includes('passeio') || s.includes('car')) return '<span class="badge badge-carro">&#x1F697; Carro</span>';
    if (s.includes('walker') || s.includes('pedestre'))        return '<span class="badge badge-walker">&#x1F6B6; Walker</span>';
    if (desc) return '<span class="badge badge-other">' + escHtml(String(desc)) + '</span>';
    return '';
  }

  function statusBadge(et) {
    if (!et)                          return '<span class="badge badge-pending">Pendente</span>';
    if (et === 'ARRIVED')             return '<span class="badge badge-arrived">&#x2713; Chegou</span>';
    if (et === 'NOT_USED_CORRETO')    return '<span class="badge badge-nuc">Ausente</span>';
    if (et === 'NOT_USED_INCORRETO')  return '<span class="badge badge-nui">&#x26A0; NUI</span>';
    return '';
  }

  function renderSkeleton(container) {
    container.innerHTML = [1,2,3,4,5].map(function () {
      return '<div class="skeleton-card">' +
        '<div class="skeleton-bar" style="width:55%;margin-bottom:14px"></div>' +
        '<div class="skeleton-bar" style="width:80%;height:48px;border-radius:10px;margin-bottom:14px"></div>' +
        '<div class="skeleton-bar" style="width:60%;height:24px;border-radius:8px;margin:0"></div>' +
        '</div>';
    }).join('');
  }

  function renderError(container, msg) {
    container.innerHTML = '<div class="empty-state"><div class="icon">&#x26A0;</div><p>' + escHtml(msg) + '</p></div>';
  }

  function escHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' })[c];
    });
  }

})();
