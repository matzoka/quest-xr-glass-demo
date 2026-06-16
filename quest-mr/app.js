import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

const statusEl = document.querySelector("#status");
const vrButton = document.querySelector("#vrButton");
const arButton = document.querySelector("#arButton");

// ---------------------------------------------------------------------------
// Scene / renderer
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090c);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

// ---------------------------------------------------------------------------
// Room: a box floating in space. Floor, walls and ball all share ONE frame:
// a point is described by its offset from `roomCenter`, and the ball stays
// inside +/-(roomHalf - ballRadius) on each axis. The floor grid is placed on
// the exact bottom face of the box, so the ball can never bounce below it.
// ---------------------------------------------------------------------------
const roomCenter = new THREE.Vector3(0, 2.2, -2.2); // world position of the box center
const roomHalf = new THREE.Vector3(4.5, 2.2, 4.5); // half extents (box is 9 x 4.4 x 9 m)
let ballRadius = 0.36; // set from the Earth radius below
const collisionHalf = new THREE.Vector3(); // roomHalf - ballRadius, per axis

function updateCollisionHalf() {
  collisionHalf.set(
    Math.max(0.04, roomHalf.x - ballRadius),
    Math.max(0.04, roomHalf.y - ballRadius),
    Math.max(0.04, roomHalf.z - ballRadius)
  );
}
updateCollisionHalf();

// Wireframe walls of the room.
const boundsFrame = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(roomHalf.x * 2, roomHalf.y * 2, roomHalf.z * 2)),
  new THREE.LineBasicMaterial({ color: 0x6fe9ff, transparent: true, opacity: 0.5 })
);
boundsFrame.position.copy(roomCenter);
scene.add(boundsFrame);

// Floor grid, sitting exactly on the bottom face of the box.
const floor = new THREE.GridHelper(Math.max(roomHalf.x, roomHalf.z) * 2, 16, 0x315469, 0x172431);
floor.position.set(roomCenter.x, roomCenter.y - roomHalf.y, roomCenter.z);
scene.add(floor);

// Camera frames the whole room from outside the front face (desktop preview).
const halfFovY = THREE.MathUtils.degToRad(camera.fov * 0.5);
const halfFovX = Math.atan(Math.tan(halfFovY) * camera.aspect);
const fitDist = Math.max(roomHalf.y / Math.tan(halfFovY), roomHalf.x / Math.tan(halfFovX));
camera.position.set(0, roomCenter.y, roomCenter.z + fitDist + roomHalf.z + 0.5);
camera.lookAt(roomCenter);

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xe8f7ff, 0x1b2330, 1.4);
scene.add(hemi);

// Acts as the "sun": lights one hemisphere of the Earth, leaving a soft night side.
const sun = new THREE.DirectionalLight(0xffffff, 3.0);
sun.position.set(3, 2, 2);
scene.add(sun);

const cyan = new THREE.PointLight(0x2fc7ff, 4, 6);
cyan.position.set(-1.5, 1.2, -0.8);
scene.add(cyan);

// ---------------------------------------------------------------------------
// Ball state. `ballOffset` is the displacement from roomCenter; the room is
// never rotated, so offsets/velocities are identical in world and room space.
// ---------------------------------------------------------------------------
const ballGroup = new THREE.Group(); // moves the Earth around the room
scene.add(ballGroup);

// Start a little below the room center so the ball is within arm's reach.
const ballOffset = new THREE.Vector3(0, -0.9, 0);
const ballVelocity = new THREE.Vector3();
let ballActive = false;
let cruiseSpeed = 1.3; // constant speed kept while flying (set by the last kick)

const CRUISE_DEFAULT = 1.3; // speed for keyboard / click / trigger kicks
const MIN_KICK = 0.9; // a gentle touch still gets the ball moving
const MAX_KICK = 2.75; // cap so a fast swing does not fling it absurdly fast
const HAND_GAIN = 1.15; // how strongly hand speed maps to launch speed
const TOUCH_PAD = 0.06; // extra reach so light touches register reliably

let lastFrameTime = 0;
let elapsed = 0; // seconds since load — drives comet / lightning timing
let currentMode = "preview";
const pressedKeys = new Set();
let audioContext = null;
let lastCollisionSoundAt = 0;

// Scratch vectors reused inside the animation loop (avoid per-frame allocation).
const tmpBall = new THREE.Vector3();
const tmpHand = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Earth: a textured sphere spinning slowly on a tilted axis, wrapped in a
// slightly larger cloud shell that drifts at its own speed. Textures come from
// the three.js sample set via CDN to keep things simple.
// ---------------------------------------------------------------------------
const EARTH_RADIUS = 0.36;
const EARTH_SPIN = 0.1; // rad/s — slow, Earth-like rotation (~63 s per turn)
const CLOUD_SPIN = 0.13; // clouds drift a touch faster than the surface
const TEX_BASE = "./assets/";

ballRadius = EARTH_RADIUS;
updateCollisionHalf();

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

function loadTex(file) {
  const tex = texLoader.load(TEX_BASE + file, undefined, undefined, (err) => {
    console.error("texture load failed:", file, err);
    statusEl.textContent = "地球テクスチャの読み込みに失敗しました（ネットワークをご確認ください）。";
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy; // sharper when viewed up close / at grazing angles
  return tex;
}

const earthMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS, 64, 48),
  new THREE.MeshStandardMaterial({
    map: loadTex("earth_atmos_2048.jpg"),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.35,
  })
);

const cloudMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 64, 48),
  new THREE.MeshStandardMaterial({
    map: loadTex("earth_clouds_2048.png"),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    roughness: 1.0,
    metalness: 0.0,
  })
);

// Tilt the spin axis ~23.4 degrees like the real Earth.
const tiltGroup = new THREE.Group();
tiltGroup.rotation.z = THREE.MathUtils.degToRad(23.4);
tiltGroup.add(earthMesh);
tiltGroup.add(cloudMesh);
ballGroup.add(tiltGroup);

// Moon — true SIZE ratio (~0.273x Earth, about a quarter), but the distance is
// pulled in from the real ~60 Earth-radii so the Moon sits just beside the
// Earth and both are framed together (like the familiar composite photos).
const MOON_RADIUS = EARTH_RADIUS * 0.273;
const MOON_DISTANCE = EARTH_RADIUS * 2.8;
const MOON_ORBIT_SPEED = 0.15; // rad/s — orbits the Earth (~42 s per revolution)
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_RADIUS, 48, 32),
  new THREE.MeshStandardMaterial({ map: loadTex("moon_1024.jpg"), roughness: 1.0, metalness: 0.0 })
);
moon.position.set(MOON_DISTANCE, 0, 0);
const moonOrbit = new THREE.Group();
moonOrbit.rotation.x = THREE.MathUtils.degToRad(6); // gently inclined orbit
moonOrbit.add(moon);
ballGroup.add(moonOrbit);

// Airliner (JAL-style) tracing the Tokyo <-> Los Angeles route along the
// surface. Child of earthMesh, so it rides the Earth's spin while flying.
function latLonToDir(latDeg, lonDeg) {
  const phi = ((lonDeg + 180) / 360) * 2 * Math.PI;
  const theta = ((90 - latDeg) / 180) * Math.PI;
  return new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta)
  ).normalize();
}
function slerpDir(a, b, t, out) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const omega = Math.acos(dot);
  const so = Math.sin(omega);
  if (so < 1e-4) return out.copy(a);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * omega) / so)
    .addScaledVector(b, Math.sin(t * omega) / so);
}

