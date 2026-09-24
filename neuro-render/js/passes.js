// Служебные проходы (control passes) для нейро-рендера через ControlNet.
//
// Модуль не импортирует three.js сам: THREE передаётся параметром, поэтому
// его можно подключить к любой уже готовой three.js-сцене (r150+), например
// к вашей HTML-модели с показателями:
//
//   import { createNeuroPasses } from './neuro-render/js/passes.js';
//   const np = createNeuroPasses(THREE, renderer, scene, camera);
//   const canvases = np.renderAll({ width: 1216, height: 832 });
//   // canvases.depth, canvases.normal, canvases.lineart, canvases.seg, canvases.beauty
//
// Проходы:
//   beauty  — сцена как есть (со своими материалами, светом, tone mapping)
//   depth   — карта глубины: ближе = светлее (так ждут ControlNet depth)
//   normal  — нормали в пространстве камеры (R = X вправо, G = Y вверх, B = на зрителя)
//   lineart — видимые рёбра модели без невидимых линий (белые на чёрном для ControlNet)
//   seg     — заливка по классам IFC цветами ADE20K (ControlNet seg)

export const PASS_NAMES = ['beauty', 'depth', 'normal', 'lineart', 'seg'];

const DEFAULTS = {
  width: 1024,
  height: 1024,
  ssaa: 2,                   // суперсэмплинг для depth/normal/lineart (1 = выкл.)
  depthMode: 'linear',       // 'linear' | 'inverse' (похоже на MiDaS)
  depthNear: null,           // null = подобрать автоматически по модели
  depthFar: null,
  depthGamma: 1.0,
  normalFlipX: false,
  normalFlipY: false,
  lineAngle: 20,             // порог угла между гранями, градусы
  lineWidth: 1,              // толщина линии в пикселях итогового кадра (1..4)
  lineInvert: true,          // true = белые линии на чёрном (формат ControlNet lineart/canny)
  segSky: [6, 230, 230],     // цвет фона в seg (ADE20K «sky»)
  segBackground: null,       // если задан — перекрывает segSky
};

