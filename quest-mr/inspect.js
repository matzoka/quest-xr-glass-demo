// Standalone inspection viewer for the Klingon K't'inga model.
// Loads the same OBJ/MTL + textures used by the main app, applies the same
// material treatment (textures kept, stray loose-edge lines hidden), and shows
// it fully lit and fully opaque with orbit controls so the hull can be checked
// up close. This page is intentionally separate from app.js so it never touches
// the XR scene.
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.getElementById("c");
const statusEl = document.getElementById("status");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 2000);
camera.position.set(6, 4, 9);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.9;

// Lighting: neutral key/fill/rim + ambient + hemisphere so the textured hull
// reads clearly from every orbit angle.
scene.add(new THREE.AmbientLight(0xffffff, 0.95));
const hemi = new THREE.HemisphereLight(0xdcecff, 0x2a3230, 1.0);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(5, 8, 6);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd6ff, 1.1);
fill.position.set(-7, 3, -4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffe6c0, 1.2);
rim.position.set(-2, 5, -9);
scene.add(rim);
const under = new THREE.DirectionalLight(0xc8d4e0, 0.5);
under.position.set(0, -6, 3);
scene.add(under);

const grid = new THREE.GridHelper(40, 40, 0x335066, 0x1c2b38);
grid.position.y = -3;
scene.add(grid);

const modelRoot = new THREE.Group();
scene.add(modelRoot);

let maxAnisotropy = 1;
try {
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
} catch (e) {
  maxAnisotropy = 1;
}

function getMaterialTextureName(material) {
  const tex = material && material.map;
  const src = tex && tex.image && (tex.image.currentSrc || tex.image.src);
  if (!src) return "";
  return src.split("/").pop().toLowerCase();
}

// Texture-preserving tune, same intent as the app but fully opaque for review.
function tuneMaterial(material) {
  if (!material) return material;
  const name = (material.name || "").toLowerCase();
  const textureName = getMaterialTextureName(material);
  const isRed = name.includes("red") || textureName.includes("red");
  const isGreen = name.includes("green") || textureName.includes("green");
  const isOrange = name.includes("orange") || textureName.includes("orange");
  const isEngine = name.includes("engine") || textureName.includes("engine");
  const isGlowAccent = isEngine || isGreen || isOrange || isRed;

  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.opacity = 1;
  if ("wireframe" in material) material.wireframe = false;
  if (material.color) material.color.set(0xffffff);

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.anisotropy = maxAnisotropy;
  }
  if (material.specular) material.specular.set(0x222a24);
  if ("shininess" in material) material.shininess = Math.max(material.shininess || 0, 22);

  if (material.emissive) {
    material.emissive.set(0x000000);
    if (material.emissiveMap) material.emissive.set(0xffffff);
    if (isEngine || isOrange) material.emissive.set(0xff7a22);
    else if (isGreen) material.emissive.set(0x45ff8f);
    else if (isRed) material.emissive.set(0xff2518);
  }
  if ("emissiveIntensity" in material) material.emissiveIntensity = isGlowAccent ? 1.15 : 0.0;

  material.needsUpdate = true;
  return material;
}

function makeKtingaWingSkinMaterial(sampleMap) {
  if (sampleMap) {
    sampleMap.colorSpace = THREE.SRGBColorSpace;
    sampleMap.anisotropy = maxAnisotropy;
    sampleMap.wrapS = THREE.RepeatWrapping;
    sampleMap.wrapT = THREE.RepeatWrapping;
    sampleMap.repeat.set(1.65, 1.45);
    sampleMap.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({
    color: 0xc7ddcf,
    map: sampleMap || null,
    roughness: 0.86,
    metalness: 0.06,
    emissive: 0x06100a,
    emissiveIntensity: 0.04,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
  });
}

function getMeshVerticesInObjectSpace(root, mesh) {
  const vertices = [];
  const position = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
  if (!position) return vertices;
  root.updateWorldMatrix(true, true);
  mesh.updateWorldMatrix(true, false);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(toRoot);
    vertices.push(point.clone());
  }
  return vertices;
}