const planeBodyMat = new THREE.MeshStandardMaterial({ color: 0xf3f5f8, metalness: 0.3, roughness: 0.5 });
const planeTailMat = new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.2, roughness: 0.5 }); // JAL-style red
const plane = new THREE.Group(); // built with the nose toward -Z
const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.0024, 0.013, 4, 8), planeBodyMat);
fuselage.rotation.x = Math.PI / 2;
plane.add(fuselage);
plane.add(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.0008, 0.004), planeBodyMat)); // wings
const tailplane = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.0007, 0.0028), planeBodyMat);
tailplane.position.set(0, 0, 0.007);
plane.add(tailplane);
const fin = new THREE.Mesh(new THREE.BoxGeometry(0.0008, 0.004, 0.0035), planeTailMat);
fin.position.set(0, 0.0022, 0.0075);
plane.add(fin);
earthMesh.add(plane);

const PLANE_TOKYO = latLonToDir(35.7, 139.7);
const PLANE_LA = latLonToDir(34.0, -118.2);
const PLANE_ALT = EARTH_RADIUS * 1.02;
const PLANE_SPEED = 0.05; // fraction of the route per second (~20 s one way)
let planeT = 0;
let planeDir = 1;
const planePos = new THREE.Vector3();
const planeNext = new THREE.Vector3();
const planeUp = new THREE.Vector3();
const planeMat = new THREE.Matrix4();

function updatePlane(dt) {
  planeT += planeDir * PLANE_SPEED * dt;
  if (planeT >= 1) {
    planeT = 1;
    planeDir = -1;
  } else if (planeT <= 0) {
    planeT = 0;
    planeDir = 1;
  }
  slerpDir(PLANE_TOKYO, PLANE_LA, planeT, planePos).multiplyScalar(PLANE_ALT);
  slerpDir(PLANE_TOKYO, PLANE_LA, THREE.MathUtils.clamp(planeT + planeDir * 0.02, 0, 1), planeNext).multiplyScalar(PLANE_ALT);
  plane.position.copy(planePos);
  planeUp.copy(planePos).normalize();
  planeMat.lookAt(planePos, planeNext, planeUp); // -Z faces the direction of travel
  plane.quaternion.setFromRotationMatrix(planeMat);
}

ballGroup.position.copy(roomCenter).add(ballOffset);

// ---------------------------------------------------------------------------
// Orbiting satellite (ISS-like): a central truss + hub with big solar panels,
// riding a tilted circular orbit around the Earth (and moving with it).
// ---------------------------------------------------------------------------
const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc2cad4, metalness: 0.8, roughness: 0.35 });
const panelMat = new THREE.MeshStandardMaterial({
  color: 0x24407e,
  metalness: 0.5,
  roughness: 0.4,
  emissive: 0x0b1c3d,
  emissiveIntensity: 0.5,
});

// ISS-like satellite: central truss + hub with big solar panels.
const satellite = new THREE.Group();
satellite.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.014, 0.014), bodyMat)); // truss
const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 12), bodyMat);
hub.rotation.z = Math.PI / 2;
satellite.add(hub);
for (const sx of [-1, 1]) {
  for (const off of [0.05, 0.088]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.0015, 0.055), panelMat);
    panel.position.set(sx * off, 0, 0);
    satellite.add(panel);
  }
}
satellite.position.set(EARTH_RADIUS * 1.7, 0, 0); // orbit radius from Earth center
satellite.scale.setScalar(0.5); // smaller now that the Moon is in the scene

const satOrbit = new THREE.Group();
satOrbit.rotation.x = THREE.MathUtils.degToRad(35); // inclined orbit
satOrbit.add(satellite);
ballGroup.add(satOrbit);
const SAT_ORBIT_SPEED = 0.8; // rad/s — a clearly visible orbit, even while the Earth moves

