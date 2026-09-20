/* ============================================================================
 *  geometry.js — утилиты плоской геометрии и форматирования
 * ==========================================================================*/
(function (global) {
  'use strict';

  var G = {};

  G.rectToPoly = function (r) {
    return [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]];
  };

  G.poly = function (obj) {
    if (obj.poly) return obj.poly;
    if (obj.rect) return G.rectToPoly(obj.rect);
    return [];
  };

  G.area = function (p) {
    var s = 0, i, n = p.length;
    for (i = 0; i < n; i++) {
      var a = p[i], b = p[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  };

  G.bbox = function (p) {
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    p.forEach(function (q) {
      if (q[0] < minx) minx = q[0];
      if (q[1] < miny) miny = q[1];
      if (q[0] > maxx) maxx = q[0];
      if (q[1] > maxy) maxy = q[1];
    });
    return { x: minx, y: miny, w: maxx - minx, h: maxy - miny, x2: maxx, y2: maxy };
  };

  G.centroid = function (p) {
    var cx = 0, cy = 0, a = 0, i, n = p.length;
    for (i = 0; i < n; i++) {
      var q = p[i], r = p[(i + 1) % n];
      var f = q[0] * r[1] - r[0] * q[1];
      a += f; cx += (q[0] + r[0]) * f; cy += (q[1] + r[1]) * f;
    }
    if (Math.abs(a) < 1e-9) { var b = G.bbox(p); return [b.x + b.w / 2, b.y + b.h / 2]; }
    a *= 0.5;
    return [cx / (6 * a), cy / (6 * a)];
  };

  /* «визуальный» центр: для L-образных помещений центр тяжести может
     выпасть за пределы полигона — тогда берём центр вписанного прямоугольника */
  G.labelPoint = function (p) {
    var c = G.centroid(p);
    if (G.inPoly(c, p)) return c;
    var b = G.bbox(p);
    var best = null, bestA = 0;
    /* перебор сеткой — ищем самую удалённую от граней точку */
    for (var i = 1; i < 12; i++) {
      for (var j = 1; j < 12; j++) {
        var x = b.x + b.w * i / 12, y = b.y + b.h * j / 12;
        if (!G.inPoly([x, y], p)) continue;
        var d = G.distToPoly([x, y], p);
        if (d > bestA) { bestA = d; best = [x, y]; }
      }
    }
    return best || c;
  };

  G.inPoly = function (pt, p) {
    var x = pt[0], y = pt[1], inside = false, n = p.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  G.distToSeg = function (p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var wx = p[0] - a[0], wy = p[1] - a[1];
    var l2 = vx * vx + vy * vy;
    var t = l2 ? (wx * vx + wy * vy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var dx = a[0] + t * vx - p[0], dy = a[1] + t * vy - p[1];
    return Math.sqrt(dx * dx + dy * dy);
  };

  G.distToPoly = function (p, poly) {
    var d = Infinity, n = poly.length;
    for (var i = 0; i < n; i++) {
      d = Math.min(d, G.distToSeg(p, poly[i], poly[(i + 1) % n]));
    }
    return d;
  };

  G.segLen = function (s) {
    var dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1];
    return Math.sqrt(dx * dx + dy * dy);
  };

  /* ── форматирование ──────────────────────────────────────────────────── */
  G.n = function (v, digits) {
    if (digits === undefined) digits = 1;
    var s = v.toFixed(digits).replace('.', ',');
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };
  G.mm = function (meters) {
    return Math.round(meters * 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  /* ── изометрическая проекция ─────────────────────────────────────────── */
  /* x' = (x − y)·cos30°,  y' = (x + y)·sin30° − z                          */
  G.iso = function (x, y, z, k) {
    k = k || 1;
    var c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    return [(x - y) * c * k, ((x + y) * s - (z || 0)) * k];
  };

  G.polyStr = function (p, digits) {
    var d = digits === undefined ? 3 : digits;
    return p.map(function (q) { return q[0].toFixed(d) + ',' + q[1].toFixed(d); }).join(' ');
  };

  global.GEO = G;
})(typeof window !== 'undefined' ? window : globalThis);
