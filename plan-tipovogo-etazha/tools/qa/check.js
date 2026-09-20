/* Headless-QA презентации плана типового этажа. Запуск: node tools/qa/check.js
   Проверяет геометрию, данные, рендер и диаграммы без браузера. Зависимостей не требует. */
(function () {
  'use strict';
  var path = require('path');
  var ROOT = path.resolve(__dirname, '../../');
  require(path.join(ROOT, 'js/geometry.js'));
  require(path.join(ROOT, 'js/data.js'));
  require(path.join(ROOT, 'js/render-plan.js'));
  require(path.join(ROOT, 'js/render-iso.js'));
  require(path.join(ROOT, 'js/charts.js'));
  var G = globalThis.GEO, PLAN = globalThis.PLAN, ISO = globalThis.ISO, CHARTS = globalThis.CHARTS;
  var d = globalThis.FLOOR_DATA;
  var st = PLAN.stats(d);

  var fails = 0;
  function good(m) { console.log('  ✓ ' + m); }
  function bad(m) { fails++; console.log('  ✗ ' + m); }

  /* ── утилиты ─────────────────────────────────────────────────────────── */
  function inside(poly, x, y) {           /* лучевой тест */
    var c = false, i, j;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function distSeg(px, py, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var L2 = dx * dx + dy * dy || 1e-12;
    var t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
    var qx = a[0] + t * dx, qy = a[1] + t * dy;
    return Math.hypot(px - qx, py - qy);
  }
  function distPoly(poly, x, y) {
    var m = 1e9, i;
    for (i = 0; i < poly.length; i++) m = Math.min(m, distSeg(x, y, poly[i], poly[(i + 1) % poly.length]));
    return m;
  }
  function xmlValid(svg) {               /* стековый валидаторWell-formed */
    var re = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'\/])*)(\/?)>/g, m, stack = [];
    var voids = { br: 1, hr: 1, img: 1, input: 1, meta: 1, link: 1 };
    while ((m = re.exec(svg))) {
      var close = m[1] === '/', tag = m[2].toLowerCase(), self = m[4] === '/';
      if (close) { if (!stack.length || stack.pop() !== tag) return 'несоответствие </' + tag + '>'; }
      else if (!self && !voids[tag]) stack.push(tag);
    }
    return stack.length ? 'не закрыто: ' + stack.join(',') : null;
  }
  function numsValid(svg) {
    var attrs = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'font-size', 'opacity'];
    var errs = [];
    attrs.forEach(function (a) {
      var re = new RegExp('\\b' + a + '="([^"]*)"', 'g'), m;
      while ((m = re.exec(svg))) {
        if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?%?$/i.test(m[1].trim())) errs.push(a + '="' + m[1] + '"');
      }
    });
    var re2 = /\b(?:points|d)="([^"]*)"/g, m2;
    while ((m2 = re2.exec(svg))) {
      if (/NaN|undefined|Infinity|--|\.\./.test(m2[1])) errs.push('path/points: ' + m2[1].slice(0, 40));
    }
    return errs;
  }

  /* ── 1. площади ──────────────────────────────────────────────────────── */
  console.log('\n=== 1. Площади и квартирография ===');
  var gross = d.size.W * d.size.D;
  var inner = d.rooms.reduce(function (s, r) { return s + G.area(G.poly(r)); }, 0);
  console.log('  брутто ' + G.n(gross) + ' м², помещений ' + G.n(inner) + ' м², конструкции ' +
    G.n(gross - inner) + ' м² (' + (100 * (gross - inner) / gross).toFixed(1) + ' %)');
  if (inner > gross) bad('сумма помещений больше габарита этажа'); else good('габарит согласован с помещениями');
  d.apartments.forEach(function (a) {
    var s = st.byApt[a.id];
    if (!s || s.total <= 0) { bad('квартира ' + a.id + ': нет площадей'); return; }
    console.log('  Кв.' + a.no + ': ' + s.roomsCount + ' комн, ' + G.n(s.total) + ' м² (жилая ' + G.n(s.living) +
      ', с летними ' + G.n(s.totalAdj) + ')');
  });

  /* ── 2. пересечения помещений ────────────────────────────────────────── */
  console.log('\n=== 2. Пересечения помещений (семплирование) ===');
  var polys = d.rooms.map(function (r) { return { id: r.id, p: G.poly(r), b: G.bbox(G.poly(r)) }; });
  var overlaps = 0, samples = 0, step = 0.2;
  polys.forEach(function (A, i) {
    for (var x = A.b.x + step / 2; x < A.b.x2; x += step) {
      for (var y = A.b.y + step / 2; y < A.b.y2; y += step) {
        if (!inside(A.p, x, y)) continue;
        samples++;
        for (var j = i + 1; j < polys.length; j++) {
          var B = polys[j];
          if (x < B.b.x || x > B.b.x2 || y < B.b.y || y > B.b.y2) continue;
          if (inside(B.p, x, y)) { overlaps++; if (overlaps < 4) bad(A.id + ' ∩ ' + B.id + ' в (' + x.toFixed(2) + ',' + y.toFixed(2) + ')'); }
        }
      }
    }
  });
  if (!overlaps) good('пересечений нет (' + samples + ' точек)'); else bad('пересечений: ' + overlaps);

  /* ── 3. непокрытые зоны (дыры между помещениями и стенами) ───────────── */
  console.log('\n=== 3. Покрытие этажа ===');
  var holes = 0, hs = 0.3, hx, hy;
  for (hx = hs / 2; hx < d.size.W; hx += hs) {
    for (hy = hs / 2; hy < d.size.D; hy += hs) {
      var inRoom = false, minD = 1e9, i2;
      for (i2 = 0; i2 < polys.length; i2++) {
        if (hx < polys[i2].b.x - 0.5 || hx > polys[i2].b.x2 + 0.5 || hy < polys[i2].b.y - 0.5 || hy > polys[i2].b.y2 + 0.5) continue;
        if (inside(polys[i2].p, hx, hy)) { inRoom = true; break; }
        minD = Math.min(minD, distPoly(polys[i2].p, hx, hy));
      }
      if (!inRoom && minD > 0.45) { holes++; if (holes < 4) bad('дыра в (' + hx.toFixed(2) + ',' + hy.toFixed(2) + ')'); }
    }
  }
  if (!holes) good('непокрытых зон нет'); else bad('непокрытых точек: ' + holes);

  /* ── 4. проёмы на осях стен ──────────────────────────────────────────── */
  console.log('\n=== 4. Проёмы ===');
  var offWall = 0;
  d.openings.forEach(function (o, i) {
    var mx = (o.seg[0][0] + o.seg[1][0]) / 2, my = (o.seg[0][1] + o.seg[1][1]) / 2;
    var onEdge = false;
    polys.forEach(function (R) {
      var e;
      for (e = 0; e < R.p.length && !onEdge; e++) {
        if (distSeg(mx, my, R.p[e], R.p[(e + 1) % R.p.length]) < 0.02) onEdge = true;
      }
    });
    var onOutline = mx < 0.02 || my < 0.02 || mx > d.size.W - 0.02 || my > d.size.D - 0.02;
    var minD2 = 1e9;
    polys.forEach(function (R) { minD2 = Math.min(minD2, distPoly(R.p, mx, my)); });
    /* проём может лежать на оси стены: торец вблизи грани помещения (до полутолщины) */
    if (!onEdge && !onOutline && minD2 > 0.26) { offWall++; bad('проём #' + i + ' (' + o.kind + ') не на оси стены'); }
  });
  if (!offWall) good(d.openings.length + ' проёмов лежат на линиях стен');

  /* ── 5. мебель внутри помещений ──────────────────────────────────────── */
  console.log('\n=== 5. Мебель ===');
  var out = 0;
  d.furniture.forEach(function (f) {
    var room = d.rooms.filter(function (r) { return r.apt === f.apt && inside(G.poly(r), f.x, f.y); })[0];
    if (!room) { bad('мебель ' + f.t + ' (' + f.apt + ') вне помещений квартиры в (' + f.x + ',' + f.y + ')'); out++; }
  });
  if (!out) good(d.furniture.length + ' предметов внутри помещений своей квартиры');

  /* ── 6. рендер ───────────────────────────────────────────────────────── */
  console.log('\n=== 6. Рендер ===');
  var vb = { x: -8.2, y: -6.4, w: d.size.W + 14.2, h: d.size.D + 18.6 };
  var out1 = PLAN.build(d, { viewBox: vb, stats: st });
  var out2 = ISO.build(d, { stats: st });
  var out3 = ISO.massing(d, { highlight: 6 });
  console.log('  план ' + Math.round(out1.svg.length / 1024) + ' КБ, аксонометрия ' +
    Math.round(out2.svg.length / 1024) + ' КБ, объёмная схема ' + Math.round(out3.length / 1024) + ' КБ');
  [['план', out1.svg], ['аксонометрия', out2.svg], ['объёмная схема', out3]].forEach(function (p) {
    var e = xmlValid(p[1]);
    if (e) bad(p[0] + ': XML — ' + e); else good(p[0] + ' — XML-корректен');
    var nv = numsValid(p[1]);
    if (nv.length) bad(p[0] + ': битые атрибуты ' + nv.slice(0, 5).join(' | ')); else good(p[0] + ': числовые атрибуты корректны');
    if (/NaN|undefined/.test(p[1])) bad(p[0] + ': NaN/undefined в выводе');
  });

  /* ── 7. диаграммы ────────────────────────────────────────────────────── */
  console.log('\n=== 7. Диаграммы ===');
  var zsum = {};
  d.rooms.forEach(function (r) { zsum[r.zone] = (zsum[r.zone] || 0) + G.area(G.poly(r)); });
  var zoneItems = Object.keys(zsum).map(function (k) {
    return { label: d.zones[k].name, value: zsum[k], color: d.zones[k].color };
  });
  var aptSum = d.apartments.reduce(function (s2, a) { return s2 + (st.byApt[a.id] ? st.byApt[a.id].total : 0); }, 0);
  var commonSum = st.byApt.core ? st.byApt.core.total : 0;
  var stackItems = [
    { label: 'Квартиры', value: aptSum, color: '#4A7FC1' },
    { label: 'Ядро и общие', value: commonSum, color: '#DD9A22' },
    { label: 'Стены', value: Math.max(gross - aptSum - commonSum, 0), color: '#6E7B8B' }
  ];
  var aptItems = d.apartments.map(function (a) {
    var s3 = st.byApt[a.id];
    return { label: 'Кв. ' + a.no, value: s3.totalAdj, color: '#888888' };
  });
  var win = { N: 0, E: 0, S: 0, W: 0 };
  d.openings.forEach(function (o) {
    if (o.kind !== 'window') return;
    var f = PLAN.facadeOf(d, o.seg);
    if (f) win[f] += G.segLen(o.seg);
  });
  [['donut', function () { return CHARTS.donut(zoneItems, { caption: 'тест' }); }],
   ['bars', function () { return CHARTS.bars(aptItems, { labelW: 34, rowH: 19 }); }],
   ['stack', function () { return CHARTS.stack(stackItems); }],
   ['rose', function () { return CHARTS.rose(win, { caption: 'тест' }); }],
   ['gauge', function () { return CHARTS.gauge(aptSum / (aptSum + commonSum), { caption: 'тест' }); }],
   ['floors', function () { return CHARTS.floors(d.building.floorsAbove, 6, {}); }]].forEach(function (c) {
    try { var s4 = c[1](); if (typeof s4 === 'string' && s4.length > 80) good(c[0] + ' ok'); else bad(c[0] + ': пустой вывод'); }
    catch (e) { bad(c[0] + ': ' + e.message); }
  });

  /* ── 8. нормативные габариты ─────────────────────────────────────────── */
  console.log('\n=== 8. Нормативные габариты ===');
  var fw = [];
  d.stairs.forEach(function (s) { s.flights.forEach(function (f) { fw.push(f.w); }); });
  if (fw.length && Math.min.apply(null, fw) >= 1.199) good('лестница: марши ' + fw.map(function (w) { return G.n(w); }).join('/') + ' м');
  else bad('марш уже 1,2 м: ' + fw.join(','));
  var narrow = d.rooms.filter(function (r) { return r.zone === 'circ' || r.zone === 'common'; })
    .filter(function (r) { var b = G.bbox(G.poly(r)); return Math.min(b.w, b.h) < 0.99; });
  if (!narrow.length) good('коридоры ≥ 1,0 м'); else bad('узкие коридоры: ' + narrow.map(function (r) { return r.id; }).join(','));
  var smallLiv = d.rooms.filter(function (r) { return r.zone === 'living' && G.area(G.poly(r)) < 7.99; });
  if (!smallLiv.length) good('жилые комнаты ≥ 8 м²'); else bad('мелкие жилые: ' + smallLiv.map(function (r) { return r.id; }).join(','));

  console.log('\n' + (fails ? '❌ ОШИБОК: ' + fails : '✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ'));
  process.exit(fails ? 1 : 0);
})();