export function createNeuroPasses(THREE, renderer, scene, camera, options = {}) {
  const cfg = {
    // Какие объекты участвуют в проходах (по умолчанию все видимые Mesh,
    // кроме помеченных userData.noPass = true).
    filter: (obj) => obj.isMesh && !obj.userData.noPass,
    // Цвет сегментации для меша: [r, g, b] 0..255
    segColor: (mesh) => mesh.userData.segColor || [180, 120, 120],
    ...options,
  };

  const hasChunk = (name) => THREE.ShaderChunk && THREE.ShaderChunk[name] !== undefined;
  const inc = (name) => (hasChunk(name) ? `#include <${name}>` : '');

  const VERT = /* glsl */ `
    #include <common>
    ${inc('batching_pars_vertex')}
    varying vec3 vViewPosition;
    void main() {
      ${inc('batching_vertex')}
      #include <begin_vertex>
      #include <project_vertex>
      vViewPosition = -mvPosition.xyz;
    }
  `;

  const FRAG_DEPTH = /* glsl */ `
    uniform float uNear;
    uniform float uFar;
    uniform float uGamma;
    uniform int uMode;
    varying vec3 vViewPosition;
    void main() {
      float z = max(vViewPosition.z, 1e-6);
      float d;
      if (uMode == 1) {
        d = (1.0 / z - 1.0 / uFar) / (1.0 / uNear - 1.0 / uFar);
      } else {
        d = 1.0 - (z - uNear) / (uFar - uNear);
      }
      d = pow(clamp(d, 0.0, 1.0), uGamma);
      gl_FragColor = vec4(vec3(d), 1.0);
    }
  `;

  const FRAG_NORMAL = /* glsl */ `
    uniform vec2 uFlip;
    varying vec3 vViewPosition;
    void main() {
      vec3 n = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
      n.xy *= uFlip;
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    }
  `;

  const FRAG_FLAT = /* glsl */ `
    uniform vec3 uColor;
    void main() { gl_FragColor = vec4(uColor, 1.0); }
  `;

  const mat = (fragmentShader, uniforms, extra = {}) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      side: THREE.DoubleSide,
      ...extra,
    });

  const depthMat = mat(FRAG_DEPTH, {
    uNear: { value: 0.1 }, uFar: { value: 100 }, uGamma: { value: 1 }, uMode: { value: 0 },
  });
  const normalMat = mat(FRAG_NORMAL, { uFlip: { value: new THREE.Vector2(1, 1) } });
  const whiteMat = mat(FRAG_FLAT, { uColor: { value: new THREE.Vector3(1, 1, 1) } }, {
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });
  const segMats = new Map();
  const segMat = (rgb) => {
    const key = rgb.join(',');
    if (!segMats.has(key)) {
      segMats.set(key, mat(FRAG_FLAT, {
        uColor: { value: new THREE.Vector3(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) },
      }));
    }
    return segMats.get(key);
  };

  // ---------- вспомогательное ----------

  function collectMeshes() {
    const list = [];
    scene.traverseVisible((o) => { if (cfg.filter(o)) list.push(o); });
    return list;
  }

  // Прячем всё, что не участвует в проходе (сетки, хелперы, спрайты, подписи),
  // подменяем материалы мешей; возвращаем функцию восстановления.
  function isolate(meshes, materialFor) {
    const keep = new Set(meshes);
    const hidden = [];
    const swapped = [];
    scene.traverse((o) => {
      if (keep.has(o)) {
        swapped.push([o, o.material]);
        o.material = materialFor(o);
      } else if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.visible) {
        hidden.push(o);
        o.visible = false;
      }
    });
    const bg = scene.background;
    const fog = scene.fog;
    const override = scene.overrideMaterial;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = null;
    return () => {
      for (const [o, m] of swapped) o.material = m;
      for (const o of hidden) o.visible = true;
      scene.background = bg;
      scene.fog = fog;
      scene.overrideMaterial = override;
    };
  }

  // Кадр экспорта = самый большой прямоугольник нужных пропорций по центру окна
  // просмотра (если пропорции совпадают — кадр идентичен окну).
  function passCamera(w, h) {
    const cam = camera.clone();
    if (cam.isPerspectiveCamera) {
      const viewAspect = camera.aspect;
      const exportAspect = w / h;
      if (exportAspect > viewAspect + 1e-6) {
        const t = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * (viewAspect / exportAspect);
        cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t));
      }
      cam.aspect = exportAspect;
    } else if (cam.isOrthographicCamera) {
      // сохраняем вертикальный охват, подгоняем горизонтальный
      const cy = (cam.top + cam.bottom) / 2;
      const cx = (cam.left + cam.right) / 2;
      let hh = (cam.top - cam.bottom) / 2;
      const hw = (cam.right - cam.left) / 2;
      if (hh * (w / h) > hw) hh = hw / (w / h);
      cam.top = cy + hh; cam.bottom = cy - hh;
      cam.left = cx - hh * (w / h); cam.right = cx + hh * (w / h);
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return cam;
  }

  function renderToCanvas(targetScene, cam, w, h, clearRGB, extraScene = null) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    const prevTarget = renderer.getRenderTarget();
    const prevClear = new THREE.Color();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    const prevXR = renderer.xr ? renderer.xr.enabled : false;
    if (renderer.xr) renderer.xr.enabled = false;

    renderer.setRenderTarget(rt);
    // Цвет очистки в рабочем (линейном) пространстве: при рендере в render target
    // three.js не преобразует его, поэтому значения попадают в PNG «как есть».
    renderer.setClearColor(new THREE.Color(clearRGB[0] / 255, clearRGB[1] / 255, clearRGB[2] / 255), 1);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
    renderer.render(targetScene, cam);
    if (extraScene) {
      renderer.autoClear = false;
      renderer.render(extraScene, cam);
    }

    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    if (renderer.xr) renderer.xr.enabled = prevXR;
    rt.dispose();

    // WebGL читает снизу вверх — переворачиваем
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function downscale(src, w, h) {
    if (src.width === w && src.height === h) return src;
    // поэтапное уменьшение в 2 раза — чище, чем за один шаг
    let cur = src;
    while (cur.width / 2 >= w && cur.height / 2 >= h && cur.width / 2 !== w) {
      const c = document.createElement('canvas');
      c.width = Math.round(cur.width / 2); c.height = Math.round(cur.height / 2);
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, c.width, c.height);
      cur = c;
    }
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    return out;
  }

  // Утолщение тёмных линий на светлом фоне (минимум по окрестности)
  function thicken(canvas, radius) {
    if (radius <= 0) return canvas;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const src = ctx.getImageData(0, 0, w, h);
    const s = src.data;
    const lum = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = s[i * 4];
    const tmp = new Uint8Array(w * h);
    // раздельный фильтр: по X, затем по Y
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 255;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < w) { const v = lum[y * w + xx]; if (v < m) m = v; }
        }
        tmp[y * w + x] = m;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 255;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < h) { const v = tmp[yy * w + x]; if (v < m) m = v; }
        }
        const i = (y * w + x) * 4;
        s[i] = s[i + 1] = s[i + 2] = m;
      }
    }
    ctx.putImageData(src, 0, 0);
    return canvas;
  }

  function invert(canvas) {
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = 255 - d.data[i];
      d.data[i + 1] = 255 - d.data[i + 1];
      d.data[i + 2] = 255 - d.data[i + 2];
    }
    ctx.putImageData(d, 0, 0);
    return canvas;
  }

  // Автоподбор near/far по габаритам модели в пространстве камеры
  function fitDepthRange(meshes, cam) {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const m of meshes) {
      if (m.userData.depthIgnoreFit) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
      box.union(tmp);
    }
    if (box.isEmpty()) return [cam.near, cam.far];
    const v = new THREE.Vector3();
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.applyMatrix4(cam.matrixWorldInverse);
      const z = -v.z;
      zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    }
    const near = Math.max(cam.near || 0.01, zmin * 0.98, 0.01);
    const far = Math.max(near * 1.01, Math.min(cam.far || Infinity, zmax * 1.02));
    return [near, far];
  }

  // Кэш рёбер для lineart
  const edgesCache = new WeakMap();
  function edgesFor(geometry, angle) {
    let entry = edgesCache.get(geometry);
    if (!entry || entry.angle !== angle) {
      if (entry) entry.geo.dispose();
      entry = { angle, geo: new THREE.EdgesGeometry(geometry, angle) };
      edgesCache.set(geometry, entry);
    }
    return entry.geo;
  }

  function buildLineScene(meshes, angle) {
    const lineScene = new THREE.Scene();
    const m4 = new THREE.Matrix4();
    for (const mesh of meshes) {
      const geo = edgesFor(mesh.geometry, angle);
      if (mesh.isInstancedMesh) {
        const n = Math.min(mesh.count, 20000);
        for (let i = 0; i < n; i++) {
          mesh.getMatrixAt(i, m4);
          const l = new THREE.LineSegments(geo, lineMat);
          l.matrixAutoUpdate = false;
          l.matrix.multiplyMatrices(mesh.matrixWorld, m4);
          l.matrixWorld.copy(l.matrix);
          lineScene.add(l);
        }
      } else {
        const l = new THREE.LineSegments(geo, lineMat);
        l.matrixAutoUpdate = false;
        l.matrix.copy(mesh.matrixWorld);
        l.matrixWorld.copy(mesh.matrixWorld);
        lineScene.add(l);
      }
    }
    return lineScene;
  }

  // ---------- проходы ----------

  function renderBeauty(o) {
    const w = o.width, h = o.height;
    const cam = passCamera(w, h);
    const prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);
    const prevRatio = renderer.getPixelRatio();
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.render(scene, cam);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(renderer.domElement, 0, 0, w, h);
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    renderer.setRenderTarget(prevTarget);
    renderer.render(scene, camera);
    return out;
  }

  function renderDepth(o, meshes) {
    const s = Math.max(1, o.ssaa | 0);
    const W = o.width * s, H = o.height * s;
    const cam = passCamera(o.width, o.height);
    let [near, far] = fitDepthRange(meshes, cam);
    if (o.depthNear != null) near = o.depthNear;
    if (o.depthFar != null) far = o.depthFar;
    depthMat.uniforms.uNear.value = near;
    depthMat.uniforms.uFar.value = far;
    depthMat.uniforms.uGamma.value = o.depthGamma;
    depthMat.uniforms.uMode.value = o.depthMode === 'inverse' ? 1 : 0;
    const restore = isolate(meshes, () => depthMat);
    try {
      const c = renderToCanvas(scene, cam, W, H, [0, 0, 0]);
      const out = downscale(c, o.width, o.height);
      out.dataset.near = near.toFixed(3);
      out.dataset.far = far.toFixed(3);
      return out;
    } finally { restore(); }
  }

  function renderNormal(o, meshes) {
    const s = Math.max(1, o.ssaa | 0);
    const cam = passCamera(o.width, o.height);
    normalMat.uniforms.uFlip.value.set(o.normalFlipX ? -1 : 1, o.normalFlipY ? -1 : 1);
    const restore = isolate(meshes, () => normalMat);
    try {
      const c = renderToCanvas(scene, cam, o.width * s, o.height * s, [128, 128, 255]);
      return downscale(c, o.width, o.height);
    } finally { restore(); }
  }

  function renderLineart(o, meshes) {
    const s = Math.max(1, o.ssaa | 0);
    const cam = passCamera(o.width, o.height);
    const lineScene = buildLineScene(meshes, o.lineAngle);
    const restore = isolate(meshes, () => whiteMat);
    try {
      let c = renderToCanvas(scene, cam, o.width * s, o.height * s, [255, 255, 255], lineScene);
      const radius = Math.round(((o.lineWidth || 1) - 1) * s / 2 + (s > 1 ? (s - 1) / 2 : 0));
      c = thicken(c, radius);
      c = downscale(c, o.width, o.height);
      if (o.lineInvert) invert(c);
      return c;
    } finally { restore(); }
  }

  function renderSeg(o, meshes) {
    const cam = passCamera(o.width, o.height);
    const restore = isolate(meshes, (m) => segMat(cfg.segColor(m)));
    try {
      // без сглаживания: в карте классов должны быть только «чистые» цвета
      return renderToCanvas(scene, cam, o.width, o.height, o.segBackground || o.segSky);
    } finally { restore(); }
  }

  function render(name, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    o.width = Math.max(8, Math.round(o.width));
    o.height = Math.max(8, Math.round(o.height));
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    if (name === 'beauty') return renderBeauty(o);
    const meshes = collectMeshes();
    switch (name) {
      case 'depth': return renderDepth(o, meshes);
      case 'normal': return renderNormal(o, meshes);
      case 'lineart': return renderLineart(o, meshes);
      case 'seg': return renderSeg(o, meshes);
      default: throw new Error(`Неизвестный проход: ${name}`);
    }
  }

  function renderAll(opts = {}) {
    const list = opts.passes || PASS_NAMES;
    const out = {};
    for (const p of list) out[p] = render(p, opts);
    return out;
  }

  // Параметры камеры в JSON — чтобы повторить кадр где угодно
  function cameraState(target = null) {
    const c = camera;
    const dir = new THREE.Vector3();
    c.getWorldDirection(dir);
    return {
      type: c.isOrthographicCamera ? 'orthographic' : 'perspective',
      position: c.position.toArray(),
      quaternion: c.quaternion.toArray(),
      up: c.up.toArray(),
      target: target ? target.toArray() : c.position.clone().add(dir).toArray(),
      fov: c.fov ?? null,
      zoom: c.zoom,
      near: c.near,
      far: c.far,
    };
  }

  function dispose() {
    depthMat.dispose(); normalMat.dispose(); whiteMat.dispose(); lineMat.dispose();
    for (const m of segMats.values()) m.dispose();
    segMats.clear();
  }

  return { render, renderAll, cameraState, dispose, config: cfg, defaults: { ...DEFAULTS } };
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((res) => canvas.toBlob(res, type));
}