// ---------------------------------------------------------------------------
// Lightning: brief additive flashes at random points on the Earth's surface.
// Children of earthMesh, so each flash sticks to the ground as the Earth spins.
// ---------------------------------------------------------------------------
const flashGeo = new THREE.SphereGeometry(0.038, 10, 8);
const flashes = [];
for (let i = 0; i < 4; i += 1) {
  const mesh = new THREE.Mesh(
    flashGeo,
    new THREE.MeshBasicMaterial({
      color: 0xcfeaff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  mesh.visible = false;
  earthMesh.add(mesh);
  flashes.push({ mesh, life: 0, peak: 0.2 });
}
let nextFlashAt = 1.0;

function randomSurfacePoint(target) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  target.set(r * Math.cos(a), u, r * Math.sin(a)).multiplyScalar(EARTH_RADIUS * 1.012);
}

function updateLightning(dt) {
  if (elapsed >= nextFlashAt) {
    const slot = flashes.find((f) => f.life <= 0);
    if (slot) {
      randomSurfacePoint(slot.mesh.position);
      slot.peak = 0.14 + Math.random() * 0.12;
      slot.life = slot.peak;
      slot.mesh.scale.setScalar(0.7 + Math.random() * 0.9);
      slot.mesh.visible = true;
    }
    nextFlashAt = elapsed + 0.5 + Math.random() * 1.8;
  }
  for (const f of flashes) {
    if (f.life > 0) {
      f.life -= dt;
      f.mesh.material.opacity = Math.max(0, f.life / f.peak);
      if (f.life <= 0) f.mesh.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Shooting star: every so often a small meteor falls toward the Earth from a
// fixed direction and burns up in a bright flash as it reaches the surface.
// Lives in ballGroup's frame, so the Earth's center is the local origin.
// ---------------------------------------------------------------------------
const meteorGroup = new THREE.Group();
ballGroup.add(meteorGroup);

const meteor = new THREE.Mesh(
  new THREE.SphereGeometry(0.006, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xfff1da })
);
const meteorTrail = new THREE.Mesh(
  new THREE.ConeGeometry(0.012, 0.28, 12, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xffb060,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
meteorTrail.rotation.x = Math.PI / 2; // cone tip points +Z (behind, after lookAt at center)
meteorTrail.position.z = 0.15; // trail streams away from the Earth
meteor.add(meteorTrail);
meteor.visible = false;
meteorGroup.add(meteor);

const meteorFlash = new THREE.Mesh(
  new THREE.SphereGeometry(0.026, 14, 12),
  new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
meteorFlash.visible = false;
meteorGroup.add(meteorFlash);

const METEOR_DIR = new THREE.Vector3(0.45, 1.0, 0.35).normalize(); // fixed incoming direction
const METEOR_START = 1.15; // distance from Earth center where it appears
const METEOR_SPEED = 1.1;
const METEOR_FLASH_TIME = 0.35;
let meteorActive = false;
let meteorFlashLife = 0;
let nextMeteorAt = 5.0;

function spawnMeteor() {
  meteor.position.copy(METEOR_DIR).multiplyScalar(METEOR_START);
  // Aim +Z up to space so the bow (-Z) faces the Earth center it falls toward,
  // and the burning trail (+Z) streams up behind it.
  meteor.lookAt(shipTmp.copy(meteor.position).add(METEOR_DIR));
  meteor.visible = true;
  meteorActive = true;
}

function updateMeteor(dt) {
  if (meteorFlashLife > 0) {
    meteorFlashLife -= dt;
    const k = Math.max(0, meteorFlashLife / METEOR_FLASH_TIME);
    meteorFlash.material.opacity = k;
    meteorFlash.scale.setScalar(1 + (1 - k) * 3); // expanding burst
    if (meteorFlashLife <= 0) meteorFlash.visible = false;
  }
  if (!meteorActive) {
    if (elapsed >= nextMeteorAt) spawnMeteor();
    return;
  }
  meteor.position.addScaledVector(METEOR_DIR, -METEOR_SPEED * dt);
  if (meteor.position.length() <= EARTH_RADIUS * 1.02) {
    // Impact: burst of light at the surface point; the meteor burns up.
    meteorFlash.position.copy(METEOR_DIR).multiplyScalar(EARTH_RADIUS * 1.02);
    meteorFlash.scale.setScalar(1);
    meteorFlash.material.opacity = 1;
    meteorFlash.visible = true;
    meteorFlashLife = METEOR_FLASH_TIME;
    meteor.visible = false;
    meteorActive = false;
    nextMeteorAt = elapsed + 15 + Math.random() * 15; // every ~15-30 s
  }
}

// ---------------------------------------------------------------------------
// USS Enterprise: flies straight across the scene like the original comet
// (reappearing every several seconds), built facing -Z (its bow) with a faint
// additive engine wake trailing each nacelle.
// ---------------------------------------------------------------------------
const enterprise = new THREE.Group();
enterprise.visible = false;
scene.add(enterprise);

// Load the detailed USS Enterprise model (OBJ + MTL + textures in
// assets/NCC-1701/), center it, scale to a target length, and add it to the
// `enterprise` group that flies across the scene.
new MTLLoader().setPath("./assets/NCC-1701/").load("untitled.mtl", (materials) => {
  materials.preload();
  new OBJLoader()
    .setMaterials(materials)
    .setPath("./assets/NCC-1701/")
    .load(
      "untitled.obj",
      (obj) => {
        obj.traverse((child) => {
          if (child.isMesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (m && m.map) m.map.anisotropy = maxAnisotropy;
            });
          }
        });
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        obj.position.sub(center); // recenter on origin
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        obj.scale.setScalar((EARTH_RADIUS * 2.7) / maxDim);
        obj.rotation.y = Math.PI; // flip so the bow leads the direction of travel
        enterprise.add(obj);
        console.log("Enterprise model loaded. raw size:", size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
      },
      undefined,
      (err) => console.error("Enterprise model load failed:", err)
    );
});

const shipVel = new THREE.Vector3();
const shipTmp = new THREE.Vector3();
let shipActive = false;
let nextShipAt = 3.0;

function spawnEnterprise() {
  const side = Math.random() < 0.5 ? -1 : 1;
  enterprise.position.set(
    roomCenter.x + side * (roomHalf.x + 1.2),
    roomCenter.y + roomHalf.y * (0.2 + Math.random() * 0.9),
    roomCenter.z + (Math.random() * 2 - 1) * roomHalf.z
  );
  shipVel
    .set(-side * (0.85 + Math.random() * 0.3), -0.15 + Math.random() * 0.2, -0.3 + Math.random() * 0.6)
    .normalize()
    .multiplyScalar(0.85 + Math.random() * 0.5);
  shipActive = true;
  enterprise.visible = true;
  playShipEntrance();
}

function updateEnterprise(dt) {
  if (!shipActive) {
    if (elapsed >= nextShipAt) spawnEnterprise();
    return;
  }
  enterprise.position.addScaledVector(shipVel, dt);
  // Object3D.lookAt aims +Z at the target, so look "backward" to put the bow
  // (-Z, the saucer) forward and the engine wake (+Z) trailing behind.
  enterprise.lookAt(shipTmp.copy(enterprise.position).sub(shipVel));
  const dx = enterprise.position.x - roomCenter.x;
  const dy = enterprise.position.y - roomCenter.y;
  const dz = enterprise.position.z - roomCenter.z;
  if (Math.abs(dx) > roomHalf.x + 1.6 || Math.abs(dy) > roomHalf.y + 2.4 || Math.abs(dz) > roomHalf.z + 1.6) {
    shipActive = false;
    enterprise.visible = false;
    stopShipAudio(); // music stops the moment the ship leaves the scene
    nextShipAt = elapsed + 150 + Math.random() * 90; // ~2.5-4 min between visits
  }
}

statusEl.textContent = "準備完了。コントローラーで地球に触れると、その方向へ弾けます（PCはWASD/矢印/クリック）。";
updateXrAvailability();

// ---------------------------------------------------------------------------
// XR availability / session handling
// ---------------------------------------------------------------------------
async function updateXrAvailability() {
  if (!vrButton || !arButton) return;
  vrButton.disabled = false;
  arButton.disabled = false;

  if (!navigator.xr) {
    statusEl.textContent = "3Dプレビュー表示中。このブラウザ/URLではWebXRは使えません。";
    return;
  }

  try {
    const [vrSupported, arSupported] = await Promise.all([
      navigator.xr.isSessionSupported("immersive-vr"),
      navigator.xr.isSessionSupported("immersive-ar"),
    ]);
    vrButton.textContent = vrSupported ? "Enter VR" : "VR unavailable";
    arButton.textContent = arSupported ? "Enter AR" : "AR unavailable";
    vrButton.disabled = !vrSupported;
    arButton.disabled = !arSupported;
    statusEl.textContent = "準備完了。Quest 3 で VR または AR を選んでください。";
  } catch (error) {
    console.error(error);
    vrButton.textContent = "Enter VR";
    arButton.textContent = "Enter AR";
    statusEl.textContent = "XRサポート確認に失敗しましたが、ボタンは試せます。";
  }
}

async function enterXr(mode) {
  if (!navigator.xr) {
    statusEl.textContent = "ここではWebXRは使えません。通常の3Dプレビューは動作中です。";
    return;
  }

  initAudio(); // unlock audio inside the button-click gesture (so it works on Quest)

  const button = mode === "immersive-ar" ? arButton : vrButton;
  const label = mode === "immersive-ar" ? "AR" : "VR";

  try {
    button.disabled = true;
    button.textContent = "Entering...";
    const options =
      mode === "immersive-ar"
        ? {
            optionalFeatures: ["local-floor", "dom-overlay"],
            domOverlay: { root: document.body },
          }
        : {
            optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
          };
    const session = await navigator.xr.requestSession(mode, options);
    session.addEventListener("end", () => {
      vrButton.disabled = false;
      arButton.disabled = false;
      vrButton.textContent = "Enter VR";
      arButton.textContent = "Enter AR";
      scene.background = new THREE.Color(0x07090c);
      floor.visible = true;
      exitButton.visible = false;
      resetButton.visible = false;
      currentMode = "preview";
      statusEl.textContent = `${label} を終了しました。もう一度入るには VR/AR を選んでください。`;
      updateXrAvailability();
    });

    if (mode === "immersive-ar") {
      scene.background = null;
      floor.visible = false;
      currentMode = "ar";
    } else {
      scene.background = new THREE.Color(0x07090c);
      floor.visible = true;
      currentMode = "vr";
    }

    await renderer.xr.setSession(session);
    vrButton.disabled = false;
    arButton.disabled = false;
    button.textContent = `Exit ${label}`;
    exitButton.visible = true;
    resetButton.visible = true; // show the in-XR Exit / Reset buttons
    statusEl.textContent = `${label} 起動中。左スティックで水平移動／右スティック上下で昇降。グリップでホームに復帰。地球に触れて弾く。終了は「終了」ボタンを指してトリガー。`;
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = `Enter ${label}`;
    statusEl.textContent = `${label} に入れませんでした: ${error.message || error}`;
  }
}

vrButton?.addEventListener("click", () => {
  const session = renderer.xr.getSession();
  if (session) {
    session.end();
    return;
  }
  enterXr("immersive-vr");
});

arButton?.addEventListener("click", () => {
  const session = renderer.xr.getSession();
  if (session) {
    session.end();
    return;
  }
  enterXr("immersive-ar");
});

updateXrAvailability();

// ---------------------------------------------------------------------------
// Audio feedback
// ---------------------------------------------------------------------------
function initAudio() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  loadShipBuffer();
}

function playCollisionSound() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  if (now - lastCollisionSoundAt < 0.08) return;
  lastCollisionSoundAt = now;

  const main = audioContext.createOscillator();
  const overtone = audioContext.createOscillator();
  const gain = audioContext.createGain();

  main.type = "sine";
  overtone.type = "triangle";
  main.frequency.setValueAtTime(720, now);
  main.frequency.exponentialRampToValueAtTime(980, now + 0.055);
  overtone.frequency.setValueAtTime(1440, now);
  overtone.frequency.exponentialRampToValueAtTime(1760, now + 0.04);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

  main.connect(gain);
  overtone.connect(gain);
  gain.connect(audioContext.destination);

  main.start(now);
  overtone.start(now);
  main.stop(now + 0.14);
  overtone.stop(now + 0.1);
}

// A short original triumphant fanfare for the Enterprise's entrance. Not a
// copyrighted theme — just a rising brass-like motif. Plays on spawn and is
// faded out the moment the ship leaves the scene.
let enterpriseVoices = [];

function playEnterpriseTheme() {
  initAudio();
  if (!audioContext || audioContext.state !== "running") return; // needs a prior user gesture
  stopEnterpriseTheme();
  const ctx = audioContext;
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  enterpriseVoices.push({ osc: null, gain: master });

  const seq = [
    [392.0, 0.0, 0.45], // G4
    [523.25, 0.45, 0.45], // C5
    [659.25, 0.9, 0.5], // E5
    [783.99, 1.4, 1.5], // G5 (held)
  ];
  for (const [freq, t, dur] of seq) {
    const start = now + t;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o1.type = "sawtooth";
    o2.type = "triangle";
    o1.frequency.value = freq;
    o2.frequency.value = freq * 2;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.9, start + 0.05);
    g.gain.exponentialRampToValueAtTime(0.3, start + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o1.connect(g);
    o2.connect(g);
    g.connect(master);
    o1.start(start);
    o2.start(start);
    o1.stop(start + dur + 0.05);
    o2.stop(start + dur + 0.05);
    enterpriseVoices.push({ osc: o1, gain: g });
    enterpriseVoices.push({ osc: o2, gain: g });
  }
}

function stopEnterpriseTheme() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  for (const v of enterpriseVoices) {
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      if (v.osc) v.osc.stop(now + 0.2);
    } catch (e) {
      /* node already stopped */
    }
  }
  enterpriseVoices = [];
}

// Optional real audio clip: drop a licensed file at assets/enterprise_theme.mp3
// and it plays on the ship's entrance; otherwise the synth fanfare above is
// used. The file is intentionally NOT bundled — provide your own to respect
// copyright.
// Entrance music via Web Audio. A decoded buffer played through the
// (gesture-unlocked) AudioContext is far more reliable than HTMLAudio autoplay —
// the HTMLAudio path stayed silent on Quest. Drop assets/enterprise_theme.mp3 to
// use it; otherwise the synth fanfare plays.
let shipBuffer = null;
let shipBufferTried = false;
let shipSource = null;

async function loadShipBuffer() {
  if (shipBuffer || shipBufferTried || !audioContext) return;
  shipBufferTried = true;
  try {
    const res = await fetch("./assets/enterprise_theme.mp3");
    if (!res.ok) throw new Error("HTTP " + res.status);
    shipBuffer = await audioContext.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    console.error("entrance music load failed:", e); // fall back to synth fanfare
  }
}

function playShipEntrance() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    if (!shipBuffer && !shipBufferTried) loadShipBuffer();
  }
  if (audioContext && audioContext.state === "running" && shipBuffer) {
    try {
      if (shipSource) {
        try {
          shipSource.stop();
        } catch (e) {
          /* ignore */
        }
      }
      shipSource = audioContext.createBufferSource();
      shipSource.buffer = shipBuffer;
      shipSource.connect(audioContext.destination);
      shipSource.start();
      return;
    } catch (e) {
      /* fall through to the synth fanfare */
    }
  }
  playEnterpriseTheme();
}

