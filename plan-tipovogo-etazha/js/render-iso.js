/* ============================================================================
 *  render-iso.js — аксонометрия типового этажа и объёмная схема здания
 *  Проекция: x' = (x − y)·cos30°,  y' = (x + y)·sin30° − z
 * ==========================================================================*/
(function (global) {
  'use strict';

  var G = global.GEO;
  var ISO = {};
  var C30 = Math.cos(Math.PI / 6), S30 = Math.sin(Math.PI / 6);

  function proj(x, y, z, k) {
    return [((x - y) * C30) * k, (((x + y) * S30) - z) * k];
  }
  function polyProj(p, z, k) { return p.map(function (q) { return proj(q[0], q[1], z, k); }); }
  function pts(p) { return p.map(function (q) { return q[0].toFixed(2) + ',' + q[1].toFixed(2); }).join(' '); }
  function shade(base, f) {
    /* base = [r,g,b], f — множитель яркости */
    return 'rgb(' + Math.min(255, Math.round(base[0] * f)) + ',' +
                    Math.min(255, Math.round(base[1] * f)) + ',' +
                    Math.min(255, Math.round(base[2] * f)) + ')';
  }

  var WALL_BASE = [228, 232, 236];
  var TOP_BASE  = [248, 250, 251];
  var SLAB_BASE = [196, 203, 210];

  /* известные осевые линии стен (фасад / межквартирные) */
  function thickFor(data, edge, outward) {
    var lines = { x: [0, data.size.W, 8.4, 15.6], y: [0, data.size.D, 8.4] };
    var a = edge[0], b = edge[1];
    var vert = Math.abs(a[0] - b[0]) < 1e-6;
    if (vert) {
      var cx = a[0] + outward[0] * 0.2;
      for (var i = 0; i < lines.x.length; i++) if (Math.abs(cx - lines.x[i]) < 0.06) return { t: 0.4, shift: 0.2 };
      return { t: 0.2, shift: 0 };
    }
    var cy = a[1] + outward[1] * 0.2;
    for (var j = 0; j < lines.y.length; j++) if (Math.abs(cy - lines.y[j]) < 0.06) return { t: 0.4, shift: 0.2 };
    return { t: 0.2, shift: 0 };
  }

  function wallBoxes(data) {
    var out = [];
    data.rooms.forEach(function (r) {
      var p = G.poly(r);
      var c = G.centroid(p);
      for (var i = 0; i < p.length; i++) {
        var a = p[i], b = p[(i + 1) % p.length];
        var dx = b[0] - a[0], dy = b[1] - a[1];
        var L = Math.sqrt(dx * dx + dy * dy);
        if (L < 0.05) continue;
        var nx = -dy / L, ny = dx / L;
        var mx = (a[0] + b[0]) / 2 - c[0], my = (a[1] + b[1]) / 2 - c[1];
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }        /* наружу */
        var th = thickFor(data, [a, b], [nx, ny]);
        var ox = nx * th.shift, oy = ny * th.shift;
        var h = th.t / 2;
        out.push({
          room: r,
          quad: [[a[0] + nx * h + ox, a[1] + ny * h + oy], [b[0] + nx * h + ox, b[1] + ny * h + oy],
                 [b[0] - nx * h + ox, b[1] - ny * h + oy], [a[0] - nx * h + ox, a[1] - ny * h + oy]],
          n: [nx, ny],
          depth: (a[0] + b[0]) / 2 + (a[1] + b[1]) / 2
        });
      }
    });
    return out;
  }

  /* ══ Аксонометрия этажа ════════════════════════════════════════════════ */
  ISO.build = function (data, opts) {
    opts = opts || {};
    var k = opts.k || 1;
    var H = opts.wallHeight == null ? 1.5 : opts.wallHeight;   /* «кукольный домик»: рез стен на 1,5 м */
    var Hc = data.building.clearHeight;
    var st = opts.stats || global.PLAN.stats(data);
    var outline = [[0, 0], [data.size.W, 0], [data.size.W, data.size.D], [0, data.size.D]];
    var items = [], i;

    /* полы помещений */
    data.rooms.forEach(function (r) {
      var z = data.zones[r.zone] || { fill: '#eee' };
      items.push({ depth: -1000, html:
        '<polygon class="iso-floor" points="' + pts(polyProj(G.poly(r), 0.06, k)) + '" fill="' + z.fill + '"/>' });
    });

    /* плита перекрытия */
    var top = polyProj(outline, 0, k);
    items.push({ depth: -1200, html: '<polygon class="iso-slab-top" points="' + pts(top) + '"/>' });
    var SL = 0.32;
    for (i = 0; i < outline.length; i++) {
      var a = outline[i], b = outline[(i + 1) % outline.length];
      var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy);
      var nx = dy / L, ny = -dx / L;
      if (nx + ny < 0) { nx = -nx; ny = -ny; }
      var q = [[a[0], a[1]], [b[0], b[1]], [b[0], b[1], ], [a[0], a[1]]];
      var p1 = proj(a[0], a[1], 0, k), p2 = proj(b[0], b[1], 0, k);
      var p3 = proj(b[0], b[1], -SL, k), p4 = proj(a[0], a[1], -SL, k);
      items.push({ depth: -900 + (a[0] + a[1] + b[0] + b[1]) / 4, html:
        '<polygon class="iso-slab-side" points="' + pts([p1, p2, p3, p4]) + '" fill="' + shade(SLAB_BASE, 0.72 + 0.28 * ((nx + ny) / 2)) + '"/>' });
    }

    /* лоджии и балконы: плита + ограждение */
    data.balconies.forEach(function (b) {
      var p = G.poly(b);
      items.push({ depth: -800, html: '<polygon class="iso-bal" points="' + pts(polyProj(p, 0.02, k)) + '"/>' });
      for (i = 0; i < p.length; i++) {
        var q1 = p[i], q2 = p[(i + 1) % p.length];
        var mid = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2];
        if (G.inPoly(mid, outline)) continue;                 /* грань к зданию */
        var t1 = proj(q1[0], q1[1], 0, k), t2 = proj(q2[0], q2[1], 0, k);
        var t3 = proj(q2[0], q2[1], 1.15, k), t4 = proj(q1[0], q1[1], 1.15, k);
        items.push({ depth: (q1[0] + q1[1] + q2[0] + q2[1]) / 4, html:
          '<polygon class="iso-rail" points="' + pts([t1, t2, t3, t4]) + '"/>' });
      }
    });

    /* стены */
    var boxes = wallBoxes(data);
    boxes.forEach(function (w) {
      var q = w.quad;
      var nx = w.n[0], ny = w.n[1];
      var lum = 0.70 + 0.30 * ((nx + ny) / Math.SQRT2);
      var topP = polyProj(q, H, k);
      var html = '';
      /* две боковые грани — рисуем только видимые (нормаль к зрителю) */
      for (var e = 0; e < 4; e++) {
        var a = q[e], b = q[(e + 1) % 4];
        var ex = b[0] - a[0], ey = b[1] - a[1], EL = Math.sqrt(ex * ex + ey * ey);
        if (EL < 0.02) continue;
        var fnx = -ey / EL, fny = ex / EL;
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        var cmx = (q[0][0] + q[2][0]) / 2, cmy = (q[0][1] + q[2][1]) / 2;
        if (fnx * (mx - cmx) + fny * (my - cmy) < 0) { fnx = -fnx; fny = -fny; }
        if (fnx + fny <= 0.02) continue;
        var s1 = proj(a[0], a[1], H, k), s2 = proj(b[0], b[1], H, k);
        var s3 = proj(b[0], b[1], 0, k), s4 = proj(a[0], a[1], 0, k);
        html += '<polygon class="iso-wall-face" points="' + pts([s1, s2, s3, s4]) + '" fill="' + shade(WALL_BASE, lum) + '"/>';
      }
      html += '<polygon class="iso-wall-top" points="' + pts(topP) + '" fill="' + shade(TOP_BASE, 0.94) + '"/>';
      items.push({ depth: w.depth, html: html });
    });

    /* лестничная клетка — объём лестничной шахты поверх резаных стен */
    data.stairs.forEach(function (s) {
      var p = G.poly(s), i;
      for (i = 0; i < p.length; i++) {
        var a = p[i], b = p[(i + 1) % p.length];
        var q = [proj(a[0], a[1], H, k), proj(b[0], b[1], H, k), proj(b[0], b[1], Hc + 0.3, k), proj(a[0], a[1], Hc + 0.3, k)];
        items.push({ depth: (a[0] + b[0] + a[1] + b[1]) / 2 + 0.6, html:
          '<polygon class="iso-core-side" points="' + pts(q) + '"/>' });
      }
      items.push({ depth: 1e5, html:
        '<polygon class="iso-core" points="' + pts(polyProj(p, Hc + 0.3, k)) + '"/>' });
    });

    /* бирки квартир поверх */
    data.apartments.forEach(function (ap) {
      var a = st.byApt[ap.id];
      if (!a) return;
      var base = proj(a.tag[0], a.tag[1], 0, k);
      var topPt = proj(a.tag[0], a.tag[1], H + 1.9, k);
      var col = global.PLAN.APT_COLOR[ap.id];
      items.push({ depth: 1e6, html:
        '<g class="iso-tag">' +
        '<line x1="' + base[0].toFixed(2) + '" y1="' + base[1].toFixed(2) + '" x2="' + topPt[0].toFixed(2) + '" y2="' + topPt[1].toFixed(2) + '" stroke="' + col + '" stroke-width="0.07"/>' +
        '<circle cx="' + base[0].toFixed(2) + '" cy="' + base[1].toFixed(2) + '" r="0.16" fill="' + col + '"/>' +
        '<rect x="' + (topPt[0] - 1.5).toFixed(2) + '" y="' + (topPt[1] - 0.62).toFixed(2) + '" width="3" height="1.24" rx="0.62" fill="' + col + '"/>' +
        '<text x="' + (topPt[0] - 1.1).toFixed(2) + '" y="' + (topPt[1] - 0.08).toFixed(2) + '" class="iso-t1">КВ. ' + ap.no + '</text>' +
        '<text x="' + (topPt[0] - 1.1).toFixed(2) + '" y="' + (topPt[1] + 0.4).toFixed(2) + '" class="iso-t2">' + G.n(a.total) + ' м²</text>' +
        '</g>' });
    });

    items.sort(function (x, y) { return x.depth - y.depth; });

    /* габарит viewBox */
    var all = polyProj(outline, 0, k).concat(polyProj(outline, H + 3.2, k), polyProj(outline, -0.4, k));
    var bb = G.bbox(all);
    var pad = 2.5;
    var vb = { x: bb.x - pad, y: bb.y - pad, w: bb.w + pad * 2, h: bb.h + pad * 2 };

    return {
      svg: '<svg class="plan-svg iso-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' +
        vb.x.toFixed(2) + ' ' + vb.y.toFixed(2) + ' ' + vb.w.toFixed(2) + ' ' + vb.h.toFixed(2) +
        '" preserveAspectRatio="xMidYMid meet">' +
        '<defs><filter id="iso-blur" x="-30%" y="-30%" width="160%" height="160%">' +
        '<feGaussianBlur stdDeviation="0.55"/></filter></defs>' +
        '<polygon class="iso-shadow" filter="url(#iso-blur)" points="' + pts(polyProj(outline, -0.42, k)) + '"/>' +
        items.map(function (it) { return it.html; }).join('') +
        '</svg>',
      viewBox: vb
    };
  };

  /* ══ Объёмная схема здания (для первого экрана) ════════════════════════ */
  ISO.massing = function (data, opts) {
    opts = opts || {};
    var k = opts.k || 1;
    var n = data.building.floorsAbove;
    var h = data.building.floorHeight;
    var hi = opts.highlight == null ? 6 : opts.highlight;      /* номер типового этажа */
    var outline = [[0, 0], [data.size.W, 0], [data.size.W, data.size.D], [0, data.size.D]];
    var s = [], i;

    /* стилобат / земля */
    var gnd = [[-4, -4], [data.size.W + 4, -4], [data.size.W + 4, data.size.D + 4], [-4, data.size.D + 4]];
    s.push('<polygon class="ms-ground" points="' + pts(polyProj(gnd, -0.6, k)) + '"/>');
    s.push('<polygon class="ms-shadow" filter="url(#ms-blur)" points="' + pts(polyProj(outline, -0.5, k)) + '"/>');

    for (i = 1; i <= n; i++) {
      var z = (i - 1) * h;
      var isHi = (i === hi);
      var top = polyProj(outline, z + h - 0.35, k);
      var bot = polyProj(outline, z, k);
      /* боковые грани */
      for (var e = 0; e < outline.length; e++) {
        var a = outline[e], b = outline[(e + 1) % outline.length];
        var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy);
        var nx = dy / L, ny = -dx / L;
        if (nx + ny < 0) { nx = -nx; ny = -ny; }
        if (nx + ny <= 0.02) continue;
        var p1 = proj(a[0], a[1], z + h - 0.35, k), p2 = proj(b[0], b[1], z + h - 0.35, k);
        var p3 = proj(b[0], b[1], z, k), p4 = proj(a[0], a[1], z, k);
        s.push('<polygon class="ms-face' + (isHi ? ' hi' : '') + '" points="' + pts([p1, p2, p3, p4]) +
               '" fill="' + shade(isHi ? [255, 176, 60] : [214, 221, 228], 0.7 + 0.3 * ((nx + ny) / 2)) + '"/>');
      }
      s.push('<polygon class="ms-top' + (isHi ? ' hi' : '') + '" points="' + pts(top) + '" stroke="' + (isHi ? '#e08a1e' : '#93a2b1') + '"/>');
      if (isHi) {
        s.push('<polygon class="ms-hi-floor" points="' + pts(bot) + '"/>');
      }
    }

    /* выноска к типовому этажу */
    var z = (hi - 1) * h + h / 2;
    var anchor = proj(data.size.W, data.size.D * 0.55, z, k);
    var lead = [anchor[0] + 5.5 * k, anchor[1] - 1.0 * k];
    s.push('<g class="ms-callout">' +
      '<line x1="' + anchor[0].toFixed(2) + '" y1="' + anchor[1].toFixed(2) + '" x2="' + lead[0].toFixed(2) + '" y2="' + lead[1].toFixed(2) + '"/>' +
      '<line x1="' + lead[0].toFixed(2) + '" y1="' + lead[1].toFixed(2) + '" x2="' + (lead[0] + 3.5 * k).toFixed(2) + '" y2="' + lead[1].toFixed(2) + '"/>' +
      '<circle cx="' + anchor[0].toFixed(2) + '" cy="' + anchor[1].toFixed(2) + '" r="0.28"/>' +
      '<text x="' + (lead[0] + 3.8 * k).toFixed(2) + '" y="' + (lead[1] - 0.7 * k).toFixed(2) + '" class="ms-t1">ТИПОВОЙ ЭТАЖ</text>' +
      '<text x="' + (lead[0] + 3.8 * k).toFixed(2) + '" y="' + (lead[1] + 1.1 * k).toFixed(2) + '" class="ms-t2">' +
        hi + '–й этаж · отм. +' + ((hi - 1) * h).toFixed(2).replace('.', ',') + ' м</text>' +
    '</g>');

    /* отметки верха и низа */
    s.push('<g class="ms-marks">' +
      '<text class="ms-m" x="' + (proj(data.size.W, 0, n * h, k)[0] + 1.2).toFixed(2) + '" y="' + (proj(data.size.W, 0, n * h, k)[1] + 0.3).toFixed(2) + '">+' + (n * h).toFixed(1).replace('.', ',') + '</text>' +
      '<text class="ms-m" x="' + (proj(data.size.W, 0, 0, k)[0] + 1.2).toFixed(2) + '" y="' + (proj(data.size.W, 0, 0, k)[1] + 0.3).toFixed(2) + '">±0,000</text>' +
    '</g>');

    var all = polyProj(gnd, -0.6, k).concat(polyProj(outline, n * h + 1, k));
    var bb = G.bbox(all);
    var pad = 3;
    var vb = { x: bb.x - pad, y: bb.y - pad, w: bb.w + pad * 2 + 15 * k, h: bb.h + pad * 2 };

    return '<svg class="massing-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' +
      vb.x.toFixed(2) + ' ' + vb.y.toFixed(2) + ' ' + vb.w.toFixed(2) + ' ' + vb.h.toFixed(2) +
      '" preserveAspectRatio="xMidYMid meet">' +
      '<defs><filter id="ms-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="0.7"/></filter>' +
      '<linearGradient id="ms-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/>' +
      '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>' +
      s.join('') + '</svg>';
  };

  global.ISO = ISO;
})(typeof window !== 'undefined' ? window : globalThis);
