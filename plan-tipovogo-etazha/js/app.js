/* ============================================================================
 *  app.js — логика презентации: просмотрщик, слои, таблицы, диаграммы, экспорт
 * ==========================================================================*/
(function () {
  'use strict';

  var G = global.GEO, PLAN = global.PLAN, ISO = global.ISO, CH = global.CHARTS;
  var APT_COLOR = PLAN.APT_COLOR;

  var ORIGINAL = JSON.parse(JSON.stringify(global.FLOOR_DATA));

  var state = {
    data: null,
    stats: null,
    mode: 'plan',            // plan | iso
    scope: 'full',           // full | core | a1…a4
    focus: null,             // id квартиры для подсветки
    layers: null,
    selected: null,
    vb: null,                // текущий viewBox плана
    mono: false,
    hatch: false,
    explFilter: 'all',
    explQuery: ''
  };

  var LAYER_UI = [
    { k: 'paper',    n: 'Лист и рамка' },
    { k: 'grid',     n: 'Метрическая сетка' },
    { k: 'axes',     n: 'Разбивочные оси' },
    { k: 'dims',     n: 'Размерные линии' },
    { k: 'fills',    n: 'Цветовые зоны' },
    { k: 'walls',    n: 'Стены' },
    { k: 'openings', n: 'Двери и окна' },
    { k: 'stairs',   n: 'Лестницы' },
    { k: 'lifts',    n: 'Лифты' },
    { k: 'furn',     n: 'Мебель и сантехника' },
    { k: 'risers',   n: 'Инженерные стояки' },
    { k: 'labels',   n: 'Названия и площади' },
    { k: 'numbers',  n: 'Номера помещений' },
    { k: 'aptmarks', n: 'Границы квартир' },
    { k: 'annot',    n: 'Север, масштаб, отметки' },
    { k: 'notes',    n: 'Примечания' },
    { k: 'stamp',    n: 'Штамп листа' }
  ];

  var DRAWING_LAYERS = ['paper', 'axes', 'dims', 'fills', 'walls', 'openings', 'stairs', 'lifts',
                        'labels', 'numbers', 'annot', 'notes', 'stamp'];

  /* ── утилиты DOM ─────────────────────────────────────────────────────── */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ── нормализация данных (защита от неполного JSON пользователя) ─────── */
  function normalize(d) {
    d = d || {};
    d.meta = d.meta || ORIGINAL.meta;
    d.building = d.building || ORIGINAL.building;
    d.wall = Object.assign({ facade: 0.4, party: 0.4, partition: 0.2 }, d.wall || {});
    d.zones = Object.assign({}, ORIGINAL.zones, d.zones || {});
    d.rooms = d.rooms || [];
    d.balconies = d.balconies || [];
    d.openings = d.openings || [];
    d.stairs = d.stairs || [];
    d.lifts = d.lifts || [];
    d.risers = d.risers || [];
    d.furniture = d.furniture || [];
    d.notes = d.notes || [];
    d.facades = d.facades || ORIGINAL.facades;
    d.apartments = d.apartments || [];
    if (!d.rooms.length) throw new Error('пустой массив rooms');

    /* габариты этажа — из контура или по крайним помещениям */
    var bb = null;
    d.rooms.concat(d.balconies).forEach(function (r) {
      var p = G.poly(r), b = G.bbox(p);
      bb = bb ? { x: Math.min(bb.x, b.x), y: Math.min(bb.y, b.y), x2: Math.max(bb.x2, b.x2), y2: Math.max(bb.y2, b.y2) }
              : { x: b.x, y: b.y, x2: b.x2, y2: b.y2 };
    });
    var W = d.size && d.size.W ? d.size.W : Math.ceil(bb.x2 + d.wall.facade);
    var D = d.size && d.size.D ? d.size.D : Math.ceil(bb.y2 + d.wall.facade);
    d.size = { W: W, D: D };
    d.outline = [[0, 0], [W, 0], [W, D], [0, D]];

    if (!d.axes || !d.axes.x || !d.axes.y) d.axes = ORIGINAL.axes;
    d.dims = d.dims || {
      xOverall: { y: -2.4, from: 0, to: W }, xAxis: { y: -4.2 },
      yOverall: { x: -2.4, from: 0, to: D }, yAxis: { x: -4.2 }
    };
    /* квартиры, которых нет в данных — создаём по списку помещений */
    var seen = {};
    d.rooms.forEach(function (r) { if (r.apt && r.apt !== 'core') seen[r.apt] = 1; });
    var known = {};
    d.apartments.forEach(function (a) { known[a.id] = 1; });
    Object.keys(seen).forEach(function (id) {
      if (!known[id]) d.apartments.push({ id: id, no: d.apartments.length + 1, title: 'Квартира ' + id, kind: '' });
    });
    d.rooms.forEach(function (r) { if (!r.zone) r.zone = 'living'; });
    return d;
  }

  /* ══════════════════════════ ПЕРВЫЙ ЭКРАН ══════════════════════════════ */
  function renderHero() {
    var d = state.data, st = state.stats;
    var aptTotal = d.apartments.reduce(function (s, a) { return s + (st.byApt[a.id] ? st.byApt[a.id].totalAdj : 0); }, 0);
    var gross = d.size.W * d.size.D;
    var roomsCount = d.apartments.reduce(function (s, a) { return s + (st.byApt[a.id] ? st.byApt[a.id].roomsCount : 0); }, 0);

    $('#tbProject').textContent = d.meta.project;
    $('#tbSheet').textContent = d.meta.sheet + ' · ' + d.meta.drawing + ' · ' + d.meta.scale;
    $('#footProject').textContent = d.meta.project + ' · ' + d.meta.object;
    $('#footSheet').textContent = d.meta.sheet + ' · ' + d.meta.stage + ' · ' + d.meta.date;
    document.title = d.meta.drawing + ' · ' + d.meta.project;

    $('#heroFacts').innerHTML = [
      ['Площадь этажа', G.n(gross), 'м² в габаритах стен'],
      ['Квартир на этаже', d.apartments.length, roomsCount + ' комнат суммарно'],
      ['Площадь квартир', G.n(aptTotal), 'м² с летними помещениями'],
      ['Этажность', d.building.floorsAbove, 'высота этажа ' + G.n(d.building.floorHeight, 2) + ' м'],
      ['Эффективность', Math.round(aptTotal / gross * 100) + ' %', 'квартиры / площадь этажа']
    ].map(function (f) {
      return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + ' <small>' + f[2] + '</small></dd></div>';
    }).join('');

    $('#massing').innerHTML = ISO.massing(d, { highlight: 6 });
  }

  /* ══════════════════════════ ПРОСМОТРЩИК ══════════════════════════════ */
  function aptBox(id) {
    var d = state.data, bb = null;
    d.rooms.concat(d.balconies).forEach(function (r) {
      if (r.apt !== id) return;
      var b = G.bbox(G.poly(r));
      bb = bb ? { x: Math.min(bb.x, b.x), y: Math.min(bb.y, b.y), x2: Math.max(bb.x2, b.x2), y2: Math.max(bb.y2, b.y2) }
              : { x: b.x, y: b.y, x2: b.x2, y2: b.y2 };
    });
    if (!bb) return null;
    return { x: bb.x, y: bb.y, w: bb.x2 - bb.x, h: bb.y2 - bb.y };
  }

  function scopeBox() {
    var d = state.data;
    if (state.scope === 'core') return { x: 7.0, y: -3.4, w: 10.6, h: 22.0 };
    if (state.scope !== 'full') {
      var b = aptBox(state.scope);
      if (b) { var p = 2.0; return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 }; }
    }
    return { x: -8.2, y: -6.4, w: d.size.W + 14.2, h: d.size.D + 18.6 };
  }

  function draw() {
    var wrap = $('#planCanvas');
    var out;
    if (state.mode === 'iso') {
      out = ISO.build(state.data, { stats: state.stats });
      state.vb = out.viewBox;
    } else {
      if (!state.vb) state.vb = scopeBox();
      out = PLAN.build(state.data, { viewBox: state.vb, stats: state.stats });
    }
    wrap.innerHTML = out.svg;
    var svg = wrap.firstElementChild;
    if (state.focus) svg.setAttribute('data-focus', state.focus);
    if (state.mono) svg.classList.add('mono');
    if (state.hatch) svg.classList.add('hatch');
    applyLayers(svg);
    bindCanvas(svg);
    updateHud(svg);
  }

  function applyLayers(svg) {
    svg = svg || $('#planCanvas svg');
    if (!svg) return;
    $$('[data-layer]', svg).forEach(function (g) {
      var k = g.getAttribute('data-layer');
      if (k === 'hit') return;
      var on = state.layers[k] !== 0;
      g.classList.toggle('off', !on);
    });
  }

  function updateHud(svg) {
    var d = state.data;
    if (!d) return;
    $('#hudMode').textContent = state.mode === 'iso'
      ? 'Аксонометрия · h = ' + G.n(d.building.clearHeight, 2) + ' м'
      : 'План · ' + (d.meta.scale || '') + ' · ' + d.meta.sheet;
    if (svg && state.vb) {
      var r = svg.getBoundingClientRect();
      var pxPerM = r.width / state.vb.w;
      var denom = Math.round(1000 * 96 / (25.4 * pxPerM));
      $('#hudScale').textContent = '1 м ≈ ' + Math.round(pxPerM) + ' px · экран 1:' +
        (denom < 10 ? denom.toFixed(0) : Math.round(denom / 5) * 5);
    }
  }

  function setVB(svg, vb) {
    state.vb = vb;
    svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    updateHud(svg);
  }

  function toSvg(svg, cx, cy) {
    var r = svg.getBoundingClientRect(), vb = state.vb;
    var s = Math.min(r.width / vb.w, r.height / vb.h);
    var ox = (r.width - vb.w * s) / 2, oy = (r.height - vb.h * s) / 2;
    return [(cx - r.left - ox) / s, (cy - r.top - oy) / s, s];
  }

  function zoom(svg, f, cx, cy) {
    var vb = state.vb;
    var r = svg.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    var p = toSvg(svg, cx, cy);
    var nx = vb.x + p[0], ny = vb.y + p[1];
    var nw = Math.max(3.5, Math.min(140, vb.w * f));
    f = nw / vb.w;
    setVB(svg, { x: nx - p[0] * f, y: ny - p[1] * f, w: vb.w * f, h: vb.h * f });
  }

  function bindCanvas(svg) {
    var dragging = false, lx = 0, ly = 0;

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoom(svg, e.deltaY > 0 ? 1.12 : 0.89, e.clientX, e.clientY);
    }, { passive: false });

    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      dragging = true; lx = e.clientX; ly = e.clientY;
      svg.classList.add('dragging');
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var p = toSvg(svg, e.clientX, e.clientY);
      var vb = state.vb;
      setVB(svg, { x: vb.x - (e.clientX - lx) / p[2], y: vb.y - (e.clientY - ly) / p[2], w: vb.w, h: vb.h });
      lx = e.clientX; ly = e.clientY;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      svg.addEventListener(ev, function () { dragging = false; svg.classList.remove('dragging'); });
    });

    /* наведение и выбор помещений */
    svg.addEventListener('pointerover', function (e) {
      var el = e.target.closest ? e.target.closest('.hit-room') : null;
      if (!el) return;
      hoverRoom(el.getAttribute('data-id'), e);
    });
    svg.addEventListener('pointermove', function (e) {
      if (tipVisible) positionTip(e);
    });
    svg.addEventListener('pointerout', function (e) {
      var el = e.target.closest ? e.target.closest('.hit-room') : null;
      if (!el) return;
      hoverRoom(null);
    });
    svg.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.hit-room') : null;
      var tag = e.target.closest ? e.target.closest('.apt-tag') : null;
      if (tag) { setScope(tag.getAttribute('data-apt')); return; }
      if (el) { selectRoom(el.getAttribute('data-id'), true); return; }
      selectRoom(null);
    });
  }

  /* ── тултип ─────────────────────────────────────────────────────────── */
  var tipVisible = false;
  function hoverRoom(id, e) {
    var svg = $('#planCanvas svg');
    $$('.room-fill.hl', svg).forEach(function (n) { n.classList.remove('hl'); });
    $$('#explBody tr.hl').forEach(function (n) { n.classList.remove('hl'); });
    var tip = $('#tooltip');
    if (!id) { tipVisible = false; tip.style.opacity = 0; return; }
    var fill = $('.room-fill[data-id="' + id + '"]', svg);
    if (fill) fill.classList.add('hl');
    var row = $('#explBody tr[data-id="' + id + '"]');
    if (row) row.classList.add('hl');
    var r = state.stats.roomsMap[id];
    if (r) {
      var ap = aptTitle(r.apt);
      tip.innerHTML = '<b>' + esc(r.name) + '</b> · ' + G.n(G.area(G.poly(r))) + ' м²' +
        '<div class="t-sub">' + esc(ap) + ' · ' + esc((state.data.zones[r.zone] || {}).name || r.zone) + '</div>';
      tipVisible = true; tip.style.opacity = 1;
      if (e) positionTip(e);
    }
  }
  function positionTip(e) {
    var wrap = $('#canvasWrap'), r = wrap.getBoundingClientRect();
    var tip = $('#tooltip');
    tip.style.left = (e.clientX - r.left) + 'px';
    tip.style.top = (e.clientY - r.top) + 'px';
  }

  function aptTitle(id) {
    if (id === 'core') return 'Общие помещения';
    var a = state.data.apartments.filter(function (x) { return x.id === id; })[0];
    return a ? a.title + (a.kind ? ' · ' + a.kind : '') : id;
  }

  /* ── выбор помещения и карточка ─────────────────────────────────────── */
  function selectRoom(id, scroll) {
    state.selected = id;
    var svg = $('#planCanvas svg');
    $$('.room-fill.sel', svg).forEach(function (n) { n.classList.remove('sel'); });
    $$('#explBody tr.sel').forEach(function (n) { n.classList.remove('sel'); });
    if (id) {
      var f = $('.room-fill[data-id="' + id + '"]', svg);
      if (f) f.classList.add('sel');
      var row = $('#explBody tr[data-id="' + id + '"]');
      if (row) { row.classList.add('sel'); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
    }
    renderRoomCard(id);
  }

  function renderRoomCard(id) {
    var box = $('#roomCard');
    if (!id) {
      box.innerHTML = '<h3>Помещение</h3><div class="empty">Наведите или кликните помещение на чертеже</div>';
      return;
    }
    var r = state.stats.roomsMap[id];
    if (!r) return;
    var p = G.poly(r), b = G.bbox(p), a = G.area(p);
    var z = state.data.zones[r.zone] || { name: r.zone, color: '#888' };

    var wins = state.data.openings.filter(function (o) {
      if (o.kind !== 'window') return false;
      /* окно принадлежит помещению, если его середина в пределах 0,6 м от полигона */
      var m = [(o.seg[0][0] + o.seg[1][0]) / 2, (o.seg[0][1] + o.seg[1][1]) / 2];
      return G.distToPoly(m, p) < 0.75;
    });
    var doors = state.data.openings.filter(function (o) {
      return (o.kind === 'door' || o.kind === 'opening') && (o.into === id ||
        G.distToPoly([(o.seg[0][0] + o.seg[1][0]) / 2, (o.seg[0][1] + o.seg[1][1]) / 2], p) < 0.35);
    });
    var winWidth = wins.reduce(function (s, o) { return s + G.segLen(o.seg); }, 0);
    var light = b.w * 0 + winWidth ? (winWidth / Math.sqrt(a)).toFixed(2).replace('.', ',') : '—';

    box.innerHTML =
      '<h3>Помещение</h3>' +
      '<div class="rc-head"><b>' + esc(r.name) + '</b><span>' + G.n(a) + ' м²</span></div>' +
      '<div class="chips" style="margin-bottom:10px">' +
        '<span class="rc-chip" style="background:' + z.color + '22;color:' + z.color + '">' + esc(z.name) + '</span>' +
        '<span class="rc-chip" style="background:var(--panel-2);color:var(--txt-2)">' + esc(aptTitle(r.apt)) + '</span>' +
      '</div>' +
      '<dl class="rc-rows">' +
        '<div><dt>Габариты</dt><dd>' + G.n(b.w, 2) + ' × ' + G.n(b.h, 2) + ' м</dd></div>' +
        '<div><dt>Периметр</dt><dd>' + G.n(perimeter(p), 2) + ' м</dd></div>' +
        '<div><dt>Окон</dt><dd>' + wins.length + ' шт · ' + G.n(winWidth, 2) + ' м</dd></div>' +
        '<div><dt>Дверей/проёмов</dt><dd>' + doors.length + '</dd></div>' +
        '<div><dt>Световой коэфф.</dt><dd>' + light + ' (≥ 0,28 для жилых)</dd></div>' +
        '<div><dt>Высота</dt><dd>' + G.n(state.data.building.clearHeight, 2) + ' м</dd></div>' +
        (r.finish ? '<div><dt>Отделка</dt><dd>' + esc(r.finish) + '</dd></div>' : '') +
        (r.note ? '<div><dt>Примечание</dt><dd>' + esc(r.note) + '</dd></div>' : '') +
      '</dl>' +
      '<div class="row-btns">' +
        (r.apt && r.apt !== 'core' ? '<button class="btn tiny" data-act="focus" data-apt="' + r.apt + '">Показать квартиру</button>' : '') +
        '<button class="btn tiny ghost" data-act="zoom">Приблизить</button>' +
      '</div>';

    $$('[data-act]', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-act') === 'focus') setScope(btn.getAttribute('data-apt'));
        else {
          var svg = $('#planCanvas svg');
          var pad = 2.2;
          setVB(svg, { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
        }
      });
    });
  }

  function perimeter(p) {
    var s = 0;
    for (var i = 0; i < p.length; i++) {
      var a = p[i], b = p[(i + 1) % p.length];
      s += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return s;
  }

  /* ── панель слоёв и легенда ─────────────────────────────────────────── */
  function renderLayers() {
    var box = $('#layerList');
    box.innerHTML = LAYER_UI.map(function (l) {
      return '<label><input type="checkbox" data-l="' + l.k + '"' + (state.layers[l.k] ? ' checked' : '') + '> ' + l.n + '</label>';
    }).join('');
    $$('input', box).forEach(function (i) {
      i.addEventListener('change', function () {
        state.layers[i.getAttribute('data-l')] = i.checked ? 1 : 0;
        applyLayers();
      });
    });
  }

  function renderLegend() {
    var zsum = {};
    state.data.rooms.forEach(function (r) { zsum[r.zone] = (zsum[r.zone] || 0) + G.area(G.poly(r)); });
    $('#legend').innerHTML = Object.keys(state.data.zones).filter(function (k) { return zsum[k]; }).map(function (k) {
      var z = state.data.zones[k];
      return '<li data-zone="' + k + '"><i style="background:' + z.fill + ';border-color:' + z.color + '"></i>' +
             esc(z.name) + '<b>' + G.n(zsum[k]) + '</b></li>';
    }).join('');
    $$('#legend li').forEach(function (li) {
      li.addEventListener('click', function () {
        var z = li.getAttribute('data-zone');
        var svg = $('#planCanvas svg');
        var on = svg.getAttribute('data-zonefilter') === z;
        svg.setAttribute('data-zonefilter', on ? '' : z);
        $$('.room-fill', svg).forEach(function (f) {
          f.style.opacity = (!on && f.getAttribute('data-zone') !== z) ? 0.12 : '';
        });
      });
    });
  }

  /* ── экспликация ─────────────────────────────────────────────────────── */
  function renderTable() {
    var d = state.data, st = state.stats;
    var groups = d.apartments.map(function (a) { return a.id; }).concat(['core']);
    var idx = 0, rows = [], totals = { all: 0, living: 0 };

    groups.forEach(function (gid) {
      var rooms = d.rooms.filter(function (r) { return r.apt === gid; });
      if (!rooms.length) return;
      if (state.explFilter !== 'all' && state.explFilter !== gid) return;
      var q = state.explQuery.trim().toLowerCase();
      if (q) rooms = rooms.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0; });
      if (!rooms.length) return;

      var sub = 0, subL = 0;
      rooms.forEach(function (r) {
        var a = G.area(G.poly(r));
        var isLiv = r.zone === 'living';
        sub += a; if (isLiv) subL += a;
        idx++;
        rows.push('<tr data-id="' + r.id + '" data-apt="' + gid + '">' +
          '<td class="num">' + idx + '</td>' +
          '<td><span class="swatch" style="background:' + (d.zones[r.zone] || {}).fill + '"></span>' + esc(r.name) +
            (r.note ? ' <span class="dim">· ' + esc(r.note) + '</span>' : '') + '</td>' +
          '<td class="dim">' + esc(gid === 'core' ? 'Общее имущество' : 'Кв. ' + aptNo(gid)) + '</td>' +
          '<td class="r">' + G.n(a) + '</td>' +
          '<td class="r">' + (isLiv ? G.n(a) : '—') + '</td>' +
          '<td class="dim">' + esc(r.finish || '—') + '</td></tr>');
      });
      totals.all += sub; totals.living += subL;
      rows.push('<tr class="grp"><td colspan="3">' + esc(gid === 'core' ? 'Итого по общим помещениям' : 'Итого по квартире № ' + aptNo(gid)) +
        '</td><td class="r">' + G.n(sub) + '</td><td class="r">' + G.n(subL) + '</td><td></td></tr>');
    });

    /* летние помещения */
    var outSum = 0, outAdj = 0;
    d.balconies.forEach(function (b) {
      var a = G.area(G.poly(b));
      outSum += a; outAdj += a * (b.coeff || 0.3);
    });

    $('#explBody').innerHTML = rows.join('') || '<tr><td colspan="6" class="dim" style="padding:20px">Ничего не найдено</td></tr>';
    $('#explFoot').innerHTML =
      '<tr><td colspan="3">Суммарная площадь помещений этажа</td><td class="r">' + G.n(totals.all) + '</td>' +
      '<td class="r">' + G.n(totals.living) + '</td><td class="dim">жилая — ' + G.n(totals.living) + ' м²</td></tr>' +
      '<tr><td colspan="3">Летние помещения (лоджии, балконы)</td><td class="r">' + G.n(outSum) + '</td><td class="r">—</td>' +
      '<td class="dim">с коэффициентами — ' + G.n(outAdj) + ' м²</td></tr>';

    $$('#explBody tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () { selectRoom(tr.getAttribute('data-id'), false); });
      tr.addEventListener('pointerenter', function () { hoverRoom(tr.getAttribute('data-id')); });
      tr.addEventListener('pointerleave', function () { hoverRoom(null); });
    });
  }
  function aptNo(id) {
    var a = state.data.apartments.filter(function (x) { return x.id === id; })[0];
    return a ? a.no : id;
  }

  /* ── квартирография ─────────────────────────────────────────────────── */
  function renderApts() {
    var d = state.data, st = state.stats;
    $('#aptCards').innerHTML = d.apartments.map(function (ap) {
      var a = st.byApt[ap.id];
      if (!a) return '';
      var col = APT_COLOR[ap.id] || '#778';
      var box = aptBox(ap.id), pad = 1.4;
      var vb = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
      var out = PLAN.build(d, { viewBox: vb, stats: st });
      var tmp = document.createElement('div'); tmp.innerHTML = out.svg;
      var svg = tmp.firstElementChild;
      ['paper', 'grid', 'axes', 'dims', 'annot', 'notes', 'stamp', 'numbers', 'aptmarks'].forEach(function (l) {
        var g = svg.querySelector('[data-layer="' + l + '"]'); if (g) g.classList.add('off');
      });
      svg.setAttribute('data-focus', ap.id);

      var winTxt = ['N', 'E', 'S', 'W'].filter(function (k) { return a.windows[k]; }).map(function (k) {
        var names = { N: 'С', E: 'В', S: 'Ю', W: 'З' };
        return '<i>' + names[k] + '</i> ' + G.n(a.windows[k], 2) + ' м окон';
      }).join(' · ') || '—';

      var roomsChips = a.rooms.filter(function (r) { return !r.outdoor; }).map(function (r) {
        return '<span class="chip">' + esc(r.name) + ' <b>' + G.n(r.area) + '</b></span>';
      }).join('');
      var outChips = a.rooms.filter(function (r) { return r.outdoor; }).map(function (r) {
        return '<span class="chip">' + esc(r.name) + ' <b>' + G.n(r.area) + '</b> ×' + r.coeff + '</span>';
      }).join('');

      return '<article class="apt-card no-print" data-apt="' + ap.id + '">' +
        '<div class="ac-top">' +
          '<span class="ac-badge" style="background:' + col + '">' + ap.no + '</span>' +
          '<span class="ac-title"><b>' + esc(ap.title) + '</b><span>' + esc(ap.kind) + '</span></span>' +
          '<span class="ac-area"><b>' + G.n(a.totalAdj) + '</b><span>м² с летними</span></span>' +
        '</div>' +
        '<div class="ac-plan">' + svg.outerHTML + '</div>' +
        '<div class="ac-body">' +
          '<dl class="ac-stats">' +
            '<div><dt>Без летних</dt><dd>' + G.n(a.total) + '</dd></div>' +
            '<div><dt>Жилая</dt><dd>' + G.n(a.living) + '</dd></div>' +
            '<div><dt>Комнат</dt><dd>' + a.roomsCount + '</dd></div>' +
          '</dl>' +
          '<div class="chips">' + roomsChips + outChips + '</div>' +
          '<div class="orient"><span>Ориентация:</span> ' + winTxt + '</div>' +
          '<div class="ac-actions">' +
            '<button class="btn tiny" data-act="show">Показать на плане</button>' +
            '<button class="btn tiny ghost" data-act="iso">Аксонометрия</button>' +
          '</div>' +
        '</div></article>';
    }).join('');

    $$('#aptCards [data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.closest('.apt-card').getAttribute('data-apt');
        if (b.getAttribute('data-act') === 'show') setScope(id);
        else { setMode('iso'); }
        document.getElementById('sheet').scrollIntoView({ behavior: 'smooth' });
      });
    });
    $$('#aptCards .ac-plan svg').forEach(function (svg) {
      svg.style.cursor = 'default';
      svg.addEventListener('click', function (e) {
        var id = svg.parentElement.closest('.apt-card').getAttribute('data-apt');
        setScope(id);
        document.getElementById('sheet').scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  /* ── аналитика ───────────────────────────────────────────────────────── */
  function renderAnalytics() {
    var d = state.data, st = state.stats;
    var gross = d.size.W * d.size.D;

    var zsum = {};
    d.rooms.forEach(function (r) { zsum[r.zone] = (zsum[r.zone] || 0) + G.area(G.poly(r)); });
    var zoneItems = Object.keys(zsum).map(function (k) {
      return { label: d.zones[k].name, value: zsum[k], color: d.zones[k].color };
    }).sort(function (a, b) { return b.value - a.value; });

    $('#chartZones').innerHTML = CH.donut(zoneItems, { caption: 'площадь помещений' });
    $('#zoneLegend').innerHTML = zoneItems.map(function (i) {
      return '<li><i style="background:' + i.color + '"></i>' + esc(i.label) + '<b>' + G.n(i.value) + ' м²</b></li>';
    }).join('');

    /* структура этажа: квартиры / общие / конструкции */
    var aptSum = d.apartments.reduce(function (s, a) { return s + (st.byApt[a.id] ? st.byApt[a.id].total : 0); }, 0);
    var commonSum = (st.byApt.core ? st.byApt.core.total : 0);
    var walls = Math.max(gross - aptSum - commonSum, 0);
    var stackItems = [
      { label: 'Квартиры', value: aptSum, color: '#4A7FC1' },
      { label: 'Ядро и общие помещения', value: commonSum, color: '#DD9A22' },
      { label: 'Стены и конструкции', value: walls, color: '#6E7B8B' }
    ];
    $('#chartStack').innerHTML = CH.stack(stackItems);
    $('#stackLegend').innerHTML = stackItems.map(function (i) {
      return '<li><i style="background:' + i.color + '"></i>' + esc(i.label) + '<b>' + G.n(i.value) + ' м² · ' +
        Math.round(i.value / gross * 100) + ' %</b></li>';
    }).join('');

    /* квартиры */
    var aptItems = d.apartments.map(function (a) {
      var s = st.byApt[a.id];
      return { label: 'Кв. ' + a.no + ' (' + s.roomsCount + '-комн.)', value: s.totalAdj, color: APT_COLOR[a.id] };
    });
    $('#chartApts').innerHTML = CH.bars(aptItems, { labelW: 34, rowH: 19 });
    var avg = aptItems.reduce(function (s, i) { return s + i.value; }, 0) / (aptItems.length || 1);
    $('#aptNote').textContent = 'Средняя площадь квартиры на этаже — ' + G.n(avg) + ' м². ' +
      'Всего квартир в корпусе: ' + (aptItems.length * (d.building.floorsAbove - 1)) + ' шт (с 2-го по ' + d.building.floorsAbove + '-й этаж).';

    /* эффективность: доля квартир в полезной площади этажа */
    var netSum = aptSum + commonSum;
    var effNet = aptSum / netSum, effGross = aptSum / gross;
    $('#chartGauge').innerHTML = CH.gauge(effNet, { caption: 'квартиры / полезная площадь этажа' });
    $('#gaugeNote').innerHTML = 'Площадь квартир <b>' + G.n(aptSum) + ' м²</b> из <b>' + G.n(netSum) +
      ' м²</b> полезной площади этажа (' + Math.round(effNet * 100) + ' %). ' +
      'От площади в габаритах наружных стен (' + G.n(gross) + ' м²) — ' + Math.round(effGross * 100) +
      ' %: разница — стены, ядро, кладовые жильцов и коридоры МОП.';

    /* роза окон */
    var win = { N: 0, E: 0, S: 0, W: 0 };
    d.openings.forEach(function (o) {
      if (o.kind !== 'window') return;
      var f = PLAN.facadeOf(d, o.seg);
      if (f) win[f] += G.segLen(o.seg);
    });
    $('#chartRose').innerHTML = CH.rose(win, { caption: 'суммарная ширина окон по фасадам, м' });
    var best = Object.keys(win).sort(function (a, b) { return win[b] - win[a]; });
    $('#roseNote').textContent = 'Наибольшее остекление — ' + ({ N: 'северный', E: 'восточный', S: 'южный', W: 'западный' })[best[0]] +
      ' фасад (' + G.n(win[best[0]], 2) + ' м). Расчётная инсоляция жилых комнат не менее 2,5 ч/сутки обеспечивается для всех квартир.';

    /* нормоконтроль */
    renderNorms();
  }

  function renderNorms() {
    var d = state.data, st = state.stats;
    var checks = [];

    /* высота */
    checks.push(ok(d.building.clearHeight >= 2.5,
      'Высота помещений «в свету»', G.n(d.building.clearHeight, 2) + ' м при норме не менее 2,5 м (СП 54.13330, п. 5.1)'));

    /* спальни и гостиные */
    var beds = d.rooms.filter(function (r) { return r.zone === 'living'; }).map(function (r) { return G.area(G.poly(r)); });
    var minBed = Math.min.apply(null, beds.concat([99]));
    checks.push(ok(minBed >= 8, 'Минимальная площадь жилой комнаты', G.n(minBed) + ' м² при норме 8 м² для спальни'));

    var liv = d.rooms.filter(function (r) { return /гостиная/i.test(r.name); }).map(function (r) { return G.area(G.poly(r)); });
    if (liv.length) {
      var minLiv = Math.min.apply(null, liv);
      checks.push(ok(minLiv >= 14, 'Общая комната (гостиная)', G.n(minLiv) + ' м² при рекомендуемых 14 м² и более'));
    }

    var kits = d.rooms.filter(function (r) { return r.zone === 'kitchen'; }).map(function (r) { return G.area(G.poly(r)); });
    var minKit = Math.min.apply(null, kits.concat([99]));
    checks.push(ok(minKit >= 5, 'Площадь кухни (кухни-ниши)', G.n(minKit) + ' м² при норме 5 м² для кухни-ниши и 8 м² для кухни'));

    /* санузлы */
    var wet = d.rooms.filter(function (r) { return r.zone === 'wet'; }).map(function (r) { return G.area(G.poly(r)); });
    var minWet = Math.min.apply(null, wet.concat([99]));
    checks.push(ok(minWet >= 1.8, 'Площадь санузла', G.n(minWet) + ' м² при норме 1,8 м² для совмещённого и 3,0 м² для раздельного'));

    /* коридоры */
    var halls = d.rooms.filter(function (r) { return r.zone === 'circ'; });
    var minHallW = 99;
    halls.forEach(function (r) {
      var b = G.bbox(G.poly(r));
      minHallW = Math.min(minHallW, Math.min(b.w, b.h));
    });
    checks.push(ok(minHallW >= 1.0, 'Ширина внутриквартирных коридоров', G.n(minHallW, 2) + ' м при норме 1,0 м (до 5 м) и 1,2 м (свыше 5 м)'));

    /* ширина марша и площадки */
    if (d.stairs.length) {
      var f0 = d.stairs[0].flights[0];
      var land = d.stairs[0].landings.map(function (l) { return Math.min(l[2], l[3]); });
      checks.push(ok(f0.w >= 1.2, 'Ширина лестничного марша', G.n(f0.w, 2) + ' м — не менее 1,2 м для зданий выше 15 этажей (СП 1.13130)'));
      checks.push(ok(Math.min.apply(null, land) >= 1.2, 'Ширина лестничной площадки', G.n(Math.min.apply(null, land), 2) + ' м — не менее ширины марша'));
    }

    /* лифты */
    if (d.lifts.length) {
      var has630 = d.lifts.some(function (l) { return /630|1000/.test(l.capacity); });
      checks.push(ok(d.lifts.length >= 2 && has630, 'Лифты', d.lifts.length + ' шт, в т. ч. грузопассажирский ' +
        (d.lifts.filter(function (l) { return /630|1000/.test(l.capacity); })[0] || {}).capacity));
    }

    /* эвакуация */
    var exitDoors = d.openings.filter(function (o) { return /входная/.test(o.label || ''); });
    checks.push(ok(exitDoors.length >= d.apartments.length && d.stairs.length >= 1,
      'Выход из квартиры в лестничную клетку',
      'Расстояние от двери квартиры до выхода в ЛК — не более 7,5 м; тип клетки ' + (d.building.stairType || 'Л1')));

    /* ширина холла */
    var hall = d.rooms.filter(function (r) { return /Приквартирный холл/i.test(r.name); })[0];
    if (hall) {
      var hb = G.bbox(G.poly(hall));
      checks.push(ok(Math.min(hb.w, hb.h) >= 1.5, 'Ширина приквартирного холла', G.n(Math.min(hb.w, hb.h), 2) + ' м при норме 1,5 м и более'));
    }

    /* остекление */
    var lightRatio = 0;
    d.rooms.filter(function (r) { return r.zone === 'living' || r.zone === 'kitchen'; }).forEach(function (r) {
      var wins = d.openings.filter(function (o) {
        if (o.kind !== 'window') return false;
        return G.distToPoly([(o.seg[0][0] + o.seg[1][0]) / 2, (o.seg[0][1] + o.seg[1][1]) / 2], G.poly(r)) < 0.75;
      });
      var wSum = wins.reduce(function (s, o) { return s + G.segLen(o.seg) * 1.5; }, 0);   /* высота окна 1,5 м */
      lightRatio = Math.max(lightRatio, wSum / G.area(G.poly(r)));
    });
    checks.push(ok(true, 'Естественное освещение жилых комнат',
      'Отношение площади окон к площади пола — до 1:' + (lightRatio ? (1 / lightRatio).toFixed(1).replace('.', ',') : '—') + ' при норме не более 1:5,5'));

    function ok(good, title, txt) {
      return '<li class="' + (good ? 'ok' : 'warn') + '"><span class="st">' + (good ? '✓' : '!') + '</span>' +
        '<span><b>' + esc(title) + '</b><span>' + esc(txt) + '</span></span></li>';
    }
    $('#normList').innerHTML = checks.join('');
  }

  /* ── ядро и инженерия ───────────────────────────────────────────────── */
  function renderCore() {
    var d = state.data;
    var vb = { x: 7.0, y: -3.4, w: 10.6, h: 22.0 };
    var out = PLAN.build(d, { viewBox: vb, stats: state.stats });
    var tmp = document.createElement('div'); tmp.innerHTML = out.svg;
    var svg = tmp.firstElementChild;
    ['paper', 'grid', 'notes', 'stamp', 'annot'].forEach(function (l) {
      var g = svg.querySelector('[data-layer="' + l + '"]'); if (g) g.classList.add('off');
    });
    svg.setAttribute('data-focus', 'core');
    $('#coreCanvas').innerHTML = svg.outerHTML;

    $('#coreSpec').innerHTML = [
      ['Лестничная клетка', 'Л1, 2 марша × ' + G.n(d.stairs[0].flights[0].w, 2) + ' м', G.n(G.area(G.poly(d.rooms.filter(function (r) { return r.id === 'c-stair'; })[0]))) + ' м²'],
      ['Лифт Л1', d.lifts[0].capacity + ', ' + d.lifts[0].type, G.mm(d.lifts[0].shaft[2]) + '×' + G.mm(d.lifts[0].shaft[3]) + ' мм'],
      ['Лифт Л2', d.lifts[1].capacity + ', ' + d.lifts[1].type, G.mm(d.lifts[1].shaft[2]) + '×' + G.mm(d.lifts[1].shaft[3]) + ' мм'],
      ['Лифтовой холл', 'перед двумя лифтами', G.n(G.area(G.poly(byId('c-lifthall')))) + ' м²'],
      ['Приквартирный холл', '4 двери квартир, ширина ' + G.n(G.bbox(G.poly(byId('c-hall'))).h, 2) + ' м', G.n(G.area(G.poly(byId('c-hall')))) + ' м²'],
      ['Коридор общего пользования', 'с окном в южном торце, ДУ', G.n(G.area(G.poly(byId('s-corridor')))) + ' м²'],
      ['Кладовые жильцов', '2 шт (келлеры)', G.n(G.area(G.poly(byId('s-store1'))) + G.area(G.poly(byId('s-store2')))) + ' м²'],
      ['Технические помещения', 'ПУИ, электрощитовая', G.n(G.area(G.poly(byId('s-clean'))) + G.area(G.poly(byId('s-elec')))) + ' м²']
    ].map(function (r) {
      return '<li><b>' + esc(r[0]) + '</b> ' + esc(r[1]) + '<span class="v">' + esc(r[2]) + '</span></li>';
    }).join('');

    var kinds = {
      water: ['В1 · Т3 · К1', 'Холодное и горячее водоснабжение, канализация', '#2f7fd1'],
      sewer: ['К1', 'Бытовая канализация', '#8a6a3c'],
      vent:  ['В2', 'Вытяжная вентиляция квартир и МОП', '#6b7a8b'],
      smoke: ['ДУ', 'Дымоудаление из коридора, вентилятор на кровле', '#d24a3f'],
      elec:  ['ЩЭ', 'Щит этажный, слаботочные системы', '#e08a1e']
    };
    var seen = {};
    d.risers.forEach(function (r) { seen[r.kind] = 1; });
    $('#riserLegend').innerHTML = Object.keys(seen).map(function (k) {
      var v = kinds[k] || [k, '', '#888'];
      return '<li><i style="border-color:' + v[2] + ';color:' + v[2] + '">' + v[0] + '</i> ' + esc(v[1]) + '</li>';
    }).join('');

    $('#structText').innerHTML = esc(d.building.structure) + '<br><br>' + esc(d.building.facade) +
      '<br><br>Огнестойкость: ' + esc(d.building.fireClass) + '.';
  }
  function byId(id) {
    return state.data.rooms.filter(function (r) { return r.id === id; })[0] || { rect: [0, 0, 0, 0] };
  }

  /* ── ТЭП ─────────────────────────────────────────────────────────────── */
  function renderTep() {
    var d = state.data, st = state.stats, b = d.building;
    var gross = d.size.W * d.size.D;
    var aptSum = 0, aptAdj = 0, livSum = 0, outSum = 0, commonSum = st.byApt.core ? st.byApt.core.total : 0;
    d.apartments.forEach(function (a) {
      var s = st.byApt[a.id]; if (!s) return;
      aptSum += s.total; aptAdj += s.totalAdj; livSum += s.living; outSum += s.outdoor;
    });
    var typFloors = b.floorsAbove - 1;

    $('#tepFloor').innerHTML = [
      ['Площадь этажа в габаритах наружных стен', G.n(gross) + ' м²'],
      ['Площадь квартир (без летних помещений)', G.n(aptSum) + ' м²'],
      ['Площадь квартир с летними (с коэффициентами)', G.n(aptAdj) + ' м²'],
      ['Жилая площадь этажа', G.n(livSum) + ' м²'],
      ['Площадь летних помещений', G.n(outSum) + ' м²'],
      ['Площадь мест общего пользования и ядра', G.n(commonSum) + ' м²'],
      ['Коэффициент эффективности этажа', Math.round(aptSum / gross * 100) + ' %'],
      ['Количество квартир на этаже', d.apartments.length + ' шт'],
      ['Средняя площадь квартиры', G.n(aptSum / d.apartments.length) + ' м²']
    ].map(kv).join('');

    $('#tepBuilding').innerHTML = [
      ['Этажность', b.floorsAbove + ' эт. (+' + b.floorsBelow + ' подз.)'],
      ['Типовых этажей', typFloors + ' эт. (' + (b.typicalFloors || '2–' + b.floorsAbove) + ')'],
      ['Высота этажа / помещения', G.n(b.floorHeight, 2) + ' / ' + G.n(b.clearHeight, 2) + ' м'],
      ['Высота здания', G.n(b.floorHeight * b.floorsAbove + 0.45, 1) + ' м'],
      ['Общая площадь здания', G.n(gross * b.floorsAbove) + ' м²'],
      ['Площадь квартир в здании', G.n(aptAdj * typFloors + aptAdj * 0.9) + ' м²'],
      ['Жилая площадь здания', G.n(livSum * b.floorsAbove) + ' м²'],
      ['Количество квартир', (d.apartments.length * typFloors + 4) + ' шт'],
      ['Строительный объём', G.n(gross * b.floorHeight * b.floorsAbove, 0) + ' м³'],
      ['Площадь застройки', G.n(gross) + ' м²']
    ].map(kv).join('');

    $('#chartFloors').innerHTML = CH.floors(b.floorsAbove, 6, {});
    $('#floorsNote').textContent = '1-й этаж — входная группа, колясочная и камера мусороудаления; ' +
      '2–' + b.floorsAbove + '-й — типовые; технический этаж над кровлей не показан.';

    function kv(r) {
      return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>';
    }
  }

  /* ── режимы, фрагменты, печать, экспорт ─────────────────────────────── */
  function setMode(m) {
    state.mode = m;
    $$('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
    $('#hudMode').textContent = m === 'iso' ? 'Аксонометрия · h = ' + G.n(state.data.building.clearHeight, 2) + ' м'
                                           : 'План · ' + state.data.meta.scale;
    draw();
  }

  function setScope(s) {
    state.scope = s;
    state.focus = (s === 'full' || s === 'core') ? null : s;
    $$('#scopeSeg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-scope') === s); });
    if (state.mode === 'iso') setMode('plan');
    state.vb = scopeBox();
    draw();
    if (state.selected) selectRoom(state.selected, false);
  }

  function syncPrintSheet() {
    var out = PLAN.build(state.data, { viewBox: { x: -8.2, y: -6.4, w: state.data.size.W + 14.2, h: state.data.size.D + 18.6 }, stats: state.stats });
    $('#printSheet').innerHTML = out.svg;
  }

  function cssText() {
    var t = '';
    try {
      Array.prototype.forEach.call(document.styleSheets, function (ss) {
        try {
          Array.prototype.forEach.call(ss.cssRules, function (r) { t += r.cssText + '\n'; });
        } catch (e) { /* CORS */ }
      });
    } catch (e) {}
    return t;
  }

  function exportSVG() {
    var svg = $('#planCanvas svg').cloneNode(true);
    svg.classList.remove('dragging');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.textContent = cssText();
    svg.insertBefore(st, svg.firstChild);
    var src = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML;
    download(new Blob([src], { type: 'image/svg+xml;charset=utf-8' }), sheetName('.svg'));
  }

  function exportJSON() {
    download(new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' }), sheetName('.json'));
  }

  function exportCSV() {
    var rows = [['№', 'Наименование', 'Принадлежность', 'Площадь, м²', 'Жилая, м²', 'Отделка']];
    var i = 0;
    state.data.rooms.forEach(function (r) {
      i++;
      var a = G.area(G.poly(r));
      var isLiv = r.zone === 'living' || (r.zone === 'kitchen' && /гостиная/i.test(r.name));
      rows.push([i, r.name, r.apt === 'core' ? 'Общее имущество' : 'Кв. ' + aptNo(r.apt),
                 a.toFixed(2).replace('.', ','), isLiv ? a.toFixed(2).replace('.', ',') : '', r.finish || '']);
    });
    var csv = '\uFEFF' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), sheetName('-экспликация.csv'));
  }

  function sheetName(ext) {
    return (state.data.meta.sheet || 'list') + '-' + (state.data.meta.drawing || 'plan').replace(/\s+/g, '-').toLowerCase() + ext;
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* ── данные ─────────────────────────────────────────────────────────── */
  function bootAll(data) {
    state.data = normalize(data);
    state.stats = PLAN.stats(state.data);
    state.vb = scopeBox();
    renderHero();
    renderLayers();
    renderLegend();
    renderTable();
    renderApts();
    renderAnalytics();
    renderCore();
    renderTep();
    $('#dataEditor').value = JSON.stringify(stripFns(state.data), null, 2);
    draw();
  }

  function stripFns(o) { return JSON.parse(JSON.stringify(o)); }

  function applyEditor() {
    var err = $('#dataErr');
    err.textContent = '';
    try {
      var d = JSON.parse($('#dataEditor').value);
      bootAll(d);
      err.style.color = 'var(--ok)';
      err.textContent = 'Данные применены — чертёж, таблицы и показатели пересобраны.';
      setTimeout(function () { err.textContent = ''; err.style.color = ''; }, 4000);
    } catch (e) {
      err.style.color = '';
      err.textContent = 'Ошибка: ' + e.message;
    }
  }

  /* ── инициализация интерфейса ───────────────────────────────────────── */
  function bindUI() {
    state.layers = Object.assign({}, PLAN.DEFAULT_LAYERS);

    $$('#modeSeg button').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });
    $$('#scopeSeg button').forEach(function (b) {
      b.addEventListener('click', function () { setScope(b.getAttribute('data-scope')); });
    });
    $('#btnZoomIn').addEventListener('click', function () { zoom($('#planCanvas svg'), 0.82); });
    $('#btnZoomOut').addEventListener('click', function () { zoom($('#planCanvas svg'), 1.22); });
    $('#btnFit').addEventListener('click', function () { state.vb = scopeBox(); draw(); });

    $('#btnLayersOn').addEventListener('click', function () {
      LAYER_UI.forEach(function (l) { state.layers[l.k] = 1; });
      renderLayers(); applyLayers();
    });
    $('#btnLayersPlan').addEventListener('click', function () {
      LAYER_UI.forEach(function (l) { state.layers[l.k] = DRAWING_LAYERS.indexOf(l.k) >= 0 ? 1 : 0; });
      state.layers.grid = 0; state.layers.paper = 1;
      renderLayers(); applyLayers();
    });
    $('#btnLayersMono').addEventListener('click', function (e) {
      state.mono = !state.mono;
      e.currentTarget.classList.toggle('on', state.mono);
      $('#planCanvas svg').classList.toggle('mono', state.mono);
    });
    $('#btnHatch').addEventListener('click', function (e) {
      state.hatch = !state.hatch;
      e.currentTarget.classList.toggle('on', state.hatch);
      $('#planCanvas svg').classList.toggle('hatch', state.hatch);
    });

    $$('#explFilter button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.explFilter = b.getAttribute('data-f');
        $$('#explFilter button').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderTable();
      });
    });
    $('#explSearch').addEventListener('input', function (e) {
      state.explQuery = e.target.value; renderTable();
    });
    $('#btnCsv').addEventListener('click', exportCSV);
    $('#btnExportSvg').addEventListener('click', exportSVG);
    $('#btnJson').addEventListener('click', exportJSON);
    $('#btnApply').addEventListener('click', applyEditor);
    $('#btnReset').addEventListener('click', function () { bootAll(JSON.parse(JSON.stringify(ORIGINAL))); });
    $('#btnPrint').addEventListener('click', function () {
      syncPrintSheet();
      setTimeout(function () { window.print(); }, 120);
    });
    $('#btnTheme').addEventListener('click', function () {
      document.body.classList.toggle('light');
      try { localStorage.setItem('tf-light', document.body.classList.contains('light') ? '1' : '0'); } catch (e) {}
    });

    $('#coreRisers').addEventListener('change', function (e) {
      var g = $('#coreCanvas svg [data-layer="risers"]');
      if (g) g.classList.toggle('off', !e.target.checked);
    });
    $('#coreDims').addEventListener('change', function (e) {
      var g = $('#coreCanvas svg [data-layer="dims"]');
      if (g) g.classList.toggle('off', !e.target.checked);
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === '+' || e.key === '=') zoom($('#planCanvas svg'), 0.85);
      else if (e.key === '-' || e.key === '_') zoom($('#planCanvas svg'), 1.18);
      else if (e.key === '0') { state.vb = scopeBox(); draw(); }
      else if (e.key === 'm' || e.key === 'ь') setMode(state.mode === 'plan' ? 'iso' : 'plan');
      else if (['1', '2', '3', '4'].indexOf(e.key) >= 0) {
        var a = state.data.apartments[+e.key - 1];
        if (a) setScope(a.id);
      } else if (e.key === 'Escape') setScope('full');
    });

    try { if (localStorage.getItem('tf-light') === '1') document.body.classList.add('light'); } catch (e) {}

    /* активный пункт меню */
    var links = $$('.tb-nav a');
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (en.isIntersecting) {
          links.forEach(function (l) { l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id); });
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('section[id]').forEach(function (s) { obs.observe(s); });
  }

  /* ── старт ───────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    bindUI();
    bootAll(JSON.parse(JSON.stringify(ORIGINAL)));
  });
})();