function stopShipAudio() {
  stopEnterpriseTheme();
  if (shipSource) {
    try {
      shipSource.stop();
    } catch (e) {
      /* already stopped */
    }
    shipSource = null;
  }
}

// ---------------------------------------------------------------------------
// Launching the Earth
// ---------------------------------------------------------------------------
// Kick the Earth along a (world == room) direction at a given speed.
function kick(direction, speed) {
  if (direction.lengthSq() < 1e-8) return;
  cruiseSpeed = THREE.MathUtils.clamp(speed, MIN_KICK, MAX_KICK);
  ballVelocity.copy(direction).normalize().multiplyScalar(cruiseSpeed);
  ballActive = true;
}

// Stop the Earth and return it to its starting position.
function resetBall() {
  ballActive = false;
  ballVelocity.set(0, 0, 0);
  ballOffset.set(0, -0.9, 0);
}

// ---------------------------------------------------------------------------
// In-XR Exit button: a panel you point at with a controller (trigger) to leave
// the session. Shown only while in VR/AR.
// ---------------------------------------------------------------------------
function makeButtonTexture(label, bg) {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 140;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg || "rgba(190,30,42,0.95)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 312, 132, 24);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 46px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 160, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}
const exitButton = new THREE.Mesh(
  new THREE.PlaneGeometry(0.34, 0.15),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("終了 / Exit"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
exitButton.position.set(0, 1.4, -0.5); // in front of the user, a bit low
exitButton.renderOrder = 999;
exitButton.visible = false;
scene.add(exitButton);

const resetButton = new THREE.Mesh(
  new THREE.PlaneGeometry(0.34, 0.15),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("リセット / Reset", "rgba(30,110,190,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
resetButton.position.set(0, 1.6, -0.5); // just above the Exit button
resetButton.renderOrder = 999;
resetButton.visible = false;
scene.add(resetButton);

const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// XR controllers: touch the Earth to launch it; trigger launches along the
// pointing direction as a fallback for when it is out of reach.
// ---------------------------------------------------------------------------
const grips = [];
const gripPrev = []; // previous world position of each grip
const gripValid = []; // whether gripPrev holds a usable value
const gripTouching = []; // latch so one touch == one kick

for (let index = 0; index < 2; index += 1) {
  const grip = renderer.xr.getControllerGrip(index);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0x9be7ff, emissive: 0x0a2230, roughness: 0.4 })
  );
  grip.add(marker);
  scene.add(grip);
  grips.push(grip);
  gripPrev.push(new THREE.Vector3());
  gripValid.push(false);
  gripTouching.push(false);

  const controller = renderer.xr.getController(index);
  controller.addEventListener("select", () => {
    initAudio();
    // If aiming at the Exit button, leave the XR session instead of launching.
    if (exitButton.visible) {
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
      const uiHit = raycaster.intersectObjects([exitButton, resetButton])[0];
      if (uiHit) {
        if (uiHit.object === exitButton) renderer.xr.getSession()?.end();
        else resetBall();
        return;
      }
    }
    // Otherwise launch along the controller's pointing (-Z) direction.
    tmpDir.set(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    kick(tmpDir, CRUISE_DEFAULT);
  });
  // Grip / squeeze button: snap the player straight back to the home position.
  controller.addEventListener("squeezestart", () => {
    initAudio();
    resetToHome();
  });
  scene.add(controller);
}

const MARKER_RADIUS = 0.025;

function updateHandTouch(dt) {
  tmpBall.copy(roomCenter).add(ballOffset);

  for (let i = 0; i < grips.length; i += 1) {
    const grip = grips[i];
    if (!grip.visible) {
      gripValid[i] = false;
      gripTouching[i] = false;
      continue;
    }

    tmpHand.setFromMatrixPosition(grip.matrixWorld);

    let handSpeed = 0;
    if (gripValid[i] && dt > 0) {
      handSpeed = tmpHand.distanceTo(gripPrev[i]) / dt;
    }
    gripPrev[i].copy(tmpHand);
    gripValid[i] = true;

    const touchDistance = ballRadius + MARKER_RADIUS + TOUCH_PAD;
    const touching = tmpHand.distanceTo(tmpBall) <= touchDistance;

    if (touching && !gripTouching[i]) {
      initAudio();
      // Push the Earth away from the hand (the natural "I bumped it" direction).
      tmpDir.copy(tmpBall).sub(tmpHand);
      if (tmpDir.lengthSq() < 1e-6) {
        tmpDir.copy(ballVelocity.lengthSq() > 1e-6 ? ballVelocity : tmpVec.set(0, 0, -1));
      }
      kick(tmpDir, Math.max(MIN_KICK, handSpeed * HAND_GAIN));
      playCollisionSound();
    }
    gripTouching[i] = touching;
  }
}

// ---------------------------------------------------------------------------
// Desktop input (preview / debugging): WASD + arrows steer, click launches
// along the view direction.
// ---------------------------------------------------------------------------
window.addEventListener("keydown", (event) => {
  pressedKeys.add(event.code);
});
window.addEventListener("keyup", (event) => {
  pressedKeys.delete(event.code);
});

renderer.domElement.addEventListener("pointerdown", () => {
  initAudio();
  camera.getWorldDirection(tmpDir);
  kick(tmpDir, CRUISE_DEFAULT);
});

function keyboardSteer() {
  const forward =
    (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp") ? 1 : 0) -
    (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown") ? 1 : 0);
  const strafe =
    (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight") ? 1 : 0) -
    (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft") ? 1 : 0);
  const lift = (pressedKeys.has("KeyE") || pressedKeys.has("Space") ? 1 : 0) - (pressedKeys.has("KeyQ") ? 1 : 0);

  if (forward === 0 && strafe === 0 && lift === 0) return;

  camera.getWorldDirection(tmpDir);
  tmpDir.y = 0;
  if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, -1);
  tmpDir.normalize();
  tmpRight.crossVectors(tmpDir, worldUp).normalize();

  tmpVec
    .copy(tmpDir)
    .multiplyScalar(forward)
    .addScaledVector(tmpRight, strafe)
    .addScaledVector(worldUp, lift);

  kick(tmpVec, CRUISE_DEFAULT);
}

// ---------------------------------------------------------------------------
// Smooth locomotion (VR/AR): a thumbstick moves the player by offsetting the
// XR reference space, so you can glide closer to the Earth (or toward the Moon).
// ---------------------------------------------------------------------------
let xrBaseRefSpace = null;
const locomotion = new THREE.Vector3();
const LOCO_SPEED = 4.0; // m/s

renderer.xr.addEventListener("sessionstart", () => {
  xrBaseRefSpace = renderer.xr.getReferenceSpace();
  locomotion.set(0, 0, 0);
});

// Snap the player straight back to where they started the session.
function resetToHome() {
  locomotion.set(0, 0, 0);
  if (xrBaseRefSpace) renderer.xr.setReferenceSpace(xrBaseRefSpace);
}

function updateLocomotion(dt) {
  const session = renderer.xr.getSession();
  if (!session || !xrBaseRefSpace) return;

  // Left thumbstick glides across the horizontal plane; the right thumbstick's
  // vertical axis lifts / lowers the player so you can rise up to any planet.
  let mx = 0;
  let mz = 0;
  let my = 0;
  for (const src of session.inputSources) {
    const ax = src.gamepad?.axes;
    if (!ax || ax.length < 2) continue;
    const x = ax.length >= 4 ? ax[2] : ax[0];
    const y = ax.length >= 4 ? ax[3] : ax[1];
    if (src.handedness === "right") {
      if (Math.abs(y) > 0.15) my += -y; // push stick up to rise
    } else {
      if (Math.abs(x) > 0.15) mx += x;
      if (Math.abs(y) > 0.15) mz += y;
    }
  }
  if (mx === 0 && mz === 0 && my === 0) return;

  const cam = renderer.xr.getCamera();
  cam.getWorldDirection(tmpDir);
  tmpDir.y = 0;
  if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, -1);
  tmpDir.normalize();
  tmpRight.crossVectors(tmpDir, worldUp).normalize();

  locomotion.addScaledVector(tmpDir, -mz * LOCO_SPEED * dt);
  locomotion.addScaledVector(tmpRight, mx * LOCO_SPEED * dt);
  locomotion.y += my * LOCO_SPEED * dt;

  const offset = new XRRigidTransform({ x: -locomotion.x, y: -locomotion.y, z: -locomotion.z });
  renderer.xr.setReferenceSpace(xrBaseRefSpace.getOffsetReferenceSpace(offset));
}

// ---------------------------------------------------------------------------
// Physics: straight-line motion with reflective walls.
// ---------------------------------------------------------------------------
function bounceAxis(axis, limit) {
  if (ballOffset[axis] > limit) {
    ballOffset[axis] = limit;
    ballVelocity[axis] = -Math.abs(ballVelocity[axis]);
    return true;
  }
  if (ballOffset[axis] < -limit) {
    ballOffset[axis] = -limit;
    ballVelocity[axis] = Math.abs(ballVelocity[axis]);
    return true;
  }
  return false;
}

function stepBall(dt) {
  ballOffset.addScaledVector(ballVelocity, dt);
  let hit = false;
  if (bounceAxis("x", collisionHalf.x)) hit = true;
  if (bounceAxis("y", collisionHalf.y)) hit = true;
  if (bounceAxis("z", collisionHalf.z)) hit = true;
  // Keep a constant cruising speed so bounces never bleed off energy.
  if (ballVelocity.lengthSq() > 1e-8) {
    ballVelocity.normalize().multiplyScalar(cruiseSpeed);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Distant Sun and Saturn, well outside the room. Large, self-lit Sun that casts
// light; ringed Saturn with a tilted axis. Both spin.
// ---------------------------------------------------------------------------
const SUN_VERT = `
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vPosition = position;
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SUN_FRAG = `
precision mediump float;
uniform float uTime;
uniform sampler2D uTex;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUv;

vec3 m289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 m289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return m289v4((x*34.+1.)*x);}
vec4 tiSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);
  const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=m289v3(i);
  vec4 p=perm(perm(perm(
    i.z+vec4(0.,i1.z,i2.z,1.))
    +i.y+vec4(0.,i1.y,i2.y,1.))
    +i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;
  vec4 s1=floor(b1)*2.+1.;
  vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=tiSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
// 通常fBm
float fbm(vec3 p){
  float v=0.;float a=.5;
  for(int i=0;i<5;i++){v+=a*snoise(p);p=p*2.+vec3(100.);a*=.5;}
  return v;
}
// Ridged fBm: 暗い背景に尖った明るい炎の筋を作る
float rfbm(vec3 p){
  float v=0.;float a=.6;
  for(int i=0;i<4;i++){
    float n=1.-abs(snoise(p)); // 0〜1の山形、暗部が0
    n=n*n;                     // さらに尖らせる
    v+=a*n;
    p=p*2.2+vec3(100.);a*=.5;
  }
  return v;
}
void main(){
  vec3 n=normalize(vPosition);
  float t1=uTime*.05;
  float t2=uTime*.03;

  // ノイズで UV をゆっくり歪め、プラズマが沸き立つ揺らぎを作る。
  vec3 q=vec3(
    fbm(n*3.5+vec3(t1,t1*.6,t1*.3)),
    fbm(n*3.5+vec3(t2*.7,t2,t2*.5))
  ,0.);
  vec2 warp=vec2(q.x,q.y)*0.022;
  // 細かい対流セル（粒状斑）のさざ波も加える。
  warp+=vec2(snoise(n*9.+vec3(t2)),snoise(n*9.+vec3(7.,t2,3.)))*0.006;

  // NASA 由来の太陽テクスチャをサンプリング（歪ませた UV で）。
  vec3 tex=texture2D(uTex,vUv+warp).rgb;

  // 明部を引き締め、エネルギーを与えて自己発光らしく見せる。
  float lum=dot(tex,vec3(0.299,0.587,0.114));
  // リッジドノイズで動くフレアの筋を上乗せ（明部だけ強調）。
  float flare=rfbm(n*5.+q*1.2+vec3(t2*.5));
  flare=pow(clamp(flare,0.,1.),2.0)*smoothstep(0.35,0.8,lum);

  vec3 col=tex*1.45;
  col+=flare*vec3(1.0,0.45,0.08)*0.7;

  // コロナエッジ（縁の輝き、控えめなオレンジ）。
  float rim=1.-abs(dot(vNormal,vec3(0.,0.,1.)));
  rim=pow(rim,3.0);
  col+=rim*vec3(1.0,0.42,0.05)*0.9;

  gl_FragColor=vec4(col,1.);
}`;

const SUN_RADIUS = EARTH_RADIUS * 50;
const sunTexture = loadTex("2k_sun.jpg");
const sunMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0.0 },
    uTex: { value: sunTexture },
  },
  vertexShader: SUN_VERT,
  fragmentShader: SUN_FRAG,
});
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 64, 48),
  sunMaterial
);
sunMesh.position.set(-48, 30, -62);
scene.add(sunMesh);

// Outer corona shell: a slightly larger additive sphere whose fragments fade
// toward the limb, giving the Sun a soft glowing halo of plasma.
const CORONA_FRAG = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vViewDir;
void main(){
  float rim=1.0-abs(dot(normalize(vNormal),normalize(vViewDir)));
  float glow=pow(clamp(rim,0.,1.),2.4);
  vec3 col=mix(vec3(1.0,0.32,0.02),vec3(1.0,0.62,0.18),glow);
  gl_FragColor=vec4(col,glow*0.9);
}`;
const CORONA_VERT = `
varying vec3 vNormal;
varying vec3 vViewDir;
void main(){
  vNormal=normalize(normalMatrix*normal);
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  vViewDir=-mv.xyz;
  gl_Position=projectionMatrix*mv;
}`;
const corona = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS * 1.18, 48, 32),
  new THREE.ShaderMaterial({
    vertexShader: CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  })
);
sunMesh.add(corona);

const sunLight = new THREE.PointLight(0xfff2e6, 2.4, 0, 0.0);
sunLight.position.copy(sunMesh.position);
scene.add(sunLight);

const SATURN_R = EARTH_RADIUS * 15;
const saturnGroup = new THREE.Group();
saturnGroup.position.set(45, -9, -35);
saturnGroup.rotation.z = THREE.MathUtils.degToRad(26.7); // axial tilt
scene.add(saturnGroup);
const saturnBall = new THREE.Mesh(
  new THREE.SphereGeometry(SATURN_R, 64, 48),
  new THREE.MeshStandardMaterial({ map: loadTex("2k_saturn.jpg"), roughness: 0.9, metalness: 0.0 })
);
saturnGroup.add(saturnBall);
const ringGeo = new THREE.RingGeometry(SATURN_R * 1.2, SATURN_R * 2.3, 128);
const rpos = ringGeo.attributes.position;
const ruv = ringGeo.attributes.uv;
const rvec = new THREE.Vector3();
for (let i = 0; i < rpos.count; i += 1) {
  rvec.fromBufferAttribute(rpos, i);
  const u = (rvec.length() - SATURN_R * 1.2) / (SATURN_R * 2.3 - SATURN_R * 1.2);
  ruv.setXY(i, u, 1);
}
const saturnRing = new THREE.Mesh(
  ringGeo,
  new THREE.MeshBasicMaterial({
    map: loadTex("2k_saturn_ring_alpha.png"),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
saturnRing.rotation.x = -Math.PI / 2; // lay flat in the equatorial plane
saturnGroup.add(saturnRing);

// ---------------------------------------------------------------------------
// Other planets, scattered well outside the room so they read as distant
// worlds. Each is a textured sphere on a tilted spin axis; `spin` is the
// per-second rotation applied in the animation loop.
// ---------------------------------------------------------------------------
const planets = [];
function addPlanet(file, radius, position, tiltDeg, spin) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.z = THREE.MathUtils.degToRad(tiltDeg);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.MeshStandardMaterial({ map: loadTex(file), roughness: 0.95, metalness: 0.0 })
  );
  group.add(mesh);
  scene.add(group);
  planets.push({ mesh, spin });
  return mesh;
}

// Mars — 0.5x Earth, rusty and small, just outside the right-hand wall.
addPlanet("2k_mars.jpg", EARTH_RADIUS * 0.5, new THREE.Vector3(5.4, 2.4, -2.2), 25.2, 0.12);
// Venus — same size as Earth, pale thick atmosphere, just outside the left wall.
addPlanet("2k_venus_atmosphere.jpg", EARTH_RADIUS * 1.0, new THREE.Vector3(-5.6, 2.2, -2.2), 2.6, -0.03);
// Jupiter — 20x Earth, banded giant, far to the left-behind.
addPlanet("2k_jupiter.jpg", EARTH_RADIUS * 20, new THREE.Vector3(-42, 6, 26), 3.1, 0.22);

// ---------------------------------------------------------------------------
// Apollo 11 mission. A Saturn V launches from the Earth, coasts to the Moon,
// the Command/Service Module ("母艦") settles into lunar orbit, and the Lunar
// Module separates and descends to the surface — looping every ~48 s. A lunar
// lander and a US flag are planted permanently on the Moon's surface.
// ---------------------------------------------------------------------------
const _yUp = new THREE.Vector3(0, 1, 0);
const _alignTmp = new THREE.Vector3();
function alignY(obj, dir) {
  _alignTmp.copy(dir);
  if (_alignTmp.lengthSq() < 1e-9) return;
  _alignTmp.normalize();
  obj.quaternion.setFromUnitVectors(_yUp, _alignTmp);
}
function smooth(p) {
  p = THREE.MathUtils.clamp(p, 0, 1);
  return p * p * (3 - 2 * p);
}

const matWhite = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.6, metalness: 0.1 });
const matBlack = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.7, metalness: 0.2 });
const matGray = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.35, metalness: 0.7 });
const matDark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.5 });
const matGold = new THREE.MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.4, metalness: 0.6, emissive: 0x3a2c08, emissiveIntensity: 0.3 });
const matSilver = new THREE.MeshStandardMaterial({ color: 0xc7ccd2, roughness: 0.3, metalness: 0.8 });