function convexHullXZ(points) {
  const unique = [];
  const seen = new Set();
  for (const point of points) {
    const key = `${point.x.toFixed(4)},${point.z.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(point);
    }
  }
  unique.sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
  if (unique.length <= 3) return unique;
  const cross = (origin, a, b) => (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function getMeshMaterialKey(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats
    .map((material) => `${material && material.name ? material.name : ""} ${getMaterialTextureName(material)}`)
    .join(" ")
    .toLowerCase();
}

function getKtingaWingSourceVertices(obj) {
  const sourceVertices = [];
  obj.updateWorldMatrix(true, true);
  obj.traverse((child) => {
    if (!child.isMesh || child.name.includes("textured-wing-skin")) return;
    const materialKey = getMeshMaterialKey(child);
    if (!/(ktmain|ktbrown|ktgray|ktgreen3)/.test(materialKey)) return;
    const vertices = getMeshVerticesInObjectSpace(obj, child);
    if (!vertices.length) return;
    const box = new THREE.Box3().setFromPoints(vertices);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const isWingSpan = size.x > 1.2 && size.z > 0.08 && center.z > -1.85 && center.z < 1.85 && box.max.y < 0.56;
    if (isWingSpan) sourceVertices.push(...vertices);
  });
  return sourceVertices;
}

function addKtingaWingSkins(obj, sampleMap) {
  const sourceVertices = getKtingaWingSourceVertices(obj);
  if (sourceVertices.length < 3) return;

  const material = makeKtingaWingSkinMaterial(sampleMap);
  const group = new THREE.Group();
  group.name = "ktinga-textured-wing-skins";

  const bounds = new THREE.Box3().setFromPoints(sourceVertices);
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const skinY = Math.min(bounds.max.y + 0.012, 0.2);

  const makeSkin = (name, hull) => {
    const xValues = hull.map((p) => p.x);
    const zValues = hull.map((p) => p.z);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);
    const spanX = Math.max(maxX - minX, 0.0001);
    const spanZ = Math.max(maxZ - minZ, 0.0001);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(hull.flatMap((p) => [p.x, skinY, p.z]), 3));
    geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(hull.flatMap((p) => [(p.x - minX) / spanX, (p.z - minZ) / spanZ]), 2)
    );
    const indices = [];
    for (let i = 1; i < hull.length - 1; i++) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
    hullMeshes.push(mesh);
  };

  for (const side of [-1, 1]) {
    const sidePoints = sourceVertices.filter((p) => {
      const outward = Math.abs(p.x - centerX);
      return side * (p.x - centerX) > 0.08 && outward < 2.08 && p.z > -1.68 && p.z < 1.28;
    });
    const hull = convexHullXZ(sidePoints);
    if (hull.length >= 3) makeSkin(`ktinga-${side < 0 ? "port" : "starboard"}-textured-wing-skin`, hull);
  }

  obj.add(group);
}

const lineObjects = [];
let wireOn = false;
let hullMeshes = [];

function setWireframe(on) {
  wireOn = on;
  for (const m of hullMeshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat) => {
      if ("wireframe" in mat) mat.wireframe = on;
    });
  }
}

new MTLLoader().setPath("./assets/KtingaClass/").load(
  "ktinga.mtl",
  (materials) => {
    materials.preload();
    new OBJLoader()
      .setMaterials(materials)
      .setPath("./assets/KtingaClass/")
      .load(
        "ktinga.obj",
        (obj) => {
          let meshCount = 0;
          let matCount = 0;
          let wingSkinMap = null;
          obj.traverse((child) => {
            if (child.isMesh) {
              meshCount++;
              hullMeshes.push(child);
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach((m) => {
                matCount++;
                tuneMaterial(m);
                const textureName = getMaterialTextureName(m);
                if (!wingSkinMap && m.map && textureName.includes("ktmainup1")) wingSkinMap = m.map.clone();
                if (!wingSkinMap && m.map && textureName.includes("ktmainup")) wingSkinMap = m.map.clone();
              });
            } else if (child.isLine) {
              child.visible = false;
              lineObjects.push(child);
            }
          });
          addKtingaWingSkins(obj, wingSkinMap);

          // Center and scale to a comfortable size (~8 units long).
          const box = new THREE.Box3().setFromObject(obj);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          obj.scale.setScalar(8 / maxDim);
          obj.updateMatrixWorld(true);
          const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
          obj.position.sub(center);
          modelRoot.add(obj);

          window.__inspect = { modelRoot, hullMeshes, lineObjects }; // TEMP debug
          statusEl.textContent =
            `読み込み完了  メッシュ:${meshCount}  マテリアル:${matCount}  遊離線:${lineObjects.length}(非表示)`;
          statusEl.style.color = "#8fe39a";
          console.log("K't'inga inspector loaded", { meshCount, matCount, lineObjects: lineObjects.length });
        },
        (xhr) => {
          if (xhr.total) statusEl.textContent = `読み込み中… ${((xhr.loaded / xhr.total) * 100) | 0}%`;
        },
        (err) => {
          statusEl.textContent = "モデル読み込み失敗（コンソール参照）";
          statusEl.style.color = "#ff8080";
          console.error("OBJ load failed:", err);
        }
      );
  },
  undefined,
  (err) => {
    statusEl.textContent = "マテリアル読み込み失敗（コンソール参照）";
    statusEl.style.color = "#ff8080";
    console.error("MTL load failed:", err);
  }
);

// View presets. The K't'inga bow (command head) is at the model's local -Z.
function setView(kind) {
  const d = 13;
  controls.target.set(0, 0, 0);
  if (kind === "top") camera.position.set(0.001, d, 0.001);
  else if (kind === "front") camera.position.set(0, 1.5, -d); // looking at the bow (-Z) head-on
  else if (kind === "side") camera.position.set(d, 1.5, 0);
  else camera.position.set(d * 0.7, d * 0.5, d * 0.7);
  controls.update();
}

// HUD wiring
const btnSpin = document.getElementById("spin");
const btnWire = document.getElementById("wire");
const btnGrid = document.getElementById("grid");
const btnLines = document.getElementById("lines");
btnSpin.onclick = () => {
  controls.autoRotate = !controls.autoRotate;
  btnSpin.textContent = `自動回転: ${controls.autoRotate ? "ON" : "OFF"}`;
  btnSpin.classList.toggle("active", controls.autoRotate);
};
btnWire.onclick = () => {
  setWireframe(!wireOn);
  btnWire.classList.toggle("active", wireOn);
};
btnGrid.onclick = () => {
  grid.visible = !grid.visible;
  btnGrid.classList.toggle("active", grid.visible);
};
btnLines.onclick = () => {
  const show = !lineObjects.some((l) => l.visible);
  lineObjects.forEach((l) => (l.visible = show));
  btnLines.textContent = `遊離線: ${show ? "表示" : "非表示"}`;
  btnLines.classList.toggle("active", show);
};
document.getElementById("top").onclick = () => setView("top");
document.getElementById("front").onclick = () => setView("front");
document.getElementById("side").onclick = () => setView("side");
document.getElementById("iso").onclick = () => setView("iso");

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
