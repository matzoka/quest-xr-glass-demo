import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const statusEl = document.querySelector("#status");
const vrButton = document.querySelector("#vrButton");
const arButton = document.querySelector("#arButton");

// ---------------------------------------------------------------------------
// Scene / renderer
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090c);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 60);

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
let cruiseSpeed = 2.6; // constant speed kept while flying (set by the last kick)

const CRUISE_DEFAULT = 2.6; // speed for keyboard / click / trigger kicks
const MIN_KICK = 1.8; // a gentle touch still gets the ball moving
const MAX_KICK = 5.5; // cap so a fast swing does not fling it absurdly fast
const HAND_GAIN = 2.3; // how strongly hand speed maps to launch speed
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

function loadTex(file) {
  const tex = texLoader.load(TEX_BASE + file, undefined, undefined, (err) => {
    console.error("texture load failed:", file, err);
    statusEl.textContent = "地球テクスチャの読み込みに失敗しました（ネットワークをご確認ください）。";
  });
  tex.colorSpace = THREE.SRGBColorSpace;
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
    alphaMap: loadTex("earth_clouds_1024.png"),
    color: 0xffffff,
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

// Moon — true to scale: radius ~0.273x Earth, distance ~60.3 Earth radii. At
// this real ratio it appears as a small dot far outside the room.
const MOON_RADIUS = EARTH_RADIUS * 0.273;
const MOON_DISTANCE = EARTH_RADIUS * 60.3;
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_RADIUS, 32, 24),
  new THREE.MeshStandardMaterial({ map: loadTex("moon_1024.jpg"), roughness: 1.0, metalness: 0.0 })
);
moon.position.copy(new THREE.Vector3(0.5, 0.45, -0.75).normalize()).multiplyScalar(MOON_DISTANCE);
ballGroup.add(moon);

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
  new THREE.SphereGeometry(0.028, 12, 10),
  new THREE.MeshBasicMaterial({ color: 0xfff1da })
);
const meteorTrail = new THREE.Mesh(
  new THREE.ConeGeometry(0.045, 0.42, 14, 1, true),
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
meteorTrail.position.z = 0.22; // trail streams away from the Earth
meteor.add(meteorTrail);
meteor.visible = false;
meteorGroup.add(meteor);

const meteorFlash = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 14, 12),
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
const shipHullMat = new THREE.MeshStandardMaterial({ color: 0xdde3ec, metalness: 0.5, roughness: 0.45 });
const shipGlowMat = new THREE.MeshBasicMaterial({ color: 0x6fd2ff });

const enterprise = new THREE.Group();
const eSaucer = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 28), shipHullMat);
eSaucer.position.set(0, 0, -0.1); // forward saucer section
enterprise.add(eSaucer);
const eHull = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.1, 6, 12), shipHullMat);
eHull.rotation.x = Math.PI / 2;
eHull.position.set(0, -0.022, 0.025);
enterprise.add(eHull);
const eNeck = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.045, 0.016), shipHullMat);
eNeck.position.set(0, -0.014, -0.05);
enterprise.add(eNeck);
for (const sx of [-1, 1]) {
  const nacelle = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.12, 6, 12), shipHullMat);
  nacelle.rotation.x = Math.PI / 2;
  nacelle.position.set(sx * 0.075, 0.04, 0.06);
  enterprise.add(nacelle);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), shipGlowMat);
  glow.position.set(sx * 0.075, 0.04, 0.128); // glowing rear of each nacelle
  enterprise.add(glow);

  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.055, 0.035), shipHullMat);
  pylon.position.set(sx * 0.038, 0.012, 0.06);
  pylon.rotation.z = sx * 0.6;
  enterprise.add(pylon);

  const wake = new THREE.Mesh(
    new THREE.ConeGeometry(0.02, 0.55, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x7fd8ff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  wake.rotation.x = Math.PI / 2; // cone tip points +Z (behind the ship)
  wake.position.set(sx * 0.075, 0.04, 0.42); // trail behind the nacelle
  enterprise.add(wake);
}
enterprise.scale.setScalar(1.4);
enterprise.visible = false;
scene.add(enterprise);

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
    statusEl.textContent = `${label} 起動中。手（コントローラー）を地球に近づけて触れると弾けます。`;
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
  unlockShipClip();
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
let shipClipReady = false;
const shipClip = new Audio("./assets/enterprise_theme.mp3");
shipClip.preload = "auto";
shipClip.addEventListener("canplaythrough", () => {
  shipClipReady = true;
});
shipClip.addEventListener("error", () => {
  shipClipReady = false; // no file (or unsupported) — fall back to the synth fanfare
});

// Browsers block autoplay until a user gesture. On the first tap/click/trigger
// we "unlock" the clip by play+pause inside that gesture, so it can then
// auto-play when the Enterprise enters (desktop preview is lenient, but real
// browsers and Quest are strict).
let shipClipUnlocked = false;
function unlockShipClip() {
  if (shipClipUnlocked) return;
  const p = shipClip.play();
  if (p && p.then) {
    p.then(() => {
      shipClip.pause();
      shipClip.currentTime = 0;
      shipClipUnlocked = true;
    }).catch(() => {});
  }
}

function playShipEntrance() {
  if (shipClipReady) {
    try {
      shipClip.currentTime = 0;
      const p = shipClip.play();
      if (p && p.catch) p.catch(() => playEnterpriseTheme());
      return;
    } catch (e) {
      /* fall through to the synth fanfare */
    }
  }
  playEnterpriseTheme();
}

function stopShipAudio() {
  stopEnterpriseTheme();
  if (shipClip && !shipClip.paused) {
    try {
      shipClip.pause();
    } catch (e) {
      /* ignore */
    }
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
    // Launch from the controller along its pointing (-Z) direction.
    tmpDir.set(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    kick(tmpDir, CRUISE_DEFAULT);
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
const LOCO_SPEED = 1.8; // m/s

renderer.xr.addEventListener("sessionstart", () => {
  xrBaseRefSpace = renderer.xr.getReferenceSpace();
  locomotion.set(0, 0, 0);
});

function updateLocomotion(dt) {
  const session = renderer.xr.getSession();
  if (!session || !xrBaseRefSpace) return;

  let mx = 0;
  let mz = 0;
  for (const src of session.inputSources) {
    const ax = src.gamepad?.axes;
    if (!ax || ax.length < 2) continue;
    const x = ax.length >= 4 ? ax[2] : ax[0];
    const z = ax.length >= 4 ? ax[3] : ax[1];
    if (Math.abs(x) > 0.15) mx += x;
    if (Math.abs(z) > 0.15) mz += z;
  }
  if (mx === 0 && mz === 0) return;

  const cam = renderer.xr.getCamera();
  cam.getWorldDirection(tmpDir);
  tmpDir.y = 0;
  if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, -1);
  tmpDir.normalize();
  tmpRight.crossVectors(tmpDir, worldUp).normalize();

  locomotion.addScaledVector(tmpDir, -mz * LOCO_SPEED * dt);
  locomotion.addScaledVector(tmpRight, mx * LOCO_SPEED * dt);

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