// Saturn V: a 3-stage stack (+Y up). The surviving spacecraft (short S-IVB +
// CSM + escape tower) sits near the local origin; the first/second stages hang
// below and are dropped during ascent. Returns the parts so the mission can
// stage them, just like the real Apollo 11 launch.
function buildSaturnV() {
  const group = new THREE.Group();
  const R = 0.014;

  // Surviving spacecraft (this is all that coasts to the Moon).
  const top = new THREE.Group();
  const sivb = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R, 0.02, 18), matWhite);
  sivb.position.y = -0.008;
  top.add(sivb);
  const svc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.78, 0.016, 18), matGray);
  svc.position.y = 0.01;
  top.add(svc);
  const cm = new THREE.Mesh(new THREE.ConeGeometry(R * 0.78, 0.014, 18), matGray);
  cm.position.y = 0.025;
  top.add(cm);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.016, 6), matDark);
  tower.position.y = 0.04;
  top.add(tower);
  group.add(top);

  // Second stage (S-II).
  const stage2 = new THREE.Group();
  stage2.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.045, 20), matWhite));
  const band2 = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.005, 20), matBlack);
  band2.position.y = 0.024;
  stage2.add(band2);
  stage2.position.y = -0.04;
  group.add(stage2);

  // First stage (S-IC) with tail fins.
  const stage1 = new THREE.Group();
  stage1.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.07, 20), matWhite));
  const band1 = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.005, 20), matBlack);
  band1.position.y = 0.03;
  stage1.add(band1);
  for (let k = 0; k < 4; k += 1) {
    const a = (k * Math.PI) / 2;
    const f = new THREE.Mesh(new THREE.BoxGeometry(R * 0.5, R * 1.8, R * 1.6), matBlack);
    f.position.set(Math.cos(a) * R, -0.03, Math.sin(a) * R);
    stage1.add(f);
  }
  stage1.position.y = -0.095;
  group.add(stage1);

  // Engine plume (additive), shown only during powered ascent.
  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(R * 0.9, 0.05, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffb060,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  plume.position.y = -0.155;
  plume.rotation.x = Math.PI; // flares downward (-Y)
  plume.visible = false;
  group.add(plume);

  return { group, stage1, stage2, plume };
}

