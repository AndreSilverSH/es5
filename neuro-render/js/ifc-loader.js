// Загрузка IFC через web-ifc → группа three.js.
// Каждый меш получает userData: { expressID, ifcType, predefinedType, name, globalId }.

import { HIDDEN_BY_DEFAULT } from './segmap.js';

let apiPromise = null;

export function getIfcApi(WebIFC, wasmPath) {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new WebIFC.IfcAPI();
      api.SetWasmPath(wasmPath, true);
      await api.Init(undefined, true); // однопоточный режим: не нужен cross-origin isolation
      return api;
    })();
  }
  return apiPromise;
}

function readValue(v) {
  if (v == null) return null;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

export async function loadIFC(THREE, WebIFC, data, { wasmPath, onProgress } = {}) {
  const api = await getIfcApi(WebIFC, wasmPath);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const modelID = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  const schema = api.GetModelSchema(modelID);

  const root = new THREE.Group();
  root.name = 'IFC';
  const materials = new Map();
  const getMaterial = (c) => {
    const key = [c.x, c.y, c.z, c.w].map((v) => v.toFixed(3)).join(',');
    if (!materials.has(key)) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(c.x, c.y, c.z),
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: c.w < 0.999,
        opacity: c.w,
        depthWrite: c.w >= 0.999,
      });
      materials.set(key, m);
    }
    return materials.get(key);
  };

  const counts = {};
  const elements = new Map();
  const typeCache = new Map();
  const matrix = new THREE.Matrix4();

  const typeName = (code) => {
    if (!typeCache.has(code)) {
      let n = String(code);
      try { n = api.GetNameFromTypeCode(code) || n; } catch (e) { /* старая версия */ }
      typeCache.set(code, n);
    }
    return typeCache.get(code);
  };

  api.StreamAllMeshes(modelID, (flatMesh, index, total) => {
    const id = flatMesh.expressID;
    const ifcType = typeName(api.GetLineType(modelID, id));
    let name = '', globalId = '', predefinedType = '';
    try {
      const line = api.GetLine(modelID, id);
      name = readValue(line.Name) || '';
      globalId = readValue(line.GlobalId) || '';
      predefinedType = readValue(line.PredefinedType) || '';
    } catch (e) { /* пропускаем атрибуты */ }

    const group = new THREE.Group();
    group.name = name || `${ifcType} #${id}`;
    group.userData = { expressID: id, ifcType, predefinedType, name, globalId };

    const placed = flatMesh.geometries;
    for (let i = 0; i < placed.size(); i++) {
      const pg = placed.get(i);
      const geom = api.GetGeometry(modelID, pg.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      if (geom.delete) geom.delete();
      if (!verts.length || !idx.length) continue;

      const n = verts.length / 6;
      const pos = new Float32Array(n * 3);
      const nor = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        pos[v * 3] = verts[v * 6];
        pos[v * 3 + 1] = verts[v * 6 + 1];
        pos[v * 3 + 2] = verts[v * 6 + 2];
        nor[v * 3] = verts[v * 6 + 3];
        nor[v * 3 + 1] = verts[v * 6 + 4];
        nor[v * 3 + 2] = verts[v * 6 + 5];
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      bg.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
      matrix.fromArray(pg.flatTransformation);
      bg.applyMatrix4(matrix);
      bg.computeBoundingBox();
      bg.computeBoundingSphere();

      const mesh = new THREE.Mesh(bg, getMaterial(pg.color));
      mesh.userData = { ...group.userData, ifcColor: [pg.color.x, pg.color.y, pg.color.z, pg.color.w] };
      mesh.name = group.name;
      group.add(mesh);
    }
    if (group.children.length) {
      group.visible = !HIDDEN_BY_DEFAULT.has(ifcType.toLowerCase());
      root.add(group);
      counts[ifcType] = (counts[ifcType] || 0) + 1;
      elements.set(id, group);
    }
    if (onProgress && (index % 25 === 0 || index === total - 1)) onProgress(index + 1, total);
  });

  api.CloseModel(modelID);
  return { root, schema, counts, elements };
}
