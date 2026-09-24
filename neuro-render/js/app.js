import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import * as WebIFC from '../vendor/web-ifc-api.js';
import { loadIFC } from './ifc-loader.js';
import { createNeuroPasses, canvasToBlob, PASS_NAMES } from './passes.js';
import { segColorFor, ADE20K } from './segmap.js';
import { ZipWriter } from './zip.js';

const $ = (s) => document.querySelector(s);
const VIEWS_KEY = 'neuroRender.views.v1';
const WASM_PATH = new URL('../vendor/', import.meta.url).href;

// ---------------- сцена ----------------
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd4e6);

const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
camera.position.set(18, 8, 14);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.target.set(0, 1.5, 0);

scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x8a7f70, 1.1));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
sun.position.set(30, 45, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

const grid = new THREE.GridHelper(200, 200, 0x6f7f90, 0x8fa0b0);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.visible = false;
scene.add(grid);

const groundMat = new THREE.MeshStandardMaterial({ color: 0x9c9a8f, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.userData = { ifcType: 'ground', depthIgnoreFit: true };
ground.visible = false;
scene.add(ground);

let model = null;       // { root, counts, name }
let modelBox = new THREE.Box3();

const passes = createNeuroPasses(THREE, renderer, scene, camera, {
  filter: (o) => o.isMesh && !o.userData.noPass && o.userData.ifcType !== undefined,
  segColor: (m) => segColorFor(m.userData.ifcType, m.userData.predefinedType),
});

// ---------------- кадр / размеры ----------------
const state = { width: 1216, height: 832, focal: 28 };

function setStatus(t) { $('#status').textContent = t; }

function layout() {
  const stage = $('#stage');
  const pad = 24;
  const aw = stage.clientWidth - pad * 2;
  const ah = stage.clientHeight - pad * 2 - 20;
  const aspect = state.width / state.height;
  let w = aw, h = aw / aspect;
  if (h > ah) { h = ah; w = ah * aspect; }
  w = Math.max(50, Math.floor(w)); h = Math.max(50, Math.floor(h));
  const frame = $('#frame');
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = aspect;
  applyFocal();
}

function applyFocal() {
  // эквивалент полнокадровой камеры 36 × 24 мм: фокусное задаёт горизонтальный угол
  const hfov = 2 * Math.atan(18 / state.focal);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect));
  camera.updateProjectionMatrix();
}

function setResolution(w, h) {
  state.width = Math.max(64, Math.round(w / 8) * 8);
  state.height = Math.max(64, Math.round(h / 8) * 8);
  $('#resW').value = state.width;
  $('#resH').value = state.height;
  const key = `${state.width}x${state.height}`;
  const sel = $('#selRes');
  const opt = [...sel.options].find((o) => o.value === key);
  sel.value = opt ? key : 'custom';
  $('#customRes').hidden = !!opt;
  layout();
}

window.addEventListener('resize', layout);

// ---------------- модель ----------------
function disposeModel() {
  if (!model) return;
  scene.remove(model.root);
  model.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  model = null;
}

function fitGround() {
  if (modelBox.isEmpty()) { ground.visible = false; return; }
  const size = modelBox.getSize(new THREE.Vector3());
  const center = modelBox.getCenter(new THREE.Vector3());
  const s = Math.max(size.x, size.z) * 8 + 50;
  ground.scale.set(s, s, 1);
  ground.position.set(center.x, modelBox.min.y - 0.005, center.z);
  ground.visible = $('#chkGround').checked;
  const r = Math.max(size.x, size.y, size.z);
  sun.position.set(center.x + r * 1.2, center.y + r * 2, center.z + r * 0.8);
  sun.target.position.copy(center);
  const cam = sun.shadow.camera;
  cam.left = -r * 1.5; cam.right = r * 1.5; cam.top = r * 1.5; cam.bottom = -r * 1.5;
  cam.near = 0.1; cam.far = r * 6;
  cam.updateProjectionMatrix();
}

function frameModel() {
  if (modelBox.isEmpty()) return;
  const center = modelBox.getCenter(new THREE.Vector3());
  const size = modelBox.getSize(new THREE.Vector3());
  const r = size.length() / 2;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.05;
  const dir = new THREE.Vector3(1, 0.45, 1.1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(0.05, dist / 500);
  camera.far = dist * 50;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function computeBox() {
  modelBox = new THREE.Box3();
  if (!model) return;
  model.root.traverseVisible((o) => { if (o.isMesh) modelBox.expandByObject(o); });
}

function renderClassList() {
  const box = $('#classList');
  box.innerHTML = '';
  if (!model) return;
  const types = Object.keys(model.counts).sort();
  for (const t of types) {
    const groups = model.root.children.filter((g) => g.userData.ifcType === t);
    const visible = groups.some((g) => g.visible);
    const pre = groups[0]?.userData.predefinedType;
    const rgb = segColorFor(t, pre);
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" ${visible ? 'checked' : ''}>
      <span class="sw" style="background:rgb(${rgb.join(',')})" title="Цвет в seg (ADE20K)"></span>
      <span>${t}</span><span class="cnt">${model.counts[t]}</span>`;
    label.querySelector('input').addEventListener('change', (e) => {
      for (const g of groups) g.visible = e.target.checked;
      computeBox();
    });
    box.appendChild(label);
  }
}

async function openIfc(buffer, name) {
  setStatus(`Загрузка ${name}…`);
  $('#dropHint').hidden = true;
  try {
    disposeModel();
    const t0 = performance.now();
    const res = await loadIFC(THREE, WebIFC, buffer, {
      wasmPath: WASM_PATH,
      onProgress: (i, n) => setStatus(`Геометрия: ${i} / ${n}`),
    });
    res.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    model = { ...res, name };
    scene.add(res.root);
    computeBox();
    fitGround();
    frameModel();
    renderClassList();
    const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
    $('#modelInfo').textContent = `${name} · ${res.schema} · элементов: ${total}`;
    setStatus(`Загружено за ${((performance.now() - t0) / 1000).toFixed(1)} с`);
    renderViewList();
  } catch (err) {
    console.error(err);
    setStatus(`Ошибка загрузки IFC: ${err.message || err}`);
    $('#dropHint').hidden = false;
  }
}

$('#fileIfc').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) openIfc(await f.arrayBuffer(), f.name);
  e.target.value = '';
});

$('#btnDemo').addEventListener('click', async () => {
  const r = await fetch('./demo/demo.ifc');
  openIfc(await r.arrayBuffer(), 'demo.ifc');
});

$('#chkGround').addEventListener('change', (e) => { ground.visible = e.target.checked && !!model; });

const stage = $('#stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', async (e) => {
  e.preventDefault();
  stage.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (f.type.startsWith('image/')) loadReference(f);
  else openIfc(await f.arrayBuffer(), f.name);
});

// двойной клик — новая точка вращения камеры
const raycaster = new THREE.Raycaster();
canvas.addEventListener('dblclick', (e) => {
  if (!model) return;
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(p, camera);
  const hit = raycaster.intersectObject(model.root, true)[0];
  if (hit) {
    controls.target.copy(hit.point);
    controls.update();
    setStatus(`Точка вращения: ${hit.object.userData.ifcType} «${hit.object.userData.name || ''}»`);
  }
});

// ---------------- кадр: UI ----------------
$('#selRes').addEventListener('change', (e) => {
  if (e.target.value === 'custom') { $('#customRes').hidden = false; return; }
  const [w, h] = e.target.value.split('x').map(Number);
  setResolution(w, h);
});
$('#resW').addEventListener('change', () => setResolution(+$('#resW').value, +$('#resH').value));
$('#resH').addEventListener('change', () => setResolution(+$('#resW').value, +$('#resH').value));
$('#focal').addEventListener('input', (e) => { state.focal = Math.max(8, +e.target.value || 28); applyFocal(); });
$('#btnLevel').addEventListener('click', () => {
  controls.target.y = camera.position.y;
  controls.update();
});
$('#chkThirds').addEventListener('change', (e) => { $('#thirds').hidden = !e.target.checked; });

// ---------------- референс ----------------
let refImage = null;
function loadReference(file) {
  const url = URL.createObjectURL(file);
  const img = $('#refOverlay');
  img.onload = () => {
    refImage = { w: img.naturalWidth, h: img.naturalHeight, name: file.name };
    img.hidden = false;
    img.style.opacity = $('#refOpacity').value;
    $('#btnRefAspect').disabled = false;
    setStatus(`Референс: ${file.name} (${img.naturalWidth}×${img.naturalHeight})`);
  };
  img.src = url;
}
$('#fileRef').addEventListener('change', (e) => { if (e.target.files[0]) loadReference(e.target.files[0]); e.target.value = ''; });
$('#refOpacity').addEventListener('input', (e) => { $('#refOverlay').style.opacity = e.target.value; });
$('#btnRefAspect').addEventListener('click', () => {
  if (!refImage) return;
  // ~1 мегапиксель (оптимально для SDXL), стороны кратны 64
  const aspect = refImage.w / refImage.h;
  const h = Math.round(Math.sqrt(1024 * 1024 / aspect) / 64) * 64;
  const w = Math.round((h * aspect) / 64) * 64;
  setResolution(w, h);
});

// ---------------- ракурсы ----------------
function loadViews() {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY)) || []; } catch { return []; }
}
function storeViews(v) { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); }

function currentView(name) {
  return {
    name,
    position: camera.position.toArray().map((x) => +x.toFixed(4)),
    target: controls.target.toArray().map((x) => +x.toFixed(4)),
    focal_mm: state.focal,
    fov_deg: +camera.fov.toFixed(4),
    near: camera.near,
    far: camera.far,
    width: state.width,
    height: state.height,
  };
}

function applyView(v) {
  if (v.width && v.height) setResolution(v.width, v.height);
  if (v.focal_mm) { state.focal = v.focal_mm; $('#focal').value = v.focal_mm; }
  camera.position.fromArray(v.position);
  controls.target.fromArray(v.target);
  if (v.near) camera.near = v.near;
  if (v.far) camera.far = v.far;
  applyFocal();
  controls.update();
}

function safeName(s) {
  return String(s).trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'view';
}

function renderViewList() {
  const ul = $('#viewList');
  ul.innerHTML = '';
  const views = loadViews();
  if (!views.length) { ul.innerHTML = '<li class="muted">Пока нет сохранённых ракурсов</li>'; return; }
  views.forEach((v, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span title="Перейти">${v.name}</span><small class="muted">${v.width}×${v.height}, ${v.focal_mm} мм</small>
      <button title="Перезаписать текущей камерой">↻</button><button title="Удалить">✕</button>`;
    const [go, upd, del] = [li.querySelector('span'), ...li.querySelectorAll('button')];
    go.addEventListener('click', () => applyView(v));
    upd.addEventListener('click', () => { const a = loadViews(); a[i] = currentView(v.name); storeViews(a); renderViewList(); });
    del.addEventListener('click', () => { const a = loadViews(); a.splice(i, 1); storeViews(a); renderViewList(); });
    ul.appendChild(li);
  });
}

$('#btnSaveView').addEventListener('click', () => {
  const views = loadViews();
  let name = safeName($('#viewName').value || `view_${String(views.length + 1).padStart(2, '0')}`);
  const idx = views.findIndex((v) => v.name === name);
  if (idx >= 0) views[idx] = currentView(name); else views.push(currentView(name));
  storeViews(views);
  $('#viewName').value = '';
  renderViewList();
  setStatus(`Ракурс «${name}» сохранён`);
});

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('#btnExportViews').addEventListener('click', () => {
  download(new Blob([JSON.stringify({ views: loadViews() }, null, 2)], { type: 'application/json' }), 'views.json');
});
$('#fileViews').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const incoming = Array.isArray(data) ? data : data.views || [];
    const views = loadViews();
    for (const v of incoming) {
      const i = views.findIndex((x) => x.name === v.name);
      if (i >= 0) views[i] = v; else views.push(v);
    }
    storeViews(views);
    renderViewList();
    setStatus(`Импортировано ракурсов: ${incoming.length}`);
  } catch (err) { setStatus(`Ошибка JSON: ${err.message}`); }
  e.target.value = '';
});