// Command + Service Module: gray cylinder with a conical capsule and a nozzle.
function buildCSM() {
  const g = new THREE.Group();
  const R = 0.013;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.05, 18), matGray));
  const cm = new THREE.Mesh(new THREE.ConeGeometry(R, R * 2.2, 18), matGray);
  cm.position.y = 0.025 + R * 1.1;
  g.add(cm);
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(R * 0.7, R * 1.4, 14, 1, true), matDark);
  nozzle.position.y = -0.025 - R * 0.6;
  g.add(nozzle);
  return g;
}

// A thin cylinder spanning two local points — used for landing-gear struts so
// they actually connect the body to the foot pads.
const _cbA = new THREE.Vector3();
const _cbB = new THREE.Vector3();
const _cbDir = new THREE.Vector3();
function cylinderBetween(from, to, radius, mat) {
  _cbDir.subVectors(to, from);
  const len = _cbDir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_yUp, _cbDir.normalize());
  return m;
}

// Lunar Module (+Y up): octagonal descent stage, boxy ascent stage + dome, and
// four splayed legs whose struts run cleanly from the body down to foot pads.
function buildLM(descentMat) {
  const g = new THREE.Group();
  const descent = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.012, 8), descentMat || matSilver);
  g.add(descent);
  const ascent = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.011, 0.015), matSilver);
  ascent.position.y = 0.012;
  g.add(ascent);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), matSilver);
  dome.position.set(0, 0.019, 0.004);
  g.add(dome);
  for (let k = 0; k < 4; k += 1) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const from = _cbA.set(cos * 0.012, -0.004, sin * 0.012); // upper attach on the body
    const foot = _cbB.set(cos * 0.026, -0.02, sin * 0.026); // splayed out and down
    g.add(cylinderBetween(from, foot, 0.0013, matSilver));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.0012, 10), matSilver);
    pad.position.set(cos * 0.026, -0.0205, sin * 0.026);
    g.add(pad);
  }
  return g;
}

