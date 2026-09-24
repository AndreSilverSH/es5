// Палитра ADE20K: на ней обучены ControlNet-модели сегментации
// (control_v11p_sd15_seg, а также семантические режимы union-моделей для SDXL).
// Каждому классу IFC назначается цвет «похожего» класса ADE20K,
// чтобы нейросеть поняла, где стена, где окно, где пол и т. д.

export const ADE20K = {
  wall:        [120, 120, 120],
  building:    [180, 120, 120],
  sky:         [6, 230, 230],
  floor:       [80, 50, 50],
  tree:        [4, 200, 3],
  ceiling:     [120, 120, 80],
  road:        [140, 140, 140],
  windowpane:  [230, 230, 230],
  grass:       [4, 250, 7],
  cabinet:     [224, 5, 255],
  sidewalk:    [235, 255, 7],
  person:      [150, 5, 61],
  earth:       [120, 120, 70],
  door:        [8, 255, 51],
  table:       [255, 6, 82],
  plant:       [204, 255, 4],
  curtain:     [255, 51, 7],
  chair:       [204, 70, 3],
  car:         [0, 102, 200],
  fence:       [255, 184, 6],
  railing:     [255, 61, 6],
  column:      [255, 8, 41],
  stairs:      [255, 224, 0],
  stairway:    [31, 0, 255],
  path:        [255, 31, 0],
  box:         [0, 255, 20],
  base:        [255, 122, 8],
  lamp:        [224, 255, 8],
  sink:        [0, 163, 255],
};

// Класс IFC (в любом регистре) → класс ADE20K.
// Для IfcSlab и IfcCovering учитывается PredefinedType.
const IFC_TO_ADE = {
  ifcwall: 'wall',
  ifcwallstandardcase: 'wall',
  ifcwallelementedcase: 'wall',
  ifccurtainwall: 'windowpane',
  ifcplate: 'windowpane',
  ifcwindow: 'windowpane',
  ifcwindowstandardcase: 'windowpane',
  ifcdoor: 'door',
  ifcdoorstandardcase: 'door',
  ifcslab: 'floor',
  ifcroof: 'building',
  ifccovering: 'ceiling',
  ifccolumn: 'column',
  ifcbeam: 'ceiling',
  ifcmember: 'fence',
  ifcrailing: 'railing',
  ifcstair: 'stairs',
  ifcstairflight: 'stairs',
  ifcramp: 'path',
  ifcrampflight: 'path',
  ifcfooting: 'base',
  ifcpile: 'base',
  ifcfurnishingelement: 'cabinet',
  ifcfurniture: 'table',
  ifcsystemfurnitureelement: 'table',
  ifclightfixture: 'lamp',
  ifcsanitaryterminal: 'sink',
  ifcgeographicelement: 'earth',
  ifcsite: 'earth',
  ifcbuildingelementproxy: 'building',
  // служебная «земля», добавляемая в сцену инструментом
  ground: 'earth',
};

export function adeClassFor(ifcType, predefinedType) {
  const t = String(ifcType || '').toLowerCase();
  const p = String(predefinedType || '').toUpperCase();
  if (t === 'ifcslab') {
    if (p === 'ROOF') return 'building';
    return 'floor';
  }
  if (t === 'ifccovering') {
    if (p === 'FLOORING') return 'floor';
    if (p === 'CLADDING') return 'wall';
    if (p === 'ROOFING') return 'building';
    return 'ceiling';
  }
  return IFC_TO_ADE[t] || 'building';
}

export function segColorFor(ifcType, predefinedType, overrides = {}) {
  const key = String(ifcType || '').toLowerCase();
  if (overrides[key]) return overrides[key];
  return ADE20K[adeClassFor(ifcType, predefinedType)];
}

// Классы, которые по умолчанию не участвуют в рендере (объёмы помещений и т. п.)
export const HIDDEN_BY_DEFAULT = new Set(['ifcspace', 'ifcopeningelement', 'ifcannotation', 'ifcvirtualelement']);