// ---------------- проходы ----------------
function passOptions() {
  return {
    width: state.width,
    height: state.height,
    ssaa: +$('#ssaa').value,
    depthMode: $('#depthMode').value,
    depthGamma: +$('#depthGamma').value || 1,
    lineAngle: +$('#lineAngle').value || 20,
    lineWidth: +$('#lineWidth').value || 1,
    lineInvert: $('#lineInvert').checked,
    normalFlipX: $('#normalFlipX').checked,
    normalFlipY: $('#normalFlipY').checked,
    passes: [...document.querySelectorAll('[data-pass]')].filter((c) => c.checked).map((c) => c.dataset.pass),
  };
}

function renderPasses(opts) {
  controls.update();
  const prevGrid = grid.visible;
  grid.visible = false;
  const refHidden = $('#refOverlay').hidden;
  try {
    return passes.renderAll(opts);
  } finally {
    grid.visible = prevGrid;
    $('#refOverlay').hidden = refHidden;
  }
}

$('#btnPreview').addEventListener('click', () => {
  if (!model) { setStatus('Сначала загрузите модель'); return; }
  const opts = passOptions();
  if (!opts.passes.length) { setStatus('Не выбран ни один проход'); return; }
  setStatus('Рендер проходов…');
  requestAnimationFrame(() => {
    const t0 = performance.now();
    const res = renderPasses(opts);
    const box = $('#thumbs');
    box.innerHTML = '';
    for (const p of PASS_NAMES) {
      if (!res[p]) continue;
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = res[p].toDataURL('image/png');
      img.addEventListener('click', () => { $('#lightbox img').src = img.src; $('#lightbox').hidden = false; });
      const cap = document.createElement('figcaption');
      cap.textContent = p + (p === 'depth' ? ` (near ${res[p].dataset.near}, far ${res[p].dataset.far})` : '');
      fig.append(img, cap);
      box.appendChild(fig);
    }
    setStatus(`Проходы готовы за ${Math.round(performance.now() - t0)} мс`);
  });
});
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