// US flag: a 13-stripe canvas with a starred canton, on a silver pole with a
// horizontal top rod so the cloth stays spread out (no wind on the Moon).
function makeUSFlagTexture() {
  const c = document.createElement("canvas");
  c.width = 190;
  c.height = 100;
  const g = c.getContext("2d");
  const stripeH = c.height / 13;
  for (let i = 0; i < 13; i += 1) {
    g.fillStyle = i % 2 === 0 ? "#b22234" : "#ffffff";
    g.fillRect(0, i * stripeH, c.width, stripeH + 1);
  }
  const cw = c.width * 0.4;
  const ch = stripeH * 7;
  g.fillStyle = "#3c3b6e";
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = "#ffffff";
  for (let r = 0; r < 9; r += 1) {
    const cols = r % 2 === 0 ? 6 : 5;
    for (let col = 0; col < cols; col += 1) {
      const x = (cw * ((r % 2 === 0 ? col + 0.5 : col + 1))) / 6.2;
      const y = (ch * (r + 0.5)) / 9;
      g.beginPath();
      g.arc(x, y, 1.7, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}
function buildFlag() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.06, 8), matSilver);
  pole.position.y = 0.03;
  g.add(pole);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.04, 6), matSilver);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0.02, 0.058, 0);
  g.add(rod);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, 0.025),
    new THREE.MeshBasicMaterial({ map: makeUSFlagTexture(), side: THREE.DoubleSide })
  );
  cloth.position.set(0.02, 0.046, 0);
  g.add(cloth);
  return g;
}

// Flying mission craft live in world space and are positioned each frame.
const saturnV = buildSaturnV();
const csm = buildCSM();
const lmFlying = buildLM(matSilver);
saturnV.group.visible = false;
csm.visible = false;
lmFlying.visible = false;
scene.add(saturnV.group);
scene.add(csm);
scene.add(lmFlying);

// Permanent surface objects ride the Moon (children of `moon`), so they stay
// stuck to the surface as the Moon spins and orbits. Scaled up a touch so they
// read clearly from across the room.
const SURF_SCALE = 1.4;
const landerUp = new THREE.Vector3(0.35, 0.82, 0.45).normalize();
const flagUp = new THREE.Vector3(0.6, 0.74, 0.3).normalize();
const surfaceLander = buildLM(matSilver);
surfaceLander.scale.setScalar(SURF_SCALE);
surfaceLander.position.copy(landerUp).multiplyScalar(MOON_RADIUS * 0.99);
alignY(surfaceLander, landerUp);
moon.add(surfaceLander);
const flag = buildFlag();
flag.scale.setScalar(SURF_SCALE);
flag.position.copy(flagUp).multiplyScalar(MOON_RADIUS * 0.99);
alignY(flag, flagUp);
moon.add(flag);

