// Встраивание нейро-рендера в УЖЕ ГОТОВУЮ three.js-страницу (например, HTML-модель с показателями).
//
//   <script type="module">
//     import { attachNeuroRender } from './neuro-render/js/embed.js';
//     attachNeuroRender({ THREE, renderer, scene, camera, controls });
//   </script>
//
// Появится кнопка «Нейро-рендер» в углу: рамка кадра поверх окна просмотра, ракурсы,
// предпросмотр проходов и экспорт ZIP (тот же формат, что у neuro-render/index.html,
// поэтому comfy/comfy_render.py работает с ним без изменений).
//
// Подписи, показатели, маркеры и прочие служебные объекты сцены пометьте
// userData.noPass = true — тогда они не попадут в depth/lineart/seg.

import { createNeuroPasses, canvasToBlob, PASS_NAMES } from './passes.js';
import { segColorFor, ADE20K } from './segmap.js';
import { ZipWriter } from './zip.js';

// Угадываем класс ADE20K по имени меша/материала, если нет userData.ifcType
const NAME_RULES = [
  [/window|glass|glaz|окн|стекл|витраж/i, 'windowpane'],
  [/door|gate|двер|ворот/i, 'door'],
  [/roof|кровл|крыш/i, 'building'],
  [/ceil|потол/i, 'ceiling'],
  [/floor|slab|перекр|пол\b|плит/i, 'floor'],
  [/stair|лестн/i, 'stairs'],
  [/rail|огражд|перил/i, 'railing'],
  [/column|колонн|пилон/i, 'column'],
  [/grass|lawn|газон|трав/i, 'grass'],
  [/ground|terrain|earth|site|земл|рельеф|участ/i, 'earth'],
  [/road|asphalt|дорог|асфальт|проезд/i, 'road'],
  [/sidewalk|pavement|тротуар|плитк/i, 'sidewalk'],
  [/tree|дерев/i, 'tree'],
  [/fence|забор/i, 'fence'],
  [/wall|стен|фасад/i, 'wall'],
];

export function guessSegColor(mesh) {
  const u = mesh.userData || {};
  if (u.segColor) return u.segColor;
  if (u.ifcType) return segColorFor(u.ifcType, u.predefinedType);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const text = [mesh.name, mesh.parent && mesh.parent.name, ...mats.map((m) => m && m.name)].filter(Boolean).join(' ');
  for (const [re, cls] of NAME_RULES) if (re.test(text)) return ADE20K[cls];
  return ADE20K.wall;
}

const CSS = `
.nr-btn{position:fixed;right:14px;bottom:14px;z-index:99999;background:#2f5fb3;color:#fff;border:0;border-radius:6px;
  padding:9px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px #0006}
.nr-panel{position:fixed;right:14px;bottom:60px;z-index:99999;width:300px;max-height:calc(100vh - 80px);overflow:auto;
  background:#1f2227;color:#e6e6e6;border:1px solid #3c414a;border-radius:8px;padding:12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px #0008}
.nr-panel h3{margin:0 0 8px;font-size:14px}
.nr-panel label{display:flex;gap:6px;align-items:center;margin:5px 0}
.nr-panel select,.nr-panel input[type=text],.nr-panel input[type=number],.nr-panel button{background:#2b2f36;color:#e6e6e6;border:1px solid #3c414a;border-radius:5px;padding:4px 8px;font:inherit}
.nr-panel button{cursor:pointer}.nr-panel button:hover{background:#353a42}
.nr-panel .pri{background:#2f5fb3;border-color:#3b6fd0}
.nr-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}
.nr-panel ul{list-style:none;margin:4px 0;padding:0}.nr-panel li{display:flex;gap:6px;align-items:center;padding:2px 0}
.nr-panel li span{flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nr-thumbs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px}.nr-thumbs img{width:100%;border:1px solid #3c414a;cursor:zoom-in}
.nr-muted{color:#8a9099;font-size:12px}
.nr-frame{position:fixed;z-index:99998;pointer-events:none;outline:2px dashed rgba(255,210,0,.9);box-shadow:0 0 0 9999px rgba(0,0,0,.35)}
`;

