// Standalone inspection viewer for the Klingon ship model.
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

new MTLLoader().setPath("./assets/klingon_ship/").load(
  "klingon_ship.mtl",
  (materials) => {
    materials.preload();
    new OBJLoader()
      .setMaterials(materials)
      .setPath("./assets/klingon_ship/")
      .load(
        "klingon_ship.obj",
        (obj) => {
          let meshCount = 0;
          let matCount = 0;
          obj.traverse((child) => {
            if (child.isMesh) {
              meshCount++;
              hullMeshes.push(child);
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach((m) => {
                matCount++;
                tuneMaterial(m);
              });
            } else if (child.isLine) {
              child.visible = false;
              lineObjects.push(child);
            }
          });

          // Center and scale to a comfortable size (~8 units long).
          const box = new THREE.Box3().setFromObject(obj);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          obj.scale.setScalar(8 / maxDim);
          obj.updateMatrixWorld(true);
          const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
          obj.position.sub(center);
          modelRoot.add(obj);

          window.__inspect = { modelRoot, hullMeshes, lineObjects };
          statusEl.textContent =
            `読み込み完了  メッシュ:${meshCount}  マテリアル:${matCount}  遊離線:${lineObjects.length}(非表示)`;
          statusEl.style.color = "#8fe39a";
          console.log("Klingon ship inspector loaded", { meshCount, matCount, lineObjects: lineObjects.length });
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

// View presets. The runtime pass is checked separately for forward direction.
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