// Lunar-orbit plane basis (perpendicular to a slightly tilted axis).
const orbAxis = new THREE.Vector3(0.25, 1, 0.15).normalize();
const orbU = new THREE.Vector3(1, 0, 0).cross(orbAxis);
if (orbU.lengthSq() < 1e-6) orbU.set(0, 0, 1);
orbU.normalize();
const orbV = new THREE.Vector3().crossVectors(orbAxis, orbU).normalize();
function orbitPos(center, r, ang, out) {
  return out.copy(center).addScaledVector(orbU, Math.cos(ang) * r).addScaledVector(orbV, Math.sin(ang) * r);
}

const APOLLO_DURATION = 48; // seconds for one full mission loop
let apolloT = 0;
const earthWorld = new THREE.Vector3();
const moonWorld = new THREE.Vector3();
const apA = new THREE.Vector3();
const apB = new THREE.Vector3();
const apDirEM = new THREE.Vector3();
const apTangent = new THREE.Vector3();
const apSurfUp = new THREE.Vector3();
const apPrev = new THREE.Vector3();
let apPrevValid = false;
const ORBIT_R = MOON_RADIUS * 2.6; // well clear of the lunar surface
const ORBIT_START_ANG = 0.4;
const LAUNCH_TOP = EARTH_RADIUS + 0.63; // craft-center distance at end of ascent

// Restore the dropped stages for the next launch.
function resetSaturnV() {
  saturnV.stage1.visible = true;
  saturnV.stage1.position.set(0, -0.095, 0);
  saturnV.stage1.scale.setScalar(1);
  saturnV.stage2.visible = true;
  saturnV.stage2.position.set(0, -0.04, 0);
  saturnV.stage2.scale.setScalar(1);
}

function updateApollo(dt) {
  apolloT += dt / APOLLO_DURATION;
  if (apolloT >= 1) {
    apolloT -= 1;
    apPrevValid = false;
    resetSaturnV();
  }
  const t = apolloT;

  earthWorld.copy(ballGroup.position); // roomCenter + ballOffset
  moon.getWorldPosition(moonWorld);
  apDirEM.copy(moonWorld).sub(earthWorld).normalize();

  saturnV.group.visible = false;
  saturnV.plume.visible = false;
  csm.visible = false;
  lmFlying.visible = false;

  if (t < 0.12) {
    // Launch + staging: lift off the Earth and drop the 1st then 2nd stage,
    // leaving only the short CSM/LM spacecraft to continue to the Moon.
    const p = t / 0.12;
    saturnV.group.visible = true;
    saturnV.plume.visible = true;
    saturnV.plume.scale.y = 0.7 + Math.random() * 0.6; // flicker
    const climb = smooth(p) * 0.5;
    saturnV.group.position.copy(earthWorld).addScaledVector(apDirEM, EARTH_RADIUS + 0.13 + climb);
    alignY(saturnV.group, apDirEM);

    if (t > 0.03) {
      const sp = smooth((t - 0.03) / 0.04); // S-IC drops 0.03–0.07
      saturnV.stage1.position.y = -0.095 - sp * 0.25;
      saturnV.stage1.scale.setScalar(1 - sp * 0.6);
      if (t > 0.07) saturnV.stage1.visible = false;
    }
    if (t > 0.07) {
      const sp = smooth((t - 0.07) / 0.04); // S-II drops 0.07–0.11
      saturnV.stage2.position.y = -0.04 - sp * 0.25;
      saturnV.stage2.scale.setScalar(1 - sp * 0.6);
      if (t > 0.11) saturnV.stage2.visible = false;
    }
    apPrev.copy(saturnV.group.position);
    apPrevValid = true;
  } else if (t < 0.5) {
    // Trans-lunar coast: only the short stack remains; glide to a point that
    // sits exactly on the lunar orbit circle (so it never enters the surface).
    const p = (t - 0.12) / 0.38;
    saturnV.group.visible = true;
    saturnV.stage1.visible = false;
    saturnV.stage2.visible = false;
    apA.copy(earthWorld).addScaledVector(apDirEM, LAUNCH_TOP);
    orbitPos(moonWorld, ORBIT_R, ORBIT_START_ANG, apB);
    saturnV.group.position.lerpVectors(apA, apB, smooth(p));
    if (apPrevValid) {
      apTangent.copy(saturnV.group.position).sub(apPrev);
      alignY(saturnV.group, apTangent);
    }
    apPrev.copy(saturnV.group.position);
    apPrevValid = true;
  } else if (t < 0.92) {
    // Lunar orbit: the CSM ("母艦") circles the Moon; the LM separates and lands.
    const p = (t - 0.5) / 0.42;
    csm.visible = true;
    const ang = ORBIT_START_ANG + p * Math.PI * 3;
    orbitPos(moonWorld, ORBIT_R, ang, apA);
    csm.position.copy(apA);
    orbitPos(moonWorld, ORBIT_R, ang + 0.01, apB);
    apTangent.copy(apB).sub(apA);
    alignY(csm, apTangent);

    if (p > 0.25) {
      const dp = (p - 0.25) / 0.5;
      if (dp < 1) {
        // Descend from orbit down onto the surface lander's exact spot.
        lmFlying.visible = true;
        surfaceLander.getWorldPosition(apB);
        lmFlying.position.lerpVectors(apA, apB, smooth(dp));
        apSurfUp.copy(apB).sub(moonWorld).normalize();
        alignY(lmFlying, apSurfUp);
      }
      // dp >= 1: landed — the permanent surfaceLander stands in for it.
    }
    apPrevValid = false;
  }
  // t >= 0.92: brief reset gap before the next launch.
}

renderer.setAnimationLoop((timestamp) => {
  const dt = Math.min((timestamp - lastFrameTime) / 1000 || 0, 0.04);
  lastFrameTime = timestamp;

  keyboardSteer();
  updateHandTouch(dt);
  updateLocomotion(dt);

  if (ballActive) {
    if (stepBall(dt)) {
      playCollisionSound();
    }
    ballGroup.position.copy(roomCenter).add(ballOffset);
  } else {
    // Idle: gentle float in place until the Earth is touched.
    ballGroup.position.copy(roomCenter).add(ballOffset);
    ballGroup.position.y += Math.sin(timestamp * 0.0012) * 0.02;
  }

  // The Earth always spins slowly on its tilted axis; the cloud shell drifts a
  // little faster, and its opacity breathes to suggest weather changing.
  earthMesh.rotation.y += dt * EARTH_SPIN;
  cloudMesh.rotation.y += dt * CLOUD_SPIN;
  cloudMesh.material.opacity = 0.75 + Math.sin(timestamp * 0.00035) * 0.12;
  moon.rotation.y += dt * 0.04;
  moonOrbit.rotation.y += dt * MOON_ORBIT_SPEED;
  updatePlane(dt);
  sunMaterial.uniforms.uTime.value = elapsed;
  sunMesh.rotation.y += dt * 0.03;
  saturnBall.rotation.y += dt * 0.1;
  for (const p of planets) p.mesh.rotation.y += dt * p.spin;

  // Refresh world matrices so the Apollo mission can read the live Moon
  // position (the Moon both orbits the Earth and the Earth roams the room).
  ballGroup.updateWorldMatrix(true, true);
  updateApollo(dt);

  // Ambient space life: orbiting satellite, occasional comet, surface lightning.
  elapsed += dt;
  satOrbit.rotation.y += dt * SAT_ORBIT_SPEED;
  updateMeteor(dt);
  updateEnterprise(dt);
  updateLightning(dt);

  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