// ---------------- экспорт ----------------
async function exportZip(views, filename) {
  if (!model) { setStatus('Сначала загрузите модель'); return; }
  const opts = passOptions();
  if (!opts.passes.length) { setStatus('Не выбран ни один проход'); return; }
  const saved = currentView('__current__');
  const zip = new ZipWriter();
  const job = {
    tool: 'neuro-render',
    version: 1,
    created: new Date().toISOString(),
    model: model.name,
    passes: opts.passes,
    settings: {
      ssaa: opts.ssaa, depthMode: opts.depthMode, depthGamma: opts.depthGamma,
      lineAngle: opts.lineAngle, lineWidth: opts.lineWidth,
      lineart: opts.lineInvert ? 'white_on_black' : 'black_on_white',
      normal: { flipX: opts.normalFlipX, flipY: opts.normalFlipY, convention: 'view-space, R=+X right, G=+Y up, B=toward camera' },
      seg: 'ADE20K palette',
    },
    seg_palette: {},
    views: [],
  };
  for (const t of Object.keys(model.counts)) job.seg_palette[t] = segColorFor(t);
  job.seg_palette.ground = ADE20K.earth;
  job.seg_palette.background = ADE20K.sky;

  try {
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      setStatus(`Рендер «${v.name}» (${i + 1}/${views.length})…`);
      applyView(v);
      await new Promise((r) => requestAnimationFrame(r));
      const res = renderPasses({ ...opts, width: state.width, height: state.height });
      const dir = safeName(v.name);
      const files = {};
      for (const p of opts.passes) {
        const path = `${dir}/${p}.png`;
        await zip.addBlob(path, await canvasToBlob(res[p]));
        files[p] = path;
      }
      const entry = { ...currentView(v.name), dir, files };
      if (res.depth) entry.depth_range = [+res.depth.dataset.near, +res.depth.dataset.far];
      zip.add(`${dir}/camera.json`, JSON.stringify(entry, null, 2));
      job.views.push(entry);
    }
    zip.add('render_job.json', JSON.stringify(job, null, 2));
    download(zip.toBlob(), filename);
    setStatus(`Готово: ${filename} (ракурсов: ${views.length})`);
  } catch (err) {
    console.error(err);
    setStatus(`Ошибка экспорта: ${err.message || err}`);
  } finally {
    applyView(saved);
  }
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
$('#btnZipCurrent').addEventListener('click', () => {
  const name = safeName($('#viewName').value || 'current');
  exportZip([currentView(name)], `passes_${name}_${stamp()}.zip`);
});
$('#btnZipAll').addEventListener('click', () => {
  const views = loadViews();
  if (!views.length) { setStatus('Нет сохранённых ракурсов — сохраните хотя бы один'); return; }
  exportZip(views, `passes_all_${stamp()}.zip`);
});

// ---------------- запуск ----------------
setResolution(state.width, state.height);
renderViewList();

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();

// ?ifc=путь/к/модели.ifc — автозагрузка
const params = new URLSearchParams(location.search);
const auto = params.get('ifc');
if (auto) {
  fetch(auto).then((r) => r.arrayBuffer()).then((b) => openIfc(b, auto.split('/').pop()))
    .catch((e) => setStatus(`Не удалось загрузить ${auto}: ${e.message}`));
}

// для отладки из консоли
window.neuro = { THREE, scene, camera, controls, renderer, passes, get model() { return model; } };
