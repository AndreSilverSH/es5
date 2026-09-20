/* Контрольный растр видов презентации (необязательный шаг QA).
   Зависимость: npm i --prefix tools/qa @resvg/resvg-js
   Запуск:     node tools/qa/render.js   →  tools/qa/png/*.png                     */
(function () {
  'use strict';
  var fs = require('fs'), path = require('path');
  var Resvg;
  try { Resvg = require('@resvg/resvg-js').Resvg; }
  catch (e) {
    console.log('Нет @resvg/resvg-js — растр пропущен. Установка: npm i --prefix tools/qa @resvg/resvg-js');
    process.exit(0);
  }
  var ROOT = path.resolve(__dirname, '../../');
  require(path.join(ROOT, 'js/geometry.js'));
  require(path.join(ROOT, 'js/data.js'));
  require(path.join(ROOT, 'js/render-plan.js'));
  require(path.join(ROOT, 'js/render-iso.js'));
  var G = globalThis.GEO, PLAN = globalThis.PLAN, ISO = globalThis.ISO, d = globalThis.FLOOR_DATA;
  var st = PLAN.stats(d);

  /* подставляем значения CSS-переменных прямо в стили (resvg не читает :root из других файлов) */
  var css = (fs.readFileSync(path.join(ROOT, 'css/plan.css'), 'utf8') + '\n' +
             fs.readFileSync(path.join(ROOT, 'css/charts.css'), 'utf8'))
    .replace(/var\(--pp-wall\)/g, '#233240').replace(/var\(--pp-paper\)/g, '#ffffff')
    .replace(/var\(--pp-line\)/g, '#4a5a6a').replace(/var\(--pp-text\)/g, '#22303c')
    .replace(/var\(--pp-axis\)/g, '#d8483c').replace(/var\(--pp-furn\)/g, '#6c7c8d')
    .replace(/transition:[^;]+;/g, '').replace(/cursor:[^;]+;/g, '')
    .replace(/color-mix\([^)]*\)/g, '#dddddd').replace(/var\(--[^)]*\)/g, '#888888');

  var outDir = path.join(__dirname, 'png/');
  fs.mkdirSync(outDir, { recursive: true });
  function render(svg, file, width, cls) {
    if (cls) svg = svg.replace('class="plan-svg"', 'class="plan-svg ' + cls + '"');
    svg = svg.replace(/preserveAspectRatio="[^"]*">/,
      'preserveAspectRatio="xMidYMid meet"><style>' + css + '</style>');
    var r = new Resvg(svg, {
      fitTo: { mode: 'width', value: width }, background: '#ffffff',
      font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' }
    });
    fs.writeFileSync(file, r.render().asPng());
    console.log('→', path.relative(process.cwd(), file), (fs.statSync(file).size / 1024).toFixed(0) + ' КБ');
  }

  var vb = { x: -8.2, y: -6.4, w: d.size.W + 14.2, h: d.size.D + 18.6 };
  var full = PLAN.build(d, { viewBox: vb, stats: st });
  render(full.svg, outDir + '01-plan-full.png', 3400);
  render(full.svg, outDir + '02-hatch-mono.png', 2400, 'hatch mono');
  render(ISO.build(d, { stats: st }).svg, outDir + '03-iso.png', 2200);
  render(ISO.massing(d, { highlight: 6 }), outDir + '04-massing.png', 1500);
  console.log('Готово. Внимание: resvg не поддерживает элементы за пределами viewBox с opacity —');
  console.log('поэтому квартирные фрагменты смотрят в браузере, а здесь печатается полный лист.');
})();
