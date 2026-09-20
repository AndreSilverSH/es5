/* ============================================================================
 *  render-plan.js — генератор SVG-чертежа плана этажа из данных
 *  ----------------------------------------------------------------------------
 *  Стены строятся автоматически:
 *   · наружный контур   — обводка 0,8 м с обрезкой по контуру (полоса 0,4 м),
 *   · межквартирные/ядро — явные линии 0,4 м,
 *   · перегородки       — обводка контуров помещений 0,2 м (зазор между
 *                         соседними помещениями полностью закрывается).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var G = global.GEO;
  var R = {};

  var APT_COLOR = {
    a1: '#4A7FC1', a2: '#D98E32', a3: '#4FA382', a4: '#B56A9B', core: '#8A93A0'
  };

  var DEFAULT_LAYERS = {
    paper: 1, grid: 1, outdoor: 1, fills: 1, walls: 1, openings: 1,
    stairs: 1, lifts: 1, furn: 1, risers: 0, labels: 1, numbers: 0,
    aptmarks: 1, axes: 1, dims: 1, annot: 1, stamp: 1, notes: 1
  };

  /* ── вспомогательные ─────────────────────────────────────────────────── */
  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function p2(x, y) { return (Math.round(x * 1000) / 1000) + ',' + (Math.round(y * 1000) / 1000); }
  function polyPts(p) { return p.map(function (q) { return p2(q[0], q[1]); }).join(' '); }

  function roomById(data) {
    var m = {};
    data.rooms.forEach(function (r) { m[r.id] = r; });
    data.balconies.forEach(function (b) { m[b.id] = b; });
    return m;
  }

  /* толщина стены, в которой сделан проём */
  function wallThickness(data, seg) {
    var a = seg[0], b = seg[1];
    var W = data.size.W;
    var onLine = function (v, l) { return Math.abs(v - l) < 0.05; };
    if (a[0] === b[0]) {                                  /* вертикальная */
      if (onLine(a[0], 0) || onLine(a[0], W)) return data.wall.facade;
      if (onLine(a[0], 8.4) || onLine(a[0], 15.6)) return data.wall.party;
    } else {                                              /* горизонтальная */
      if (onLine(a[1], 0) || onLine(a[1], data.size.D)) return data.wall.facade;
      if (onLine(a[1], 8.4)) return data.wall.party;
    }
    return data.wall.partition;
  }

  /* ориентация фасада по положению окна */
  function facadeOf(data, seg) {
    var a = seg[0], b = seg[1], W = data.size.W, D = data.size.D;
    if (Math.abs(a[1]) < 0.05 && Math.abs(b[1]) < 0.05) return 'N';
    if (Math.abs(a[1] - D) < 0.05 && Math.abs(b[1] - D) < 0.05) return 'S';
    if (Math.abs(a[0]) < 0.05 && Math.abs(b[0]) < 0.05) return 'W';
    if (Math.abs(a[0] - W) < 0.05 && Math.abs(b[0] - W) < 0.05) return 'E';
    return null;
  }

  /* ══ Библиотека символов мебели и сантехники (локальные координаты, м) ══ */
  var F = 0.035;   /* толщина линии символа */
  var FURN = {
    bed160: function () {
      return '<rect x="-0.8" y="-1.0" width="1.6" height="2.0" rx="0.06"/>' +
             '<path d="M-0.8,-0.55 H0.8"/>' +
             '<rect x="-0.68" y="-0.93" width="0.58" height="0.3" rx="0.08"/>' +
             '<rect x="0.10" y="-0.93" width="0.58" height="0.3" rx="0.08"/>' +
             '<path d="M-0.8,0.35 H0.8"/>';
    },
    bed140: function () {
      return '<rect x="-0.7" y="-1.0" width="1.4" height="2.0" rx="0.06"/>' +
             '<path d="M-0.7,-0.55 H0.7"/>' +
             '<rect x="-0.58" y="-0.93" width="1.16" height="0.3" rx="0.08"/>' +
             '<path d="M-0.7,0.35 H0.7"/>';
    },
    nightstand: function () { return '<rect x="-0.22" y="-0.22" width="0.44" height="0.44" rx="0.04"/><circle r="0.05"/>'; },
    wardrobe: function () {
      return '<rect x="-0.8" y="-0.3" width="1.6" height="0.6" rx="0.03"/>' +
             '<path d="M0,-0.3 V0.3 M-0.78,-0.12 h0.3 M0.48,-0.12 h0.3"/>';
    },
    sofa: function () {
      return '<rect x="-1.0" y="-0.45" width="2.0" height="0.9" rx="0.1"/>' +
             '<path d="M-1.0,-0.2 H1.0 M-0.34,-0.2 V0.45 M0.34,-0.2 V0.45"/>' +
             '<rect x="-1.0" y="-0.45" width="0.18" height="0.9" rx="0.06"/>' +
             '<rect x="0.82" y="-0.45" width="0.18" height="0.9" rx="0.06"/>';
    },
    armchair: function () {
      return '<rect x="-0.42" y="-0.4" width="0.84" height="0.8" rx="0.1"/>' +
             '<path d="M-0.42,-0.16 H0.42"/>';
    },
    ctable: function () { return '<rect x="-0.5" y="-0.3" width="1.0" height="0.6" rx="0.14"/>'; },
    dtable: function () { return '<rect x="-0.7" y="-0.42" width="1.4" height="0.84" rx="0.1"/>'; },
    chair: function () { return '<rect x="-0.22" y="-0.2" width="0.44" height="0.4" rx="0.06"/><path d="M-0.22,-0.2 H0.22" stroke-width="0.06"/>'; },
    tvunit: function () { return '<rect x="-0.65" y="-0.1" width="1.3" height="0.2" rx="0.04"/><path d="M-0.55,-0.06 H0.55"/>'; },
    fridge: function () { return '<rect x="-0.32" y="-0.32" width="0.64" height="0.64" rx="0.04"/><path d="M-0.32,0 H0.32 M0.18,-0.24 v0.16"/>'; },
    kcounter: function () {
      return '<rect x="-1.2" y="-0.3" width="2.4" height="0.6" rx="0.03"/>' +
             '<rect x="-0.95" y="-0.22" width="0.5" height="0.44" rx="0.06"/>' +      /* мойка */
             '<circle cx="-0.7" cy="0" r="0.09"/>' +
             '<rect x="0.15" y="-0.22" width="0.6" height="0.44" rx="0.03"/>' +        /* плита */
             '<circle cx="0.3" cy="-0.09" r="0.07"/><circle cx="0.6" cy="-0.09" r="0.07"/>' +
             '<circle cx="0.3" cy="0.09" r="0.07"/><circle cx="0.6" cy="0.09" r="0.07"/>' +
             '<path d="M-0.2,-0.3 V0.3 M0.9,-0.3 V0.3"/>';
    },
    bathtub: function () {
      return '<rect x="-0.85" y="-0.38" width="1.7" height="0.76" rx="0.16"/>' +
             '<rect x="-0.76" y="-0.3" width="1.52" height="0.6" rx="0.12"/>' +
             '<circle cx="0.62" cy="0" r="0.05"/>';
    },
    shower: function () {
      return '<rect x="-0.45" y="-0.45" width="0.9" height="0.9" rx="0.06"/>' +
             '<path d="M-0.45,0.45 L0.45,-0.45"/><circle r="0.07"/>';
    },
    wc: function () {
      return '<rect x="-0.19" y="-0.33" width="0.38" height="0.16" rx="0.04"/>' +
             '<ellipse cx="0" cy="0.03" rx="0.19" ry="0.27"/>';
    },
    basin: function () {
      return '<rect x="-0.28" y="-0.21" width="0.56" height="0.42" rx="0.12"/>' +
             '<ellipse cx="0" cy="0.02" rx="0.18" ry="0.13"/>';
    },
    washer: function () { return '<rect x="-0.3" y="-0.3" width="0.6" height="0.6" rx="0.04"/><circle r="0.19"/><circle cx="0.18" cy="-0.2" r="0.04"/>'; },
    desk: function () { return '<rect x="-0.6" y="-0.3" width="1.2" height="0.6" rx="0.03"/><path d="M-0.6,-0.1 H0.6"/>'; },
    plant: function () { return '<circle r="0.24"/><path d="M0,-0.24 V0.24 M-0.24,0 H0.24 M-0.17,-0.17 L0.17,0.17 M0.17,-0.17 L-0.17,0.17"/>'; },
    shoes: function () { return '<rect x="-0.42" y="-0.16" width="0.84" height="0.32" rx="0.06"/><path d="M-0.42,0 H0.42"/>'; },
    shelf: function () { return '<rect x="-0.6" y="-0.2" width="1.2" height="0.4"/><path d="M-0.6,0 H0.6"/>'; },
    panel: function () { return '<rect x="-0.45" y="-0.14" width="0.9" height="0.28" rx="0.03"/><path d="M-0.3,0 H0.3"/>'; },
    sink: function () { return '<rect x="-0.3" y="-0.22" width="0.6" height="0.44" rx="0.08"/><circle r="0.08"/>'; }
  };

  /* ══ DEFS ══════════════════════════════════════════════════════════════ */
  function defs(data) {
    var W = data.size.W, D = data.size.D;
    var outline = polyPts([[0, 0], [W, 0], [W, D], [0, D]]);
    return '' +
    '<defs>' +
      '<clipPath id="pp-clip-outline"><polygon points="' + outline + '"/></clipPath>' +
      '<clipPath id="pp-clip-sheet"><rect x="-8" y="-8" width="' + (W + 18) + '" height="' + (D + 22) + '"/></clipPath>' +
      '<pattern id="pp-hatch" width="0.34" height="0.34" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<rect width="0.34" height="0.34" fill="#ffffff"/>' +
        '<line x1="0" y1="0" x2="0" y2="0.34" stroke="var(--pp-wall, #243444)" stroke-width="0.055"/>' +
      '</pattern>' +
      '<pattern id="pp-hatch-out" width="0.3" height="0.3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<rect width="0.3" height="0.3" fill="#E7EDF2"/>' +
        '<line x1="0" y1="0" x2="0" y2="0.3" stroke="#71899E" stroke-width="0.04"/>' +
      '</pattern>' +
      '<pattern id="pp-grid" width="1" height="1" patternUnits="userSpaceOnUse">' +
        '<path d="M1,0 V1 H0" fill="none" stroke="#dfe4ea" stroke-width="0.02"/>' +
      '</pattern>' +
      '<pattern id="pp-grid5" width="5" height="5" patternUnits="userSpaceOnUse">' +
        '<path d="M5,0 V5 H0" fill="none" stroke="#cfd7df" stroke-width="0.035"/>' +
      '</pattern>' +
      '<filter id="pp-shadow" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feDropShadow dx="0.35" dy="0.45" stdDeviation="0.28" flood-color="#0b1a2a" flood-opacity="0.28"/>' +
      '</filter>' +
      '<linearGradient id="pp-paper" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f4f1ea"/>' +
      '</linearGradient>' +
    '</defs>';
  }

  /* ══ Бумага, сетка, север, масштабная линейка ══════════════════════════ */
  function layerPaper(data, opts) {
    var W = data.size.W, D = data.size.D;
    return '<g class="lyr" data-layer="paper">' +
      '<rect x="-7.4" y="-6.25" width="' + (W + 15.6) + '" height="' + (D + 18.35) + '" rx="0.6" fill="url(#pp-paper)" stroke="#c9cfd6" stroke-width="0.06"/>' +
      '<rect x="-6.6" y="-5.85" width="' + (W + 14) + '" height="' + (D + 17.55) + '" fill="none" stroke="#2b3d4f" stroke-width="0.09"/>' +
    '</g>' +
    '<g class="lyr" data-layer="grid">' +
      '<rect x="0" y="0" width="' + W + '" height="' + D + '" fill="url(#pp-grid)"/>' +
      '<rect x="0" y="0" width="' + W + '" height="' + D + '" fill="url(#pp-grid5)"/>' +
    '</g>';
  }

  /* ══ Лоджии и балконы ══════════════════════════════════════════════════ */
  function layerOutdoor(data) {
    var s = '<g class="lyr" data-layer="outdoor">';
    data.balconies.forEach(function (b) {
      var p = G.poly(b);
      s += '<g class="balcony" data-id="' + b.id + '" data-apt="' + b.apt + '">' +
           '<polygon class="bal-slab" points="' + polyPts(p) + '"/>' +
           '<polygon class="bal-rail" points="' + polyPts(p) + '"/></g>';
    });
    return s + '</g>';
  }

  /* ══ Заполнения помещений ══════════════════════════════════════════════ */
  function layerFills(data) {
    var s = '<g class="lyr" data-layer="fills">';
    data.rooms.forEach(function (r) {
      var p = G.poly(r);
      var z = data.zones[r.zone] || { fill: '#eee' };
      s += '<polygon class="room-fill" data-id="' + r.id + '" data-apt="' + r.apt + '" data-zone="' + r.zone +
           '" points="' + polyPts(p) + '" fill="' + z.fill + '"/>';
    });
    return s + '</g>';
  }

  /* ══ Стены ═════════════════════════════════════════════════════════════ */
  function layerWalls(data) {
    var W = data.size.W, D = data.size.D;
    var outline = polyPts([[0, 0], [W, 0], [W, D], [0, D]]);
    var s = '<g class="lyr walls" data-layer="walls">';

    /* перегородки — обводка помещений */
    s += '<g class="w-part">';
    data.rooms.forEach(function (r) {
      s += '<polygon points="' + polyPts(G.poly(r)) + '"/>';
    });
    s += '</g>';

    /* межквартирные и стены ядра */
    s += '<g class="w-party">' +
      '<line x1="8.4" y1="0" x2="8.4" y2="' + D + '"/>' +
      '<line x1="15.6" y1="0" x2="15.6" y2="' + D + '"/>' +
      '<line x1="0" y1="8.4" x2="8.4" y2="8.4"/>' +
      '<line x1="15.6" y1="8.4" x2="' + W + '" y2="8.4"/>' +
      '<line x1="8.4" y1="8.4" x2="15.6" y2="8.4"/>' +
      '<line x1="8.4" y1="8.4" x2="8.4" y2="' + D + '"/>' +
      '<line x1="15.6" y1="8.4" x2="15.6" y2="' + D + '"/>' +
    '</g>';

    /* наружные стены — полоса 0,4 м внутрь от контура */
    s += '<g clip-path="url(#pp-clip-outline)"><polygon class="w-facade" points="' + outline + '"/></g>';
    /* парапет / внешняя грань */
    s += '<polygon class="w-outline" points="' + outline + '"/>';

    return s + '</g>';
  }

  /* ══ Проёмы: двери, окна, лифты ════════════════════════════════════════ */
  function layerOpenings(data) {
    var s = '<g class="lyr" data-layer="openings">';
    data.openings.forEach(function (o, i) {
      var a = o.seg[0], b = o.seg[1];
      var t = wallThickness(data, o.seg);
      var vert = Math.abs(a[0] - b[0]) < 1e-6;
      var erase = '<line class="op-erase" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] +
                  '" stroke-width="' + (t + 0.06) + '"/>';
      var sym = '';
      var L = G.segLen(o.seg);

      if (o.kind === 'window') {
        var nx = vert ? 1 : 0, ny = vert ? 0 : 1;      /* нормаль */
        var off = t / 2 - 0.06;
        var gx = Math.min(a[0], b[0]) + (vert ? -off * 0.55 : 0);
        var gy = Math.min(a[1], b[1]) + (vert ? 0 : -off * 0.55);
        var gw = vert ? off * 1.1 : L;
        var gh = vert ? L : off * 1.1;
        sym = '<g class="op-window">' +
          '<rect class="win-glass" x="' + gx.toFixed(3) + '" y="' + gy.toFixed(3) +
            '" width="' + gw.toFixed(3) + '" height="' + gh.toFixed(3) + '" rx="0.03"/>' +
          '<line x1="' + (a[0] - nx * off) + '" y1="' + (a[1] - ny * off) + '" x2="' + (b[0] - nx * off) + '" y2="' + (b[1] - ny * off) + '"/>' +
          '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" class="win-mid"/>' +
          '<line x1="' + (a[0] + nx * off) + '" y1="' + (a[1] + ny * off) + '" x2="' + (b[0] + nx * off) + '" y2="' + (b[1] + ny * off) + '"/>' +
        '</g>';
      } else if (o.kind === 'door' || o.kind === 'lift') {
        var hinge = (o.hinge === 'end') ? b : a;
        var tip = (o.hinge === 'end') ? a : b;
        var dx = tip[0] - hinge[0], dy = tip[1] - hinge[1];
        /* направление открывания: наружу от стены в сторону помещения */
        var sign = 1;
        if (o.into) {
          var rm = roomById(data)[o.into];
          if (rm) {
            var c = G.centroid(G.poly(rm));
            sign = vert ? (c[0] > hinge[0] ? 1 : -1) : (c[1] > hinge[1] ? 1 : -1);
          }
        }
        if (o.swing === 'out') sign = -sign;
        var leafX = vert ? hinge[0] + sign * L : hinge[0];
        var leafY = vert ? hinge[1] : hinge[1] + sign * L;
        var sweep = vert
          ? 'M' + leafX + ',' + hinge[1] + ' A' + L + ',' + L + ' 0 0 ' + (sign > 0 ? (dy > 0 ? 1 : 0) : (dy > 0 ? 0 : 1)) + ' ' + tip[0] + ',' + tip[1]
          : 'M' + hinge[0] + ',' + leafY + ' A' + L + ',' + L + ' 0 0 ' + (sign > 0 ? (dx > 0 ? 0 : 1) : (dx > 0 ? 1 : 0)) + ' ' + tip[0] + ',' + tip[1];

        if (o.kind === 'lift') {
          sym = '<g class="op-lift">' +
            '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" class="lift-door"/>' +
            '<line class="lift-jamb" x1="' + (a[0] + (vert ? 0.14 : 0)) + '" y1="' + (a[1] + (vert ? 0 : 0.14)) + '" x2="' + (a[0] + (vert ? -0.14 : 0)) + '" y2="' + (a[1] + (vert ? 0 : -0.14)) + '"/>' +
            '<line class="lift-jamb" x1="' + (b[0] + (vert ? 0.14 : 0)) + '" y1="' + (b[1] + (vert ? 0 : 0.14)) + '" x2="' + (b[0] + (vert ? -0.14 : 0)) + '" y2="' + (b[1] + (vert ? 0 : -0.14)) + '"/>' +
          '</g>';
        } else {
          sym = '<g class="op-door">' +
            '<line class="leaf" x1="' + hinge[0] + '" y1="' + hinge[1] + '" x2="' + leafX + '" y2="' + leafY + '"/>' +
            '<path class="sweep" d="' + sweep + '"/>' +
          '</g>';
        }
      } else if (o.kind === 'opening') {
        sym = '<g class="op-opening">' +
          '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" class="open-line"/>' +
        '</g>';
      }
      s += '<g class="opening" data-i="' + i + '" data-kind="' + o.kind + '" data-apt="' + (o.apt || '') + '">' + erase + sym + '</g>';
    });
    return s + '</g>';
  }

  /* ══ Лестницы ══════════════════════════════════════════════════════════ */
  function layerStairs(data) {
    var s = '<g class="lyr" data-layer="stairs">';
    data.stairs.forEach(function (st) {
      st.landings.forEach(function (l) {
        s += '<rect class="st-landing" x="' + l[0] + '" y="' + l[1] + '" width="' + l[2] + '" height="' + l[3] + '"/>';
      });
      st.flights.forEach(function (f) {
        s += '<g class="st-flight"><rect x="' + f.x + '" y="' + f.y + '" width="' + f.w + '" height="' + f.h + '"/>';
        var n = f.treads, i;
        for (i = 1; i < n; i++) {
          var y = f.y + f.h * i / n;
          s += '<line x1="' + f.x + '" y1="' + y.toFixed(3) + '" x2="' + (f.x + f.w) + '" y2="' + y.toFixed(3) + '"/>';
        }
        /* стрелка направления */
        var cx = f.x + f.w / 2, up = f.dir === 'up';
        var y0 = up ? f.y + f.h - 0.25 : f.y + 0.25;
        var y1 = up ? f.y + 0.25 : f.y + f.h - 0.25;
        s += '<path class="st-arrow" d="M' + cx + ',' + y0 + ' L' + cx + ',' + y1 + '"/>' +
             '<path class="st-arrow" d="M' + (cx - 0.13) + ',' + (y1 + (up ? 0.26 : -0.26)) + ' L' + cx + ',' + y1 +
             ' L' + (cx + 0.13) + ',' + (y1 + (up ? 0.26 : -0.26)) + '"/>';
        s += '</g>';
      });
      var c = G.centroid(G.poly(st));
      s += '<text class="st-lbl" x="' + c[0] + '" y="' + (st.rect[1] + 0.55) + '">ВВЕРХ</text>';
      /* уровни этажей: отметка площадки */
    });
    return s + '</g>';
  }

  /* ══ Лифты ═════════════════════════════════════════════════════════════ */
  function layerLifts(data) {
    var s = '<g class="lyr" data-layer="lifts">';
    data.lifts.forEach(function (l) {
      var sh = l.shaft, cab = l.cab;
      s += '<g class="lift">' +
        '<rect class="lift-shaft" x="' + sh[0] + '" y="' + sh[1] + '" width="' + sh[2] + '" height="' + sh[3] + '"/>' +
        '<line class="lift-x" x1="' + sh[0] + '" y1="' + sh[1] + '" x2="' + (sh[0] + sh[2]) + '" y2="' + (sh[1] + sh[3]) + '"/>' +
        '<line class="lift-x" x1="' + (sh[0] + sh[2]) + '" y1="' + sh[1] + '" x2="' + sh[0] + '" y2="' + (sh[1] + sh[3]) + '"/>' +
        '<rect class="lift-cab" x="' + cab[0] + '" y="' + cab[1] + '" width="' + cab[2] + '" height="' + cab[3] + '"/>' +
        '<text class="lift-lbl" x="' + (sh[0] + sh[2] / 2) + '" y="' + (sh[1] + sh[3] / 2 + 0.12) + '">' + esc(l.name) + '</text>' +
      '</g>';
    });
    return s + '</g>';
  }

  /* ══ Мебель ════════════════════════════════════════════════════════════ */
  function layerFurniture(data) {
    var s = '<g class="lyr" data-layer="furn">';
    data.furniture.forEach(function (f) {
      var fn = FURN[f.t];
      if (!fn) return;
      s += '<g class="furn" transform="translate(' + f.x + ',' + f.y + ') rotate(' + (f.rot || 0) + ')">' + fn() + '</g>';
    });
    /* стеллажи и щиты — автоматически по типам помещений */
    data.rooms.forEach(function (r) {
      var b = G.bbox(G.poly(r));
      if (r.zone === 'storage') {
        s += '<g class="furn">' +
          '<rect x="' + (b.x + 0.08) + '" y="' + (b.y + 0.08) + '" width="' + (b.w - 0.16) + '" height="0.4"/>' +
          '<rect x="' + (b.x + 0.08) + '" y="' + (b.y2 - 0.48) + '" width="' + (b.w - 0.16) + '" height="0.4"/>' +
        '</g>';
      }
      if (r.id === 's-elec') {
        s += '<g class="furn">' +
          '<rect x="' + (b.x2 - 0.5) + '" y="' + (b.y + 0.3) + '" width="0.4" height="' + (b.h - 0.6) + '"/>' +
          '<rect x="' + (b.x + 0.2) + '" y="' + (b.y + 0.3) + '" width="0.35" height="1.0"/>' +
        '</g>';
      }
      if (r.id === 's-clean') {
        s += '<g class="furn" transform="translate(' + (b.x + 0.5) + ',' + (b.y + 0.4) + ')">' + FURN.sink() + '</g>' +
             '<g class="furn"><rect x="' + (b.x + 0.1) + '" y="' + (b.y2 - 0.5) + '" width="' + (b.w - 0.2) + '" height="0.4"/></g>';
      }
    });
    return s + '</g>';
  }

  /* ══ Инженерные стояки ═════════════════════════════════════════════════ */
  function layerRisers(data) {
    var s = '<g class="lyr" data-layer="risers">';
    data.risers.forEach(function (r) {
      /* ставим маркер в нижний левый угол помещения, в котором он лежит */
      var host = null, hb = null;
      data.rooms.forEach(function (rm) {
        var bb = G.bbox(G.poly(rm));
        if (r.x >= bb.x && r.x <= bb.x2 && r.y >= bb.y && r.y <= bb.y2) { host = rm; hb = bb; }
      });
      var mx = r.x, my = r.y;
      if (host) { mx = hb.x + 0.36; my = hb.y2 - 0.36; }
      var showCode = host && hb.w >= 2.2;
      s += '<g class="riser r-' + r.kind + '" title="' + esc(r.label) + '">' +
        '<circle cx="' + mx.toFixed(2) + '" cy="' + my.toFixed(2) + '" r="' + r.r + '"/>' +
        '<circle cx="' + mx.toFixed(2) + '" cy="' + my.toFixed(2) + '" r="' + (r.r * 0.35) + '" class="dot"/>' +
        (showCode ? '<text class="r-code" x="' + (mx + r.r + 0.14).toFixed(2) + '" y="' + (my + 0.09).toFixed(2) + '">' + esc(r.label) + '</text>' : '') +
      '</g>';
    });
    return s + '</g>';
  }

  /* ══ Подписи помещений и нумерация ═════════════════════════════════════ */
  /* прямоугольники бирок квартир — для отрисовки и для разбора коллизий подписей */
  function aptChipRects(data, stats) {
    var out = [];
    data.apartments.forEach(function (a) {
      var st = stats.byApt[a.id];
      if (!st || !st.tag) return;
      out.push({ apt: a.id, x: st.tag[0] - 1.55, y: st.tag[1] - 0.52, w: 3.1, h: 1.04 });
    });
    return out;
  }

  /* перенос слов: не шире maxChars символов */
  function wrapName(text, maxChars) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      if (!cur.length) { cur = w; return; }
      if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    });
    if (cur.length) lines.push(cur);
    return lines;
  }

  function layerLabels(data, opts) {
    opts = opts || {};
    var chips = opts.chips || [];
    var idx = {};
    data.rooms.forEach(function (r, i) { idx[r.id] = i + 1; });
    var s1 = '<g class="lyr" data-layer="labels">';
    var s2 = '<g class="lyr" data-layer="numbers">';

    data.rooms.forEach(function (r) {
      var p = G.poly(r);
      var b = G.bbox(p);
      var a = G.area(p);
      var c = r.labelAt ? [r.labelAt[0], r.labelAt[1]] : G.labelPoint(p);
      var small = Math.min(b.w, b.h) < 1.7 || a < 5.5;
      var isLift = /Шахта/.test(r.name);
      var name = isLift ? r.name.replace('Шахта лифта ', 'ЛИФТ ') : r.name;

      if (small || isLift) {
        var cyS = c[1], k2;
        for (k2 = 0; k2 < chips.length; k2++) {
          var chS = chips[k2];
          if (c[0] > chS.x - 0.2 && c[0] < chS.x + chS.w + 0.2 && cyS + 0.5 > chS.y - 0.1 && cyS - 0.5 < chS.y + chS.h + 0.1) {
            var dnS = chS.y + chS.h + 0.6, upS = chS.y - 0.6;
            if (dnS < b.y2 - 0.15) cyS = dnS; else if (upS > b.y + 0.15) cyS = upS;
          }
        }
        s1 += '<text class="rm-area sm" x="' + c[0].toFixed(2) + '" y="' + (cyS + 0.1).toFixed(2) + '">' + G.n(a) + '</text>';
        s2 += '<g class="rm-num" data-id="' + r.id + '"><circle cx="' + c[0].toFixed(2) + '" cy="' + (cyS - 0.5).toFixed(2) + '" r="0.3"/>' +
              '<text x="' + c[0].toFixed(2) + '" y="' + (cyS - 0.4).toFixed(2) + '">' + idx[r.id] + '</text></g>';
        return;
      }

      /* размер шрифта и переносы по ширине помещения */
      var fs = a < 9 ? 0.34 : 0.42;
      var maxChars0 = Math.max(6, Math.floor((b.w - 0.5) / (fs * 0.62)));
      if (wrapName(name, maxChars0).length >= 3) fs = 0.32;
      var lh = fs * 1.16;
      var maxChars = Math.max(6, Math.floor((b.w - 0.5) / (fs * 0.62)));
      var lines = wrapName(name, maxChars);
      var hasSub = !!r.note && a >= 10;
      var blockH = lines.length * lh + 0.42 + (hasSub ? 0.34 : 0);

      /* уходим от бирки квартиры, если подпись попала под неё */
      var cy = c[1], i2;
      for (i2 = 0; i2 < chips.length; i2++) {
        var ch = chips[i2];
        var overX = c[0] > ch.x - 0.2 && c[0] < ch.x + ch.w + 0.2;
        var overY = cy + blockH / 2 > ch.y - 0.1 && cy - blockH / 2 < ch.y + ch.h + 0.1;
        if (!overX || !overY) continue;
        var down = ch.y + ch.h + blockH / 2 + 0.18;
        var up = ch.y - blockH / 2 - 0.18;
        if (down + blockH / 2 < b.y2 - 0.15) cy = down;
        else if (up - blockH / 2 > b.y + 0.15) cy = up;
      }

      var y0 = cy - blockH / 2 + fs * 0.92;
      var txt = '<g class="rm-lbl"><text class="rm-name" x="' + c[0].toFixed(2) + '" y="' + y0.toFixed(2) + '"' +
                (lines.length > 1 ? ' style="font-size:' + fs + '"' : '') + '>';
      lines.forEach(function (ln, li) {
        txt += (li ? '<tspan x="' + c[0].toFixed(2) + '" dy="' + lh.toFixed(2) + '">' : '') + esc(ln) + (li ? '</tspan>' : '');
      });
      txt += '</text>' +
             '<text class="rm-area" x="' + c[0].toFixed(2) + '" y="' + (y0 + lines.length * lh + 0.04).toFixed(2) + '">' + G.n(a) + ' м²</text>';
      if (hasSub) txt += '<text class="rm-note" x="' + c[0].toFixed(2) + '" y="' + (y0 + lines.length * lh + 0.4).toFixed(2) + '">' + esc(r.note) + '</text>';
      txt += '</g>';
      s1 += txt;

      s2 += '<g class="rm-num" data-id="' + r.id + '"><circle cx="' + c[0].toFixed(2) + '" cy="' + (cy - blockH / 2 - 0.42).toFixed(2) + '" r="0.3"/>' +
            '<text x="' + c[0].toFixed(2) + '" y="' + (cy - blockH / 2 - 0.32).toFixed(2) + '">' + idx[r.id] + '</text></g>';
    });

    /* подписи балконов — поверх стен */
    data.balconies.forEach(function (bl) {
      var pb = G.poly(bl), bb2 = G.bbox(pb);
      s1 += '<text class="bal-lbl" x="' + (bb2.x + bb2.w / 2).toFixed(2) + '" y="' + (bb2.y + bb2.h / 2 + 0.1).toFixed(2) + '">' +
            esc(bl.name) + ' ' + G.n(G.area(pb)) + ' м²</text>';
    });
    return s1 + '</g>' + s2 + '</g>';
  }

  function layerAptMarks(data, stats) {
    var s = '<g class="lyr" data-layer="aptmarks">';
    data.rooms.forEach(function (r) {
      if (r.apt === 'core') return;
      s += '<polygon class="apt-frame f-' + r.apt + '" points="' + polyPts(G.poly(r)) + '"/>';
    });
    data.apartments.forEach(function (a) {
      var st = stats.byApt[a.id];
      if (!st) return;
      var pos = st.tag;
      var col = APT_COLOR[a.id];
      s += '<g class="apt-tag" data-apt="' + a.id + '" transform="translate(' + pos[0].toFixed(2) + ',' + pos[1].toFixed(2) + ')">' +
        '<rect x="-1.55" y="-0.52" width="3.1" height="1.04" rx="0.52" fill="' + col + '"/>' +
        '<text class="t1" x="-1.1" y="-0.06">КВ. ' + a.no + '</text>' +
        '<text class="t2" x="-1.1" y="0.34">' + G.n(st.total) + ' м² · ' + st.roomsCount + '-комн.</text>' +
      '</g>';
    });
    return s + '</g>';
  }

  /* ══ Оси ═══════════════════════════════════════════════════════════════ */
  function layerAxes(data) {
    var W = data.size.W, D = data.size.D, ext = 2.6;
    var s = '<g class="lyr" data-layer="axes">';
    data.axes.x.forEach(function (ax) {
      s += '<line class="axis" x1="' + ax.v + '" y1="' + (-ext) + '" x2="' + ax.v + '" y2="' + (D + ext) + '"/>' +
           '<g class="axis-bubble"><circle cx="' + ax.v + '" cy="' + (D + ext + 0.62) + '" r="0.55"/>' +
           '<text x="' + ax.v + '" y="' + (D + ext + 0.82) + '">' + esc(ax.label) + '</text></g>';
    });
    data.axes.y.forEach(function (ax) {
      s += '<line class="axis" x1="' + (-ext) + '" y1="' + ax.v + '" x2="' + (W + ext) + '" y2="' + ax.v + '"/>' +
           '<g class="axis-bubble"><circle cx="' + (-ext - 0.62) + '" cy="' + ax.v + '" r="0.55"/>' +
           '<text x="' + (-ext - 0.62) + '" y="' + (ax.v + 0.2) + '">' + esc(ax.label) + '</text></g>';
    });
    return s + '</g>';
  }

  /* ══ Размеры ═══════════════════════════════════════════════════════════ */
  function dimLine(x1, y1, x2, y2, text, opts) {
    opts = opts || {};
    var vert = Math.abs(x1 - x2) < 1e-6;
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var tk = 0.22;
    var s = '<g class="dim">';
    /* выносные линии */
    if (opts.ext) {
      if (vert) {
        s += '<line class="dim-ext" x1="' + (x1 + opts.ext) + '" y1="' + y1 + '" x2="' + (x1 - 0.3) + '" y2="' + y1 + '"/>' +
             '<line class="dim-ext" x1="' + (x2 + opts.ext) + '" y1="' + y2 + '" x2="' + (x2 - 0.3) + '" y2="' + y2 + '"/>';
      } else {
        s += '<line class="dim-ext" x1="' + x1 + '" y1="' + (y1 + opts.ext) + '" x2="' + x1 + '" y2="' + (y1 - 0.3) + '"/>' +
             '<line class="dim-ext" x1="' + x2 + '" y1="' + (y2 + opts.ext) + '" x2="' + x2 + '" y2="' + (y2 - 0.3) + '"/>';
      }
    }
    s += '<line class="dim-line" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
    /* архитектурные засечки 45° */
    s += '<line class="dim-tick" x1="' + (x1 - tk) + '" y1="' + (y1 + tk) + '" x2="' + (x1 + tk) + '" y2="' + (y1 - tk) + '"/>' +
         '<line class="dim-tick" x1="' + (x2 - tk) + '" y1="' + (y2 + tk) + '" x2="' + (x2 + tk) + '" y2="' + (y2 - tk) + '"/>';
    if (text) {
      s += vert
        ? '<text class="dim-txt" transform="translate(' + (mx - 0.28) + ',' + my + ') rotate(-90)">' + esc(text) + '</text>'
        : '<text class="dim-txt" x="' + mx + '" y="' + (my - 0.28) + '">' + esc(text) + '</text>';
    }
    return s + '</g>';
  }

  function layerDims(data) {
    var W = data.size.W, D = data.size.D, s = '<g class="lyr" data-layer="dims">';
    var dx = data.dims;

    /* габарит */
    s += dimLine(0, dx.xOverall.y, W, dx.xOverall.y, G.mm(W), { ext: dx.xOverall.y });
    s += dimLine(dx.yOverall.x, 0, dx.yOverall.x, D, G.mm(D), { ext: dx.yOverall.x });

    /* цепи по осям */
    var i;
    for (i = 1; i < data.axes.x.length; i++) {
      var a0 = data.axes.x[i - 1], a1 = data.axes.x[i];
      s += dimLine(a0.v, dx.xAxis.y, a1.v, dx.xAxis.y, G.mm(a1.v - a0.v), {});
    }
    for (i = 1; i < data.axes.y.length; i++) {
      var b0 = data.axes.y[i - 1], b1 = data.axes.y[i];
      s += dimLine(dx.yAxis.x, b0.v, dx.yAxis.x, b1.v, G.mm(b1.v - b0.v), {});
    }
    return s + '</g>';
  }

  /* ══ Аннотации: север, масштаб, отметка уровня ═════════════════════════ */
  function layerAnnot(data) {
    var W = data.size.W, D = data.size.D;
    var s = '<g class="lyr" data-layer="annot">';

    /* роза / север */
    var nx = W + 3.4, ny = 1.2;
    s += '<g class="north" transform="translate(' + nx + ',' + ny + ')">' +
      '<circle r="1.15" class="n-ring"/>' +
      '<path class="n-arrow" d="M0,-0.95 L0.34,0.55 L0,0.28 L-0.34,0.55 Z"/>' +
      '<text class="n-lbl" y="-1.45">С</text></g>';

    /* масштабная линейка */
    var sx = -6.4, sy = D + 4.5, seg = 2;
    s += '<g class="scalebar" transform="translate(' + sx + ',' + sy + ')">';
    for (var i = 0; i < 5; i++) {
      s += '<rect x="' + (i * seg) + '" y="0" width="' + seg + '" height="0.34" class="' + (i % 2 ? 'sb-w' : 'sb-b') + '"/>';
    }
    s += '<rect x="0" y="0" width="' + (seg * 5) + '" height="0.34" class="sb-frame"/>';
    for (i = 0; i <= 5; i++) {
      s += '<text class="sb-lbl" x="' + (i * seg) + '" y="-0.22">' + (i * seg) + '</text>';
    }
    s += '<text class="sb-lbl" x="' + (seg * 5 + 0.3) + '" y="0.28">м</text>';
    s += '<text class="sb-title" x="0" y="0.95">Масштаб 1:100</text></g>';

    /* отметка уровня */
    s += '<g class="level" transform="translate(' + (W + 1.9) + ',' + (D + 1.9) + ')">' +
      '<path class="lvl-tri" d="M0,0 L0.7,0 L0.35,-0.42 Z"/>' +
      '<line class="lvl-line" x1="-0.5" y1="0" x2="1.6" y2="0"/>' +
      '<text class="lvl-txt" x="0" y="-0.6">' + esc(data.meta.level) + '</text></g>';

    /* указатель разреза */
    s += '<g class="section-mark" transform="translate(12,' + (D + 1.55) + ')">' +
      '<circle r="0.62" class="sm-ring"/><text class="sm-txt" y="0.22">1</text></g>';
    s += '<g class="section-mark" transform="translate(12,-1.55)">' +
      '<circle r="0.62" class="sm-ring"/><text class="sm-txt" y="0.22">1</text></g>';
    s += '<line class="section-line" x1="12" y1="-0.9" x2="12" y2="0.2"/>';
    s += '<line class="section-line" x1="12" y1="' + (D - 0.2) + '" x2="12" y2="' + (D + 0.9) + '"/>';

    return s + '</g>';
  }

  /* ══ Примечания на листе ═══════════════════════════════════════════════ */
  function layerNotes(data) {
    var D = data.size.D;
    var s = '<g class="lyr" data-layer="notes">';
    s += '<text class="notes-title" x="-6.4" y="' + (D + 6.5) + '">Примечания</text>';
    data.notes.forEach(function (t, i) {
      s += '<text class="note" x="-6.4" y="' + (D + 7.0 + i * 0.5) + '">' + (i + 1) + '. ' + esc(t) + '</text>';
    });
    return s + '</g>';
  }

  /* ══ Штамп листа (вложенный SVG в бумажных миллиметрах) ════════════════ */
  function layerStamp(data) {
    var W = data.size.W, D = data.size.D;
    var w = 13.2, h = w * 45 / 185;
    var x = W + 2.2 - w + 3.0, y = D + 4.6;
    var m = data.meta;
    function cell(cx, cy, cw, ch, txt, cls) {
      return '<rect x="' + cx + '" y="' + cy + '" width="' + cw + '" height="' + ch + '" class="st-cell"/>' +
             '<text x="' + (cx + 1.6) + '" y="' + (cy + ch / 2 + 1.1) + '" class="st-txt ' + (cls || '') + '">' + esc(txt) + '</text>';
    }
    var inner =
      '<rect x="0" y="0" width="185" height="45" class="st-frame"/>' +
      '<rect x="0" y="0" width="185" height="17" class="st-zone"/>' +
      '<text x="4" y="7.4" class="st-title">' + esc(m.drawing) + '</text>' +
      '<text x="4" y="13.2" class="st-sub">' + esc(m.floorNote) + ' · отм. ' + esc(m.level) + ' · масштаб ' + esc(m.scale) + '</text>' +
      '<line x1="128" y1="0" x2="128" y2="17" class="st-line"/>' +
      '<text x="132" y="7" class="st-k">Лист</text><text x="132" y="14" class="st-v">1</text>' +
      '<text x="156" y="7" class="st-k">Листов</text><text x="156" y="14" class="st-v">12</text>' +
      /* строки */
      cell(0, 17, 62, 7, m.project, 'b') +
      cell(0, 24, 62, 7, m.corp, '') +
      cell(0, 31, 62, 14, m.stage, 'sm2') +
      cell(62, 17, 40, 7, 'Шифр 05-26-АР', '') +
      cell(62, 24, 40, 7, 'Стадия  П', '') +
      cell(62, 31, 40, 14, m.address, 'sm2') +
      cell(102, 17, 40, 7, m.author, 'sm2') +
      cell(102, 24, 40, 7, m.checker, 'sm2') +
      cell(102, 31, 40, 14, 'Нормоконтроль: ____________', 'sm2') +
      cell(142, 17, 43, 7, m.sheet + ' · План типового этажа', 'b sm2') +
      cell(142, 24, 43, 7, 'Дата ' + m.date, '') +
      cell(142, 31, 43, 14, 'Подп. и дата ____________', 'sm2');

    return '<g class="lyr" data-layer="stamp">' +
      '<svg x="' + x.toFixed(3) + '" y="' + y.toFixed(3) + '" width="' + w.toFixed(3) + '" height="' + h.toFixed(3) +
      '" viewBox="0 0 185 45" preserveAspectRatio="none">' + inner + '</svg></g>';
  }

  /* ══ Сборка чертежа ════════════════════════════════════════════════════ */
  R.stats = function (data) {
    var byApt = {}, roomsMap = roomById(data);
    data.rooms.forEach(function (r) {
      var a = byApt[r.apt] || (byApt[r.apt] = {
        apt: r.apt, rooms: [], total: 0, living: 0, kitchen: 0, wet: 0, circ: 0,
        roomsCount: 0, outdoor: 0, outdoorAdj: 0, bbox: null, tag: [0, 0], windows: {}
      });
      var p = G.poly(r), area = G.area(p);
      a.rooms.push({ id: r.id, name: r.name, area: area, zone: r.zone, note: r.note });
      a.total += area;
      if (r.zone === 'living') { a.living += area; a.roomsCount++; }
      if (r.zone === 'kitchen') { a.kitchen += area; if (/гостиная/i.test(r.name)) a.roomsCount++; }
      if (r.zone === 'wet') a.wet += area;
      if (r.zone === 'circ') a.circ += area;
      var b = G.bbox(p);
      a.bbox = a.bbox ? {
        x: Math.min(a.bbox.x, b.x), y: Math.min(a.bbox.y, b.y),
        x2: Math.max(a.bbox.x2, b.x2), y2: Math.max(a.bbox.y2, b.y2)
      } : { x: b.x, y: b.y, x2: b.x2, y2: b.y2 };
    });
    data.balconies.forEach(function (b) {
      var a = byApt[b.apt];
      if (!a) return;
      var area = G.area(G.poly(b));
      a.outdoor += area;
      a.outdoorAdj += area * (b.coeff || 0.3);
      a.rooms.push({ id: b.id, name: b.name, area: area, zone: 'outdoor', coeff: b.coeff, outdoor: true });
    });
    /* окна по сторонам света */
    data.openings.forEach(function (o) {
      if (o.kind !== 'window') return;
      var f = facadeOf(data, o.seg);
      if (!f || !byApt[o.apt]) return;
      byApt[o.apt].windows[f] = (byApt[o.apt].windows[f] || 0) + G.segLen(o.seg);
    });
    /* место для бирки квартиры — у входной двери, со смещением внутрь */
    data.apartments.forEach(function (ap) {
      var a = byApt[ap.id];
      if (!a) return;
      var door = data.openings.filter(function (o) {
        return o.kind === 'door' && o.apt === ap.id && /входная/.test(o.label || '');
      })[0];
      if (door) {
        var mid = [(door.seg[0][0] + door.seg[1][0]) / 2, (door.seg[0][1] + door.seg[1][1]) / 2];
        var cx = (a.bbox.x + a.bbox.x2) / 2, cy = (a.bbox.y + a.bbox.y2) / 2;
        var dx = cx - mid[0], dy = cy - mid[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
        a.tag = [mid[0] + dx / L * 2.3, mid[1] + dy / L * 2.3];
      } else {
        a.tag = [(a.bbox.x + a.bbox.x2) / 2, (a.bbox.y + a.bbox.y2) / 2];
      }
      a.totalAdj = a.total + a.outdoorAdj;
    });
    return { byApt: byApt, roomsMap: roomsMap };
  };

  R.build = function (data, opts) {
    opts = opts || {};
    var st = opts.stats || R.stats(data);
    var W = data.size.W, D = data.size.D;
    var parts = [];

    parts.push(defs(data));
    if (opts.layers && opts.layers.paper === 0 && opts.noPaper) { /* пропуск */ }
    parts.push(layerPaper(data, opts));
    parts.push(layerOutdoor(data));
    parts.push(layerFills(data));
    parts.push(layerWalls(data));
    parts.push(layerOpenings(data));
    parts.push(layerStairs(data));
    parts.push(layerLifts(data));
    parts.push(layerFurniture(data));
    parts.push(layerRisers(data));
    var lb = layerLabels(data, { chips: aptChipRects(data, st) });
    parts.push(lb);
    parts.push(layerAptMarks(data, st));
    parts.push(layerAxes(data));
    parts.push(layerDims(data));
    parts.push(layerAnnot(data));
    parts.push(layerNotes(data));
    parts.push(layerStamp(data));

    /* интерактивный слой поверх всего */
    parts.push('<g class="lyr hit" data-layer="hit">' + data.rooms.map(function (r) {
      return '<polygon class="hit-room" data-id="' + r.id + '" data-apt="' + r.apt + '" points="' + polyPts(G.poly(r)) + '"/>';
    }).join('') + '</g>');

    var vb = { x: -8.2, y: -6.4, w: W + 14.2, h: D + 16.4 };
    if (opts.viewBox) vb = opts.viewBox;

    return {
      svg: '<svg class="plan-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' +
           vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h + '" preserveAspectRatio="xMidYMid meet">' + parts.join('') + '</svg>',
      viewBox: vb,
      stats: st,
      sheet: { x: -8.2, y: -6.4, w: W + 14.2, h: D + 16.4 },
      plan: { x: -5.6, y: -5.4, w: W + 11.2, h: D + 11.4 }
    };
  };

  /* мини-план отдельной квартиры / ядра */
  R.buildScope = function (data, box, opts) {
    opts = opts || {};
    var pad = opts.pad == null ? 1.2 : opts.pad;
    var vb = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
    var out = R.build(data, { viewBox: vb, stats: opts.stats });
    return out;
  };

  R.APT_COLOR = APT_COLOR;
  R.DEFAULT_LAYERS = DEFAULT_LAYERS;
  R.facadeOf = facadeOf;

  global.PLAN = R;
})(typeof window !== 'undefined' ? window : globalThis);
