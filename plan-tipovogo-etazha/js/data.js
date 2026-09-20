/* ============================================================================
 *  ДАННЫЕ ПРОЕКТА · План типового этажа
 *  ----------------------------------------------------------------------------
 *  Все координаты — в метрах, в системе координат плана:
 *      X → вправо (0 … W),  Y ↓ вниз (0 … D),  начало — левый верхний угол
 *      наружного контура этажа (по граням наружных стен).
 *
 *  Помещения задаются габаритными прямоугольниками rect:[x, y, w, h]
 *  или полигоном poly:[[x,y], …] «в свету» (между гранями стен).
 *  Стены рисуются автоматически как обводка контуров помещений, поэтому
 *  соседние помещения разделяются зазором, равным толщине стены:
 *      0.2 м — перегородки, 0.4 м — наружные / межквартирные / стены ядра.
 *
 *  Файл целиком заменяется на ваши данные — структура описана в DATA.md.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ── Габариты этажа и толщины стен ─────────────────────────────────────── */
  var W = 24.0;   // длина этажа, м  (оси А…Ж)
  var D = 15.6;   // ширина этажа, м (оси 1…5)
  var WALL = { facade: 0.4, party: 0.4, partition: 0.2 };

  /* зеркальное отражение относительно вертикальной оси здания */
  var mir = function (v) { return W - v; };

  var meta = {
    project:   'Жилой комплекс «Прибрежный»',
    object:    'Многоквартирный жилой дом со встроено-пристроенными помещениями',
    address:   'г. Ростов-на-Дону',
    corp:      'Корпус 1 · Секция 1',
    stage:     'Проектная документация (стадия «П»)',
    sheet:     'АР-07',
    drawing:   'План типового этажа',
    scale:     '1:100',
    level:     '+16.500',
    floorNote: 'Этаж 6 · типовые этажи 2–17',
    author:    'Гип: ____________',
    checker:   'Пров.: ____________',
    date:      '2026·09'
  };

  var building = {
    floorsAbove: 17,
    floorsBelow: 1,
    floorHeight: 3.3,      // от отметки пола до отметки пола следующего этажа
    clearHeight: 3.0,      // высота помещений «в свету»
    structure:   'Монолитный ж/б каркас (диафрагмы жёсткости — стены ядра), шаг осей 3,6–4,2 м, плита безбалочная 200 мм',
    facade:      'Навесной вентилируемый фасад, керамогранит + штукатурные вставки, окно ПВХ 70 мм, 2-камерный стеклопакет',
    sections:    1,
    unitsPerFloor: 4,
    typicalFloors: '2–17 (16 этажей)',
    fireClass:   'Ф1.3 · класс конструктивной пожарной опасности С0 · степень огнестойкости II',
    stairType:   'Лестничная клетка типа Л1, лифты — 630 кг и 400 кг (ГОСТ 33605)'
  };

  /* ── Оси (разбивочная сетка) ───────────────────────────────────────────── */
  var axes = {
    x: [
      { label: 'А', v: 0.0 },  { label: 'Б', v: 4.2 },  { label: 'В', v: 8.4 },
      { label: 'Г', v: 12.0 }, { label: 'Д', v: 15.6 }, { label: 'Е', v: 19.8 },
      { label: 'Ж', v: 24.0 }
    ],
    y: [
      { label: '1', v: 0.0 },  { label: '2', v: 4.2 },  { label: '3', v: 8.4 },
      { label: '4', v: 12.0 }, { label: '5', v: 15.6 }
    ]
  };

  /* ── Зонирование (цвета подачи) ────────────────────────────────────────── */
  var zones = {
    living:   { name: 'Жилые комнаты',              color: '#3F7FC1', fill: '#DCE9F7' },
    kitchen:  { name: 'Кухни и кухни-гостиные',     color: '#5B9A3C', fill: '#E7F2DC' },
    wet:      { name: 'Санузлы и ванные',           color: '#2FA3B5', fill: '#DBEFF3' },
    storage:  { name: 'Гардеробные и кладовые',     color: '#8E6BC1', fill: '#ECE5F8' },
    circ:     { name: 'Прихожие и коридоры квартир',color: '#A98F63', fill: '#F5EFE3' },
    core:     { name: 'Лестнично-лифтовой узел',    color: '#DD9A22', fill: '#FDF0D5' },
    common:   { name: 'Коридоры общего пользования',color: '#C08A2E', fill: '#FAEBD2' },
    service:  { name: 'Технические помещения',      color: '#CE5B56', fill: '#FADFDD' },
    outdoor:  { name: 'Лоджии и балконы',           color: '#71899E', fill: '#E7EDF2' }
  };

  /* ── Квартиры ──────────────────────────────────────────────────────────── */
  var apartments = [
    { id: 'a1', no: 1, title: 'Квартира № 1', kind: '3-комнатная · европланировка',
      mirrorOf: null,  orient: 'С-З' },
    { id: 'a2', no: 2, title: 'Квартира № 2', kind: '2-комнатная',
      mirrorOf: null,  orient: 'Ю-З' },
    { id: 'a3', no: 3, title: 'Квартира № 3', kind: '3-комнатная · европланировка',
      mirrorOf: 'a1',  orient: 'С-В' },
    { id: 'a4', no: 4, title: 'Квартира № 4', kind: '2-комнатная',
      mirrorOf: 'a2',  orient: 'Ю-В' }
  ];

  /* ── Помещения (квартиры 1 и 2 — базовые; 3 и 4 строятся зеркально) ────── */
  var rooms = [
    /* ·· Квартира 1 · 3-комнатная (евро) — северо-запад ·· */
    { id: 'a1-bed1',   apt: 'a1', name: 'Спальня',        note: 'мастер-спальня', zone: 'living',
      rect: [0.4, 0.4, 4.0, 4.0], finish: 'Ламинат 33 кл. / обои под покраску' },
    { id: 'a1-kitchen',apt: 'a1', name: 'Кухня-гостиная', zone: 'kitchen',
      rect: [0.4, 4.6, 4.0, 3.6], finish: 'Керамогранит / ламинат, фартук — плитка' },
    { id: 'a1-bed2',   apt: 'a1', name: 'Спальня',        note: 'детская / кабинет', zone: 'living',
      rect: [4.6, 0.4, 3.6, 2.6], finish: 'Ламинат 33 кл.' },
    { id: 'a1-bath',   apt: 'a1', name: 'Ванная',         zone: 'wet',
      rect: [6.4, 3.2, 1.8, 1.6], finish: 'Керамическая плитка, тёплый пол' },
    { id: 'a1-wc',     apt: 'a1', name: 'Санузел',        zone: 'wet',
      rect: [6.4, 5.0, 1.8, 1.4], finish: 'Керамическая плитка' },
    { id: 'a1-hall',   apt: 'a1', name: 'Коридор',        zone: 'circ',
      rect: [4.6, 3.2, 1.6, 3.2], finish: 'Керамогранит' },
    { id: 'a1-entry',  apt: 'a1', name: 'Прихожая',       zone: 'circ',
      rect: [4.6, 6.6, 3.6, 1.6], finish: 'Керамогранит, встроенный шкаф' },

    /* ·· Квартира 2 · 2-комнатная — юго-запад ·· */
    { id: 'a2-kitchen',apt: 'a2', name: 'Кухня',          zone: 'kitchen',
      rect: [0.4, 8.6, 4.2, 2.4], finish: 'Керамогранит, фартук — плитка' },
    { id: 'a2-living', apt: 'a2', name: 'Гостиная',       zone: 'living',
      rect: [0.4, 11.2, 4.2, 4.0], finish: 'Ламинат 33 кл. / обои под покраску' },
    { id: 'a2-bed',    apt: 'a2', name: 'Спальня',        zone: 'living',
      rect: [4.8, 12.8, 3.4, 2.4], finish: 'Ламинат 33 кл.' },
    { id: 'a2-bath',   apt: 'a2', name: 'Санузел совмещённый', zone: 'wet',
      rect: [6.2, 10.6, 2.0, 2.0], finish: 'Керамическая плитка, тёплый пол' },
    { id: 'a2-entry',  apt: 'a2', name: 'Прихожая',       zone: 'circ',
      rect: [6.2, 8.6, 2.0, 1.8], finish: 'Керамогранит' },
    { id: 'a2-hall',   apt: 'a2', name: 'Коридор',        zone: 'circ',
      rect: [4.8, 8.6, 1.2, 4.0], finish: 'Керамогранит' },

    /* ·· Ядро — лестнично-лифтовой узел ·· */
    { id: 'c-stair',   apt: 'core', name: 'Лестничная клетка ЛК1', zone: 'core', labelAt: [9.9, 5.45],
      rect: [8.6, 0.4, 2.6, 5.6], finish: 'Керамогранит, ступени ЛМ-2, ограждение h=1,2 м' },
    { id: 'c-lift1',   apt: 'core', name: 'Шахта лифта Л1', note: '630 кг, грузопассажирский', zone: 'core',
      rect: [11.4, 0.4, 1.9, 2.8], finish: '—' },
    { id: 'c-lift2',   apt: 'core', name: 'Шахта лифта Л2', note: '400 кг, пассажирский', zone: 'core',
      rect: [13.5, 0.4, 1.9, 2.8], finish: '—' },
    { id: 'c-lifthall',apt: 'core', name: 'Лифтовой холл', zone: 'core',
      rect: [11.4, 3.4, 4.0, 2.6], finish: 'Керамогранит, отделка стен — декор. панели' },
    { id: 'c-hall',    apt: 'core', name: 'Приквартирный холл', zone: 'core',
      rect: [8.6, 6.2, 6.8, 2.0], finish: 'Керамогранит, потолки — грильято' },

    /* ·· Южный блок — общие и технические помещения ·· */
    { id: 's-corridor', apt: 'core', name: 'Коридор общего пользования', zone: 'common', labelAt: [10.4, 9.6],
      poly: [[8.6, 8.6], [15.4, 8.6], [15.4, 10.2], [12.8, 10.2], [12.8, 15.2],
             [11.2, 15.2], [11.2, 10.2], [8.6, 10.2]],
      finish: 'Керамогранит, дымоудаление, окно в южном торце' },
    { id: 's-store1',  apt: 'core', name: 'Кладовая жильцов № 1', note: 'келлер, сдаётся в аренду', zone: 'storage',
      rect: [8.6, 10.4, 2.4, 2.4], finish: 'Керамогранит, стеллажи, рольставни' },
    { id: 's-store2',  apt: 'core', name: 'Кладовая жильцов № 2', note: 'келлер, сдаётся в аренду', zone: 'storage',
      rect: [13.0, 10.4, 2.4, 2.4], finish: 'Керамогранит, стеллажи, рольставни' },
    { id: 's-clean',   apt: 'core', name: 'Помещение уборочного инвентаря', zone: 'service',
      rect: [8.6, 13.0, 2.4, 2.2], finish: 'Керамическая плитка, трап, раковина' },
    { id: 's-elec',    apt: 'core', name: 'Электрощитовая', note: 'ЩЭ, щит слаботочных систем', zone: 'service',
      rect: [13.0, 13.0, 2.4, 2.2], finish: 'Керамогранит, стены — ГВЛВ' }
  ];

  /* ── Лоджии и балконы (летние помещения) ───────────────────────────────── */
  var balconies = [
    { id: 'a1-loggia',  apt: 'a1', name: 'Лоджия',  type: 'loggia',  coeff: 0.5,
      rect: [-1.4, 4.8, 1.4, 3.2] },
    { id: 'a1-balcony', apt: 'a1', name: 'Балкон',  type: 'balcony', coeff: 0.3,
      rect: [0.8, -1.2, 2.6, 1.2] },
    { id: 'a2-loggia',  apt: 'a2', name: 'Лоджия',  type: 'loggia',  coeff: 0.5,
      rect: [0.8, 15.6, 3.4, 1.4] },
    { id: 'a2-balcony', apt: 'a2', name: 'Балкон',  type: 'balcony', coeff: 0.3,
      rect: [5.2, 15.6, 2.8, 1.2] }
  ];

  /* ── Проёмы: двери, окна, открытые проёмы, двери лифтов ────────────────── *
   * kind:  door — дверь с полотном и четвертью открывания
   *        opening — открытый проём (без полотна)
   *        window — окно в наружной стене
   *        lift — двери лифта
   * seg: [[x1,y1],[x2,y2]] — отрезок на осевой линии стены
   * swing: 'in' | 'out' — направление открывания (относительно помещения)
   * hinge: 'start' | 'end' — у какой точки отрезка петля
   * into: id помещения, куда открывается дверь (для 'in')                        */
  var openings = [
    /* ·· Квартира 1 ·· */
    { kind: 'door', apt: 'a1', seg: [[8.4, 6.9], [8.4, 7.8]], into: 'a1-entry',   label: 'входная, 900 мм, противопожарная EI30' },
    { kind: 'opening', apt: 'a1', seg: [[4.8, 6.5], [5.8, 6.5]], into: 'a1-hall' },
    { kind: 'door', apt: 'a1', seg: [[5.0, 3.1], [5.9, 3.1]], into: 'a1-bed2' },
    { kind: 'door', apt: 'a1', seg: [[4.5, 3.4], [4.5, 4.3]], into: 'a1-bed1' },
    { kind: 'door', apt: 'a1', seg: [[6.3, 3.5], [6.3, 4.3]], into: 'a1-bath' },
    { kind: 'door', apt: 'a1', seg: [[6.3, 5.2], [6.3, 6.0]], into: 'a1-wc' },
    { kind: 'opening', apt: 'a1', seg: [[4.5, 6.9], [4.5, 8.1]], into: 'a1-kitchen', label: 'проём 1200 мм' },
    { kind: 'window', apt: 'a1', seg: [[1.2, 0.0], [3.0, 0.0]], label: 'окно 1800×1500' },
    { kind: 'window', apt: 'a1', seg: [[5.2, 0.0], [7.4, 0.0]], label: 'окно 2200×1500' },
    { kind: 'window', apt: 'a1', seg: [[0.0, 1.0], [0.0, 2.8]], label: 'окно 1800×1500' },
    { kind: 'window', apt: 'a1', seg: [[0.0, 5.0], [0.0, 6.4]], label: 'окно 1400×1500' },
    { kind: 'door',   apt: 'a1', seg: [[0.0, 6.8], [0.0, 7.9]], into: 'a1-loggia', swing: 'out', label: 'дверь лоджии 1100×2100' },

    /* ·· Квартира 2 ·· */
    { kind: 'door', apt: 'a2', seg: [[8.4, 8.9], [8.4, 9.8]], into: 'a2-entry', label: 'входная, 900 мм, противопожарная EI30' },
    { kind: 'opening', apt: 'a2', seg: [[6.1, 9.0], [6.1, 10.0]], into: 'a2-hall' },
    { kind: 'door', apt: 'a2', seg: [[6.6, 10.5], [7.5, 10.5]], into: 'a2-bath' },
    { kind: 'door', apt: 'a2', seg: [[4.7, 9.4], [4.7, 10.3]], into: 'a2-kitchen' },
    { kind: 'door', apt: 'a2', seg: [[4.7, 11.5], [4.7, 12.4]], into: 'a2-living' },
    { kind: 'door', apt: 'a2', seg: [[5.0, 12.7], [5.9, 12.7]], into: 'a2-bed' },
    { kind: 'window', apt: 'a2', seg: [[0.0, 9.0], [0.0, 10.6]], label: 'окно 1600×1500' },
    { kind: 'window', apt: 'a2', seg: [[0.0, 12.0], [0.0, 13.8]], label: 'окно 1800×1500' },
    { kind: 'window', apt: 'a2', seg: [[3.0, 15.6], [4.2, 15.6]], label: 'окно 1200×1500' },
    { kind: 'door',   apt: 'a2', seg: [[1.4, 15.6], [2.5, 15.6]], into: 'a2-loggia', swing: 'out', label: 'дверь лоджии 1100×2100' },
    { kind: 'door',   apt: 'a2', seg: [[5.6, 15.6], [6.5, 15.6]], into: 'a2-balcony', swing: 'out', label: 'балконная дверь 900×2100' },
    { kind: 'window', apt: 'a2', seg: [[6.9, 15.6], [7.8, 15.6]], label: 'окно 900×1500' },

    /* ·· Ядро ·· */
    { kind: 'window', apt: 'core', seg: [[9.2, 0.0], [10.8, 0.0]], label: 'окно лестничной клетки 1600×1500' },
    { kind: 'lift',   apt: 'core', seg: [[11.9, 3.2], [12.8, 3.2]], label: 'двери лифта Л1, 800 мм' },
    { kind: 'lift',   apt: 'core', seg: [[14.0, 3.2], [14.9, 3.2]], label: 'двери лифта Л2, 800 мм' },
    { kind: 'opening', apt: 'core', seg: [[11.3, 4.2], [11.3, 5.4]], into: 'c-lifthall', label: 'проём 1200 мм' },
    { kind: 'opening', apt: 'core', seg: [[12.2, 6.1], [14.2, 6.1]], into: 'c-hall', label: 'проём 2000 мм' },
    { kind: 'opening', apt: 'core', seg: [[9.2, 6.1], [10.4, 6.1]], into: 'c-hall', label: 'выход из лестничной клетки 1200 мм' },
    { kind: 'opening', apt: 'core', seg: [[11.4, 8.4], [12.8, 8.4]], into: 's-corridor', label: 'проём 1400 мм' },
    { kind: 'window', apt: 'core', seg: [[11.6, 15.6], [12.4, 15.6]], label: 'окно коридора 800×1500' },

    /* ·· Южный блок ·· */
    { kind: 'door', apt: 'core', seg: [[9.4, 10.3], [10.4, 10.3]], into: 's-store1', label: 'рольставни 1000 мм' },
    { kind: 'door', apt: 'core', seg: [[13.6, 10.3], [14.6, 10.3]], into: 's-store2', label: 'рольставни 1000 мм' },
    { kind: 'door', apt: 'core', seg: [[11.1, 13.6], [11.1, 14.5]], into: 's-clean' },
    { kind: 'door', apt: 'core', seg: [[12.9, 13.6], [12.9, 14.5]], into: 's-elec' }
  ];

  /* ── Лестница ЛК1 (двухмаршевая, клетка 2,6 × 5,6 м) ───────────────────── */
  var stairs = [
    {
      id: 'st1', name: 'ЛК1', apt: 'core',
      rect: [8.6, 0.4, 2.6, 5.6],
      flights: [
        { x: 8.60, y: 1.70, w: 1.20, h: 2.90, treads: 9, dir: 'up' },    // западный марш
        { x: 10.00, y: 1.70, w: 1.20, h: 2.90, treads: 9, dir: 'down' }  // восточный марш
      ],
      landings: [ [8.6, 0.4, 2.6, 1.3], [8.6, 4.6, 2.6, 1.4] ],
      note: 'уклон 1:2 · ступень 165×320 мм · ширина марша 1,20 м · площадка 1,30 м'
    }
  ];

  /* ── Лифты ─────────────────────────────────────────────────────────────── */
  var lifts = [
    { id: 'l1', name: 'Л1', shaft: [11.4, 0.4, 1.9, 2.8], cab: [11.55, 0.55, 1.6, 2.1],
      door: [11.9, 3.2, 0.9], capacity: '630 кг · 1,0 м/с', type: 'грузопассажирский' },
    { id: 'l2', name: 'Л2', shaft: [13.5, 0.4, 1.9, 2.8], cab: [13.65, 0.55, 1.1, 2.1],
      door: [14.0, 3.2, 0.9], capacity: '400 кг · 1,0 м/с', type: 'пассажирский' }
  ];

  /* ── Инженерные стояки и шахты (слой «Инженерия») ──────────────────────── */
  var risers = [
    /* квартиры 1 и 2 */
    { apt: 'a1', x: 5.95, y: 3.55, r: 0.22, label: 'В1·Т3·К1', kind: 'water' },
    { apt: 'a1', x: 5.95, y: 5.95, r: 0.26, label: 'В2',       kind: 'vent'  },
    { apt: 'a2', x: 6.45, y: 12.35, r: 0.22, label: 'В1·Т3·К1', kind: 'water' },
    { apt: 'a2', x: 5.40, y: 12.20, r: 0.26, label: 'В2',      kind: 'vent'  },
    { apt: 'a2', x: 4.25, y: 10.72, r: 0.20, label: 'В2·К1',   kind: 'vent'  },
    /* общие */
    { apt: 'core', x: 13.40, y: 9.60, r: 0.30, label: 'ДУ',  kind: 'smoke' },
    { apt: 'core', x: 12.00, y: 11.0, r: 0.26, label: 'В2',  kind: 'vent'  },
    { apt: 'core', x: 14.20, y: 14.10, r: 0.28, label: 'ЩЭ', kind: 'elec'  },
    { apt: 'core', x: 9.80,  y: 14.10, r: 0.24, label: 'ПУИ', kind: 'water' }
  ];

  /* ── Мебель и сантехника (базовые квартиры; зеркалятся вместе с ними) ──── *
   * t — тип из библиотеки символов, x/y — центр, rot — поворот, град.        */
  var furniture = [
    /* Кв.1 · спальня (мастер) */
    { apt: 'a1', t: 'bed160',     x: 2.40, y: 1.55, rot: 0 },
    { apt: 'a1', t: 'nightstand', x: 1.35, y: 0.85, rot: 0 },
    { apt: 'a1', t: 'nightstand', x: 3.45, y: 0.85, rot: 0 },
    { apt: 'a1', t: 'wardrobe',   x: 4.05, y: 3.30, rot: 90 },
    { apt: 'a1', t: 'plant',      x: 0.90, y: 3.95, rot: 0 },
    /* Кв.1 · кухня-гостиная */
    { apt: 'a1', t: 'fridge',     x: 0.90, y: 5.00, rot: 0 },
    { apt: 'a1', t: 'kcounter',   x: 2.50, y: 5.00, rot: 0 },
    { apt: 'a1', t: 'sofa',       x: 3.90, y: 6.40, rot: 90 },
    { apt: 'a1', t: 'ctable',     x: 2.90, y: 6.40, rot: 0 },
    { apt: 'a1', t: 'dtable',     x: 1.60, y: 7.40, rot: 0 },
    { apt: 'a1', t: 'chair',      x: 1.00, y: 6.90, rot: 90 },
    { apt: 'a1', t: 'chair',      x: 2.20, y: 6.90, rot: 270 },
    { apt: 'a1', t: 'chair',      x: 1.00, y: 7.90, rot: 90 },
    { apt: 'a1', t: 'chair',      x: 2.20, y: 7.90, rot: 270 },
    /* Кв.1 · спальня 2 */
    { apt: 'a1', t: 'bed140',     x: 5.85, y: 1.50, rot: 0 },
    { apt: 'a1', t: 'nightstand', x: 6.80, y: 0.80, rot: 0 },
    { apt: 'a1', t: 'wardrobe',   x: 7.75, y: 1.80, rot: 90 },
    { apt: 'a1', t: 'desk',       x: 5.05, y: 2.55, rot: 0 },
    /* Кв.1 · ванная и санузел */
    { apt: 'a1', t: 'bathtub',    x: 7.35, y: 3.62, rot: 0 },
    { apt: 'a1', t: 'basin',      x: 6.75, y: 4.50, rot: 0 },
    { apt: 'a1', t: 'washer',     x: 7.80, y: 4.45, rot: 0 },
    { apt: 'a1', t: 'wc',         x: 6.75, y: 5.45, rot: 0 },
    { apt: 'a1', t: 'basin',      x: 7.65, y: 5.45, rot: 0 },
    /* Кв.1 · прихожая */
    { apt: 'a1', t: 'wardrobe',   x: 5.60, y: 7.85, rot: 0 },
    { apt: 'a1', t: 'shoes',      x: 7.55, y: 7.90, rot: 0 },

    /* Кв.2 · кухня */
    { apt: 'a2', t: 'kcounter',   x: 1.90, y: 9.00, rot: 0 },
    { apt: 'a2', t: 'fridge',     x: 4.10, y: 9.00, rot: 0 },
    { apt: 'a2', t: 'dtable',     x: 2.60, y: 10.30, rot: 0 },
    { apt: 'a2', t: 'chair',      x: 2.00, y: 9.80, rot: 180 },
    { apt: 'a2', t: 'chair',      x: 3.20, y: 9.80, rot: 180 },
    { apt: 'a2', t: 'chair',      x: 2.00, y: 10.80, rot: 0 },
    { apt: 'a2', t: 'chair',      x: 3.20, y: 10.80, rot: 0 },
    /* Кв.2 · гостиная */
    { apt: 'a2', t: 'sofa',       x: 2.60, y: 14.60, rot: 180 },
    { apt: 'a2', t: 'ctable',     x: 2.60, y: 13.50, rot: 0 },
    { apt: 'a2', t: 'tvunit',     x: 2.60, y: 11.65, rot: 0 },
    { apt: 'a2', t: 'armchair',   x: 1.00, y: 13.30, rot: 90 },
    { apt: 'a2', t: 'plant',      x: 4.20, y: 14.80, rot: 0 },
    /* Кв.2 · спальня */
    { apt: 'a2', t: 'bed160',     x: 6.30, y: 14.00, rot: 180 },
    { apt: 'a2', t: 'nightstand', x: 5.25, y: 14.70, rot: 0 },
    { apt: 'a2', t: 'nightstand', x: 7.35, y: 14.70, rot: 0 },
    { apt: 'a2', t: 'wardrobe',   x: 7.90, y: 13.60, rot: 90 },
    /* Кв.2 · санузел */
    { apt: 'a2', t: 'bathtub',    x: 7.20, y: 11.05, rot: 0 },
    { apt: 'a2', t: 'wc',         x: 6.55, y: 12.20, rot: 0 },
    { apt: 'a2', t: 'washer',     x: 7.60, y: 12.20, rot: 0 },
    { apt: 'a2', t: 'basin',      x: 6.55, y: 11.10, rot: 0 },
    /* Кв.2 · прихожая */
    { apt: 'a2', t: 'wardrobe',   x: 7.20, y: 8.95, rot: 0 },
    { apt: 'a2', t: 'shoes',      x: 6.60, y: 10.05, rot: 0 }
  ];

  /* ── Размеры для выноски (цепочки по осям и габаритам) ─────────────────── */
  var dims = {
    xOverall: { y: -2.4, from: 0, to: W },
    xAxis:    { y: -4.2, axis: 'x' },
    yOverall: { x: -2.4, from: 0, to: D },
    yAxis:    { x: -4.2, axis: 'y' },
    local: [
      { seg: [[8.6, 6.6], [8.6, 7.5]],  text: 'проход к ЛК1' },
      { seg: [[9.2, -1.0], [10.8, -1.0]], text: '1600' },
      { seg: [[16.6, 16.6], [18.2, 16.6]], text: '1600' }
    ]
  };

  /* ── Аннотации и выноски на листе ──────────────────────────────────────── */
  var notes = [
    'Отметка чистого пола типового этажа +16,500 м (БСВ +17,050 м).',
    'Высота помещений «в свету» — 3,00 м; высота этажа — 3,30 м.',
    'Наружные стены — монолитный ж/б 200 мм с утеплителем 150 мм и вентфасадом (400 мм в габарите).',
    'Межквартирные стены и стены ядра — монолитный ж/б 400 мм (диафрагмы жёсткости).',
    'Перегородки — пазогребневые плиты / ГЛК на металлокаркасе, 200 мм с учётом отделки.',
    'Входные двери квартир — противопожарные EI30 с уплотнением в притворах.',
    'Окна — ПВХ, 2-камерный стеклопакет, сопротивление теплопередаче ≥ 0,65 м²·°С/Вт.',
    'Лоджии и балконы учитываются с коэффициентами 0,5 и 0,3 (СП 54.13330.2022, прил. В).',
    'Мусоропровод не предусмотрен; камера мусороудаления — на 1-м этаже.',
    'Дымоудаление из коридоров общего пользования — шахта ДУ с вентилятором на кровле.',
    'Ориентация окон квартир: № 1 — С/З, № 2 — Ю/З, № 3 — С/В, № 4 — Ю/В.'
  ];

  /* ── Ориентация фасадов (для розы ветров и инсоляции) ──────────────────── */
  var facades = { N: 'Северный', E: 'Восточный', S: 'Южный', W: 'Западный' };

  /* ==========================================================================
   *  Сборка полного набора данных: зеркальные квартиры 3 и 4
   * ========================================================================*/
  function mirrorRect(r) { return [mir(r[0] + r[2]), r[1], r[2], r[3]]; }
  function mirrorPoly(p) { return p.map(function (q) { return [mir(q[0]), q[1]]; }); }
  function mirrorSeg(s)  { return [[mir(s[0][0]), s[0][1]], [mir(s[1][0]), s[1][1]]]; }

  var mirrorMap = { a1: 'a3', a2: 'a4' };
  var idMap = {};   // a1-bed1 -> a3-bed1

  rooms.forEach(function (r) {
    var tgt = mirrorMap[r.apt];
    if (!tgt) return;
    var copy = JSON.parse(JSON.stringify(r));
    idMap[r.id] = copy.id = tgt + r.id.slice(2);
    copy.apt = tgt;
    if (copy.rect) copy.rect = mirrorRect(copy.rect);
    if (copy.poly) copy.poly = mirrorPoly(copy.poly);
    rooms.push(copy);
  });

  balconies.forEach(function (b) {
    var tgt = mirrorMap[b.apt];
    if (!tgt) return;
    var copy = JSON.parse(JSON.stringify(b));
    idMap[b.id] = copy.id = tgt + b.id.slice(2);
    copy.apt = tgt;
    copy.rect = mirrorRect(copy.rect);
    balconies.push(copy);
  });

  openings.forEach(function (o) {
    var tgt = mirrorMap[o.apt];
    if (!tgt) return;
    var copy = JSON.parse(JSON.stringify(o));
    copy.apt = tgt;
    copy.seg = mirrorSeg(o.seg);
    if (o.into) copy.into = idMap[o.into] || o.into;
    openings.push(copy);
  });

  furniture.forEach(function (f) {
    var tgt = mirrorMap[f.apt];
    if (!tgt) return;
    var copy = { apt: tgt, t: f.t, x: mir(f.x), y: f.y, rot: (180 - (f.rot || 0)) % 360 };
    furniture.push(copy);
  });

  risers.forEach(function (r) {
    var tgt = mirrorMap[r.apt];
    if (!tgt) return;
    var copy = JSON.parse(JSON.stringify(r));
    copy.apt = tgt;
    copy.x = mir(copy.x);
    risers.push(copy);
  });

  /* квартира 3 = зеркало 1, квартира 4 = зеркало 2 */
  apartments.forEach(function (a) {
    if (!a.mirrorOf) return;
    var src = apartments.filter(function (s) { return s.id === a.mirrorOf; })[0];
    a.kind = src.kind;
  });

  global.FLOOR_DATA = {
    meta: meta,
    building: building,
    size: { W: W, D: D },
    wall: WALL,
    axes: axes,
    zones: zones,
    apartments: apartments,
    rooms: rooms,
    balconies: balconies,
    openings: openings,
    stairs: stairs,
    lifts: lifts,
    risers: risers,
    furniture: furniture,
    dims: dims,
    notes: notes,
    facades: facades
  };
})(typeof window !== 'undefined' ? window : globalThis);
