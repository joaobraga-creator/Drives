(function () {
  'use strict';

  // ── Auth guard ────────────────────────────────────────────────────────────────
  const facility   = sessionStorage.getItem('notused_facility')   || '';
  const userEmail  = sessionStorage.getItem('notused_email')      || '';
  const placeName  = sessionStorage.getItem('notused_place_name') || '';

  if (!facility) { window.location.replace('index.html'); return; }

  // ── State ─────────────────────────────────────────────────────────────────────
  let allDrivers   = [];
  let activeFilter = 'todos';
  let modalDriver  = null;
  let html5QrCode  = null;

  // ── Init ──────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    const facilityEl = document.getElementById('header-facility');
    if (facilityEl) facilityEl.textContent = facility;
    const placeNameEl = document.getElementById('header-place-name');
    if (placeNameEl && placeName) placeNameEl.textContent = placeName;
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
    const total    = allDrivers.length;
    const arrived  = allDrivers.filter(function (d) { return d.event_type === 'ARRIVED'; }).length;
    const absent   = allDrivers.filter(function (d) {
      return d.event_type === 'NOT_USED_CORRETO' || d.event_type === 'NOT_USED_INCORRETO';
    }).length;
    const pending  = total - arrived - absent;

    setText('stat-total',     total);
    setText('stat-arrived',   arrived);
    setText('stat-pendentes', pending);
    setText('stat-nao-chegou', absent);
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  // ── Filters ───────────────────────────────────────────────────────────────────
  window.setFilter = function (filter, btn) {
    activeFilter = filter;

    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.stat-pill').forEach(function (p) { p.classList.remove('active'); });

    if (btn) {
      btn.classList.add('active');
      var matchingPill = document.querySelector('.stat-pill[data-filter="' + filter + '"]');
      if (matchingPill) matchingPill.classList.add('active');
    }

    applyFilters();
  };

  window.applyFilters = function () {
    var search = (document.getElementById('search-input').value || '').toLowerCase().trim();
    var list   = allDrivers.slice();

    if (activeFilter === 'pendentes')  list = list.filter(function (d) { return !d.event_type; });
    if (activeFilter === 'arrived')    list = list.filter(function (d) { return d.event_type === 'ARRIVED'; });
    if (activeFilter === 'nao-chegou') list = list.filter(function (d) {
      return d.event_type === 'NOT_USED_CORRETO' || d.event_type === 'NOT_USED_INCORRETO';
    });

    if (search) {
      list = list.filter(function (d) {
        return String(d.driver_id    || '').toLowerCase().includes(search) ||
               String(d.tipo_veiculo || '').toLowerCase().includes(search);
      });
    }

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
      '<div class="card-actions">' + buildActions(d) + '</div>' +
    '</div>';
  }

  function buildActions(d) {
    var idx = d._idx;
    var et  = d.event_type;

    if (!et) {
      return '<button class="btn-arrived" onclick="markArrived(' + idx + ')"><i class="fas fa-check"></i> Chegou</button>' +
             '<button class="btn-not-arrived" onclick="markNotArrived(' + idx + ')"><i class="fas fa-times"></i> Nao chegou</button>';
    }
    if (et === 'ARRIVED') {
      var lateTag = computeIsLate(d, d.clicked_at ? new Date(d.clicked_at) : null)
        ? '<span class="ofensor-tag ofensor-driver"><i class="fas fa-clock"></i> Atrasado</span>' : '';
      return '<div class="event-confirmed">' +
        '<div class="event-label"><span class="badge badge-arrived"><i class="fas fa-check-circle"></i> Chegou</span>' + lateTag + '</div>' +
        '<button class="btn-undo" onclick="undoEvent(' + idx + ')"><i class="fas fa-undo"></i> desfazer</button>' +
      '</div>';
    }
    if (et === 'NOT_USED_CORRETO') {
      return '<div class="event-confirmed">' +
        '<div class="event-label"><span class="badge badge-nuc"><i class="fas fa-times-circle"></i> Nao chegou</span><span class="ofensor-tag ofensor-op"><i class="fas fa-building"></i> Operacao</span></div>' +
        '<button class="btn-undo" onclick="undoEvent(' + idx + ')"><i class="fas fa-undo"></i> desfazer</button>' +
      '</div>';
    }
    if (et === 'NOT_USED_INCORRETO') {
      return '<div class="event-confirmed">' +
        '<div class="event-label"><span class="badge badge-nui"><i class="fas fa-exclamation-triangle"></i> NUI</span><span class="ofensor-tag ofensor-driver"><i class="fas fa-user"></i> Driver</span></div>' +
        '<button class="btn-undo" onclick="undoEvent(' + idx + ')"><i class="fas fa-undo"></i> desfazer</button>' +
      '</div>';
    }
    return '';
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  window.markArrived = async function (idx) {
    var driver   = allDrivers[idx];
    if (!driver) return;
    var late     = computeIsLate(driver, null);
    var offender = late ? 'DRIVER' : null;
    var ok = await postEvent(String(driver.driver_id), 'ARRIVED',
                             driver.horario_chegada, driver.data_eta, offender);
    if (ok) {
      driver.event_type = 'ARRIVED';
      driver.clicked_at = new Date().toISOString();
      refresh();
      if (modalDriver && String(modalDriver.driver_id) === String(driver.driver_id)) {
        showDriverModal(driver);
      }
    }
  };

  window.markNotArrived = async function (idx) {
    var driver    = allDrivers[idx];
    if (!driver) return;
    var eventType = computeNotUsedType(driver);
    if (eventType === 'NOT_USED_INCORRETO') {
      var eta = driver.horario_chegada || driver.eta_planejado_operacao || 'N/A';
      if (!confirm('Atencao: o ETA deste driver e ' + eta + ' e ainda nao chegou.\n\nMarcar agora sera salvo como NUI. Continuar?')) return;
    }
    var offender = eventType === 'NOT_USED_INCORRETO' ? 'DRIVER' : 'OPERATION';
    var ok = await postEvent(String(driver.driver_id), eventType,
                             driver.horario_chegada, driver.data_eta, offender);
    if (ok) {
      driver.event_type = eventType;
      refresh();
      if (modalDriver && String(modalDriver.driver_id) === String(driver.driver_id)) {
        showDriverModal(driver);
      }
    }
  };

  window.undoEvent = async function (idx) {
    var driver = allDrivers[idx];
    if (!driver) return;
    try {
      var res = await fetch('/event', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ facility: facility, driver_id: String(driver.driver_id), email: userEmail })
      });
      if (!res.ok) return;
      driver.event_type = null;
      driver.clicked_at = null;
      refresh();
      if (modalDriver && String(modalDriver.driver_id) === String(driver.driver_id)) {
        closeModal();
      }
    } catch (_) {}
  };

  async function postEvent(driverId, eventType, etaTime, etaDate, offender) {
    try {
      var res = await fetch('/event', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          facility:   facility,
          driver_id:  String(driverId),
          event_type: eventType,
          email:      userEmail,
          eta_time:   etaTime  || null,
          eta_date:   etaDate  || null,
          offender:   offender || null
        })
      });
      return res.ok;
    } catch (_) { return false; }
  }

  function refresh() { updateStats(); applyFilters(); }

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
    ).catch(function (err) {
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

    // Treat QR result as untrusted external input — validate before use
    var raw = String(decodedText || '').trim();
    if (!raw || raw.length > 50) {
      showToast('QR code invalido');
      return;
    }
    // Allow only alphanumeric + underscore/hyphen (typical driver IDs)
    if (!/^[\w\-]+$/.test(raw)) {
      showToast('QR code invalido');
      return;
    }

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
    var idx     = driver._idx;

    var actionsHtml = '';
    if (!et) {
      actionsHtml =
        '<button class="modal-btn-arrived" onclick="markArrived(' + idx + ')"><i class="fas fa-check"></i> Chegou</button>' +
        '<button class="modal-btn-not-arrived" onclick="markNotArrived(' + idx + ')"><i class="fas fa-times"></i> Nao chegou</button>';
    } else if (et === 'ARRIVED') {
      actionsHtml =
        '<div class="modal-confirmed">' +
          '<div class="modal-confirmed-icon">&#x2705;</div>' +
          '<div class="modal-confirmed-text">Chegada confirmada</div>' +
        '</div>' +
        '<button class="modal-btn-undo" onclick="undoEvent(' + idx + ')">Desfazer</button>';
    } else {
      var label = et === 'NOT_USED_INCORRETO' ? '&#x26A0; NUI — Driver' : 'Nao chegou — Operacao';
      actionsHtml =
        '<div class="modal-confirmed">' +
          '<div class="modal-confirmed-icon">&#x274C;</div>' +
          '<div class="modal-confirmed-text">' + label + '</div>' +
        '</div>' +
        '<button class="modal-btn-undo" onclick="undoEvent(' + idx + ')">Desfazer</button>';
    }

    content.innerHTML =
      '<div class="modal-driver-id">' + id + '</div>' +
      '<div class="modal-vehicle">' + vehicleToBadge(driver.tipo_veiculo) + ' ' + vehicle + '</div>' +
      '<div class="modal-eta-block">' +
        '<div class="modal-eta-label">ETA previsto</div>' +
        '<div class="modal-eta-time">' + escHtml(etaTime) + '</div>' +
      '</div>' +
      '<div class="modal-actions">' + actionsHtml + '</div>';

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

  function computeNotUsedType(driver) {
    var etaDate = driver.data_eta;
    var etaTime = driver.horario_chegada || driver.eta_planejado_operacao;
    if (!etaDate || !etaTime) return 'NOT_USED_CORRETO';
    try {
      var eta = new Date(etaDate + 'T' + etaTime);
      if (isNaN(eta.getTime())) return 'NOT_USED_CORRETO';
      return new Date() < eta ? 'NOT_USED_INCORRETO' : 'NOT_USED_CORRETO';
    } catch (_) { return 'NOT_USED_CORRETO'; }
  }

  function computeDelta(driver, now) {
    var etaDate = driver.data_eta;
    var etaTime = driver.horario_chegada || driver.eta_planejado_operacao;
    if (!etaDate || !etaTime || driver.event_type) return '';
    try {
      var eta      = new Date(etaDate + 'T' + etaTime);
      if (isNaN(eta.getTime())) return '';
      var diffMin  = Math.round((eta.getTime() - now.getTime()) / 60000);
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
    if (!et)                      return '<span class="badge badge-pending">Pendente</span>';
    if (et === 'ARRIVED')         return '<span class="badge badge-arrived">&#x2713; Chegou</span>';
    if (et === 'NOT_USED_CORRETO')   return '<span class="badge badge-nuc">Ausente</span>';
    if (et === 'NOT_USED_INCORRETO') return '<span class="badge badge-nui">&#x26A0; NUI</span>';
    return '';
  }

  function renderSkeleton(container) {
    container.innerHTML = [1,2,3,4,5].map(function () {
      return '<div class="skeleton-card">' +
        '<div class="skeleton-bar" style="width:55%;margin-bottom:14px"></div>' +
        '<div class="skeleton-bar" style="width:80%;height:48px;border-radius:10px;margin-bottom:14px"></div>' +
        '<div style="display:flex;gap:8px">' +
          '<div class="skeleton-bar" style="flex:1;height:48px;border-radius:10px;margin:0"></div>' +
          '<div class="skeleton-bar" style="flex:1;height:48px;border-radius:10px;margin:0"></div>' +
        '</div></div>';
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