export function attachNeuroRender({ THREE, renderer, scene, camera, controls = null, segColor = guessSegColor,
  filter = null, storageKey = 'neuroRender.embed.views.v1', modelName = document.title || 'model' }) {
  const passes = createNeuroPasses(THREE, renderer, scene, camera, {
    segColor,
    ...(filter ? { filter } : {}),
  });
  const state = { width: 1216, height: 832 };

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'nr-btn';
  btn.textContent = 'Нейро-рендер';
  const frame = document.createElement('div');
  frame.className = 'nr-frame';
  frame.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'nr-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <h3>Нейро-рендер · проходы ControlNet</h3>
    <div class="nr-row">
      <select data-k="res">
        <option>1024x1024</option><option>1152x896</option><option selected>1216x832</option>
        <option>1344x768</option><option>832x1216</option><option>1536x1024</option><option>1920x1080</option>
      </select>
    </div>
    <div class="nr-row">
      ${PASS_NAMES.map((p) => `<label><input type="checkbox" data-pass="${p}" checked>${p}</label>`).join('')}
    </div>
    <label>Глубина <select data-k="depthMode"><option value="linear">линейная</option><option value="inverse">обратная</option></select></label>
    <label>Угол рёбер, ° <input data-k="lineAngle" type="number" value="20" min="1" max="89" style="width:60px"></label>
    <div class="nr-row"><input data-k="name" type="text" placeholder="имя ракурса" style="flex:1"><button data-a="save" class="pri">Сохранить</button></div>
    <ul data-k="views"></ul>
    <div class="nr-row"><button data-a="preview">Просмотр</button><button data-a="zip" class="pri">ZIP: кадр</button><button data-a="zipAll">ZIP: все</button></div>
    <div class="nr-muted" data-k="status">Жёлтая рамка — границы кадра экспорта.</div>
    <div class="nr-thumbs" data-k="thumbs"></div>`;
  document.body.append(btn, frame, panel);
  const q = (s) => panel.querySelector(s);
  const setStatus = (t) => { q('[data-k=status]').textContent = t; };

  function updateFrame() {
    if (panel.hidden) { frame.hidden = true; return; }
    const r = renderer.domElement.getBoundingClientRect();
    const va = r.width / r.height, ea = state.width / state.height;
    let w = r.width, h = r.height;
    if (ea > va) h = w / ea; else w = h * ea;
    Object.assign(frame.style, {
      left: `${r.left + (r.width - w) / 2}px`, top: `${r.top + (r.height - h) / 2}px`,
      width: `${w}px`, height: `${h}px`,
    });
    frame.hidden = false;
  }
  window.addEventListener('resize', updateFrame);
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; updateFrame(); });
  q('[data-k=res]').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    state.width = w; state.height = h; updateFrame();
  });

  const opts = () => ({
    width: state.width, height: state.height,
    depthMode: q('[data-k=depthMode]').value,
    lineAngle: +q('[data-k=lineAngle]').value || 20,
    passes: [...panel.querySelectorAll('[data-pass]')].filter((c) => c.checked).map((c) => c.dataset.pass),
  });

  // --- ракурсы ---
  const target = () => (controls && controls.target ? controls.target.clone()
    : camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3())));
  const loadViews = () => { try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch { return []; } };
  const storeViews = (v) => localStorage.setItem(storageKey, JSON.stringify(v));
  const safe = (s) => String(s).trim().replace(/[\\/:*?"<>|\s]+/g, '_') || 'view';
  const current = (name) => ({
    name, position: camera.position.toArray(), target: target().toArray(),
    quaternion: camera.quaternion.toArray(), fov_deg: camera.fov, width: state.width, height: state.height,
  });
  function apply(v) {
    camera.position.fromArray(v.position);
    if (controls && controls.target) { controls.target.fromArray(v.target); controls.update(); }
    else if (v.quaternion) camera.quaternion.fromArray(v.quaternion);
    if (v.fov_deg && camera.isPerspectiveCamera) { camera.fov = v.fov_deg; camera.updateProjectionMatrix(); }
    if (v.width) { state.width = v.width; state.height = v.height; q('[data-k=res]').value = `${v.width}x${v.height}`; }
    updateFrame();
  }
  function renderViews() {
    const ul = q('[data-k=views]');
    ul.innerHTML = '';
    loadViews().forEach((v, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${v.name}</span><button title="Удалить">✕</button>`;
      li.querySelector('span').onclick = () => apply(v);
      li.querySelector('button').onclick = () => { const a = loadViews(); a.splice(i, 1); storeViews(a); renderViews(); };
      ul.appendChild(li);
    });
  }
  q('[data-a=save]').addEventListener('click', () => {
    const views = loadViews();
    const name = safe(q('[data-k=name]').value || `view_${views.length + 1}`);
    const i = views.findIndex((v) => v.name === name);
    if (i >= 0) views[i] = current(name); else views.push(current(name));
    storeViews(views); renderViews(); q('[data-k=name]').value = '';
  });

  // --- проходы / экспорт ---
  function hideUi(fn) {
    // HTML-оверлеи (подписи, показатели) в canvas не попадают; прячем только нашу рамку
    frame.hidden = true;
    try { return fn(); } finally { updateFrame(); }
  }
  q('[data-a=preview]').addEventListener('click', () => {
    const res = hideUi(() => passes.renderAll(opts()));
    const box = q('[data-k=thumbs]');
    box.innerHTML = '';
    for (const p of Object.keys(res)) {
      const img = document.createElement('img');
      img.src = res[p].toDataURL();
      img.title = p;
      img.onclick = () => window.open(img.src, '_blank');
      box.appendChild(img);
    }
    setStatus('Проходы готовы');
  });

  async function exportZip(views, filename) {
    const o = opts();
    const back = current('__back__');
    const zip = new ZipWriter();
    const job = { tool: 'neuro-render', version: 1, created: new Date().toISOString(), model: modelName,
      passes: o.passes, settings: { depthMode: o.depthMode, lineAngle: o.lineAngle, lineart: 'white_on_black', seg: 'ADE20K palette' }, views: [] };
    try {
      for (const v of views) {
        apply(v);
        setStatus(`Рендер «${v.name}»…`);
        await new Promise((r) => requestAnimationFrame(r));
        const res = hideUi(() => passes.renderAll({ ...o, width: state.width, height: state.height }));
        const dir = safe(v.name);
        const files = {};
        for (const p of o.passes) { files[p] = `${dir}/${p}.png`; await zip.addBlob(files[p], await canvasToBlob(res[p])); }
        const entry = { ...current(v.name), dir, files };
        if (res.depth) entry.depth_range = [+res.depth.dataset.near, +res.depth.dataset.far];
        zip.add(`${dir}/camera.json`, JSON.stringify(entry, null, 2));
        job.views.push(entry);
      }
      zip.add('render_job.json', JSON.stringify(job, null, 2));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip.toBlob());
      a.download = filename;
      a.click();
      setStatus(`Готово: ${filename}`);
    } finally { apply(back); }
  }
  q('[data-a=zip]').addEventListener('click', () => {
    const n = safe(q('[data-k=name]').value || 'current');
    exportZip([current(n)], `passes_${n}.zip`);
  });
  q('[data-a=zipAll]').addEventListener('click', () => {
    const v = loadViews();
    if (!v.length) { setStatus('Сначала сохраните ракурсы'); return; }
    exportZip(v, 'passes_all.zip');
  });
  renderViews();

  return { passes, open: () => { panel.hidden = false; updateFrame(); } };
}
