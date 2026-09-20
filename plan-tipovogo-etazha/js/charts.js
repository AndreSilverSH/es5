/* ============================================================================
 *  charts.js — лёгкие SVG-диаграммы без зависимостей
 * ==========================================================================*/
(function (global) {
  'use strict';

  var G = global.GEO;
  var C = {};

  function polar(cx, cy, r, ang) {
    var a = (ang - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arcPath(cx, cy, r1, r2, a0, a1) {
    var p0 = polar(cx, cy, r2, a0), p1 = polar(cx, cy, r2, a1);
    var p2 = polar(cx, cy, r1, a1), p3 = polar(cx, cy, r1, a0);
    var large = (a1 - a0) > 180 ? 1 : 0;
    return 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) +
           'A' + r2 + ',' + r2 + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2) +
           'L' + p2[0].toFixed(2) + ',' + p2[1].toFixed(2) +
           'A' + r1 + ',' + r1 + ' 0 ' + large + ' 0 ' + p3[0].toFixed(2) + ',' + p3[1].toFixed(2) + 'Z';
  }

  /* ── кольцевая диаграмма ─────────────────────────────────────────────── */
  C.donut = function (items, opts) {
    opts = opts || {};
    var W = 100, H = 100, cx = 50, cy = 50, r2 = 42, r1 = opts.inner || 27;
    var total = items.reduce(function (s, i) { return s + i.value; }, 0) || 1;
    var a = -0.6, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart donut">';
    items.forEach(function (it) {
      var sweep = it.value / total * 360;
      var a1 = a + Math.max(sweep - 1.1, 0.35);
      s += '<path d="' + arcPath(cx, cy, r1, r2, a, a1) + '" fill="' + it.color + '" class="seg">' +
           '<title>' + it.label + ' — ' + G.n(it.value) + ' м² (' + Math.round(it.value / total * 100) + '%)</title></path>';
      a += sweep;
    });
    s += '<text class="c-big" x="50" y="48">' + G.n(total) + '</text>';
    s += '<text class="c-small" x="50" y="58">' + (opts.unit || 'м²') + '</text>';
    if (opts.caption) s += '<text class="c-cap" x="50" y="70">' + opts.caption + '</text>';
    return s + '</svg>';
  };

  /* ── горизонтальные полосы ───────────────────────────────────────────── */
  C.bars = function (items, opts) {
    opts = opts || {};
    var rowH = opts.rowH || 17, W = 100;
    var H = items.length * rowH + 8;
    var max = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    var lx = opts.labelW || 30, bw = W - lx - 16;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart bars">';
    items.forEach(function (it, i) {
      var y = i * rowH + 6;
      var w = Math.max(it.value / max * bw, 0.8);
      s += '<text class="b-lbl" x="' + (lx - 2) + '" y="' + (y + rowH * 0.52) + '">' + it.label + '</text>';
      s += '<rect class="b-track" x="' + lx + '" y="' + y + '" width="' + bw + '" height="' + (rowH * 0.62) + '" rx="2"/>';
      s += '<rect class="b-fill" x="' + lx + '" y="' + y + '" width="' + w.toFixed(2) + '" height="' + (rowH * 0.62) +
           '" rx="2" fill="' + it.color + '"><title>' + it.label + ': ' + G.n(it.value) + ' м²</title></rect>';
      s += '<text class="b-val" x="' + (lx + w + 2).toFixed(2) + '" y="' + (y + rowH * 0.52) + '">' + G.n(it.value) + '</text>';
    });
    return s + '</svg>';
  };

  /* ── 100 % стековая полоса ───────────────────────────────────────────── */
  C.stack = function (items, opts) {
    opts = opts || {};
    var total = items.reduce(function (s, i) { return s + i.value; }, 0) || 1;
    var x = 0, H = 16;
    var s = '<svg viewBox="0 0 100 34" class="chart stack" preserveAspectRatio="none">';
    items.forEach(function (it, i) {
      var w = it.value / total * 100;
      s += '<rect x="' + x.toFixed(2) + '" y="4" width="' + (w - 0.4).toFixed(2) + '" height="' + H + '" rx="1.6" fill="' + it.color + '">' +
           '<title>' + it.label + ' — ' + G.n(it.value) + ' м² (' + Math.round(it.value / total * 100) + '%)</title></rect>';
      if (w > 8) {
        s += '<text class="s-lbl" x="' + (x + w / 2).toFixed(2) + '" y="15">' + Math.round(it.value / total * 100) + '%</text>';
      }
      x += w;
    });
    return s + '</svg>';
  };

  /* ── роза ориентации окон ────────────────────────────────────────────── */
  C.rose = function (vals, opts) {
    /* vals = {N: м, E: м, S: м, W: м} — суммарная ширина окон по фасадам */
    opts = opts || {};
    var dirs = ['N', 'E', 'S', 'W'];
    var names = { N: 'С', E: 'В', S: 'Ю', W: 'З' };
    var max = Math.max(1, dirs.reduce(function (m, d) { return Math.max(m, vals[d] || 0); }, 0));
    var cx = 50, cy = 52, R = 34;
    var s = '<svg viewBox="0 0 100 104" class="chart rose">';
    [0.33, 0.66, 1].forEach(function (f) {
      s += '<circle class="r-grid" cx="' + cx + '" cy="' + cy + '" r="' + (R * f).toFixed(1) + '"/>';
    });
    dirs.forEach(function (d) {
      var p = polar(cx, cy, R + 5, d === 'N' ? 0 : d === 'E' ? 90 : d === 'S' ? 180 : 270);
      s += '<line class="r-axis" x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(2) + '" y2="' + p[1].toFixed(2) + '"/>';
      s += '<text class="r-lbl" x="' + p[0].toFixed(2) + '" y="' + (p[1] + 2).toFixed(2) + '">' + names[d] + '</text>';
    });
    var ptsArr = dirs.map(function (d, i) {
      var v = (vals[d] || 0) / max;
      return polar(cx, cy, Math.max(R * v, 2.5), i * 90);
    });
    s += '<polygon class="r-poly" points="' + ptsArr.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ') + '"/>';
    ptsArr.forEach(function (p, i) {
      s += '<circle class="r-dot" cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="2.2"/>';
    });
    s += '<text class="r-cap" x="50" y="99">' + (opts.caption || '') + '</text>';
    return s + '</svg>';
  };

  /* ── шкала-полукруг (коэффициент эффективности) ──────────────────────── */
  C.gauge = function (value, opts) {
    opts = opts || {};
    var cx = 50, cy = 58, r = 38;
    var v = Math.max(0, Math.min(1, value));
    var s = '<svg viewBox="0 0 100 76" class="chart gauge">';
    s += '<path d="' + arcPath(cx, cy, r - 11, r, 180, 360) + '" fill="#e6ebf1"/>';
    var col = v >= 0.65 ? '#3f9e63' : v >= 0.55 ? '#e0a02e' : '#d2615c';
    s += '<path d="' + arcPath(cx, cy, r - 11, r, 180, 180 + v * 180) + '" fill="' + col + '"/>';
    /* целевой ориентир 0,65 */
    var t = polar(cx, cy, r + 2, 180 + 0.65 * 180), t2 = polar(cx, cy, r - 13, 180 + 0.65 * 180);
    s += '<line class="g-tick" x1="' + t[0].toFixed(2) + '" y1="' + t[1].toFixed(2) + '" x2="' + t2[0].toFixed(2) + '" y2="' + t2[1].toFixed(2) + '"/>';
    s += '<text class="g-val" x="50" y="52">' + Math.round(v * 100) + '%</text>';
    s += '<text class="g-lbl" x="50" y="66">' + (opts.caption || '') + '</text>';
    return s + '</svg>';
  };

  /* ── схема этажности здания ──────────────────────────────────────────── */
  C.floors = function (n, hi, opts) {
    opts = opts || {};
    var rowH = opts.rowH || 11, W = 100;
    var H = n * rowH + 12;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart floors">';
    for (var i = n; i >= 1; i--) {
      var y = (n - i) * rowH + 4;
      var cls = i === 1 ? 'f-first' : (i === n ? 'f-roof' : 'f-typ');
      var hi2 = i === hi;
      s += '<g class="fl ' + cls + (hi2 ? ' hi' : '') + '">' +
           '<rect x="18" y="' + y + '" width="' + (W - 34) + '" height="' + (rowH - 2.4) + '" rx="1.8"/>' +
           '<text class="f-no" x="14" y="' + (y + rowH * 0.62) + '">' + i + '</text>' +
           (hi2 ? '<text class="f-tag" x="' + (W - 12) + '" y="' + (y + rowH * 0.62) + '">типовой</text>' : '') +
           '</g>';
    }
    return s + '</svg>';
  };

  global.CHARTS = C;
})(typeof window !== 'undefined' ? window : globalThis);
