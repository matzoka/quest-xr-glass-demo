import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";

const statusEl = document.querySelector("#status");
const vrButton = document.querySelector("#vrButton");
const arButton = document.querySelector("#arButton");
const enterpriseOrbitButton = document.querySelector("#enterpriseOrbitButton");
const klingonButton = document.querySelector("#klingonButton");
const blackHoleTourButton = document.querySelector("#blackHoleTourButton");
const controllerHelpButton = document.querySelector("#controllerHelpButton");
const taxiAnalyticsButton = document.querySelector("#taxiAnalyticsButton");
const poseDebugOutputEl = document.querySelector("#poseDebugOutput");

// Taxi feature gating: only show if Worker injected __TAXI_ALLOWED__=true
// When accessed outside Worker (GitHub Pages, local file), defaults to hidden
const TAXI_ALLOWED = window.__TAXI_ALLOWED__ === true;
if (TAXI_ALLOWED && taxiAnalyticsButton) {
  taxiAnalyticsButton.removeAttribute("hidden");
}

const APP_VERSION = "v2026.09.29.19";
const DEBUG_TOP_VIEW = new URLSearchParams(window.location.search).has("topDebug");
const DEBUG_TOP_VIEW_DISTANCE = Number(new URLSearchParams(window.location.search).get("topDebugDist"));
const DEBUG_BLACK_HOLE_VIEW = new URLSearchParams(window.location.search).has("blackHoleDebug");
const DEBUG_BLACK_HOLE_FALL = new URLSearchParams(window.location.search).has("blackHoleFallDebug");
const DEBUG_BLACK_HOLE_BACK_VIEW = new URLSearchParams(window.location.search).has("blackHoleBackDebug");
const BLACK_HOLE_VISUAL_VARIANT = new URLSearchParams(window.location.search).get("blackHoleVisual") || "gargantuaA";
const DEBUG_SOLAR_SPOT_VIEW = new URLSearchParams(window.location.search).has("solarSpotDebug");
const DEBUG_SOLAR_PROM_VIEW = new URLSearchParams(window.location.search).has("solarPromDebug");
const DEBUG_AURORA_VIEW = new URLSearchParams(window.location.search).has("auroraDebug");
const DEBUG_COMET_VIEW = new URLSearchParams(window.location.search).has("cometDebug");
const DEBUG_CAMERA_VIEW = new URLSearchParams(window.location.search).has("cameraDebug");
const DEBUG_POSE_CAPTURE = new URLSearchParams(window.location.search).has("poseDebug");

// ---------------------------------------------------------------------------
// Scene / renderer
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090c);

// Far plane must comfortably exceed the deep-space backdrop radius (the Milky
// Way shell sits at 372 around roomCenter) PLUS however far the viewer can fly
// via locomotion. With far=400 the backdrop got clipped to the near-black
// background the moment the player drifted away from roomCenter, which showed
// up in-headset as a huge black disc punched through the Milky Way wherever you
// looked. 2000 keeps the whole backdrop inside the frustum across the explorable
// space; depth precision is unaffected in practice (no large coplanar surfaces
// live out at that range).
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 2000);

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
const BLACK_HOLE_POSITION = new THREE.Vector3(-220, -150, -220);
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

function applyDebugTopCamera() {
  if (taxiAnalyticsPreview2D && !renderer.xr.isPresenting) {
    return;
  }
  if (DEBUG_CAMERA_VIEW && !renderer.xr.isPresenting) {
    const params = new URLSearchParams(window.location.search);
    const read = (name, fallback) => {
      const value = Number(params.get(name));
      return Number.isFinite(value) ? value : fallback;
    };
    camera.up.set(0, 1, 0);
    camera.position.set(read("camX", 0), read("camY", 2.2), read("camZ", 8));
    camera.lookAt(read("lookX", roomCenter.x), read("lookY", roomCenter.y), read("lookZ", roomCenter.z));
    return;
  }
  if (DEBUG_COMET_VIEW && !renderer.xr.isPresenting) {
    camera.up.set(0, 1, 0);
    camera.position.set(-12, 42, 12);
    camera.lookAt(-50, 28, -70);
    return;
  }
  if ((DEBUG_SOLAR_SPOT_VIEW || DEBUG_SOLAR_PROM_VIEW) && !renderer.xr.isPresenting) {
    camera.up.set(0, 1, 0);
    camera.position.set(-48, 30, -35);
    camera.lookAt(-48, 30, -62);
    return;
  }
  if (DEBUG_BLACK_HOLE_BACK_VIEW && !renderer.xr.isPresenting) {
    camera.up.set(0, 1, 0);
    camera.position.copy(BLACK_HOLE_POSITION).lerp(roomCenter, 0.16).add(new THREE.Vector3(0, 0.25, 0));
    camera.lookAt(roomCenter.x - 2.2, roomCenter.y + 1.4, roomCenter.z - 16);
    return;
  }
  if (DEBUG_BLACK_HOLE_VIEW && !renderer.xr.isPresenting) {
    camera.up.set(0, 1, 0);
    camera.position.copy(BLACK_HOLE_POSITION).add(new THREE.Vector3(-1.4, 1.15, 8.9));
    camera.lookAt(blackHoleTmp.copy(BLACK_HOLE_POSITION).add(new THREE.Vector3(0.45, -0.12, 0)));
    return;
  }
  if (!DEBUG_TOP_VIEW || renderer.xr.isPresenting) return;
  camera.up.set(0, 0, -1);
  const distance = Number.isFinite(DEBUG_TOP_VIEW_DISTANCE) ? DEBUG_TOP_VIEW_DISTANCE : 18;
  camera.position.set(roomCenter.x, roomCenter.y + distance, roomCenter.z);
  camera.lookAt(roomCenter);
}

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
const viewerWorld = new THREE.Vector3();
const viewerForward = new THREE.Vector3();
const shipAudioViewerWorld = new THREE.Vector3();
const shipAudioListenerForward = new THREE.Vector3();
const shipAudioListenerUp = new THREE.Vector3();
const audioSourceWorld = new THREE.Vector3();
const audioSourceWorldAlt = new THREE.Vector3();
const transientSpatialAudios = [];

// ---------------------------------------------------------------------------
// Deep-space backdrop: distant stars plus a soft galaxy band. It is kept as
// normal scene geometry so the Earth, Moon, and ships can still occlude it.
// ---------------------------------------------------------------------------
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeStarTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.06, "rgba(255,255,255,1)");
  g.addColorStop(0.14, "rgba(220,235,255,0.72)");
  g.addColorStop(0.24, "rgba(145,180,255,0.11)");
  g.addColorStop(0.34, "rgba(95,135,255,0.02)");
  g.addColorStop(1, "rgba(90,130,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function smoothFade01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function applyCanvasEdgeFade(ctx, width, height, edgeX = 0.12, edgeY = 0.18) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const fy = smoothFade01(Math.min(v, 1 - v) / edgeY);
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const fx = smoothFade01(Math.min(u, 1 - u) / edgeX);
      data[(y * width + x) * 4 + 3] = Math.round(data[(y * width + x) * 4 + 3] * fx * fy);
    }
  }

  ctx.putImageData(image, 0, 0);
}

function makeGalaxyTexture(seed = 71701) {
  const rand = seededRandom(seed);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const core = ctx.createRadialGradient(360, 220, 10, 360, 220, 380);
  core.addColorStop(0, "rgba(255,235,220,0.52)");
  core.addColorStop(0.22, "rgba(190,170,255,0.24)");
  core.addColorStop(0.62, "rgba(70,115,255,0.08)");
  core.addColorStop(1, "rgba(20,35,80,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.52);
  ctx.rotate(-0.18);
  for (let i = 0; i < 4200; i += 1) {
    const x = (rand() - 0.5) * canvas.width * 1.15;
    const spread = 14 + Math.pow(rand(), 2.2) * 105;
    const y = (rand() - rand()) * spread;
    const warm = rand() < 0.42;
    const alpha = 0.08 + rand() * 0.32;
    const r = rand() < 0.985 ? 0.35 + rand() * 1.05 : 1.8 + rand() * 2.2;
    ctx.fillStyle = warm
      ? `rgba(255,220,185,${alpha})`
      : `rgba(${185 + rand() * 70},${205 + rand() * 45},255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  applyCanvasEdgeFade(ctx, canvas.width, canvas.height, 0.12, 0.2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNebulaTexture(seed = 48211, hue = 0.6) {
  const rand = seededRandom(seed);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 18; i += 1) {
    const x = rand() * canvas.width;
    const y = rand() * canvas.height;
    const rx = 120 + rand() * 340;
    const alpha = 0.025 + rand() * 0.075;
    const colorA = new THREE.Color().setHSL(hue + (rand() - 0.5) * 0.09, 0.42 + rand() * 0.22, 0.48 + rand() * 0.18);
    const colorB = new THREE.Color().setHSL(hue + (rand() - 0.5) * 0.14, 0.5, 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, `rgba(${(colorA.r * 255) | 0},${(colorA.g * 255) | 0},${(colorA.b * 255) | 0},${alpha})`);
    g.addColorStop(0.38, `rgba(${(colorB.r * 255) | 0},${(colorB.g * 255) | 0},${(colorB.b * 255) | 0},${alpha * 0.35})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
  ctx.rotate((rand() - 0.5) * 0.9);
  for (let i = 0; i < 1600; i += 1) {
    const x = (rand() - 0.5) * canvas.width * 1.1;
    const y = (rand() - rand()) * (24 + Math.pow(rand(), 2.4) * 150);
    const a = 0.012 + rand() * 0.04;
    ctx.fillStyle = `rgba(${120 + rand() * 90},${145 + rand() * 70},${200 + rand() * 55},${a})`;
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.restore();

  applyCanvasEdgeFade(ctx, canvas.width, canvas.height, 0.1, 0.22);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMilkyWayTexture(seed = 830201) {
  const rand = seededRandom(seed);
  const canvas = document.createElement("canvas");
  canvas.width = 4096;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  function bandCenter(u) {
    return 0.52 + Math.sin(u * Math.PI * 2 * 1.08 + 0.62) * 0.105 + Math.sin(u * Math.PI * 2 * 2.35 - 1.7) * 0.035;
  }

  function drawWrapped(x, margin, draw) {
    draw(x);
    if (x < margin) draw(x + width);
    if (x > width - margin) draw(x - width);
  }

  function drawCloud(x, y, rx, ry, rotation, colorA, colorB, alpha) {
    drawWrapped(x, rx * 1.4, (wrappedX) => {
      ctx.save();
      ctx.translate(wrappedX, y);
      ctx.rotate(rotation);
      ctx.scale(rx / ry, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      g.addColorStop(0, colorA(alpha));
      g.addColorStop(0.42, colorB(alpha * 0.38));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, ry, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < 1400; i += 1) {
    const u = rand();
    const x = u * width;
    const coreBias = Math.exp(-Math.pow((u - 0.56) / 0.17, 2));
    const spread = 0.025 + rand() * 0.07 + coreBias * 0.035;
    const y = (bandCenter(u) + (rand() - rand()) * spread) * height;
    const rx = 55 + rand() * 230 + coreBias * 210;
    const ry = 14 + rand() * 72 + coreBias * 58;
    const warm = rand() < 0.62 || coreBias > 0.35;
    const alpha = 0.014 + rand() * 0.064 + coreBias * 0.06;
    drawCloud(
      x,
      y,
      rx,
      ry,
      (rand() - 0.5) * 0.72,
      warm
        ? (a) => `rgba(255,218,168,${a})`
        : (a) => `rgba(170,195,255,${a})`,
      warm
        ? (a) => `rgba(168,126,88,${a})`
        : (a) => `rgba(80,120,210,${a})`,
      alpha
    );
  }

  for (let i = 0; i < 42000; i += 1) {
    const u = rand();
    const coreBias = Math.exp(-Math.pow((u - 0.56) / 0.18, 2));
    const spread = 0.012 + Math.pow(rand(), 2.3) * (0.12 + coreBias * 0.055);
    const v = bandCenter(u) + (rand() - rand()) * spread;
    if (v < 0.02 || v > 0.98) continue;
    const x = u * width;
    const y = v * height;
    const warm = rand() < 0.46 + coreBias * 0.22;
    const alpha = 0.045 + rand() * (0.18 + coreBias * 0.25);
    const size = rand() < 0.992 ? 0.34 + rand() * 0.82 : 1.15 + rand() * 1.9;
    ctx.fillStyle = warm
      ? `rgba(255,222,185,${alpha})`
      : `rgba(${180 + rand() * 65},${205 + rand() * 40},255,${alpha})`;
    drawWrapped(x, 4, (wrappedX) => {
      ctx.beginPath();
      ctx.arc(wrappedX, y, size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  for (let i = 0; i < 1200; i += 1) {
    const u = 0.49 + (rand() - rand()) * 0.12;
    const v = bandCenter(u) + (rand() - rand()) * 0.06;
    const x = u * width;
    const y = v * height;
    const size = 0.9 + rand() * 2.4;
    const alpha = 0.14 + rand() * 0.42;
    ctx.fillStyle = `rgba(255,235,198,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "destination-out";
  for (let lane = 0; lane < 6; lane += 1) {
    ctx.beginPath();
    for (let step = 0; step <= 260; step += 1) {
      const u = step / 260;
      const offset = (lane - 2.5) * 0.015 + Math.sin(u * Math.PI * 2 * (1.6 + lane * 0.16) + lane) * 0.018;
      const x = u * width;
      const y = (bandCenter(u) + offset) * height;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(0,0,0,${0.035 + rand() * 0.07})`;
    ctx.lineWidth = 10 + rand() * 30;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  for (let i = 0; i < 220; i += 1) {
    const u = rand();
    const x = u * width;
    const y = (bandCenter(u) + (rand() - rand()) * (0.03 + rand() * 0.07)) * height;
    const rx = 35 + rand() * 180;
    const ry = 8 + rand() * 36;
    drawWrapped(x, rx * 1.3, (wrappedX) => {
      ctx.save();
      ctx.translate(wrappedX, y);
      ctx.rotate((rand() - 0.5) * 0.85);
      ctx.scale(rx / ry, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      g.addColorStop(0, `rgba(0,0,0,${0.16 + rand() * 0.22})`);
      g.addColorStop(0.58, `rgba(0,0,0,${0.08 + rand() * 0.12})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, ry, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  ctx.globalCompositeOperation = "source-over";
  applyCanvasEdgeFade(ctx, width, height, 0.04, 0.02);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makeSpiralGalaxyTexture(seed = 25103) {
  const rand = seededRandom(seed);
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  const center = canvas.width * 0.5;
  const tilt = 0.56 + rand() * 0.22;
  const turns = 1.58 + rand() * 0.72;
  const armCount = 2 + Math.floor(rand() * 2);
  const diskRotation = (rand() - 0.5) * 0.7;

  const halo = ctx.createRadialGradient(center, center, 8, center, center, center * 0.92);
  halo.addColorStop(0, "rgba(255,238,205,0.36)");
  halo.addColorStop(0.18, "rgba(150,180,255,0.2)");
  halo.addColorStop(0.58, "rgba(80,125,220,0.07)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(diskRotation);
  ctx.scale(1, tilt);
  ctx.globalCompositeOperation = "lighter";
  for (let arm = 0; arm < armCount; arm += 1) {
    const armOffset = (arm / armCount) * Math.PI * 2;
    for (let lane = 0; lane < 2; lane += 1) {
      ctx.beginPath();
      for (let step = 0; step <= 92; step += 1) {
        const t = step / 92;
        const radius = 14 + t * 150 + lane * 4;
        const angle = armOffset + t * turns * Math.PI * 2 + (lane - 0.5) * 0.11;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = lane === 0 ? "rgba(150,185,255,0.13)" : "rgba(255,215,190,0.065)";
      ctx.lineWidth = 2.2 + rand() * 1.4;
      ctx.stroke();
    }
  }
  for (let arm = 0; arm < armCount; arm += 1) {
    const armOffset = (arm / armCount) * Math.PI * 2;
    for (let i = 0; i < 840; i += 1) {
      const t = Math.pow(rand(), 0.72);
      const radius = 10 + t * 160;
      const angle = armOffset + t * turns * Math.PI * 2 + (rand() - 0.5) * (0.34 - t * 0.16);
      const armWidth = 1.8 + t * 8.5 + rand() * 2.6;
      const x = Math.cos(angle) * radius + (rand() - 0.5) * armWidth;
      const y = Math.sin(angle) * radius + (rand() - 0.5) * armWidth;
      const warmKnot = rand() < 0.09;
      const alpha = warmKnot ? 0.22 + rand() * 0.28 : 0.05 + rand() * 0.16;
      const dot = warmKnot ? 0.45 + rand() * 1.35 : 0.28 + rand() * 0.9;
      ctx.fillStyle = warmKnot
        ? `rgba(255,178,170,${alpha})`
        : `rgba(${155 + rand() * 80},${180 + rand() * 55},255,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let i = 0; i < 420; i += 1) {
    const radius = Math.pow(rand(), 0.92) * 168;
    const angle = rand() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const alpha = 0.018 + rand() * 0.052;
    ctx.fillStyle = `rgba(185,205,255,${alpha})`;
    ctx.fillRect(x, y, 0.6 + rand() * 1.6, 0.6 + rand() * 1.6);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(diskRotation + 0.58);
  ctx.scale(1.35, 0.42);
  ctx.globalCompositeOperation = "lighter";
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 44);
  core.addColorStop(0, "rgba(255,240,185,0.82)");
  core.addColorStop(0.38, "rgba(255,218,150,0.36)");
  core.addColorStop(1, "rgba(255,205,135,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  applyCanvasEdgeFade(ctx, canvas.width, canvas.height, 0.2, 0.2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStarPoints(count, radius, size, opacity, seed) {
  const rand = seededRandom(seed);
  const positions = [];
  const colors = [];
  const palette = [
    new THREE.Color(0xffffff),
    new THREE.Color(0xcbdcff),
    new THREE.Color(0xffe7c8),
    new THREE.Color(0xbfdfff),
  ];

  for (let i = 0; i < count; i += 1) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const d = radius * (0.86 + rand() * 0.14);
    positions.push(Math.cos(a) * r * d, z * d, Math.sin(a) * r * d);
    const c = palette[Math.floor(rand() * palette.length)];
    const distanceT = THREE.MathUtils.clamp((d / radius - 0.86) / 0.14, 0, 1);
    const depthBrightness = THREE.MathUtils.lerp(1.28, 0.78, distanceT);
    const dimFactor = 0.38 + rand() * 0.24;
    const twinkle = (0.82 + rand() * 0.68) * depthBrightness * dimFactor;
    colors.push(c.r * twinkle, c.g * twinkle, c.b * twinkle);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geo, mat);
}

function makeMilkyWayBand() {
  const radius = 372;
  const segments = 192;
  const rows = 18;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const brightCenter = 0.75;

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const bandOffset = (v - 0.5) * 0.86;
    for (let col = 0; col <= segments; col += 1) {
      const u = col / segments;
      const longitude = u * Math.PI * 2;
      const centerLatitude = Math.sin(u * Math.PI * 2 * 1.08 + 0.62) * 0.105 + Math.sin(u * Math.PI * 2 * 2.35 - 1.7) * 0.035;
      const latitude = centerLatitude + bandOffset;
      const cosLat = Math.cos(latitude);
      positions.push(
        Math.cos(longitude) * cosLat * radius,
        Math.sin(latitude) * radius,
        Math.sin(longitude) * cosLat * radius
      );
      uvs.push(u, v);
      const wrappedDistance = Math.abs(((u - brightCenter + 0.5) % 1) - 0.5);
      const fadeT = smoothFade01((wrappedDistance - 0.24) / 0.1);
      const brightness = THREE.MathUtils.lerp(1, 0.14, fadeT);
      colors.push(brightness, brightness, brightness);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      const a = row * (segments + 1) + col;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const band = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: makeMilkyWayTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      alphaTest: 0.004,
      vertexColors: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  );
  band.rotation.set(0.46, -0.16, -0.58);
  band.renderOrder = -20;
  return band;
}

const spaceBackdrop = new THREE.Group();
const spaceNebulaMaterials = [];
spaceBackdrop.position.copy(roomCenter);
spaceBackdrop.add(makeMilkyWayBand());
spaceBackdrop.add(makeStarPoints(2050, 265, 1.0, 0.94, 67531));
spaceBackdrop.add(makeStarPoints(1300, 185, 1.35, 0.98, 12077));
spaceBackdrop.add(makeStarPoints(325, 212, 1.75, 0.92, 43789));
spaceBackdrop.add(makeStarPoints(85, 178, 2.35, 0.98, 87103));
spaceBackdrop.add(makeStarPoints(15, 172, 3.05, 0.95, 34129));

function addGalaxyBand(position, width, height, opacity, rotationZ, seed) {
  const galaxy = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: makeGalaxyTexture(seed),
      color: 0xffffff,
      transparent: true,
      opacity,
      alphaTest: 0.003,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  );
  galaxy.position.copy(position);
  galaxy.rotation.z = rotationZ;
  spaceBackdrop.add(galaxy);
  return galaxy;
}

function addNebulaCloud(position, width, height, opacity, rotationZ, seed, hue) {
  const material = new THREE.MeshBasicMaterial({
    map: makeNebulaTexture(seed, hue),
    color: 0xffffff,
    transparent: true,
    opacity,
    alphaTest: 0.003,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.userData.baseOpacity = opacity;
  material.userData.phase = (seed % 997) * 0.013;
  material.userData.breath = 0.035 + ((seed % 31) / 31) * 0.035;
  const nebula = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  nebula.position.copy(position);
  nebula.rotation.z = rotationZ;
  spaceNebulaMaterials.push(material);
  spaceBackdrop.add(nebula);
  return nebula;
}

function makeSpiralGalaxyField(seed, textureSeed, count, radiusMin, radiusMax, opacity) {
  const rand = seededRandom(seed);
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const normal = new THREE.Vector3();
  const center = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const rotatedRight = new THREE.Vector3();
  const rotatedUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const fallbackUp = new THREE.Vector3(1, 0, 0);

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * goldenAngle + (rand() - 0.5) * 0.42;
    const dirX = Math.cos(theta) * radial;
    const dirY = y + (rand() - 0.5) * 0.016;
    const dirZ = Math.sin(theta) * radial;
    normal.set(-dirX, -dirY, -dirZ).normalize();

    const radius = radiusMin + rand() * (radiusMax - radiusMin);
    center.set(-normal.x * radius, -normal.y * radius, -normal.z * radius);

    const basisUp = Math.abs(normal.dot(worldUp)) > 0.92 ? fallbackUp : worldUp;
    right.crossVectors(basisUp, normal).normalize();
    up.crossVectors(normal, right).normalize();

    const angle = rand() * Math.PI * 2;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    rotatedRight.copy(right).multiplyScalar(ca).addScaledVector(up, sa);
    rotatedUp.copy(up).multiplyScalar(ca).addScaledVector(right, -sa);

    const size = 2.7 + Math.pow(rand(), 1.65) * 9.8;
    const aspect = 0.78 + rand() * 0.38;
    const hw = size * 0.5;
    const hh = size * aspect * 0.5;
    const brightness = 0.38 + Math.pow(rand(), 1.4) * 0.82;
    const blueShift = 0.78 + rand() * 0.22;
    const base = (positions.length / 3) | 0;
    const corners = [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ];

    for (const [sx, sy, u, v] of corners) {
      positions.push(
        center.x + rotatedRight.x * sx * hw + rotatedUp.x * sy * hh,
        center.y + rotatedRight.y * sx * hw + rotatedUp.y * sy * hh,
        center.z + rotatedRight.z * sx * hw + rotatedUp.z * sy * hh
      );
      uvs.push(u, v);
      colors.push(brightness * blueShift, brightness * (0.86 + rand() * 0.14), brightness);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const material = new THREE.MeshBasicMaterial({
    map: makeSpiralGalaxyTexture(textureSeed),
    color: 0xffffff,
    transparent: true,
    opacity,
    alphaTest: 0.004,
    vertexColors: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Mesh(geometry, material);
}

function addDistantSpiralGalaxies() {
  const rand = seededRandom(407219);
  const placements = [
    { theta: -2.65, y: 0.38, size: 42, opacity: 0.5 },
    { theta: -2.08, y: -0.24, size: 24, opacity: 0.38 },
    { theta: -1.34, y: 0.68, size: 18, opacity: 0.32 },
    { theta: -0.58, y: -0.56, size: 34, opacity: 0.44 },
    { theta: 0.22, y: 0.18, size: 21, opacity: 0.34 },
    { theta: 0.84, y: -0.74, size: 16, opacity: 0.28 },
    { theta: 1.42, y: 0.52, size: 30, opacity: 0.4 },
    { theta: 2.06, y: -0.12, size: 22, opacity: 0.34 },
    { theta: 2.58, y: 0.78, size: 14, opacity: 0.26 },
    { theta: 3.02, y: -0.42, size: 38, opacity: 0.46 },
    { theta: -2.88, y: -0.7, size: 18, opacity: 0.3 },
    { theta: -2.42, y: 0.06, size: 28, opacity: 0.38 },
    { theta: -1.72, y: 0.84, size: 12, opacity: 0.24 },
    { theta: -1.02, y: -0.36, size: 32, opacity: 0.42 },
    { theta: -0.2, y: 0.72, size: 16, opacity: 0.28 },
    { theta: 0.48, y: -0.02, size: 26, opacity: 0.36 },
    { theta: 1.1, y: -0.58, size: 20, opacity: 0.32 },
    { theta: 1.74, y: 0.26, size: 36, opacity: 0.44 },
    { theta: 2.32, y: -0.82, size: 13, opacity: 0.24 },
    { theta: 2.86, y: 0.08, size: 30, opacity: 0.4 },
  ];
  const normal = new THREE.Vector3();
  const position = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < placements.length; i += 1) {
    const p = placements[i];
    const radial = Math.sqrt(Math.max(0, 1 - p.y * p.y));
    normal.set(Math.cos(p.theta) * radial, p.y, Math.sin(p.theta) * radial).normalize();
    position.copy(normal).multiplyScalar(286 + rand() * 56);
    const aspect = 0.78 + rand() * 0.28;
    const galaxy = new THREE.Mesh(
      new THREE.PlaneGeometry(p.size, p.size * aspect),
      new THREE.MeshBasicMaterial({
        map: makeSpiralGalaxyTexture(260001 + i * 947),
        color: 0xffffff,
        transparent: true,
        opacity: p.opacity,
        alphaTest: 0.006,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    galaxy.position.copy(position);
    galaxy.lookAt(roomCenter);
    galaxy.rotateZ(rand() * Math.PI * 2);
    if (Math.abs(normal.dot(worldUp)) > 0.98) galaxy.rotateZ(0.4);
    spaceBackdrop.add(galaxy);
  }
}

addGalaxyBand(new THREE.Vector3(-70, 22, -180), 170, 70, 0.78, 0.0, 71701);
addGalaxyBand(new THREE.Vector3(78, 38, -225), 62, 24, 0.44, -0.38, 36017);
addGalaxyBand(new THREE.Vector3(108, -34, -245), 48, 18, 0.34, 0.28, 90163);
addGalaxyBand(new THREE.Vector3(-132, -28, -238), 42, 16, 0.32, -0.18, 52121);
addGalaxyBand(new THREE.Vector3(8, 62, -260), 34, 12, 0.28, 0.52, 14741);
addGalaxyBand(new THREE.Vector3(-24, -58, -285), 28, 10, 0.18, -0.62, 83077);
addGalaxyBand(new THREE.Vector3(132, 8, -295), 24, 9, 0.16, 0.18, 62539);
addGalaxyBand(new THREE.Vector3(-108, 66, -310), 32, 12, 0.14, 0.46, 29401);
addGalaxyBand(new THREE.Vector3(46, -76, -318), 22, 8, 0.13, -0.28, 75931);
addNebulaCloud(new THREE.Vector3(-122, 42, -270), 130, 58, 0.22, -0.16, 88121, 0.6);
addNebulaCloud(new THREE.Vector3(96, -6, -286), 112, 46, 0.16, 0.34, 47237, 0.55);
addNebulaCloud(new THREE.Vector3(14, -66, -302), 150, 50, 0.14, -0.48, 13967, 0.69);
addDistantSpiralGalaxies();
scene.add(spaceBackdrop);

function updateSpaceBackdropMode() {
  spaceBackdrop.visible = currentMode !== "ar";
}

function updateSpaceBackdrop(elapsedTime) {
  for (const mat of spaceNebulaMaterials) {
    const base = mat.userData.baseOpacity || 0.12;
    const breath = mat.userData.breath || 0.04;
    mat.opacity = base * (1 + Math.sin(elapsedTime * 0.035 + mat.userData.phase) * breath);
  }
}

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
cloudMesh.renderOrder = 2;

function makeMajorCityLightsTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";

  function latLonToCanvas(lat, lon) {
    return {
      x: ((lon + 180) / 360) * canvas.width,
      y: ((90 - lat) / 180) * canvas.height,
    };
  }

  function drawGlowAt(x, y, radius, strength) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0.0, `rgba(255,236,170,${0.72 * strength})`);
    glow.addColorStop(0.28, `rgba(255,196,82,${0.36 * strength})`);
    glow.addColorStop(0.70, `rgba(255,150,38,${0.12 * strength})`);
    glow.addColorStop(1.0, "rgba(255,120,24,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255,246,205,${0.86 * strength})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.75, radius * 0.13), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCity(lat, lon, strength = 0.65, radius = 4.0) {
    const p = latLonToCanvas(lat, lon);
    for (const offset of [0, -canvas.width, canvas.width]) {
      drawGlowAt(p.x + offset, p.y, radius, strength);
    }
  }

  const cities = [
    // East Asia
    [35.68, 139.76, 0.9, 6.8], [34.69, 135.50, 0.62, 4.8], [35.18, 136.91, 0.48, 3.7],
    [37.57, 126.98, 0.75, 5.4], [39.90, 116.41, 0.72, 5.4], [31.23, 121.47, 0.86, 6.2],
    [23.13, 113.26, 0.76, 5.8], [22.32, 114.17, 0.58, 4.4], [25.03, 121.56, 0.52, 3.8],
    [14.60, 120.98, 0.58, 4.5], [13.76, 100.50, 0.58, 4.4], [10.82, 106.63, 0.46, 3.5],
    [1.35, 103.82, 0.58, 4.2], [-6.21, 106.85, 0.64, 4.9],

    // South and Central Asia
    [28.61, 77.21, 0.82, 6.0], [19.08, 72.88, 0.68, 5.0], [22.57, 88.36, 0.55, 4.0],
    [23.81, 90.41, 0.66, 4.8], [24.86, 67.01, 0.58, 4.4], [31.55, 74.34, 0.52, 4.0],
    [35.69, 51.39, 0.5, 3.9],

    // Middle East and Africa
    [25.20, 55.27, 0.48, 3.8], [24.71, 46.68, 0.42, 3.2], [30.04, 31.24, 0.66, 4.9],
    [41.01, 28.98, 0.62, 4.6], [6.52, 3.38, 0.5, 3.8], [-1.29, 36.82, 0.34, 2.8],
    [-26.20, 28.05, 0.42, 3.3], [-33.93, 18.42, 0.34, 2.8],

    // Europe
    [55.76, 37.62, 0.68, 5.1], [51.51, -0.13, 0.68, 5.1], [48.86, 2.35, 0.68, 5.1],
    [52.52, 13.40, 0.48, 3.7], [52.37, 4.90, 0.42, 3.2], [50.85, 4.35, 0.38, 3.0],
    [50.94, 6.96, 0.48, 3.7], [48.14, 11.58, 0.36, 2.8], [45.46, 9.19, 0.46, 3.5],
    [41.90, 12.50, 0.42, 3.2], [40.42, -3.70, 0.48, 3.7], [41.38, 2.17, 0.4, 3.0],
    [38.72, -9.14, 0.34, 2.8], [52.23, 21.01, 0.4, 3.1], [48.21, 16.37, 0.34, 2.7],
    [37.98, 23.73, 0.34, 2.7], [59.33, 18.07, 0.32, 2.6], [55.68, 12.57, 0.32, 2.6],

    // North America
    [40.71, -74.01, 0.86, 6.4], [42.36, -71.06, 0.48, 3.7], [39.95, -75.16, 0.44, 3.4],
    [38.90, -77.04, 0.48, 3.7], [43.65, -79.38, 0.5, 3.8], [45.50, -73.57, 0.38, 3.0],
    [41.88, -87.63, 0.62, 4.8], [42.33, -83.05, 0.42, 3.2], [33.75, -84.39, 0.44, 3.4],
    [25.76, -80.19, 0.44, 3.4], [32.78, -96.80, 0.48, 3.7], [29.76, -95.37, 0.44, 3.4],
    [39.74, -104.99, 0.34, 2.7], [33.45, -112.07, 0.42, 3.2], [47.61, -122.33, 0.4, 3.1],
    [37.77, -122.42, 0.44, 3.4], [34.05, -118.24, 0.68, 5.1], [32.72, -117.16, 0.34, 2.7],
    [36.17, -115.14, 0.34, 2.7], [19.43, -99.13, 0.66, 5.0], [25.69, -100.32, 0.4, 3.1],
    [20.67, -103.35, 0.38, 2.9],

    // South America
    [4.71, -74.07, 0.42, 3.2], [-12.05, -77.04, 0.42, 3.2], [-33.45, -70.66, 0.42, 3.2],
    [-34.60, -58.38, 0.52, 4.0], [-23.55, -46.63, 0.74, 5.5], [-22.91, -43.17, 0.48, 3.7],
    [-19.92, -43.94, 0.34, 2.7],

    // Oceania
    [-33.87, 151.21, 0.48, 3.7], [-37.81, 144.96, 0.44, 3.4], [-27.47, 153.03, 0.32, 2.6],
    [-31.95, 115.86, 0.3, 2.5], [-36.85, 174.76, 0.28, 2.4],
  ];

  for (const city of cities) drawCity(...city);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

const earthLightsTexture = makeMajorCityLightsTexture();

const earthNightSunDir = new THREE.Vector3(0, 0, 1);
const earthNightUniforms = {
  uSunDir: { value: earthNightSunDir },
};

const earthNightVert = `
varying vec2 vUv;
varying vec3 vNormal;
void main(){
  vUv=uv;
  vNormal=normalize(normal);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

const earthNightShadowMaterial = new THREE.ShaderMaterial({
  uniforms: {
    ...earthNightUniforms,
  },
  vertexShader: earthNightVert,
  fragmentShader: `
precision mediump float;
uniform vec3 uSunDir;
varying vec3 vNormal;
void main(){
  float lit=dot(normalize(vNormal),normalize(uSunDir));
  float night=1.0-smoothstep(-0.22,0.16,lit);
  float deepNight=1.0-smoothstep(-0.72,-0.08,lit);
  float alpha=night*(0.50+deepNight*0.30);
  if(alpha<0.01) discard;
  gl_FragColor=vec4(0.0,0.012,0.035,alpha);
}`,
  transparent: true,
  depthWrite: false,
});
const earthNightShadowMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.026, 64, 48),
  earthNightShadowMaterial
);
earthNightShadowMesh.renderOrder = 4;
earthMesh.add(earthNightShadowMesh);

const cityLightsMaterial = new THREE.ShaderMaterial({
  uniforms: {
    ...earthNightUniforms,
    uCityTex: { value: earthLightsTexture },
    uIntensity: { value: 4.2 },
  },
  vertexShader: earthNightVert,
  fragmentShader: `
precision mediump float;
uniform sampler2D uCityTex;
uniform vec3 uSunDir;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vNormal;
void main(){
  float lit=dot(normalize(vNormal),normalize(uSunDir));
  float night=1.0-smoothstep(-0.24,0.08,lit);
  vec3 cityMap=texture2D(uCityTex,vUv).rgb;
  float brightness=max(max(cityMap.r,cityMap.g),cityMap.b);
  float strength=smoothstep(0.012,0.34,brightness);
  float alpha=strength*night*1.25;
  if(alpha<0.01) discard;
  gl_FragColor=vec4(cityMap*night*uIntensity,alpha);
}`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const cityLightsMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.004, 64, 48),
  cityLightsMaterial
);
cityLightsMesh.renderOrder = 5;
earthMesh.add(cityLightsMesh);

const AURORA_SURFACE_RADIUS_SCALE = 1.058;
const AURORA_CURTAIN_MIN_BASE_RADIUS_SCALE = 1.045;
const AURORA_CURTAIN_MAX_BASE_RADIUS_SCALE = 1.125;
const AURORA_CURTAIN_MIN_HEIGHT_SCALE = 0.12;
const AURORA_CURTAIN_MAX_HEIGHT_SCALE = 0.30;
const AURORA_CURTAIN_MIN_POLAR_LIFT_SCALE = 0.022;
const AURORA_CURTAIN_MAX_POLAR_LIFT_SCALE = 0.054;
const AURORA_XR_VISIBILITY_BOOST = 1.42;
const AURORA_XR_MIN_VISIBLE_INTENSITY = 0.54;

const auroraMaterial = new THREE.ShaderMaterial({
  uniforms: {
    ...earthNightUniforms,
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 },
    uStorm: { value: 0.0 },
  },
  vertexShader: earthNightVert,
  fragmentShader: `
precision highp float;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uIntensity;
uniform float uStorm;
varying vec2 vUv;
varying vec3 vNormal;
void main(){
  vec3 n=normalize(vNormal);
  float lit=dot(n,normalize(uSunDir));
  if(lit>-0.02) discard;
  float night=1.0-smoothstep(-0.30,-0.04,lit);
  float lat=abs(n.y);
  float polarBand=smoothstep(0.67,0.77,lat)*(1.0-smoothstep(0.955,1.0,lat));
  float wave=0.5+0.5*sin(vUv.x*64.0+uTime*0.95+sin(vUv.y*29.0)*1.7);
  float ribbon=smoothstep(0.58,0.98,wave);
  float shimmer=0.68+0.32*sin(uTime*2.2+vUv.x*17.0+vUv.y*7.0);
  float stormLane=smoothstep(0.34,0.92,0.5+0.5*sin(vUv.x*11.0+uTime*0.11+sin(vUv.x*3.0)*1.2));
  float disturbance=0.20+0.62*uIntensity;
  float alpha=polarBand*night*(0.030+0.15*ribbon)*(0.74+stormLane*(0.34+uStorm*0.44))*shimmer*uIntensity;
  if(alpha<0.01) discard;
  vec3 color=mix(vec3(0.18,0.95,0.34),vec3(0.24,0.72,0.86),ribbon);
  gl_FragColor=vec4(color*alpha*(1.10+disturbance),alpha*0.64);
}`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: true,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});
const auroraMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * AURORA_SURFACE_RADIUS_SCALE, 64, 48),
  auroraMaterial
);
auroraMesh.renderOrder = 6;
auroraMesh.visible = false;
earthMesh.add(auroraMesh);

function makeAuroraCurtainGeometry(hemisphere = 1, phase = 0) {
  const thetaSegments = 256;
  const heightSegments = 24;
  const positions = [];
  const normals = [];
  const uvs = [];
  const altitudeMixes = [];
  const indices = [];

  for (let i = 0; i <= thetaSegments; i++) {
    const u = i / thetaSegments;
    const theta = u * Math.PI * 2;
    const lat = THREE.MathUtils.degToRad(
      67.2 +
        Math.sin(theta * 2.0 + phase) * 2.2 +
        Math.sin(theta * 5.0 + phase * 0.7) * 1.05
    );
    const polarRadius = Math.cos(lat);
    const polarY = hemisphere * Math.sin(lat);
    const altitudeNoise = THREE.MathUtils.clamp(
      0.5 +
        Math.sin(theta * 2.0 + phase * 0.9) * 0.34 +
        Math.sin(theta * 5.0 - phase * 0.55) * 0.18,
      0,
      1
    );
    const altitudeMix = THREE.MathUtils.smoothstep(altitudeNoise, 0, 1);
    const baseRadiusScale = THREE.MathUtils.lerp(
      AURORA_CURTAIN_MIN_BASE_RADIUS_SCALE,
      AURORA_CURTAIN_MAX_BASE_RADIUS_SCALE,
      altitudeMix
    );
    const heightScale = THREE.MathUtils.lerp(
      AURORA_CURTAIN_MIN_HEIGHT_SCALE,
      AURORA_CURTAIN_MAX_HEIGHT_SCALE,
      altitudeMix
    );
    const polarLiftScale = THREE.MathUtils.lerp(
      AURORA_CURTAIN_MIN_POLAR_LIFT_SCALE,
      AURORA_CURTAIN_MAX_POLAR_LIFT_SCALE,
      altitudeMix
    );

    for (let j = 0; j <= heightSegments; j++) {
      const v = j / heightSegments;
      const heightWave = Math.sin(theta * 3.0 + phase + v * 1.9) * 0.007;
      const radius = EARTH_RADIUS * (baseRadiusScale + v * heightScale + heightWave);
      const x = Math.cos(theta) * polarRadius * radius;
      const y = polarY * radius + hemisphere * EARTH_RADIUS * v * polarLiftScale;
      const z = Math.sin(theta) * polarRadius * radius;
      const normal = new THREE.Vector3(x, y, z).normalize();

      positions.push(x, y, z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, v);
      altitudeMixes.push(altitudeMix);
    }
  }

  const row = heightSegments + 1;
  for (let i = 0; i < thetaSegments; i++) {
    for (let j = 0; j < heightSegments; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + j + 1;
      const d = i * row + j + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("aAltitudeMix", new THREE.Float32BufferAttribute(altitudeMixes, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const auroraCurtainMaterial = new THREE.ShaderMaterial({
  uniforms: {
    ...earthNightUniforms,
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 },
    uStorm: { value: 0.0 },
  },
  vertexShader: `
precision highp float;
uniform float uTime;
uniform float uStorm;
attribute float aAltitudeMix;
varying vec2 vUv;
varying vec3 vNormal;
varying float vAltitudeMix;
void main(){
  vUv=uv;
  vNormal=normalize(normal);
  vAltitudeMix=aAltitudeMix;
  vec3 radial=normalize(position);
  float slowFront=0.5+0.5*sin(uv.x*12.566+uTime*0.055+sin(uv.x*31.416)*0.72);
  float breathing=0.5+0.5*sin(uv.x*43.0-uTime*0.18+uv.y*3.1);
  float surge=smoothstep(0.50,0.96,slowFront+uStorm*0.18);
  float lift=(0.004+0.018*surge+0.010*breathing*aAltitudeMix)*uv.y*(0.35+0.65*uStorm);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position+radial*lift,1.0);
}`,
  fragmentShader: `
precision highp float;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uIntensity;
uniform float uStorm;
varying vec2 vUv;
varying vec3 vNormal;
varying float vAltitudeMix;
float hash(float n){return fract(sin(n)*43758.5453123);}
float valueNoise(float x){
  float i=floor(x);
  float f=fract(x);
  f=f*f*(3.0-2.0*f);
  return mix(hash(i),hash(i+1.0),f);
}
void main(){
  vec3 n=normalize(vNormal);
  float lit=dot(n,normalize(uSunDir));
  if(lit>-0.02) discard;
  float night=1.0-smoothstep(-0.34,-0.05,lit);
  float height=vUv.y;
  float verticalFade=smoothstep(0.02,0.18,height)*(1.0-smoothstep(0.74,1.0,height));
  float slowCell=valueNoise(vUv.x*9.0+uTime*0.020);
  float arcNoise=valueNoise(vUv.x*23.0+sin(uTime*0.031)*1.8);
  float stormFront=smoothstep(0.36,0.94,slowCell+uStorm*0.22+0.12*sin(vUv.x*7.0-uTime*0.075));
  float arcMask=smoothstep(0.18,0.74,arcNoise+0.18*sin(vUv.x*13.0+uTime*0.10));
  float lowCurtain=(1.0-vAltitudeMix)*smoothstep(0.02,0.36,1.0-height);
  float tallRay=vAltitudeMix*smoothstep(0.22,0.88,height);
  float fineStrand=pow(0.5+0.5*sin(vUv.x*210.0+height*7.2+uTime*(1.05+uStorm*0.8)),5.0);
  float broadVeil=0.52+0.48*pow(0.5+0.5*sin(vUv.x*31.0-height*4.1+uTime*0.29),2.0);
  float verticalPulse=0.76+0.24*sin(height*9.0+uTime*0.63+vUv.x*7.0+stormFront*1.8);
  float altitudeCharacter=0.50*broadVeil+0.20*fineStrand+0.42*stormFront*(0.65*lowCurtain+1.0*tallRay);
  float alpha=night*uIntensity*verticalFade*arcMask*verticalPulse*altitudeCharacter;
  if(alpha<0.003) discard;
  vec3 low=vec3(0.12,0.95,0.30);
  vec3 high=vec3(0.22,0.80,0.72);
  vec3 violet=vec3(0.40,0.28,0.82);
  vec3 color=mix(low,high,smoothstep(0.24,0.78,height));
  color=mix(color,violet,smoothstep(0.70,0.96,height)*0.12*(0.5+vAltitudeMix));
  gl_FragColor=vec4(color*alpha*(2.35+uIntensity*1.35+stormFront*0.55),alpha*0.72);
}`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const auroraCurtainGroup = new THREE.Group();
const auroraNorthCurtain = new THREE.Mesh(makeAuroraCurtainGeometry(1, 0.0), auroraCurtainMaterial);
const auroraSouthCurtain = new THREE.Mesh(makeAuroraCurtainGeometry(-1, 2.7), auroraCurtainMaterial);
auroraNorthCurtain.renderOrder = 7;
auroraSouthCurtain.renderOrder = 7;
auroraCurtainGroup.visible = false;
auroraCurtainGroup.add(auroraNorthCurtain, auroraSouthCurtain);
earthMesh.add(auroraCurtainGroup);

let auroraFlareIntensity = 0;
let auroraFlareTarget = 0;

function updateAuroraFlare(dt) {
  let displayTarget = auroraFlareTarget;
  if (renderer.xr.isPresenting && auroraFlareTarget > 0.08) {
    displayTarget = Math.max(auroraFlareTarget * AURORA_XR_VISIBILITY_BOOST, AURORA_XR_MIN_VISIBLE_INTENSITY);
  }
  const target = DEBUG_AURORA_VIEW ? 0.92 : THREE.MathUtils.clamp(displayTarget, 0, 1);
  const response = target > auroraFlareIntensity ? 1 - Math.exp(-dt * 1.9) : 1 - Math.exp(-dt * 0.58);
  auroraFlareIntensity = THREE.MathUtils.lerp(auroraFlareIntensity, target, response);
  if (auroraFlareIntensity < 0.002 && target <= 0.001) auroraFlareIntensity = 0;
  auroraMaterial.uniforms.uIntensity.value = auroraFlareIntensity;
  auroraCurtainMaterial.uniforms.uIntensity.value = auroraFlareIntensity;
  auroraMaterial.uniforms.uStorm.value = auroraFlareIntensity;
  auroraCurtainMaterial.uniforms.uStorm.value = auroraFlareIntensity;
  auroraMesh.visible = auroraFlareIntensity > 0.006;
  auroraCurtainGroup.visible = auroraFlareIntensity > 0.012;
}

function getAuroraDebugState() {
  return {
    xrPresenting: renderer.xr.isPresenting,
    flareTarget: auroraFlareTarget,
    flareIntensity: auroraFlareIntensity,
    surfaceVisible: auroraMesh.visible,
    curtainVisible: auroraCurtainGroup.visible,
    xrVisibilityBoost: AURORA_XR_VISIBILITY_BOOST,
    xrMinVisibleIntensity: AURORA_XR_MIN_VISIBLE_INTENSITY,
  };
}

window.__questXrDebug = Object.assign(window.__questXrDebug || {}, {
  getAuroraState: getAuroraDebugState,
});

const nightSunWorld = new THREE.Vector3();
const nightSunLocal = new THREE.Vector3();
function updateEarthNightSide(timeSeconds) {
  earthMesh.updateWorldMatrix(true, false);
  sunMesh.getWorldPosition(nightSunWorld);
  nightSunLocal.copy(nightSunWorld);
  earthMesh.worldToLocal(nightSunLocal);
  nightSunLocal.normalize();
  earthNightSunDir.copy(nightSunLocal);
  auroraMaterial.uniforms.uTime.value = timeSeconds;
  auroraCurtainMaterial.uniforms.uTime.value = timeSeconds;
}

// Tilt the spin axis ~23.4 degrees like the real Earth.
const tiltGroup = new THREE.Group();
tiltGroup.rotation.z = THREE.MathUtils.degToRad(23.4);
tiltGroup.add(earthMesh);
tiltGroup.add(cloudMesh);
ballGroup.add(tiltGroup);

// Moon — true SIZE ratio (~0.273x Earth, about a quarter), with a compressed
// display distance. The real Moon is ~60 Earth-radii away; this demo uses 6 so
// the Apollo sequence is readable in a small room while still feeling separated.
const MOON_RADIUS = EARTH_RADIUS * 0.273;
const MOON_DISTANCE = EARTH_RADIUS * 6.0;
const MOON_ORBIT_SPEED = 0.015; // rad/s — slow enough that Apollo is not chasing a racing Moon
const moonSunDir = new THREE.Vector3(1, 0, 0);
const moonSunWorld = new THREE.Vector3();
const moonSunLocal = new THREE.Vector3();
const moonMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTex: { value: loadTex("moon_1024.jpg") },
    uSunDir: { value: moonSunDir },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
  },
  vertexShader: `
varying vec2 vUv;
varying vec3 vNormal;
void main(){
  vUv=uv;
  vNormal=normalize(normal);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`,
  fragmentShader: `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uSunDir;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec3 vNormal;
float luma(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
void main(){
  vec3 tex=texture2D(uTex,vUv).rgb;
  float center=luma(tex);
  float blur=0.0;
  blur+=luma(texture2D(uTex,vUv+vec2(uTexel.x,0.0)).rgb);
  blur+=luma(texture2D(uTex,vUv-vec2(uTexel.x,0.0)).rgb);
  blur+=luma(texture2D(uTex,vUv+vec2(0.0,uTexel.y)).rgb);
  blur+=luma(texture2D(uTex,vUv-vec2(0.0,uTexel.y)).rgb);
  blur*=0.25;
  float craterDark=clamp((blur-center)*3.15,0.0,0.34);
  float craterBright=clamp((center-blur)*1.45,0.0,0.14);
  float craterShade=clamp(1.0-craterDark+craterBright,0.68,1.22);

  float lit=dot(normalize(vNormal),normalize(uSunDir));
  float day=smoothstep(-0.13,0.18,lit);
  float direct=pow(max(lit,0.0),0.82);
  float light=mix(0.24,0.66+0.58*direct,day);
  vec3 tint=mix(vec3(0.46,0.48,0.52),vec3(1.08,1.03,0.94),day);
  vec3 color=tex*craterShade*light*tint;
  gl_FragColor=vec4(color,1.0);
}`,
});
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_RADIUS, 48, 32),
  moonMaterial
);
moon.position.set(MOON_DISTANCE, 0, 0);
const moonOrbit = new THREE.Group();
moonOrbit.rotation.x = THREE.MathUtils.degToRad(6); // gently inclined orbit
moonOrbit.add(moon);
ballGroup.add(moonOrbit);

function updateMoonLighting() {
  moon.updateWorldMatrix(true, false);
  sunMesh.getWorldPosition(moonSunWorld);
  moonSunLocal.copy(moonSunWorld);
  moon.worldToLocal(moonSunLocal);
  moonSunLocal.normalize();
  moonSunDir.copy(moonSunLocal);
}

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
const satelliteBodyDayColor = new THREE.Color(0xc2cad4);
const satelliteBodyNightColor = new THREE.Color(0x030507);
const satellitePanelDayColor = new THREE.Color(0x24407e);
const satellitePanelNightColor = new THREE.Color(0x000205);
const satellitePanelDayEmissive = new THREE.Color(0x0b1c3d);
const satellitePanelNightEmissive = new THREE.Color(0x000000);
const bodyMat = new THREE.MeshStandardMaterial({ color: satelliteBodyDayColor.clone(), metalness: 0.8, roughness: 0.35 });
const panelMat = new THREE.MeshStandardMaterial({
  color: satellitePanelDayColor.clone(),
  metalness: 0.5,
  roughness: 0.4,
  emissive: satellitePanelDayEmissive.clone(),
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
satellite.scale.setScalar(0.25); // smaller now that the Moon is in the scene

const satOrbit = new THREE.Group();
satOrbit.rotation.x = THREE.MathUtils.degToRad(35); // inclined orbit
satOrbit.add(satellite);
ballGroup.add(satOrbit);
const SAT_ORBIT_SPEED = 0.16; // rad/s — slower orbit so the satellite no longer rushes around Earth
const satelliteWorld = new THREE.Vector3();
const satelliteLocal = new THREE.Vector3();
const satelliteSunLocal = new THREE.Vector3();

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
// Shooting stars: most meteors skim the upper atmosphere at a shallow angle and
// burn out before reaching the ground. Only a rare event reaches the surface.
// Lives in ballGroup's frame, so the Earth's center is the local origin.
// ---------------------------------------------------------------------------
const meteorGroup = new THREE.Group();
ballGroup.add(meteorGroup);

const meteor = new THREE.Mesh(
  new THREE.SphereGeometry(0.0025, 10, 8),
  new THREE.MeshBasicMaterial({
    color: 0xfff1da,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
const meteorTrail = new THREE.Mesh(
  new THREE.ConeGeometry(0.001125, 0.13, 12, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xffb060,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
meteorTrail.rotation.x = Math.PI / 2; // cone tip points along local +Z, behind the incoming path
meteorTrail.position.z = 0.07; // trail streams behind the meteor
meteor.add(meteorTrail);
meteor.visible = false;
meteorGroup.add(meteor);

const meteorFlash = new THREE.Mesh(
  new THREE.SphereGeometry(0.011, 14, 12),
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

const METEOR_TRAIL_AXIS = new THREE.Vector3(0, 0, 1); // meteor trail extends along local +Z
const METEOR_IMPACT_DIR = new THREE.Vector3(0.45, 1.0, 0.35).normalize(); // original rare surface-impact path
const METEOR_IMPACT_START_R = 1.15;
const METEOR_BURN_SPEED = 0.42;
const METEOR_IMPACT_SPEED = 1.1;
const METEOR_BURN_END_R = EARTH_RADIUS * 1.13;
const METEOR_IMPACT_END_R = EARTH_RADIUS * 1.02;
const METEOR_BURN_PATH_LEN = EARTH_RADIUS * 1.45;
const METEOR_IMPACT_CHANCE = 0.08;
const METEOR_MIN_INTERVAL = 18;
const METEOR_MAX_INTERVAL = 36;
const METEOR_FLASH_TIME = 0.35;
const METEOR_BURN_FLASH_TIME = 0.24;
const METEOR_KIND_BURN = "burn";
const METEOR_KIND_IMPACT = "impact";
let meteorActive = false;
let meteorKind = METEOR_KIND_BURN;
let meteorProgress = 0;
let meteorPathLength = 1;
let meteorSpeed = METEOR_BURN_SPEED;
let meteorFlashLife = 0;
let meteorFlashDuration = METEOR_FLASH_TIME;
let meteorFlashBaseScale = 1;
let meteorFlashExpand = 1.8;
let nextMeteorAt = 5.0;
const meteorStart = new THREE.Vector3();
const meteorEnd = new THREE.Vector3();
const meteorMoveDir = new THREE.Vector3();
const meteorTrailDir = new THREE.Vector3();
const meteorUp = new THREE.Vector3();
const meteorTangent = new THREE.Vector3();
const meteorRandomDir = new THREE.Vector3();
const meteorSunWorld = new THREE.Vector3();
const meteorSunLocal = new THREE.Vector3();
const meteorCameraWorld = new THREE.Vector3();
const meteorCameraLocal = new THREE.Vector3();

function randomUnitVector(out) {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(Math.cos(a) * r, z, Math.sin(a) * r);
}

function getSunDirInBallFrame(out) {
  sunMesh.getWorldPosition(meteorSunWorld);
  out.copy(meteorSunWorld);
  ballGroup.worldToLocal(out);
  return out.normalize();
}

function getCameraDirInBallFrame(out) {
  camera.getWorldPosition(meteorCameraWorld);
  out.copy(meteorCameraWorld);
  ballGroup.worldToLocal(out);
  if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
  return out.normalize();
}

function chooseVisibleNightUp(out) {
  getSunDirInBallFrame(meteorSunLocal);
  getCameraDirInBallFrame(meteorCameraLocal);
  for (let i = 0; i < 80; i += 1) {
    randomUnitVector(out);
    if (out.dot(meteorSunLocal) < -0.08 && out.dot(meteorCameraLocal) > 0.08) return out;
  }
  return out.copy(meteorSunLocal).negate().addScaledVector(meteorCameraLocal, 0.75).normalize();
}

function updateSatelliteLighting() {
  getSunDirInBallFrame(satelliteSunLocal);
  satellite.getWorldPosition(satelliteWorld);
  satelliteLocal.copy(satelliteWorld);
  ballGroup.worldToLocal(satelliteLocal);
  if (satelliteLocal.lengthSq() < 1e-6) return;
  satelliteLocal.normalize();
  const lit = satelliteLocal.dot(satelliteSunLocal);
  const daylight = THREE.MathUtils.smoothstep(lit, -0.16, 0.22);
  bodyMat.color.copy(satelliteBodyNightColor).lerp(satelliteBodyDayColor, daylight);
  panelMat.color.copy(satellitePanelNightColor).lerp(satellitePanelDayColor, daylight);
  panelMat.emissive.copy(satellitePanelNightEmissive).lerp(satellitePanelDayEmissive, daylight);
  panelMat.emissiveIntensity = daylight * 0.5;
}

function scheduleNextMeteor() {
  nextMeteorAt = elapsed + METEOR_MIN_INTERVAL + Math.random() * (METEOR_MAX_INTERVAL - METEOR_MIN_INTERVAL);
}

function triggerMeteorFlash(position, isImpact) {
  meteorFlash.position.copy(position);
  meteorFlash.scale.setScalar(isImpact ? 1 : 0.55);
  meteorFlash.material.color.set(isImpact ? 0xffd9a0 : 0xbfefff);
  meteorFlash.material.opacity = isImpact ? 1 : 0.78;
  meteorFlash.visible = true;
  meteorFlashLife = isImpact ? METEOR_FLASH_TIME : METEOR_BURN_FLASH_TIME;
  meteorFlashDuration = meteorFlashLife;
  meteorFlashBaseScale = isImpact ? 1 : 0.55;
  meteorFlashExpand = isImpact ? 1.8 : 1.05;
}

function spawnMeteor() {
  meteorKind = Math.random() < METEOR_IMPACT_CHANCE ? METEOR_KIND_IMPACT : METEOR_KIND_BURN;
  meteorProgress = 0;

  if (meteorKind === METEOR_KIND_IMPACT) {
    meteorStart.copy(METEOR_IMPACT_DIR).multiplyScalar(METEOR_IMPACT_START_R);
    meteorEnd.copy(METEOR_IMPACT_DIR).multiplyScalar(METEOR_IMPACT_END_R);
    meteorMoveDir.copy(METEOR_IMPACT_DIR).negate();
    meteorPathLength = meteorStart.distanceTo(meteorEnd);
    meteorSpeed = METEOR_IMPACT_SPEED;
    meteor.material.color.set(0xfff1da);
    meteorTrail.material.color.set(0xffb060);
  } else {
    chooseVisibleNightUp(meteorUp);
    meteorTangent.crossVectors(meteorCameraLocal, meteorUp);
    if (meteorTangent.lengthSq() < 1e-5) {
      randomUnitVector(meteorRandomDir);
      meteorTangent.crossVectors(meteorRandomDir, meteorUp);
    }
    meteorTangent.normalize();
    if (Math.random() < 0.5) meteorTangent.negate();
    meteorEnd.copy(meteorUp).multiplyScalar(METEOR_BURN_END_R);
    meteorMoveDir.copy(meteorTangent).multiplyScalar(0.98).addScaledVector(meteorUp, -0.22).normalize();
    meteorPathLength = METEOR_BURN_PATH_LEN;
    meteorSpeed = METEOR_BURN_SPEED;
    meteor.material.color.set(0xeaffff);
    meteorTrail.material.color.set(0xffd08a);
    meteorStart.copy(meteorEnd).addScaledVector(meteorMoveDir, -meteorPathLength);
  }

  meteor.position.copy(meteorStart);
  meteorTrailDir.copy(meteorMoveDir).negate();
  meteor.quaternion.setFromUnitVectors(METEOR_TRAIL_AXIS, meteorTrailDir);
  meteor.material.opacity = 0;
  meteorTrail.material.opacity = 0;
  meteor.scale.setScalar(meteorKind === METEOR_KIND_IMPACT ? 1.0 : 0.85);
  meteorTrail.scale.setScalar(meteorKind === METEOR_KIND_IMPACT ? 1.0 : 1.35);
  meteor.visible = true;
  meteorActive = true;
}

function updateMeteor(dt) {
  if (meteorFlashLife > 0) {
    meteorFlashLife -= dt;
    const k = Math.max(0, meteorFlashLife / meteorFlashDuration);
    meteorFlash.material.opacity = k;
    meteorFlash.scale.setScalar(meteorFlashBaseScale + (1 - k) * meteorFlashExpand);
    if (meteorFlashLife <= 0) meteorFlash.visible = false;
  }
  if (!meteorActive) {
    if (elapsed >= nextMeteorAt) spawnMeteor();
    return;
  }
  meteorProgress = Math.min(1, meteorProgress + (meteorSpeed * dt) / meteorPathLength);
  meteor.position.copy(meteorStart).addScaledVector(meteorMoveDir, meteorPathLength * meteorProgress);
  const fadeIn = THREE.MathUtils.smoothstep(meteorProgress, 0, 0.16);
  const fadeOut = 1 - THREE.MathUtils.smoothstep(meteorProgress, 0.82, 1.0);
  const glow = fadeIn * fadeOut;
  const burnBoost = meteorKind === METEOR_KIND_BURN ? 0.65 + 0.35 * THREE.MathUtils.smoothstep(meteorProgress, 0.48, 0.82) : 1;
  meteor.material.opacity = (meteorKind === METEOR_KIND_BURN ? 0.9 : 0.82) * glow * burnBoost;
  meteorTrail.material.opacity = (meteorKind === METEOR_KIND_BURN ? 0.86 : 0.58) * glow * burnBoost;
  meteor.scale.setScalar((meteorKind === METEOR_KIND_BURN ? 0.85 : 1.0) + meteorProgress * 0.5);

  if (meteorProgress >= 1) {
    triggerMeteorFlash(meteorEnd, meteorKind === METEOR_KIND_IMPACT);
    meteor.visible = false;
    meteorActive = false;
    scheduleNextMeteor();
  }
}

// ---------------------------------------------------------------------------
// Long-period comet: a slow, solar-centered elliptical pass. It is not aimed at
// the Earth; the tail points away from the Sun rather than simply behind motion.
// ---------------------------------------------------------------------------
function makeCometHeadTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0.0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(210,245,255,0.85)");
  g.addColorStop(0.62, "rgba(110,190,255,0.28)");
  g.addColorStop(1.0, "rgba(70,130,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCometTailTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const v = (y + 0.5) / canvas.height - 0.5;
    const widthFade = Math.exp(-(v * v) / 0.035);
    for (let x = 0; x < canvas.width; x += 1) {
      const u = x / (canvas.width - 1);
      const tailFade = Math.pow(1 - u, 1.7);
      const alpha = Math.round(235 * tailFade * widthFade);
      const i = (y * canvas.width + x) * 4;
      img.data[i] = 145 + Math.round(90 * tailFade);
      img.data[i + 1] = 210 + Math.round(45 * tailFade);
      img.data[i + 2] = 255;
      img.data[i + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const comet = new THREE.Group();
const cometTail = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    map: makeCometTailTexture(),
    color: 0xc8efff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
const COMET_TAIL_LENGTH = 28;
const COMET_TAIL_WIDTH = 2.7;
cometTail.position.x = COMET_TAIL_LENGTH * 0.5;
cometTail.scale.set(COMET_TAIL_LENGTH, COMET_TAIL_WIDTH, 1);
comet.add(cometTail);
const cometHead = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeCometHeadTexture(),
    color: 0xeaffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
cometHead.scale.set(1.45, 1.45, 1);
comet.add(cometHead);
comet.visible = false;
scene.add(comet);

let cometActive = false;
let cometT = 0;
let cometDuration = 520;
let nextCometAt = DEBUG_COMET_VIEW ? 0.5 : 12;
const cometMoveDir = new THREE.Vector3();
const cometTailDir = new THREE.Vector3();
const cometViewDir = new THREE.Vector3();
const cometPlaneY = new THREE.Vector3();
const cometPlaneZ = new THREE.Vector3();
const cometBasis = new THREE.Matrix4();
const cometOrbitCenter = new THREE.Vector3();
const cometOrbitMajor = new THREE.Vector3();
const cometOrbitMinor = new THREE.Vector3();
const cometOrbitPos = new THREE.Vector3();
const cometPrevPos = new THREE.Vector3();
let cometOrbitSemiMajor = 150;
let cometOrbitSemiMinor = 92;
let cometOrbitFocusOffset = 116;
let cometOrbitStart = -2.25;
let cometOrbitSpan = 2.05;
let cometOrbitPerihelion = 34;

function scheduleNextComet() {
  nextCometAt = elapsed + 160 + Math.random() * 220;
}

function spawnComet() {
  sunMesh.getWorldPosition(cometOrbitCenter);

  const sign = DEBUG_COMET_VIEW ? 1 : Math.random() < 0.5 ? -1 : 1;
  cometOrbitMajor.set(sign * 0.9, -0.06, -0.22).normalize();
  cometOrbitMinor.set(DEBUG_COMET_VIEW ? 0.05 * sign : 0.08 * sign, DEBUG_COMET_VIEW ? 0.32 : 0.56, DEBUG_COMET_VIEW ? -0.95 : -0.83).normalize();
  cometOrbitMinor.addScaledVector(cometOrbitMajor, -cometOrbitMinor.dot(cometOrbitMajor)).normalize();

  cometOrbitPerihelion = SUN_RADIUS * (DEBUG_COMET_VIEW ? 1.7 : 1.55 + Math.random() * 0.55);
  cometOrbitSemiMajor = DEBUG_COMET_VIEW ? 145 : 135 + Math.random() * 75;
  cometOrbitFocusOffset = Math.max(1, cometOrbitSemiMajor - cometOrbitPerihelion);
  cometOrbitSemiMinor = Math.sqrt(Math.max(1, cometOrbitSemiMajor * cometOrbitSemiMajor - cometOrbitFocusOffset * cometOrbitFocusOffset));
  cometOrbitStart = DEBUG_COMET_VIEW ? 0.36 : -2.45 + Math.random() * 0.28;
  cometOrbitSpan = DEBUG_COMET_VIEW ? 1.45 : 3.25 + Math.random() * 0.5;
  cometDuration = DEBUG_COMET_VIEW ? 520 : 420 + Math.random() * 180;
  cometT = 0;
  const startP = 0;
  const startE = cometOrbitStart + cometOrbitSpan * startP;
  cometOrbitPos
    .copy(cometOrbitCenter)
    .addScaledVector(cometOrbitMajor, Math.cos(startE) * cometOrbitSemiMajor - cometOrbitFocusOffset)
    .addScaledVector(cometOrbitMinor, Math.sin(startE) * cometOrbitSemiMinor);
  comet.position.copy(cometOrbitPos);
  cometPrevPos.copy(cometOrbitPos);
  comet.visible = true;
  cometActive = true;
}

function updateComet(dt) {
  if (!cometActive) {
    if (elapsed >= nextCometAt) spawnComet();
    return;
  }
  cometT += dt;
  const p = Math.min(1, cometT / cometDuration);
  const fade = THREE.MathUtils.smoothstep(p, 0, 0.025) * (1 - THREE.MathUtils.smoothstep(p, 0.965, 1.0));
  const orbitP = p;
  const e = cometOrbitStart + cometOrbitSpan * orbitP;
  sunMesh.getWorldPosition(cometOrbitCenter);
  cometOrbitPos
    .copy(cometOrbitCenter)
    .addScaledVector(cometOrbitMajor, Math.cos(e) * cometOrbitSemiMajor - cometOrbitFocusOffset)
    .addScaledVector(cometOrbitMinor, Math.sin(e) * cometOrbitSemiMinor);
  cometMoveDir.copy(cometOrbitPos).sub(cometPrevPos);
  if (cometMoveDir.lengthSq() < 1e-5) cometMoveDir.copy(cometOrbitMajor);
  cometMoveDir.normalize();
  comet.position.copy(cometOrbitPos);
  cometPrevPos.copy(cometOrbitPos);
  cometTailDir.copy(cometOrbitPos).sub(cometOrbitCenter);
  if (cometTailDir.lengthSq() < 1e-5) cometTailDir.copy(cometMoveDir).negate();
  cometTailDir.normalize();
  cometViewDir.copy(camera.position).sub(comet.position).normalize();
  cometPlaneY.crossVectors(cometViewDir, cometTailDir);
  if (cometPlaneY.lengthSq() < 1e-5) cometPlaneY.crossVectors(camera.up, cometTailDir);
  cometPlaneY.normalize();
  cometPlaneZ.crossVectors(cometTailDir, cometPlaneY).normalize();
  if (cometPlaneZ.dot(cometViewDir) < 0) {
    cometPlaneY.negate();
    cometPlaneZ.negate();
  }
  cometBasis.makeBasis(cometTailDir, cometPlaneY, cometPlaneZ);
  comet.quaternion.setFromRotationMatrix(cometBasis);
  const sunDistance = cometOrbitPos.distanceTo(cometOrbitCenter);
  const solarWind = THREE.MathUtils.clamp(1.15 - (sunDistance - cometOrbitPerihelion) / (cometOrbitSemiMajor * 0.92), 0.34, 1.0);
  cometTail.material.opacity = 0.42 * fade + 0.48 * fade * solarWind;
  cometHead.material.opacity = 0.62 * fade + 0.28 * fade * solarWind;
  cometTail.scale.set(COMET_TAIL_LENGTH * (0.72 + solarWind * 0.55), COMET_TAIL_WIDTH * (0.75 + solarWind * 0.55), 1);
  cometTail.position.x = (COMET_TAIL_LENGTH * (0.72 + solarWind * 0.55)) * 0.5;
  cometHead.scale.setScalar(1.1 + solarWind * 0.48 + Math.sin(cometT * 1.35) * 0.04);
  if (p >= 1) {
    comet.visible = false;
    cometActive = false;
    scheduleNextComet();
  }
}

// ---------------------------------------------------------------------------
// USS Enterprise: flies across deep space on a clear non-collision course
// (reappearing every several seconds), built facing -Z (its bow) with a faint
// additive engine wake trailing each nacelle.
// ---------------------------------------------------------------------------
const enterprise = new THREE.Group();
enterprise.visible = false;
scene.add(enterprise);

function getMaterialTextureName(material) {
  const image = material?.map?.image;
  const src = image?.currentSrc || image?.src || "";
  return src.split(/[\\/]/).pop().toLowerCase();
}

function tuneEnterpriseMaterial(material) {
  if (!material) return;
  const name = (material.name || "").toLowerCase();
  const textureName = getMaterialTextureName(material);
  const darkDecal =
    name.includes("image8") ||
    name.includes("image9") ||
    textureName.includes("nccimage8") ||
    textureName.includes("nccimage9");

  material.side = THREE.DoubleSide;
  if (material.color) material.color.set(0xffffff);
  if (material.specular) material.specular.set(0x555555);
  if ("shininess" in material) material.shininess = Math.max(material.shininess || 0, 18);
  if (material.emissive) material.emissive.set(0x111111);

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.anisotropy = maxAnisotropy;
  }

  if (darkDecal) {
    material.map = null;
    if (material.color) material.color.set(0xe6e7e2);
    if (material.emissive) material.emissive.set(0x181818);
    material.transparent = false;
  }

  if (material.emissive) {
    if (name.includes("image6") || textureName.includes("nccimage6")) material.emissive.set(0xff2020);
    if (name.includes("image7") || textureName.includes("nccimage7")) material.emissive.set(0x20ff20);
    if (
      name.includes("light") ||
      name.includes("image5") ||
      textureName.includes("ncclight") ||
      textureName.includes("nccimage5")
    ) {
      material.emissive.set(0xffb45a);
    }
  }

  material.needsUpdate = true;
}

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
            mats.forEach(tuneEnterpriseMaterial);
          }
        });
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const modelScale = (EARTH_RADIUS * 2.7) / maxDim;
        obj.scale.setScalar(modelScale);
        obj.rotation.y = Math.PI; // flip so the bow leads the direction of travel
        obj.updateMatrixWorld(true);
        const fittedBox = new THREE.Box3().setFromObject(obj);
        const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
        obj.position.sub(fittedCenter); // recenter after scale/rotation are applied
        obj.updateMatrixWorld(true);
        const centeredSize = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
        enterpriseTailOffset = Math.max(ENTERPRISE_TAIL_OFFSET, centeredSize.z * 0.5);
        enterprise.add(obj);
        console.log("Enterprise model loaded. raw size:", size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
      },
      undefined,
      (err) => console.error("Enterprise model load failed:", err)
    );
});

const shipVel = new THREE.Vector3();
const shipTmp = new THREE.Vector3();
const shipWarpStartPos = new THREE.Vector3();
const shipWarpDir = new THREE.Vector3();
const shipWarpSparkPos = new THREE.Vector3();
const shipWarpUp = new THREE.Vector3(0, 1, 0);
const shipWarpBack = new THREE.Vector3(0, 0, 1);
const shipTargetEmptyLeft = new THREE.Vector3(-82, 16, 72);
const shipTargetEmptyRight = new THREE.Vector3(82, 16, 72);
const ENTERPRISE_TAIL_OFFSET = EARTH_RADIUS * 1.15;
const ENTERPRISE_TRAIL_OVERLAP = EARTH_RADIUS * 0.3;
const ENTERPRISE_LOCAL_WARP_TRAIL_SCALE = 1 / 3;
const ENTERPRISE_SPARK_APPEAR_P = 0.88;
const SHIP_WARP_START_SPEED_FACTOR = 1.35;
const SHIP_WARP_ACCEL_FACTOR = 6.3;
const SHIP_WARP_DELAY_AFTER_ROOM_EXIT = 10;
const ENTERPRISE_MODE_NORMAL = "normal";
const ENTERPRISE_MODE_RARE_ORBIT = "rareOrbit";
const ENTERPRISE_RARE_CHANCE = 0.14;
const ENTERPRISE_FORCE_RARE = new URLSearchParams(window.location.search).has("enterpriseRare");
const ENTERPRISE_RARE_APPROACH = "approach";
const ENTERPRISE_RARE_ORBIT = "orbit";
const ENTERPRISE_RARE_DEPART = "depart";
const ENTERPRISE_RARE_LAPS = 5;
const ENTERPRISE_RARE_ORBIT_RADIUS = EARTH_RADIUS * 3.05;
const ENTERPRISE_RARE_APPROACH_SPEED = 0.82;
const ENTERPRISE_RARE_ORBIT_SPEED = 1.36;
const ENTERPRISE_RARE_DEPART_SPEED = 1.12;
const ENTERPRISE_RARE_EXIT_WARP_SPEED = 2.15;
const ENTERPRISE_RARE_EMPTY_DIR = new THREE.Vector3(0.28, 0.32, 1).normalize();
let enterpriseTailOffset = ENTERPRISE_TAIL_OFFSET;
let shipActive = false;
let shipWarping = false;
let shipMode = ENTERPRISE_MODE_NORMAL;
let shipRarePhase = ENTERPRISE_RARE_APPROACH;
let shipRareOrbitAngle = 0;
let shipEnteredRoom = false;
let shipExitedRoom = false;
let shipAfterRoomT = 0;
let shipWarpT = 0;
let shipWarpDuration = 0.75;
let shipWarpAudioEnded = true;
let enterpriseRarePending = false;
let shipWarpTrailScale = 1;
let nextShipAt = new URLSearchParams(window.location.search).has("klingon") ? Number.POSITIVE_INFINITY : 3.0;
const shipRareEarthCenter = new THREE.Vector3();
const shipRareApproachTarget = new THREE.Vector3();
const shipRareOrbitU = new THREE.Vector3();
const shipRareOrbitV = new THREE.Vector3();
const shipRareOrbitAxis = new THREE.Vector3(0.18, 0.82, 0.28).normalize();
const shipRareWarpDir = new THREE.Vector3();
const shipRareDelta = new THREE.Vector3();
const shipRareNextPos = new THREE.Vector3();
const shipRarePrevPos = new THREE.Vector3();
const shipRareViewDir = new THREE.Vector3();
const shipRareViewRight = new THREE.Vector3();
const shipRareViewUp = new THREE.Vector3();
const shipRouteStart = new THREE.Vector3();
const shipRouteControl = new THREE.Vector3();
const shipRouteEnd = new THREE.Vector3();
const shipRoutePrev = new THREE.Vector3();
let shipRouteT = 0;
let shipRouteDuration = 1;

const enterpriseWarp = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.055, 1, 18, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xaeefff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
enterpriseWarp.visible = false;
enterprise.add(enterpriseWarp);

function makeEnterpriseSparkTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.16, "rgba(230,245,255,0.96)");
  g.addColorStop(0.34, "rgba(120,170,255,0.55)");
  g.addColorStop(1, "rgba(40,90,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeEnterpriseSparkRays() {
  const positions = [];
  const colors = [];
  const palette = [
    new THREE.Color(0x8fe8ff),
    new THREE.Color(0xffffff),
    new THREE.Color(0x7cff7c),
    new THREE.Color(0xfff06a),
    new THREE.Color(0xff5959),
    new THREE.Color(0x9c76ff),
  ];
  for (let i = 0; i < 42; i += 1) {
    const a = i * 2.39996323;
    const inner = 0.035 + (i % 4) * 0.008;
    const outer = 0.38 + ((i * 17) % 23) * 0.018;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * inner, s * inner, 0, c * outer, s * outer, 0);
    colors.push(1, 1, 1);
    const col = palette[i % palette.length];
    colors.push(col.r, col.g, col.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

const enterpriseSpark = new THREE.Group();
const enterpriseSparkHalo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeEnterpriseSparkTexture(),
    color: 0x7ab9ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
const enterpriseSparkCore = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeEnterpriseSparkTexture(),
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
const enterpriseSparkRays = new THREE.LineSegments(
  makeEnterpriseSparkRays(),
  new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
enterpriseSpark.add(enterpriseSparkHalo);
enterpriseSpark.add(enterpriseSparkCore);
enterpriseSpark.add(enterpriseSparkRays);
enterpriseSpark.visible = false;
scene.add(enterpriseSpark);

function resetEnterpriseVisitState() {
  shipEnteredRoom = false;
  shipExitedRoom = false;
  shipAfterRoomT = 0;
  shipWarping = false;
  shipWarpT = 0;
  shipActive = true;
  enterprise.visible = true;
  enterpriseWarp.visible = false;
  enterpriseSpark.visible = false;
}

function finishEnterpriseVisit() {
  shipActive = false;
  shipWarping = false;
  stopRareOrbitAudio();
  enterprise.visible = false;
  enterpriseWarp.visible = false;
  enterpriseSpark.visible = false;
  shipMode = ENTERPRISE_MODE_NORMAL;
  nextShipAt = elapsed + 150 + Math.random() * 90; // ~2.5-4 min between visits
}

function getEnterpriseEarthCenter(out) {
  return out.copy(ballGroup.position);
}

function setRareApproachTarget() {
  getEnterpriseEarthCenter(shipRareEarthCenter);
  shipRareApproachTarget.copy(shipRareEarthCenter).addScaledVector(shipRareOrbitU, ENTERPRISE_RARE_ORBIT_RADIUS);
}

function setRareDepartCourse() {
  getEnterpriseEarthCenter(shipRareEarthCenter);
  shipRareViewDir.copy(shipRareEarthCenter).sub(camera.position);
  if (shipRareViewDir.lengthSq() < 1e-5) shipRareViewDir.set(0, 0, -1);
  shipRareViewDir.normalize();

  shipRareViewRight.crossVectors(shipRareViewDir, worldUp);
  if (shipRareViewRight.lengthSq() < 1e-5) shipRareViewRight.set(1, 0, 0);
  shipRareViewRight.normalize();
  shipRareViewUp.crossVectors(shipRareViewRight, shipRareViewDir).normalize();

  shipRareWarpDir
    .copy(shipRareViewRight)
    .addScaledVector(shipRareViewUp, -0.05)
    .addScaledVector(shipRareViewDir, -0.28)
    .normalize();
}

function spawnEnterpriseNormal() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const target = side < 0 ? shipTargetEmptyRight : shipTargetEmptyLeft;
  const speed = 2.1 + Math.random() * 0.35;
  shipMode = ENTERPRISE_MODE_NORMAL;
  enterprise.position.set(
    roomCenter.x + side * (roomHalf.x + 1.2),
    roomCenter.y + roomHalf.y * (0.05 + Math.random() * 0.75),
    roomCenter.z + (Math.random() * 2 - 1) * roomHalf.z * 0.65
  );
  shipRouteStart.copy(enterprise.position);
  shipRouteEnd.copy(target);
  const routeLength = planSafeFlightRoute(shipRouteStart, shipRouteEnd, shipRouteControl, {
    shipClearance: EARTH_RADIUS * 1.65,
  });
  shipRouteT = 0;
  shipRouteDuration = Math.max(0.1, routeLength / speed);
  sampleFlightRouteTangent(shipRouteStart, shipRouteControl, shipRouteEnd, 0, shipVel)
    .normalize()
    .multiplyScalar(speed);
  resetEnterpriseVisitState();
  playShipEntrance();
}

function spawnEnterpriseRareOrbit() {
  shipMode = ENTERPRISE_MODE_RARE_ORBIT;
  shipRarePhase = ENTERPRISE_RARE_APPROACH;
  shipRareOrbitAngle = 0;
  getEnterpriseEarthCenter(shipRareEarthCenter);
  shipRareOrbitU.copy(ENTERPRISE_RARE_EMPTY_DIR).projectOnPlane(shipRareOrbitAxis);
  if (shipRareOrbitU.lengthSq() < 1e-5) shipRareOrbitU.set(1, 0, 0);
  shipRareOrbitU.normalize();
  shipRareOrbitV.crossVectors(shipRareOrbitAxis, shipRareOrbitU).normalize();
  shipRareWarpDir.copy(shipRareOrbitV);

  enterprise.position
    .copy(shipRareEarthCenter)
    .addScaledVector(shipRareOrbitU, roomHalf.x + 4.2)
    .addScaledVector(shipRareOrbitAxis, 0.75);
  setRareApproachTarget();
  shipVel.copy(shipRareApproachTarget).sub(enterprise.position).normalize().multiplyScalar(ENTERPRISE_RARE_APPROACH_SPEED);
  resetEnterpriseVisitState();
  playShipEntrance();
}

function spawnEnterprise() {
  if (ENTERPRISE_FORCE_RARE || Math.random() < ENTERPRISE_RARE_CHANCE) {
    spawnEnterpriseRareOrbit();
  } else {
    spawnEnterpriseNormal();
  }
}

function requestEnterpriseRareOrbit() {
  initAudio();
  enterpriseRarePending = true;
  nextShipAt = Math.min(nextShipAt, elapsed);
  if (!shipActive && !klingonActive && !klingonPending) {
    enterpriseRarePending = false;
    spawnEnterpriseRareOrbit();
    statusEl.textContent = "Enterprise周回演出を開始しました。";
    return;
  }
  statusEl.textContent = "Enterprise周回演出を予約しました。現在の演出が終わると開始します。";
}

function enterpriseInsideRoomFrame() {
  const dx = Math.abs(enterprise.position.x - roomCenter.x);
  const dy = Math.abs(enterprise.position.y - roomCenter.y);
  const dz = Math.abs(enterprise.position.z - roomCenter.z);
  return dx <= roomHalf.x + 0.25 && dy <= roomHalf.y + 0.45 && dz <= roomHalf.z + 0.25;
}

function enterpriseClearOfRoomFrame() {
  const dx = Math.abs(enterprise.position.x - roomCenter.x);
  const dy = Math.abs(enterprise.position.y - roomCenter.y);
  const dz = Math.abs(enterprise.position.z - roomCenter.z);
  return dx > roomHalf.x + 0.9 || dy > roomHalf.y + 0.9 || dz > roomHalf.z + 0.9;
}

function syncEnterpriseWarp(warpLength, visualP) {
  const scaledWarpLength = warpLength * shipWarpTrailScale;
  const trailRoot = enterpriseTailOffset - ENTERPRISE_TRAIL_OVERLAP;
  enterpriseWarp.position.set(0, 0, trailRoot + scaledWarpLength * 0.5);
  enterpriseWarp.quaternion.setFromUnitVectors(shipWarpUp, shipWarpBack);
  const warpWidth = 1 - visualP * 0.55;
  enterpriseWarp.scale.set(warpWidth, scaledWarpLength, warpWidth);
}

function syncEnterpriseSpark(p, visualP) {
  const pulse = 0.82 + Math.sin(shipWarpT * 42) * 0.18;
  const appear = THREE.MathUtils.smoothstep(p, ENTERPRISE_SPARK_APPEAR_P, 0.97);
  const endBoost = THREE.MathUtils.smoothstep(p, 0.92, 1.0);
  const fade = shipWarpAudioEnded ? 1 - THREE.MathUtils.smoothstep(visualP, 0.985, 1.0) : 1;
  const alpha = appear * fade;
  enterpriseSpark.visible = alpha > 0.01;
  enterpriseSpark.position.copy(shipWarpSparkPos);
  enterpriseSpark.scale.setScalar((0.95 + endBoost * 0.75) * appear);
  enterpriseSpark.lookAt(camera.position);
  enterpriseSparkHalo.material.opacity = 0.64 * alpha;
  enterpriseSparkHalo.scale.setScalar(0.9 + endBoost * 0.42);
  enterpriseSparkCore.material.opacity = 0.98 * pulse * alpha;
  enterpriseSparkCore.scale.setScalar(0.34 + endBoost * 0.24);
  enterpriseSparkRays.material.opacity = 0.82 * pulse * alpha;
  enterpriseSparkRays.rotation.z += 0.08 + p * 0.22;
  enterpriseSparkRays.scale.setScalar(1.05 + endBoost * 0.9);
}

function enterpriseWarpTravelFactor(p) {
  return SHIP_WARP_START_SPEED_FACTOR * p + 0.5 * SHIP_WARP_ACCEL_FACTOR * p * p;
}

function orientEnterpriseAlongVelocity() {
  enterprise.lookAt(shipTmp.copy(enterprise.position).sub(shipVel));
}

function startEnterpriseWarp() {
  shipWarping = true;
  shipWarpT = 0;
  shipWarpAudioEnded = true;
  enterprise.visible = true;
  stopShipAudio();
  shipWarpDuration = playShipWarpSound();
  shipWarpStartPos.copy(enterprise.position);
  shipWarpDir.copy(shipVel).normalize();
  shipWarpTrailScale = enterpriseInsideRoomFrame() ? ENTERPRISE_LOCAL_WARP_TRAIL_SCALE : 1;
  const predictedWarpTravel = shipVel.length() * shipWarpDuration * enterpriseWarpTravelFactor(1);
  shipWarpSparkPos
    .copy(shipWarpStartPos)
    .addScaledVector(shipWarpDir, predictedWarpTravel - enterpriseTailOffset);
  enterpriseSpark.visible = false;
  syncEnterpriseSpark(0, 0);
  syncEnterpriseWarp(2.2, 0);
  enterpriseWarp.visible = true;
  enterpriseWarp.material.opacity = 1;
}

function updateEnterpriseRareOrbit(dt) {
  if (shipRarePhase === ENTERPRISE_RARE_APPROACH) {
    setRareApproachTarget();
    shipRareDelta.copy(shipRareApproachTarget).sub(enterprise.position);
    const dist = shipRareDelta.length();
    if (dist <= ENTERPRISE_RARE_APPROACH_SPEED * dt) {
      enterprise.position.copy(shipRareApproachTarget);
      shipRarePhase = ENTERPRISE_RARE_ORBIT;
      shipRareOrbitAngle = 0;
      shipVel.copy(shipRareOrbitV).multiplyScalar(ENTERPRISE_RARE_ORBIT_RADIUS * ENTERPRISE_RARE_ORBIT_SPEED);
      playRareOrbitAudio();
    } else {
      shipVel.copy(shipRareDelta).normalize().multiplyScalar(ENTERPRISE_RARE_APPROACH_SPEED);
      enterprise.position.addScaledVector(shipVel, dt);
    }
    orientEnterpriseAlongVelocity();
    updateEnterpriseAudioDistance();
    return;
  }

  if (shipRarePhase === ENTERPRISE_RARE_ORBIT) {
    shipRarePrevPos.copy(enterprise.position);
    getEnterpriseEarthCenter(shipRareEarthCenter);
    shipRareOrbitAngle += ENTERPRISE_RARE_ORBIT_SPEED * dt;
    const maxAngle = Math.PI * 2 * ENTERPRISE_RARE_LAPS;
    const angle = Math.min(shipRareOrbitAngle, maxAngle);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    shipRareNextPos
      .copy(shipRareEarthCenter)
      .addScaledVector(shipRareOrbitU, c * ENTERPRISE_RARE_ORBIT_RADIUS)
      .addScaledVector(shipRareOrbitV, s * ENTERPRISE_RARE_ORBIT_RADIUS);
    enterprise.position.copy(shipRareNextPos);

    if (shipRareOrbitAngle >= maxAngle) {
      stopRareOrbitAudio();
      shipRarePhase = ENTERPRISE_RARE_DEPART;
      setRareDepartCourse();
      shipVel.copy(shipRareWarpDir).multiplyScalar(ENTERPRISE_RARE_DEPART_SPEED);
      orientEnterpriseAlongVelocity();
      updateEnterpriseAudioDistance();
      return;
    }

    shipVel.copy(enterprise.position).sub(shipRarePrevPos);
    if (shipVel.lengthSq() < 1e-6) {
      shipVel.copy(shipRareOrbitU).multiplyScalar(-s).addScaledVector(shipRareOrbitV, c);
    }
    shipVel.normalize().multiplyScalar(ENTERPRISE_RARE_ORBIT_RADIUS * ENTERPRISE_RARE_ORBIT_SPEED);
    orientEnterpriseAlongVelocity();
    updateEnterpriseAudioDistance();
    return;
  }

  if (shipRarePhase === ENTERPRISE_RARE_DEPART) {
    enterprise.position.addScaledVector(shipVel, dt);
    orientEnterpriseAlongVelocity();
    updateEnterpriseAudioDistance();
    if (enterpriseClearOfRoomFrame()) {
      shipVel.copy(shipRareWarpDir).multiplyScalar(ENTERPRISE_RARE_EXIT_WARP_SPEED);
      orientEnterpriseAlongVelocity();
      startEnterpriseWarp();
    }
  }
}

// ---------------------------------------------------------------------------
// Klingon ship: a rare, heavy background pass with cloak-style fades.
// ---------------------------------------------------------------------------
const klingon = new THREE.Group();
klingon.visible = false;
scene.add(klingon);

const klingonCloakField = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1, 4),
  new THREE.MeshBasicMaterial({
    color: 0x54ff9b,
    transparent: true,
    opacity: 0,
    wireframe: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
klingonCloakField.visible = false;
klingon.add(klingonCloakField);

const klingonFlash = new THREE.Group();
const klingonFlashHalo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeEnterpriseSparkTexture(),
    color: 0x53ff92,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
const klingonFlashCore = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeEnterpriseSparkTexture(),
    color: 0xd8ffe8,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
const klingonFlashRays = new THREE.LineSegments(
  makeEnterpriseSparkRays(),
  new THREE.LineBasicMaterial({
    color: 0x62ffae,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
klingonFlash.add(klingonFlashHalo);
klingonFlash.add(klingonFlashCore);
klingonFlash.add(klingonFlashRays);
klingonFlash.visible = false;
scene.add(klingonFlash);

const KLINGON_FORCE = new URLSearchParams(window.location.search).has("klingon");
const KLINGON_FADE_IN = 4.2;
const KLINGON_FADE_OUT = 5.4;
const KLINGON_PASS_DURATION_FALLBACK = 29;
const KLINGON_TARGET_LENGTH = EARTH_RADIUS * 5.75;
const KLINGON_ASSET_PATH = "./assets/klingon_ship/";
const KLINGON_MTL_FILE = "klingon_ship.mtl";
const KLINGON_OBJ_FILE = "klingon_ship.obj";
let klingonModelLoaded = false;
let klingonModelLoading = false;
let klingonPending = false;
let klingonActive = false;
let klingonT = 0;
let klingonPassDuration = KLINGON_PASS_DURATION_FALLBACK;
let klingonDepartureSoundPlayed = false;
let nextKlingonAt = KLINGON_FORCE ? 2.5 : 120 + Math.random() * 120;
const klingonStart = new THREE.Vector3();
const klingonControl = new THREE.Vector3();
const klingonEnd = new THREE.Vector3();
const klingonVel = new THREE.Vector3();
const klingonTmp = new THREE.Vector3();
const klingonPrevPos = new THREE.Vector3();
const klingonMaterials = [];
const klingonDebugArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.2, 0xffff66, 0.28, 0.16);
klingonDebugArrow.visible = false;
scene.add(klingonDebugArrow);

function scheduleNextKlingon() {
  nextKlingonAt = elapsed + 220 + Math.random() * 180;
}

// Gently lift the hull out of pure black so the Klingon reads against MR
// passthrough, without crushing the texture detail at the top end.
function keepKlingonHullReadable(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      "gl_FragColor.rgb = clamp(gl_FragColor.rgb, vec3(0.05, 0.07, 0.06) * gl_FragColor.a, gl_FragColor.a * vec3(1.0));\n#include <dithering_fragment>"
    );
  };
  material.customProgramCacheKey = () => "klingon-hull-readable-v2";
}

// Tune the Klingon hull materials in place: keep the ship texture and only
// adjust shading so the hull stays readable while true light accents glow.
function tuneKlingonMaterial(material) {
  if (!material) return new THREE.MeshStandardMaterial({ color: 0x31433a });
  const name = (material.name || "").toLowerCase();
  const textureName = getMaterialTextureName(material);
  const isRed = name.includes("red") || textureName.includes("red");
  const isGreen = name.includes("green") || textureName.includes("green");
  const isOrange = name.includes("orange") || textureName.includes("orange");
  const isEngine = name.includes("engine") || textureName.includes("engine");
  const isGlowAccent = isEngine || isGreen || isOrange || isRed;

  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.opacity = 0;
  if ("wireframe" in material) material.wireframe = false;
  material.depthTest = true;
  material.depthWrite = true;
  if (material.color) material.color.set(0xffffff); // let the texture supply the color

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.anisotropy = maxAnisotropy;
  }

  if (material.specular) material.specular.set(0x222a24);
  if ("shininess" in material) material.shininess = Math.max(material.shininess || 0, 22);

  if (material.emissive) {
    material.emissive.set(0x0a140d);
    if (material.emissiveMap) material.emissive.set(0xffffff);
    if (isEngine || isOrange) material.emissive.set(0xff7a22);
    else if (isGreen) material.emissive.set(0x45ff8f);
    else if (isRed) material.emissive.set(0xff2518);
  }
  if ("emissiveIntensity" in material) {
    material.emissiveIntensity = isGlowAccent ? 1.15 : 0.18;
  }

  keepKlingonHullReadable(material);
  material.userData.klingonColorHex = textureName || material.name || "hull";
  material.needsUpdate = true;
  return material;
}

function setKlingonOpacity(alpha) {
  const clamped = THREE.MathUtils.clamp(alpha, 0, 1);
  for (const material of klingonMaterials) {
    material.opacity = clamped;
    material.transparent = clamped < 0.995;
    material.needsUpdate = true;
  }
}

function loadKlingonModel() {
  if (klingonModelLoaded || klingonModelLoading) return;
  klingonModelLoading = true;
  new MTLLoader().setPath(KLINGON_ASSET_PATH).load(
    KLINGON_MTL_FILE,
    (materials) => {
      materials.preload();
      new OBJLoader()
        .setMaterials(materials)
        .setPath(KLINGON_ASSET_PATH)
        .load(
          KLINGON_OBJ_FILE,
          (obj) => {
            let tunedMeshCount = 0;
            let tunedMaterialCount = 0;
            let hiddenLineCount = 0;
            const tunedColorCounts = {};
            obj.traverse((child) => {
              if (child.isMesh) {
                tunedMeshCount++;
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                const tunedMats = mats.map((material) => tuneKlingonMaterial(material));
                child.material = Array.isArray(child.material) ? tunedMats : tunedMats[0];
                tunedMats.forEach((material) => {
                  tunedMaterialCount++;
                  const colorKey = material.userData.klingonColorHex || "unknown";
                  tunedColorCounts[colorKey] = (tunedColorCounts[colorKey] || 0) + 1;
                  if (!klingonMaterials.includes(material)) klingonMaterials.push(material);
                });
              } else if (child.isLine) {
                child.visible = false;
                hiddenLineCount++;
              }
            });

            const box = new THREE.Box3().setFromObject(obj);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            obj.scale.setScalar(KLINGON_TARGET_LENGTH / maxDim);
            // The OBJ is normalized for Three.js: Y-up, level in XZ, bow on +Z.
            obj.updateMatrixWorld(true);
            const fittedBox = new THREE.Box3().setFromObject(obj);
            const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
            obj.position.sub(fittedCenter);
            obj.updateMatrixWorld(true);
            const centeredSize = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
            klingonCloakField.scale.set(centeredSize.x * 0.58, centeredSize.y * 0.9, centeredSize.z * 0.58);
            klingon.add(obj);
            klingonModelLoaded = true;
            klingonModelLoading = false;
            setKlingonOpacity(0);
            console.log(
              "Klingon ship model loaded. raw size:",
              size.x.toFixed(2),
              size.y.toFixed(2),
              size.z.toFixed(2),
              "meshes/materials:",
              tunedMeshCount,
              tunedMaterialCount,
              "hiddenLines:",
              hiddenLineCount,
              tunedColorCounts
            );
          },
          undefined,
          (err) => {
            klingonModelLoading = false;
            klingonPending = false;
            scheduleNextKlingon();
            console.error("Klingon model load failed:", err);
          }
        );
    },
    undefined,
    (err) => {
      klingonModelLoading = false;
      klingonPending = false;
      scheduleNextKlingon();
      console.error("Klingon material load failed:", err);
    }
  );
}

function spawnKlingonPass() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const cruiseY = roomCenter.y - roomHalf.y * 0.35;
  const cruiseZ = roomCenter.z - roomHalf.z * 0.62;
  klingonStart.set(
    roomCenter.x + side * (roomHalf.x + 3.8),
    cruiseY,
    cruiseZ
  );
  klingonEnd.set(
    roomCenter.x - side * (roomHalf.x + 4.6),
    cruiseY,
    cruiseZ
  );
  planSafeFlightRoute(klingonStart, klingonEnd, klingonControl, {
    shipClearance: EARTH_RADIUS * 2.0,
  });
  klingon.position.copy(klingonStart);
  klingonPassDuration = playKlingonTheme();
  sampleFlightRouteTangent(klingonStart, klingonControl, klingonEnd, 0, klingonVel)
    .multiplyScalar(1 / klingonPassDuration);
  orientKlingonAlongVelocity();
  klingonT = 0;
  klingonDepartureSoundPlayed = false;
  klingonPending = false;
  klingonActive = true;
  klingon.visible = true;
  klingonFlash.visible = false;
  setKlingonOpacity(0);
  playKlingonArrivalSound();
}

function requestKlingonPass() {
  initAudio();
  klingonPending = true;
  nextKlingonAt = Math.min(nextKlingonAt, elapsed);
  loadKlingonBuffer();
  loadKlingonModel();
  if (!shipActive && !klingonActive) {
    statusEl.textContent = "クリンゴン船の登場を開始します。";
    return;
  }
  statusEl.textContent = "クリンゴン船の登場を予約しました。現在の演出が終わると開始します。";
}

function orientKlingonAlongVelocity() {
  // Object3D.lookAt points local -Z at the target. The normalized Klingon bow
  // is local -Z, so look ahead to make the bow lead the route.
  klingon.lookAt(klingonTmp.copy(klingon.position).add(klingonVel));
}

function updateKlingon(dt) {
  if (!klingonActive) {
    if ((elapsed >= nextKlingonAt || klingonPending) && !shipActive) {
      if (!klingonModelLoaded) {
        klingonPending = true;
        loadKlingonModel();
        return;
      }
      if (audioContext && audioContext.state === "running" && !klingonBuffer && !klingonBufferTried) {
        loadKlingonBuffer();
        return;
      }
      if (audioContext && audioContext.state === "running" && klingonBufferPromise) {
        return;
      }
      if (audioContext && audioContext.state === "running" && !isOneShotAudioReady(klingonArrivalSound)) {
        loadOneShotAudio(klingonArrivalSound);
        return;
      }
      if (audioContext && audioContext.state === "running" && !isOneShotAudioReady(klingonDepartureSound)) {
        loadOneShotAudio(klingonDepartureSound);
        return;
      }
      spawnKlingonPass();
    }
    return;
  }

  klingonT += dt;
  const p = THREE.MathUtils.clamp(klingonT / klingonPassDuration, 0, 1);
  const fadeIn = THREE.MathUtils.smoothstep(klingonT, 0, KLINGON_FADE_IN);
  const fadeOut = 1 - THREE.MathUtils.smoothstep(klingonT, klingonPassDuration - KLINGON_FADE_OUT, klingonPassDuration);
  const alpha = fadeIn * fadeOut;
  klingonPrevPos.copy(klingon.position);
  sampleFlightRoutePoint(klingonStart, klingonControl, klingonEnd, p, klingon.position);
  klingonVel.copy(klingon.position).sub(klingonPrevPos);
  if (dt > 1e-5) klingonVel.multiplyScalar(1 / dt);
  if (klingonVel.lengthSq() < 1e-6) {
    sampleFlightRouteTangent(klingonStart, klingonControl, klingonEnd, p, klingonVel)
      .multiplyScalar(1 / klingonPassDuration);
  }
  orientKlingonAlongVelocity();
  updateKlingonAudioDistance();
  if (DEBUG_TOP_VIEW) {
    klingonDebugArrow.visible = true;
    klingonDebugArrow.position.copy(klingon.position);
    klingonDebugArrow.setDirection(klingonTmp.copy(klingonVel).normalize());
  } else {
    klingonDebugArrow.visible = false;
  }
  setKlingonOpacity(alpha);

  klingonCloakField.visible = false;

  const vanish = THREE.MathUtils.smoothstep(klingonT, klingonPassDuration - 2.8, klingonPassDuration);
  if (!klingonDepartureSoundPlayed && klingonT >= klingonPassDuration - getKlingonDepartureSoundLead()) {
    klingonDepartureSoundPlayed = true;
    playKlingonDepartureSound();
  }
  const flashAlpha = vanish * (1 - THREE.MathUtils.smoothstep(klingonT, klingonPassDuration - 0.5, klingonPassDuration));
  klingonFlash.visible = flashAlpha > 0.02;
  klingonFlash.position.copy(klingon.position);
  klingonFlash.lookAt(camera.position);
  klingonFlashHalo.material.opacity = 0.52 * flashAlpha;
  klingonFlashHalo.scale.setScalar(0.85 + vanish * 0.7);
  klingonFlashCore.material.opacity = 0.78 * flashAlpha;
  klingonFlashCore.scale.setScalar(0.34 + vanish * 0.28);
  klingonFlashRays.material.opacity = 0.68 * flashAlpha;
  klingonFlashRays.rotation.z += 0.12 + vanish * 0.25;
  klingonFlashRays.scale.setScalar(0.9 + vanish * 0.95);

  if (p >= 1) {
    klingonActive = false;
    klingon.visible = false;
    klingonFlash.visible = false;
    klingonCloakField.visible = false;
    klingonDebugArrow.visible = false;
    setKlingonOpacity(0);
    stopKlingonTheme();
    scheduleNextKlingon();
  }
}

function updateEnterprise(dt) {
  if (!shipActive) {
    if (enterpriseRarePending && !klingonActive && !klingonPending) {
      enterpriseRarePending = false;
      spawnEnterpriseRareOrbit();
      return;
    }
    if (elapsed >= nextShipAt && !klingonActive && !klingonPending) spawnEnterprise();
    return;
  }

  if (shipWarping) {
    shipWarpT += dt;
    const p = THREE.MathUtils.clamp(shipWarpT / shipWarpDuration, 0, 1);
    const visualP = shipWarpAudioEnded ? p : Math.min(p, 0.96);
    const warpLength = THREE.MathUtils.lerp(2.2, 28, p);
    shipTmp.copy(shipWarpDir);
    enterprise.position
      .copy(shipWarpStartPos)
      .addScaledVector(shipTmp, shipVel.length() * shipWarpDuration * enterpriseWarpTravelFactor(p));
    orientEnterpriseAlongVelocity();
    updateEnterpriseAudioDistance();
    syncEnterpriseWarp(warpLength, visualP);
    syncEnterpriseSpark(p, visualP);
    enterpriseWarp.material.opacity = shipWarpAudioEnded ? 1 - visualP : Math.max(0.14, 1 - visualP);
    if (p >= 1 && shipWarpAudioEnded) {
      finishEnterpriseVisit();
    }
    return;
  }

  if (shipMode === ENTERPRISE_MODE_RARE_ORBIT) {
    updateEnterpriseRareOrbit(dt);
    return;
  }

  shipRoutePrev.copy(enterprise.position);
  shipRouteT += dt;
  const routeP = THREE.MathUtils.clamp(shipRouteT / shipRouteDuration, 0, 1);
  if (routeP < 1) {
    sampleFlightRoutePoint(shipRouteStart, shipRouteControl, shipRouteEnd, routeP, enterprise.position);
    shipVel.copy(enterprise.position).sub(shipRoutePrev);
    if (dt > 1e-5) shipVel.multiplyScalar(1 / dt);
    if (shipVel.lengthSq() < 1e-6) {
      sampleFlightRouteTangent(shipRouteStart, shipRouteControl, shipRouteEnd, routeP, shipVel)
        .normalize()
        .multiplyScalar(Math.max(2.1, shipRouteEnd.distanceTo(shipRouteStart) / shipRouteDuration));
    }
  } else {
    enterprise.position.addScaledVector(shipVel, dt);
  }
  // Object3D.lookAt aims +Z at the target, so look "backward" to put the bow
  // (-Z, the saucer) forward and keep local +Z as the stern/trail side.
  orientEnterpriseAlongVelocity();
  updateEnterpriseAudioDistance();
  if (!shipEnteredRoom && enterpriseInsideRoomFrame()) shipEnteredRoom = true;
  if (shipEnteredRoom && !shipExitedRoom && enterpriseClearOfRoomFrame()) {
    shipExitedRoom = true;
    shipAfterRoomT = 0;
  }
  if (shipExitedRoom) {
    shipAfterRoomT += dt;
    if (shipAfterRoomT >= SHIP_WARP_DELAY_AFTER_ROOM_EXIT) startEnterpriseWarp();
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
            optionalFeatures: ["local-floor", "dom-overlay", "hand-tracking"],
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
      enterpriseOrbitXrButton.visible = false;
      klingonXrButton.visible = false;
      blackHoleTourXrButton.visible = false;
      taxiAnalyticsXrButton.visible = false;
      setXrButtonVolumesVisible(false);
      enterpriseOrbitXrIcon.visible = false;
      klingonXrIcon.visible = false;
      blackHoleTourXrIcon.visible = false;
      helpXrIcon.visible = false;
      welcomePanel.visible = false;
      poseDebugXrButton.visible = false;
      poseDebugXrHitArea.visible = false;
      poseDebugXrPanel.visible = false;
      blackHoleTourCountdownActive = false;
      if (blackHoleTourCountdownTimer) {
        clearTimeout(blackHoleTourCountdownTimer);
        blackHoleTourCountdownTimer = null;
      }
      blackHoleWarpHud.visible = false;
      inTaxiAnalyticsRoom = false;
      taxiAnalyticsPreview2D = false;
      taxiReturnXrButton.visible = false;
      const taxiChatPanelElTmp = document.getElementById("taxiChatPanel");
      if (taxiChatPanelElTmp) taxiChatPanelElTmp.setAttribute("hidden", "");
      setHandPresenceVisible(false);
      setControllerHelpVisible(false);
      currentMode = "preview";
      updateSpaceBackdropMode();
      statusEl.textContent = `${label} を終了しました。もう一度入るには VR/AR を選んでください。`;
      updateXrAvailability();
    });

    if (mode === "immersive-ar") {
      scene.background = null;
      floor.visible = false;
      currentMode = "ar";
      updateSpaceBackdropMode();
    } else {
      scene.background = new THREE.Color(0x07090c);
      floor.visible = true;
      currentMode = "vr";
      updateSpaceBackdropMode();
    }

    await renderer.xr.setSession(session);
    vrButton.disabled = false;
    arButton.disabled = false;
    button.textContent = `Exit ${label}`;
    exitButton.visible = true;
    resetButton.visible = true; // show the in-XR Exit / Reset buttons
    enterpriseOrbitXrButton.visible = true;
    klingonXrButton.visible = true;
    blackHoleTourXrButton.visible = true;
    taxiAnalyticsXrButton.visible = TAXI_ALLOWED;
    enterpriseOrbitXrIcon.visible = true;
    klingonXrIcon.visible = true;
    blackHoleTourXrIcon.visible = true;
    helpXrIcon.visible = true;
    welcomePanel.visible = true;
    setXrButtonVolumesVisible(true);
    poseDebugXrButton.visible = DEBUG_POSE_CAPTURE;
    poseDebugXrHitArea.visible = DEBUG_POSE_CAPTURE;
    poseDebugXrPanel.visible = DEBUG_POSE_CAPTURE;
    resetToHome();
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

enterpriseOrbitButton?.addEventListener("click", requestEnterpriseRareOrbit);
klingonButton?.addEventListener("click", requestKlingonPass);
blackHoleTourButton?.addEventListener("click", requestBlackHoleTour);
controllerHelpButton?.addEventListener("click", toggleControllerHelp);
taxiAnalyticsButton?.addEventListener("click", requestTaxiAnalyticsRoom);

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
  loadWarpBuffer();
  loadRareOrbitBuffer();
  loadKlingonBuffer();
  loadBlackHoleBuffer();
  loadOneShotAudio(xrButtonPressSound);
  loadOneShotAudio(klingonArrivalSound);
  loadOneShotAudio(klingonDepartureSound);
}

function playCollisionSound() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  if (now - lastCollisionSoundAt < 0.08) return;
  lastCollisionSoundAt = now;

  const main = audioContext.createOscillator();
  const overtone = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const collisionPos = roomCenter.clone().add(ballOffset);

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
  const spatialAudio = connectDistanceGain(gain, collisionPos, 1, LOCAL_AUDIO_MIN_RATIO);
  const tracked = trackSpatialAudio(spatialAudio, collisionPos);
  main.onended = () => {
    untrackSpatialAudio(tracked);
    disconnectSpatialAudio(spatialAudio);
  };

  main.start(now);
  overtone.start(now);
  main.stop(now + 0.14);
  overtone.stop(now + 0.1);
}

function playPoseRecordSound() {
  if (!audioContext) return;
  if (audioContext.state === "suspended") {
    audioContext.resume().then(() => {
      if (audioContext?.state === "running") playPoseRecordSound();
    }).catch(() => {});
    return;
  }
  if (audioContext.state !== "running") return;
  const now = audioContext.currentTime;
  const master = audioContext.createGain();
  const soundPos = poseDebugXrButton.visible
    ? poseDebugXrButton.position.clone()
    : getViewerAudioPosition(audioSourceWorld).clone();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.18, now + 0.012);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  const spatialAudio = connectDistanceGain(master, soundPos, 1, LOCAL_AUDIO_MIN_RATIO);
  const tracked = trackSpatialAudio(spatialAudio, soundPos);

  [
    [880, 0.0, 0.12],
    [1320, 0.11, 0.14],
  ].forEach(([freq, delay, duration]) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + delay;
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.8, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    if (delay + duration >= 0.25) {
      osc.onended = () => {
        untrackSpatialAudio(tracked);
        disconnectSpatialAudio(spatialAudio);
      };
    }
    osc.start(start);
    osc.stop(start + duration + 0.03);
  });
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
  master.gain.value = 1;
  enterpriseSynthSpatial = connectDistanceGain(master, enterprise.position, ENTERPRISE_SYNTH_VOLUME);
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
  disconnectSpatialAudio(enterpriseSynthSpatial);
  enterpriseSynthSpatial = null;
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
let shipSourceGain = null;
let warpBuffer = null;
let warpBufferTried = false;
let warpSource = null;
let warpSourceGain = null;
let rareOrbitBuffer = null;
let rareOrbitBufferTried = false;
let rareOrbitSource = null;
let rareOrbitGain = null;
let rareOrbitAudioWanted = false;
let klingonBuffer = null;
let klingonBufferTried = false;
let klingonBufferPromise = null;
let klingonSource = null;
let klingonGain = null;
let klingonAudioWanted = false;
let enterpriseSynthSpatial = null;
let blackHoleBuffer = null;
let blackHoleBufferTried = false;
let blackHoleBufferPromise = null;
let blackHoleRumbleSource = null;
let blackHoleRumbleGain = null;
let blackHoleRumbleFilter = null;
let blackHoleRumbleSpatial = null;
let blackHoleRumbleTargetGain = 0;
const xrButtonPressSound = {
  url: "./assets/xr-button-press.mp3",
  label: "XR button press sound",
  buffer: null,
  promise: null,
  source: null,
  spatialAudio: null,
  spatialPosition: null,
  spatialTrack: null,
  failed: false,
};
const klingonArrivalSound = {
  url: "./assets/star-trek-tng-transporter.mp3",
  label: "Klingon arrival sound",
  buffer: null,
  promise: null,
  source: null,
  spatialAudio: null,
  spatialPosition: null,
  spatialTrack: null,
  failed: false,
};
const klingonDepartureSound = {
  url: "./assets/star-trek-transportation.mp3",
  label: "Klingon departure sound",
  buffer: null,
  promise: null,
  source: null,
  spatialAudio: null,
  spatialPosition: null,
  spatialTrack: null,
  failed: false,
};

const SHIP_AUDIO_MIN_RATIO = 0.18;
const SHIP_AUDIO_FULL_DISTANCE = 4.0;
const SHIP_AUDIO_FLOOR_DISTANCE = 24.0;
const LOCAL_AUDIO_MIN_RATIO = 0.0;
const ENTERPRISE_ENTRANCE_VOLUME = 1.0;
const ENTERPRISE_SYNTH_VOLUME = 0.42;
const ENTERPRISE_RARE_ORBIT_VOLUME = 1.0;
const ENTERPRISE_WARP_VOLUME = 1.0;
const KLINGON_THEME_VOLUME = 1.0;
const KLINGON_ARRIVAL_VOLUME = 1.0;
const KLINGON_DEPARTURE_VOLUME = 1.0;

function getAudioCamera() {
  return renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
}

function getViewerAudioPosition(out) {
  return getAudioCamera().getWorldPosition(out);
}

function updateAudioListenerPose() {
  if (!audioContext) return;
  const cam = getAudioCamera();
  cam.getWorldPosition(shipAudioViewerWorld);
  cam.getWorldDirection(shipAudioListenerForward);
  shipAudioListenerUp.copy(cam.up).applyQuaternion(cam.quaternion).normalize();

  const listener = audioContext.listener;
  const now = audioContext.currentTime;
  if (listener.positionX) {
    listener.positionX.setTargetAtTime(shipAudioViewerWorld.x, now, 0.04);
    listener.positionY.setTargetAtTime(shipAudioViewerWorld.y, now, 0.04);
    listener.positionZ.setTargetAtTime(shipAudioViewerWorld.z, now, 0.04);
    listener.forwardX.setTargetAtTime(shipAudioListenerForward.x, now, 0.04);
    listener.forwardY.setTargetAtTime(shipAudioListenerForward.y, now, 0.04);
    listener.forwardZ.setTargetAtTime(shipAudioListenerForward.z, now, 0.04);
    listener.upX.setTargetAtTime(shipAudioListenerUp.x, now, 0.04);
    listener.upY.setTargetAtTime(shipAudioListenerUp.y, now, 0.04);
    listener.upZ.setTargetAtTime(shipAudioListenerUp.z, now, 0.04);
  } else {
    listener.setPosition(shipAudioViewerWorld.x, shipAudioViewerWorld.y, shipAudioViewerWorld.z);
    listener.setOrientation(
      shipAudioListenerForward.x,
      shipAudioListenerForward.y,
      shipAudioListenerForward.z,
      shipAudioListenerUp.x,
      shipAudioListenerUp.y,
      shipAudioListenerUp.z
    );
  }
}

function setSpatialAudioPosition(spatialAudio, sourcePosition) {
  if (!audioContext || !spatialAudio || !sourcePosition) return;
  updateAudioListenerPose();
  const now = audioContext.currentTime;
  const { panner } = spatialAudio;
  if (panner.positionX) {
    panner.positionX.setTargetAtTime(sourcePosition.x, now, 0.04);
    panner.positionY.setTargetAtTime(sourcePosition.y, now, 0.04);
    panner.positionZ.setTargetAtTime(sourcePosition.z, now, 0.04);
  } else {
    panner.setPosition(sourcePosition.x, sourcePosition.y, sourcePosition.z);
  }
}

function configurePanner(panner, { attenuate = true } = {}) {
  panner.panningModel = "HRTF";
  panner.distanceModel = "linear";
  panner.refDistance = SHIP_AUDIO_FULL_DISTANCE;
  panner.maxDistance = SHIP_AUDIO_FLOOR_DISTANCE;
  panner.rolloffFactor = attenuate ? 1 : 0;
}

function connectSpatialPanner(source, sourcePosition, options = {}) {
  updateAudioListenerPose();
  const panner = audioContext.createPanner();
  configurePanner(panner, options);
  source.connect(panner);

  const spatialAudio = { panner, distanceGain: null, floorGain: null };
  setSpatialAudioPosition(spatialAudio, sourcePosition);
  return spatialAudio;
}

function connectDistanceGain(source, sourcePosition, maxVolume, minRatio = SHIP_AUDIO_MIN_RATIO) {
  const spatialAudio = connectSpatialPanner(source, sourcePosition);
  const { panner } = spatialAudio;

  const distanceGain = audioContext.createGain();
  const floorGain = minRatio > 0 ? audioContext.createGain() : null;
  distanceGain.gain.value = maxVolume * (1 - minRatio);
  if (floorGain) floorGain.gain.value = maxVolume * minRatio;

  panner.connect(distanceGain);
  distanceGain.connect(audioContext.destination);
  if (floorGain) {
    source.connect(floorGain);
    floorGain.connect(audioContext.destination);
  }

  spatialAudio.distanceGain = distanceGain;
  spatialAudio.floorGain = floorGain;
  return spatialAudio;
}

function disconnectSpatialAudio(spatialAudio) {
  if (!spatialAudio) return;
  try {
    spatialAudio.panner?.disconnect();
    spatialAudio.distanceGain?.disconnect();
    spatialAudio.floorGain?.disconnect();
  } catch (e) {
    /* already disconnected */
  }
}

function trackSpatialAudio(spatialAudio, sourcePosition) {
  if (!spatialAudio || !sourcePosition) return null;
  const tracked = { spatialAudio, sourcePosition };
  transientSpatialAudios.push(tracked);
  return tracked;
}

function untrackSpatialAudio(tracked) {
  const index = transientSpatialAudios.indexOf(tracked);
  if (index >= 0) transientSpatialAudios.splice(index, 1);
}

function updateTransientSpatialAudios() {
  for (const tracked of transientSpatialAudios) {
    setSpatialAudioPosition(tracked.spatialAudio, tracked.sourcePosition);
  }
}

function updateEnterpriseAudioDistance() {
  setSpatialAudioPosition(shipSourceGain, enterprise.position);
  setSpatialAudioPosition(warpSourceGain, enterprise.position);
  setSpatialAudioPosition(rareOrbitGain, enterprise.position);
  setSpatialAudioPosition(enterpriseSynthSpatial, enterprise.position);
}

function updateKlingonAudioDistance() {
  setSpatialAudioPosition(klingonGain, klingon.position);
  updateOneShotAudioDistance(klingonArrivalSound);
  updateOneShotAudioDistance(klingonDepartureSound);
}

function updateOneShotAudioDistance(sound) {
  setSpatialAudioPosition(sound.spatialAudio, sound.spatialPosition);
}

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

async function loadWarpBuffer() {
  if (warpBuffer || warpBufferTried || !audioContext) return;
  warpBufferTried = true;
  try {
    const res = await fetch("./assets/warp.mp3");
    if (!res.ok) throw new Error("HTTP " + res.status);
    warpBuffer = await audioContext.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    console.error("warp sound load failed:", e);
  }
}

async function loadRareOrbitBuffer() {
  if (rareOrbitBuffer || rareOrbitBufferTried || !audioContext) return;
  rareOrbitBufferTried = true;
  try {
    const res = await fetch("./assets/star-trek-viewer.mp3");
    if (!res.ok) throw new Error("HTTP " + res.status);
    rareOrbitBuffer = await audioContext.decodeAudioData(await res.arrayBuffer());
    if (rareOrbitAudioWanted && !rareOrbitSource && shipMode === ENTERPRISE_MODE_RARE_ORBIT && shipRarePhase === ENTERPRISE_RARE_ORBIT) {
      playRareOrbitAudio();
    }
  } catch (e) {
    console.error("rare orbit audio load failed:", e);
  }
}

function loadBlackHoleBuffer() {
  if (blackHoleBuffer || !audioContext) return Promise.resolve(blackHoleBuffer);
  if (blackHoleBufferPromise) return blackHoleBufferPromise;
  blackHoleBufferTried = true;
  blackHoleBufferPromise = fetch("./assets/blackhole.mp3")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    })
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      blackHoleBuffer = buffer;
      if (blackHoleRumbleTargetGain > 0.001) startBlackHoleRumble();
      return buffer;
    })
    .catch((e) => {
      console.error("black hole sound load failed:", e);
      return null;
    })
    .finally(() => {
      blackHoleBufferPromise = null;
    });
  return blackHoleBufferPromise;
}

function startBlackHoleRumble() {
  if (!audioContext || audioContext.state !== "running") return;
  if (!blackHoleBuffer && !blackHoleBufferPromise && !blackHoleBufferTried) loadBlackHoleBuffer();
  if (!blackHoleBuffer || blackHoleRumbleSource) return;

  try {
    blackHoleRumbleGain = audioContext.createGain();
    blackHoleRumbleGain.gain.value = 0.0001;
    blackHoleRumbleFilter = audioContext.createBiquadFilter();
    blackHoleRumbleFilter.type = "lowpass";
    blackHoleRumbleFilter.frequency.value = 120;
    blackHoleRumbleFilter.Q.value = 0.7;
    blackHoleRumbleSource = audioContext.createBufferSource();
    blackHoleRumbleSource.buffer = blackHoleBuffer;
    blackHoleRumbleSource.loop = true;
    blackHoleRumbleSource.connect(blackHoleRumbleFilter);
    blackHoleRumbleSpatial = connectSpatialPanner(blackHoleRumbleFilter, BLACK_HOLE_POSITION, { attenuate: false });
    blackHoleRumbleSpatial.panner.connect(blackHoleRumbleGain);
    blackHoleRumbleGain.connect(audioContext.destination);
    blackHoleRumbleSource.onended = () => {
      blackHoleRumbleSource = null;
      disconnectSpatialAudio(blackHoleRumbleSpatial);
      blackHoleRumbleSpatial = null;
    };
    blackHoleRumbleSource.start();
  } catch (e) {
    blackHoleRumbleSource = null;
    blackHoleRumbleGain = null;
    blackHoleRumbleFilter = null;
    disconnectSpatialAudio(blackHoleRumbleSpatial);
    blackHoleRumbleSpatial = null;
  }
}

function getBlackHoleRumbleGain(distance) {
  const t = THREE.MathUtils.clamp(
    (BLACK_HOLE_SOUND_START_R - distance) / (BLACK_HOLE_SOUND_START_R - BLACK_HOLE_SOUND_FULL_R),
    0,
    1
  );
  return Math.pow(smoothFade01(t), 1.28) * BLACK_HOLE_SOUND_MAX_GAIN;
}

function updateBlackHoleRumble(distance, dt, timeSeconds) {
  blackHoleRumbleTargetGain = getBlackHoleRumbleGain(distance);
  if (!audioContext) return;
  if (audioContext.state === "suspended") return;
  if (!blackHoleBuffer && !blackHoleBufferPromise && !blackHoleBufferTried) loadBlackHoleBuffer();
  if (blackHoleRumbleTargetGain > 0.001 && !blackHoleRumbleSource) startBlackHoleRumble();
  if (!blackHoleRumbleGain) return;
  setSpatialAudioPosition(blackHoleRumbleSpatial, BLACK_HOLE_POSITION);

  const now = audioContext.currentTime;
  const gain = Math.max(0.0001, blackHoleRumbleTargetGain);
  blackHoleRumbleGain.gain.cancelScheduledValues(now);
  blackHoleRumbleGain.gain.setTargetAtTime(gain, now, 0.22);

  const intensity = THREE.MathUtils.clamp(blackHoleRumbleTargetGain / BLACK_HOLE_SOUND_MAX_GAIN, 0, 1);
  if (blackHoleRumbleFilter) {
    blackHoleRumbleFilter.frequency.setTargetAtTime(90 + intensity * 460, now, 0.28);
    blackHoleRumbleFilter.Q.setTargetAtTime(0.65 + intensity * 1.5, now, 0.35);
  }
  if (blackHoleRumbleSource?.playbackRate) {
    blackHoleRumbleSource.playbackRate.setTargetAtTime(0.94 + intensity * 0.12 + Math.sin(timeSeconds * 0.7) * 0.006, now, 0.45);
  }
}

window.__questXrDebug = Object.assign(window.__questXrDebug || {}, {
  getBlackHoleRumbleState: () => ({
    audioState: audioContext?.state || "none",
    bufferLoaded: !!blackHoleBuffer,
    sourceActive: !!blackHoleRumbleSource,
    targetGain: blackHoleRumbleTargetGain,
    currentGain: blackHoleRumbleGain?.gain.value || 0,
    filterFrequency: blackHoleRumbleFilter?.frequency.value || 0,
  }),
});

function loadKlingonBuffer() {
  if (klingonBuffer || !audioContext) return Promise.resolve(klingonBuffer);
  if (klingonBufferPromise) return klingonBufferPromise;
  klingonBufferTried = true;
  klingonBufferPromise = fetch("./assets/klingon_theme.mp3")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    })
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      klingonBuffer = buffer;
      if (klingonAudioWanted && klingonActive && !klingonSource) {
        playKlingonTheme();
      }
      return buffer;
    })
    .catch((e) => {
      console.error("Klingon theme load failed:", e);
      return null;
    })
    .finally(() => {
      klingonBufferPromise = null;
    });
  return klingonBufferPromise;
}

function getKlingonPassDuration() {
  return Math.max(8, klingonBuffer?.duration || KLINGON_PASS_DURATION_FALLBACK);
}

function loadOneShotAudio(sound) {
  if (sound.buffer || sound.failed || !audioContext) return Promise.resolve(sound.buffer);
  if (sound.promise) return sound.promise;
  sound.promise = fetch(sound.url)
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    })
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      sound.buffer = buffer;
      return buffer;
    })
    .catch((e) => {
      sound.failed = true;
      console.error(sound.label + " load failed:", e);
      return null;
    })
    .finally(() => {
      sound.promise = null;
    });
  return sound.promise;
}

function isOneShotAudioReady(sound) {
  return !!sound.buffer || !!sound.failed;
}

function playOneShotAudio(sound, volume = 0.72, sourcePosition = null, minRatio = LOCAL_AUDIO_MIN_RATIO) {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    if (!sound.buffer && !sound.promise) loadOneShotAudio(sound);
  }
  if (!audioContext || audioContext.state !== "running" || !sound.buffer) return 0;
  try {
    if (sound.source) {
      try {
        sound.source.stop();
      } catch (e) {
        /* already stopped */
      }
      disconnectSpatialAudio(sound.spatialAudio);
      untrackSpatialAudio(sound.spatialTrack);
      sound.spatialAudio = null;
      sound.spatialPosition = null;
      sound.spatialTrack = null;
    }
    const source = audioContext.createBufferSource();
    sound.source = source;
    source.buffer = sound.buffer;
    const soundPos = sourcePosition || getViewerAudioPosition(audioSourceWorldAlt).clone();
    const spatialAudio = connectDistanceGain(source, soundPos, volume, minRatio);
    const tracked = trackSpatialAudio(spatialAudio, soundPos);
    sound.spatialAudio = spatialAudio;
    sound.spatialPosition = soundPos;
    sound.spatialTrack = tracked;
    source.onended = () => {
      if (sound.source === source) {
        sound.source = null;
        sound.spatialAudio = null;
        sound.spatialPosition = null;
        sound.spatialTrack = null;
      }
      untrackSpatialAudio(tracked);
      disconnectSpatialAudio(spatialAudio);
    };
    source.start();
    return sound.buffer.duration || 0;
  } catch (e) {
    sound.source = null;
    sound.spatialAudio = null;
    sound.spatialPosition = null;
    sound.spatialTrack = null;
    return 0;
  }
}

function playXrButtonPressSound() {
  return playOneShotAudio(xrButtonPressSound, 0.86, getViewerAudioPosition(audioSourceWorld).clone(), LOCAL_AUDIO_MIN_RATIO);
}

function playKlingonArrivalSound() {
  return playOneShotAudio(klingonArrivalSound, KLINGON_ARRIVAL_VOLUME, klingon.position, SHIP_AUDIO_MIN_RATIO);
}

function playKlingonDepartureSound() {
  return playOneShotAudio(klingonDepartureSound, KLINGON_DEPARTURE_VOLUME, klingon.position, SHIP_AUDIO_MIN_RATIO);
}

function getKlingonDepartureSoundLead() {
  return THREE.MathUtils.clamp(klingonDepartureSound.buffer?.duration || 2.8, 1.2, 5.5);
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
        disconnectSpatialAudio(shipSourceGain);
        shipSourceGain = null;
      }
      const source = audioContext.createBufferSource();
      const spatialAudio = connectDistanceGain(source, enterprise.position, ENTERPRISE_ENTRANCE_VOLUME);
      shipSource = source;
      shipSourceGain = spatialAudio;
      source.buffer = shipBuffer;
      source.onended = () => {
        if (shipSource === source) shipSource = null;
        disconnectSpatialAudio(spatialAudio);
        if (shipSourceGain === spatialAudio) shipSourceGain = null;
      };
      source.start();
      return;
    } catch (e) {
      /* fall through to the synth fanfare */
    }
  }
  playEnterpriseTheme();
}

function playShipWarpSound() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    if (!warpBuffer && !warpBufferTried) loadWarpBuffer();
  }
  if (audioContext && audioContext.state === "running" && warpBuffer) {
    try {
      if (warpSource) {
        try {
          warpSource.stop();
        } catch (e) {
          /* ignore */
        }
        disconnectSpatialAudio(warpSourceGain);
        warpSourceGain = null;
      }
      shipWarpAudioEnded = false;
      const source = audioContext.createBufferSource();
      const spatialAudio = connectDistanceGain(source, enterprise.position, ENTERPRISE_WARP_VOLUME);
      warpSource = source;
      warpSourceGain = spatialAudio;
      source.buffer = warpBuffer;
      source.onended = () => {
        if (warpSource === source) {
          shipWarpAudioEnded = true;
          warpSource = null;
        }
        disconnectSpatialAudio(spatialAudio);
        if (warpSourceGain === spatialAudio) warpSourceGain = null;
      };
      source.start();
      return Math.max(0.35, warpBuffer.duration || 0.75);
    } catch (e) {
      /* use visual fallback */
    }
  }
  shipWarpAudioEnded = true;
  return 0.75;
}

function playRareOrbitAudio() {
  rareOrbitAudioWanted = true;
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    if (!rareOrbitBuffer && !rareOrbitBufferTried) loadRareOrbitBuffer();
  }
  if (!audioContext || audioContext.state !== "running" || !rareOrbitBuffer || rareOrbitSource) return;
  try {
    const source = audioContext.createBufferSource();
    const spatialAudio = connectDistanceGain(source, enterprise.position, ENTERPRISE_RARE_ORBIT_VOLUME);
    rareOrbitSource = source;
    rareOrbitGain = spatialAudio;
    source.buffer = rareOrbitBuffer;
    source.loop = true;
    source.onended = () => {
      if (rareOrbitSource === source) rareOrbitSource = null;
      disconnectSpatialAudio(spatialAudio);
      if (rareOrbitGain === spatialAudio) rareOrbitGain = null;
    };
    source.start();
  } catch (e) {
    rareOrbitSource = null;
    rareOrbitGain = null;
  }
}

function stopRareOrbitAudio() {
  rareOrbitAudioWanted = false;
  if (!rareOrbitSource) return;
  try {
    rareOrbitSource.stop();
  } catch (e) {
    /* already stopped */
  }
  rareOrbitSource = null;
  disconnectSpatialAudio(rareOrbitGain);
  rareOrbitGain = null;
}

function playKlingonTheme() {
  klingonAudioWanted = true;
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    if (!klingonBuffer && !klingonBufferPromise) loadKlingonBuffer();
  }
  if (!audioContext || audioContext.state !== "running" || !klingonBuffer) return getKlingonPassDuration();
  try {
    if (klingonSource) {
      try {
        klingonSource.stop();
      } catch (e) {
        /* already stopped */
      }
      disconnectSpatialAudio(klingonGain);
      klingonGain = null;
    }
    const source = audioContext.createBufferSource();
    const spatialAudio = connectDistanceGain(source, klingon.position, KLINGON_THEME_VOLUME);
    klingonSource = source;
    klingonGain = spatialAudio;
    source.buffer = klingonBuffer;
    source.onended = () => {
      if (klingonSource === source) klingonSource = null;
      disconnectSpatialAudio(spatialAudio);
      if (klingonGain === spatialAudio) klingonGain = null;
    };
    source.start();
  } catch (e) {
    klingonSource = null;
    klingonGain = null;
  }
  return getKlingonPassDuration();
}

function stopKlingonTheme() {
  klingonAudioWanted = false;
  if (!klingonSource) return;
  try {
    klingonSource.stop();
  } catch (e) {
    /* already stopped */
  }
  klingonSource = null;
  disconnectSpatialAudio(klingonGain);
  klingonGain = null;
}

function stopShipAudio() {
  stopEnterpriseTheme();
  stopRareOrbitAudio();
  if (shipSource) {
    try {
      shipSource.stop();
    } catch (e) {
      /* already stopped */
    }
    shipSource = null;
    disconnectSpatialAudio(shipSourceGain);
    shipSourceGain = null;
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
function makeButtonTexture(label, accent = "rgba(84,210,255,0.9)") {
  const c = document.createElement("canvas");
  c.width = 704;
  c.height = 160;
  const ctx = c.getContext("2d");

  const panelGradient = ctx.createLinearGradient(0, 0, 0, c.height);
  panelGradient.addColorStop(0, "rgba(23,34,46,0.97)");
  panelGradient.addColorStop(0.45, "rgba(8,14,22,0.98)");
  panelGradient.addColorStop(1, "rgba(5,9,14,0.98)");
  ctx.fillStyle = panelGradient;
  ctx.beginPath();
  ctx.roundRect(8, 8, c.width - 16, c.height - 16, 18);
  ctx.fill();

  const sheen = ctx.createLinearGradient(0, 10, 0, 78);
  sheen.addColorStop(0, "rgba(255,255,255,0.18)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.roundRect(18, 16, c.width - 36, 54, 14);
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.26)";
  ctx.beginPath();
  ctx.roundRect(9.5, 9.5, c.width - 19, c.height - 19, 18);
  ctx.stroke();

  ctx.lineWidth = 5;
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.moveTo(34, c.height - 25);
  ctx.lineTo(c.width - 34, c.height - 25);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(30, 36, 7, 88, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#fff";
  const maxTextWidth = 560;
  let fontSize = 48;
  do {
    ctx.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
    fontSize -= 2;
  } while (fontSize > 30 && ctx.measureText(label).width > maxTextWidth);
  ctx.shadowColor = "rgba(0,0,0,0.66)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, c.width / 2, 76);
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

const APPROVED_XR_ICON_URLS = {
  enterprise: "./assets/icon-enterprise-c.png",
  klingon: "./assets/icon-klingon-c.png",
  blackHole: "./assets/icon-blackhole-c.png",
  help: "./assets/icon-help-b.png",
};
const WELCOME_HOST_ICON_URL = "./assets/welcome-host-matzoka.png";
const X_PROFILE_SNAPSHOT_URL = "./assets/x-matzoka-profile-shot.png";
const RAW_APPROVED_ASSET_BASE = "https://raw.githubusercontent.com/matzoka/quest-xr-glass-demo/master/quest-mr/assets/";

function loadApprovedAssetTexture(localUrl, fileName) {
  const tex = texLoader.load(localUrl, undefined, undefined, () => {
    texLoader.load(RAW_APPROVED_ASSET_BASE + fileName, (fallbackTex) => {
      tex.image = fallbackTex.image;
      tex.needsUpdate = true;
    });
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function loadApprovedXrIconTexture(kind) {
  const localUrl = APPROVED_XR_ICON_URLS[kind];
  return loadApprovedAssetTexture(localUrl, localUrl.split("/").pop());
}

function loadXProfileSnapshotTexture() {
  const tex = loadApprovedAssetTexture(X_PROFILE_SNAPSHOT_URL, "x-matzoka-profile-shot.png");
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.offset.set(163 / 1200, 0);
  tex.repeat.set(599 / 1200, 1);
  return tex;
}

const XR_ICON_SPIN = 1.35;
const XR_BUTTON_X = -1.08;
const XR_BUTTON_Z = 0.86;
const XR_BUTTON_ROT_Y = Math.PI / 2;
const XR_BUTTON_Y0 = 1.42;
const XR_BUTTON_STEP = 0.165;
const XR_BUTTON_W = 0.62;
const XR_BUTTON_H = 0.135;
const XR_BUTTON_HIT_W = XR_BUTTON_W;
const XR_BUTTON_HIT_H = XR_BUTTON_H;
const XR_BUTTON_HIT_DEPTH = 0.035;
const XR_ICON_Z = 0.39;
const XR_ICON_SIZE = 0.19;
const XR_ICON_ASPECT_H = 100 / 170;
const XR_ICON_HIT_W = XR_ICON_SIZE + 0.045;
const XR_ICON_HIT_H = XR_ICON_SIZE + 0.045;
const XR_ICON_HIT_DEPTH = 0.035;
const xrButtonIcons = [];
const xrIconHitTargets = [];
const xrButtonVolumes = [];
const xrButtonHitTargets = [];
const xrButtonActions = new Map();
let lastXrButtonActionAt = -Infinity;

function xrButtonY(row) {
  return XR_BUTTON_Y0 + row * XR_BUTTON_STEP;
}

function placeXrButton(mesh, row) {
  mesh.position.set(XR_BUTTON_X, xrButtonY(row), XR_BUTTON_Z);
  mesh.rotation.y = XR_BUTTON_ROT_Y;
}

function makeXrButtonHitBox(row, action) {
  const hitBox = new THREE.Mesh(
    new THREE.BoxGeometry(XR_BUTTON_HIT_W, XR_BUTTON_HIT_H, XR_BUTTON_HIT_DEPTH),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    })
  );
  hitBox.position.set(XR_BUTTON_X, xrButtonY(row), XR_BUTTON_Z);
  hitBox.rotation.y = XR_BUTTON_ROT_Y;
  hitBox.renderOrder = 1202;
  hitBox.visible = false;
  hitBox.userData.xrHitSize = { w: XR_BUTTON_HIT_W, h: XR_BUTTON_HIT_H, d: XR_BUTTON_HIT_DEPTH };
  scene.add(hitBox);
  xrButtonHitTargets.push(hitBox);
  xrButtonActions.set(hitBox, action);
  return hitBox;
}

function enhanceXrButton(mesh, row, action) {
  xrButtonActions.set(mesh, action);
  const hitBox = makeXrButtonHitBox(row, action);
  xrButtonVolumes.push({ hitBox });
}

function setXrButtonVolumesVisible(visible) {
  for (const item of xrButtonVolumes) {
    item.hitBox.visible = visible;
  }
  for (const item of xrIconHitTargets) {
    item.hitBox.visible = visible && item.icon.visible;
  }
}

function makeXrIcon(kind, row, size = 0.17, action = null) {
  const icon = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size * XR_ICON_ASPECT_H),
    new THREE.MeshBasicMaterial({
      map: loadApprovedXrIconTexture(kind),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  icon.position.set(XR_BUTTON_X - 0.006, xrButtonY(row), XR_ICON_Z);
  icon.rotation.y = XR_BUTTON_ROT_Y;
  icon.renderOrder = 1001;
  icon.visible = false;
  scene.add(icon);
  xrButtonIcons.push(icon);

  if (action) {
    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(XR_ICON_HIT_W, XR_ICON_HIT_H, XR_ICON_HIT_DEPTH),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      })
    );
    hitBox.position.copy(icon.position);
    hitBox.rotation.copy(icon.rotation);
    hitBox.renderOrder = 1203;
    hitBox.visible = false;
    hitBox.userData.xrHitSize = { w: XR_ICON_HIT_W, h: XR_ICON_HIT_H, d: XR_ICON_HIT_DEPTH };
    scene.add(hitBox);
    xrButtonHitTargets.push(hitBox);
    xrIconHitTargets.push({ icon, hitBox });
    xrButtonActions.set(hitBox, action);
  }

  return icon;
}

function makeWelcomePanelTexture() {
  const c = document.createElement("canvas");
  c.width = 1180;
  c.height = 620;
  const ctx = c.getContext("2d");

  ctx.clearRect(0, 0, c.width, c.height);
  const bg = ctx.createLinearGradient(0, 0, c.width, c.height);
  bg.addColorStop(0, "rgba(9,20,31,0.82)");
  bg.addColorStop(0.56, "rgba(5,11,18,0.76)");
  bg.addColorStop(1, "rgba(8,23,30,0.8)");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(18, 18, c.width - 36, c.height - 36, 32);
  ctx.fill();

  ctx.strokeStyle = "rgba(122,255,167,0.72)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(24, 24, c.width - 48, c.height - 48, 28);
  ctx.stroke();

  ctx.strokeStyle = "rgba(111,233,255,0.34)";
  ctx.lineWidth = 2;
  for (let x = 72; x < c.width - 48; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 32);
    ctx.lineTo(x, c.height - 32);
    ctx.stroke();
  }
  for (let y = 80; y < c.height - 48; y += 54) {
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(c.width - 34, y);
    ctx.stroke();
  }

  const accent = ctx.createLinearGradient(44, 0, 360, 0);
  accent.addColorStop(0, "rgba(122,255,167,0.95)");
  accent.addColorStop(1, "rgba(111,233,255,0.55)");
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(48, 54, 12, 512, 6);
  ctx.fill();

  ctx.fillStyle = "#dfffee";
  ctx.font = "700 62px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(122,255,167,0.46)";
  ctx.shadowBlur = 16;
  ctx.fillText("ようこそ、地球XRラウンジへ", 108, 62);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(235,248,255,0.94)";
  ctx.font = "500 34px Arial, Helvetica, sans-serif";
  const lines = [
    "ここは、地球を手で弾きながら宇宙を眺める",
    "Quest向けのVR/AR体験スペースです。",
    "左のボタンやアイコンから、Enterprise周回、",
    "クリンゴン登場、ブラックホール探訪へ移動できます。",
    "HELPアイコンでは操作ガイドを確認できます。",
  ];
  let y = 168;
  for (const line of lines) {
    ctx.fillText(line, 108, y);
    y += 48;
  }

  ctx.fillStyle = "rgba(122,255,167,0.96)";
  ctx.font = "700 34px Arial, Helvetica, sans-serif";
  ctx.fillText("X: @matzoka", 108, 476);

  ctx.fillStyle = "rgba(235,248,255,0.76)";
  ctx.font = "700 28px Arial, Helvetica, sans-serif";
  ctx.fillText(`Version: ${APP_VERSION}`, 352, 479);

  ctx.fillStyle = "rgba(111,233,255,0.5)";
  ctx.font = "600 24px Arial, Helvetica, sans-serif";
  ctx.fillText("Touch the Earth. Choose a mission. Drift into space.", 108, 532);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

const welcomeHostTexture = loadApprovedAssetTexture(WELCOME_HOST_ICON_URL, "welcome-host-matzoka.png");
const welcomePanel = new THREE.Group();
welcomePanel.visible = false;

const welcomePanelBack = new THREE.Mesh(
  new THREE.PlaneGeometry(1.88, 0.98),
  new THREE.MeshBasicMaterial({
    map: makeWelcomePanelTexture(),
    transparent: true,
    opacity: 0.94,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
);
welcomePanelBack.renderOrder = 990;
welcomePanel.add(welcomePanelBack);

const welcomeHostIcon = new THREE.Mesh(
  new THREE.PlaneGeometry(0.34, 0.34),
  new THREE.MeshBasicMaterial({
    map: welcomeHostTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
);
welcomeHostIcon.position.set(0.72, 0.24, 0.012);
welcomeHostIcon.renderOrder = 1002;
welcomePanel.add(welcomeHostIcon);

welcomePanel.position.set(XR_BUTTON_X + 0.006, 1.98, XR_BUTTON_Z + 1.16);
welcomePanel.rotation.y = XR_BUTTON_ROT_Y;
scene.add(welcomePanel);

function makePoseDebugPanelTexture(values = null) {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 440;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#1c2733";
  ctx.strokeRect(8, 8, c.width - 16, c.height - 16);

  ctx.fillStyle = "#111820";
  ctx.font = "bold 42px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("視線記録", 34, 26);

  ctx.fillStyle = values ? "#0d5c36" : "#745200";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(values ? "記録済み: 下の6つを控えてください" : "未記録: ボタンを押してください", 34, 78);

  const rows = values
    ? [
        ["camX", values.camX],
        ["camY", values.camY],
        ["camZ", values.camZ],
        ["lookX", values.lookX],
        ["lookY", values.lookY],
        ["lookZ", values.lookZ],
      ]
    : [
        ["camX", "---"],
        ["camY", "---"],
        ["camZ", "---"],
        ["lookX", "---"],
        ["lookY", "---"],
        ["lookZ", "---"],
      ];

  ctx.font = "bold 36px Consolas, 'Courier New', monospace";
  ctx.textBaseline = "middle";
  for (let i = 0; i < rows.length; i += 1) {
    const y = 145 + i * 46;
    ctx.fillStyle = i % 2 === 0 ? "#f0f4f8" : "#ffffff";
    ctx.fillRect(28, y - 21, c.width - 56, 42);
    ctx.fillStyle = "#1c2733";
    ctx.fillText(rows[i][0], 46, y);
    ctx.textAlign = "right";
    ctx.fillText(rows[i][1], c.width - 104, y);
    ctx.textAlign = "left";
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function makeControllerHelpTexture() {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, c.width, c.height);
  bg.addColorStop(0, "rgba(5,12,18,0.96)");
  bg.addColorStop(0.48, "rgba(7,18,26,0.94)");
  bg.addColorStop(1, "rgba(18,13,7,0.94)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.strokeStyle = "rgba(100,220,255,0.22)";
  ctx.lineWidth = 2;
  for (let x = 72; x < c.width; x += 92) {
    ctx.beginPath();
    ctx.moveTo(x, 92);
    ctx.lineTo(x, c.height - 92);
    ctx.stroke();
  }
  for (let y = 96; y < c.height; y += 82) {
    ctx.beginPath();
    ctx.moveTo(72, y);
    ctx.lineTo(c.width - 72, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,185,92,0.36)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(c.width * 0.52, c.height * 0.54, 650, 225, -0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(105,225,255,0.32)";
  ctx.beginPath();
  ctx.ellipse(c.width * 0.52, c.height * 0.54, 470, 160, 0.26, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#f6fbff";
  ctx.font = "bold 72px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("操作HELP", 96, 70);
  ctx.fillStyle = "rgba(190,230,245,0.88)";
  ctx.font = "bold 31px Arial, sans-serif";
  ctx.fillText("MISSION CONTROL / CONTROLLER GUIDE", 104, 150);

  function controller(cx, cy, side) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = side === "left" ? "rgba(36,91,114,0.98)" : "rgba(106,70,24,0.98)";
    ctx.strokeStyle = "rgba(238,252,255,0.86)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(-125, -190, 250, 380, 95);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(4,9,14,0.95)";
    ctx.beginPath();
    ctx.arc(0, -88, 43, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(122,235,255,0.95)";
    ctx.beginPath();
    ctx.arc(0, -88, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.76)";
    ctx.lineWidth = 5;
    ctx.strokeRect(-52, 8, 104, 62);
    ctx.fillStyle = "#f6fbff";
    ctx.font = "bold 40px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(side === "left" ? "L" : "R", 0, 39);
    ctx.restore();
  }

  controller(420, 545, "left");
  controller(1640, 545, "right");

  function card(num, title, detail, x, y, accent) {
    ctx.save();
    ctx.fillStyle = "rgba(7,17,24,0.9)";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, 520, 112, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + 56, y + 56, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#061016";
    ctx.font = "bold 36px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(num), x + 56, y + 57);
    ctx.textAlign = "left";
    ctx.fillStyle = "#f7fbff";
    ctx.font = "bold 34px Arial, sans-serif";
    ctx.fillText(title, x + 104, y + 36);
    ctx.fillStyle = "rgba(198,222,234,0.88)";
    ctx.font = "26px Arial, sans-serif";
    ctx.fillText(detail, x + 104, y + 78);
    ctx.restore();
  }

  card(1, "左スティック: 移動", "水平にグライド", 96, 256, "rgba(104,224,255,0.95)");
  card(2, "右スティック: 上下", "高度を上げ下げ", 96, 728, "rgba(104,224,255,0.95)");
  card(3, "トリガー: 選択", "ボタン決定 / 地球を弾く", 716, 238, "rgba(255,198,96,0.96)");
  card(4, "グリップ: ホーム復帰", "開始位置へ戻る", 716, 724, "rgba(255,198,96,0.96)");
  card(5, "地球に触れる: 弾く", "触れた向きへ発射", 1332, 256, "rgba(115,255,172,0.95)");
  card(6, "ブラックホール探訪", "近傍へジャンプ", 1332, 728, "rgba(255,160,82,0.96)");

  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 14]);
  const links = [
    [616, 312, 812, 320],
    [616, 784, 812, 780],
    [1236, 300, 1332, 312],
    [1236, 786, 1332, 784],
  ];
  for (const [x1, y1, x2, y2] of links) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(122,235,255,0.72)";
  ctx.lineWidth = 6;
  ctx.strokeRect(54, 46, c.width - 108, c.height - 92);
  ctx.strokeStyle = "rgba(255,190,96,0.8)";
  ctx.lineWidth = 3;
  ctx.strokeRect(74, 66, c.width - 148, c.height - 132);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function loadControllerHelpDTexture() {
  return loadApprovedAssetTexture("./assets/controller-help-panel-d.png", "controller-help-panel-d.png");
}

function makeXBrowserFrameTexture() {
  const c = document.createElement("canvas");
  c.width = 1152;
  c.height = 1560;
  const ctx = c.getContext("2d");

  ctx.clearRect(0, 0, c.width, c.height);
  const bg = ctx.createLinearGradient(0, 0, c.width, c.height);
  bg.addColorStop(0, "rgba(6,15,22,0.95)");
  bg.addColorStop(0.58, "rgba(3,8,14,0.94)");
  bg.addColorStop(1, "rgba(7,20,23,0.96)");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(20, 20, c.width - 40, c.height - 40, 34);
  ctx.fill();

  ctx.strokeStyle = "rgba(125,239,255,0.58)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(22, 22, c.width - 44, c.height - 44, 34);
  ctx.stroke();
  ctx.strokeStyle = "rgba(122,255,167,0.34)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(48, 48, c.width - 96, c.height - 96, 22);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.roundRect(76, 82, c.width - 152, 104, 18);
  ctx.fill();

  ctx.fillStyle = "#f6fbff";
  ctx.font = "800 54px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("X / @matzoka", 138, 134);

  ctx.fillStyle = "rgba(125,239,255,0.9)";
  ctx.beginPath();
  ctx.arc(100, 134, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(122,255,167,0.92)";
  ctx.font = "700 25px Arial, Helvetica, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("FRONT WALL BROWSER SNAPSHOT", c.width - 92, 135);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.beginPath();
  ctx.roundRect(126, 236, 900, 1120, 18);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(126, 236, 900, 1120, 18);
  ctx.stroke();

  ctx.fillStyle = "rgba(225,244,255,0.7)";
  ctx.font = "600 24px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Xの公開プロフィールを、Quest内で読める壁面パネルとして表示しています。", 96, 1430);
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.font = "600 20px Arial, Helvetica, sans-serif";
  ctx.fillText("Snapshot: x.com/matzoka", 96, 1470);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

let poseDebugPanelTexture = makePoseDebugPanelTexture();
const CONTROLLER_HELP_AUTO_HIDE = 24;
const CONTROLLER_HELP_D_ASPECT = 1552 / 1013;
const controllerHelpPanelHeight = roomHalf.y * 1.72;
const controllerHelpPanelWidth = Math.min(roomHalf.z * 1.86, controllerHelpPanelHeight * CONTROLLER_HELP_D_ASPECT);
let controllerHelpActive = false;
let controllerHelpHideAt = 0;

const controllerHelpPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(controllerHelpPanelWidth, controllerHelpPanelHeight),
  new THREE.MeshBasicMaterial({
    map: loadControllerHelpDTexture(),
    transparent: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
);
controllerHelpPanel.position.set(roomCenter.x - roomHalf.x + 0.025, roomCenter.y + 0.02, roomCenter.z);
controllerHelpPanel.rotation.y = Math.PI / 2;
controllerHelpPanel.renderOrder = 72;
controllerHelpPanel.visible = false;
scene.add(controllerHelpPanel);

const xBrowserPanel = new THREE.Group();
xBrowserPanel.visible = false;

const xBrowserPanelBack = new THREE.Mesh(
  new THREE.PlaneGeometry(3.04, 4.12),
  new THREE.MeshBasicMaterial({
    map: makeXBrowserFrameTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
);
xBrowserPanelBack.renderOrder = 74;
xBrowserPanel.add(xBrowserPanelBack);

const xBrowserSnapshot = new THREE.Mesh(
  new THREE.PlaneGeometry(2.2, 3.28),
  new THREE.MeshBasicMaterial({
    map: loadXProfileSnapshotTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
);
xBrowserSnapshot.position.set(0, -0.08, -0.014);
xBrowserSnapshot.renderOrder = 76;
xBrowserPanel.add(xBrowserSnapshot);

xBrowserPanel.position.set(roomCenter.x - 2.86, roomCenter.y + 0.05, roomCenter.z - roomHalf.z + 0.035);
xBrowserPanel.rotation.y = 0;
scene.add(xBrowserPanel);

function setControllerHelpVisible(visible) {
  controllerHelpActive = visible;
  controllerHelpPanel.visible = visible;
  xBrowserPanel.visible = visible;
  if (renderer.xr.isPresenting && exitButton.visible) {
    welcomePanel.visible = !visible;
  }
  controllerHelpHideAt = visible ? elapsed + CONTROLLER_HELP_AUTO_HIDE : 0;
  statusEl.textContent = visible
    ? "左側に操作HELP、正面にXプロフィールパネルを表示しました。もう一度HELPを押すと閉じます。"
    : "操作HELPを閉じました。";
}

function toggleControllerHelp() {
  setControllerHelpVisible(!controllerHelpActive);
}

function updateControllerHelp() {
  if (controllerHelpActive && elapsed >= controllerHelpHideAt) {
    setControllerHelpVisible(false);
  }
}

const exitButton = new THREE.Mesh(
  new THREE.PlaneGeometry(XR_BUTTON_W, XR_BUTTON_H),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("終了 / Exit", "rgba(255,92,110,0.92)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
placeXrButton(exitButton, 0);
exitButton.renderOrder = 999;
exitButton.visible = false;
scene.add(exitButton);
enhanceXrButton(exitButton, 0, "exit");

const resetButton = new THREE.Mesh(
  new THREE.PlaneGeometry(XR_BUTTON_W, XR_BUTTON_H),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("リセット / Reset", "rgba(85,185,255,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
placeXrButton(resetButton, 1);
resetButton.renderOrder = 999;
resetButton.visible = false;
scene.add(resetButton);
enhanceXrButton(resetButton, 1, "reset");

const enterpriseOrbitXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(XR_BUTTON_W, XR_BUTTON_H),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("Enterprise 周回", "rgba(120,214,255,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
placeXrButton(enterpriseOrbitXrButton, 2);
enterpriseOrbitXrButton.renderOrder = 999;
enterpriseOrbitXrButton.visible = false;
scene.add(enterpriseOrbitXrButton);
enhanceXrButton(enterpriseOrbitXrButton, 2, "enterprise");
const enterpriseOrbitXrIcon = makeXrIcon("enterprise", 2, XR_ICON_SIZE, "enterprise");

const klingonXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(XR_BUTTON_W, XR_BUTTON_H),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("クリンゴン登場", "rgba(117,255,168,0.92)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
placeXrButton(klingonXrButton, 3);
klingonXrButton.renderOrder = 999;
klingonXrButton.visible = false;
scene.add(klingonXrButton);
enhanceXrButton(klingonXrButton, 3, "klingon");
const klingonXrIcon = makeXrIcon("klingon", 3, XR_ICON_SIZE, "klingon");

const blackHoleTourXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(XR_BUTTON_W, XR_BUTTON_H),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("ブラックホール探訪", "rgba(255,188,105,0.96)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
placeXrButton(blackHoleTourXrButton, 4);
blackHoleTourXrButton.renderOrder = 999;
blackHoleTourXrButton.visible = false;
scene.add(blackHoleTourXrButton);
enhanceXrButton(blackHoleTourXrButton, 4, "blackHole");
const blackHoleTourXrIcon = makeXrIcon("blackHole", 4, XR_ICON_SIZE, "blackHole");

const taxiAnalyticsXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(XR_BUTTON_W, XR_BUTTON_H),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("タクシー業務アプリ分析", "rgba(168,132,255,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
placeXrButton(taxiAnalyticsXrButton, 5);
taxiAnalyticsXrButton.renderOrder = 999;
taxiAnalyticsXrButton.visible = false;
scene.add(taxiAnalyticsXrButton);
enhanceXrButton(taxiAnalyticsXrButton, 5, "taxiAnalytics");

const helpXrIcon = makeXrIcon("help", 6, XR_ICON_SIZE, "help");

const poseDebugXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(0.56, 0.2),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("視線記録", "rgba(90,62,150,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
poseDebugXrButton.position.set(0, 2.62, -0.5);
poseDebugXrButton.renderOrder = 999;
poseDebugXrButton.visible = false;
scene.add(poseDebugXrButton);

const poseDebugXrHitArea = new THREE.Mesh(
  new THREE.PlaneGeometry(0.78, 0.34),
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
poseDebugXrHitArea.position.set(0, 2.62, -0.5);
poseDebugXrHitArea.renderOrder = 1000;
poseDebugXrHitArea.visible = false;
scene.add(poseDebugXrHitArea);

const poseDebugXrPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(0.9, 0.52),
  new THREE.MeshBasicMaterial({
    map: poseDebugPanelTexture,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
poseDebugXrPanel.position.set(0, 1.82, -0.5);
poseDebugXrPanel.renderOrder = 998;
poseDebugXrPanel.visible = false;
scene.add(poseDebugXrPanel);

const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const poseDebugButtonRight = new THREE.Vector3();
const poseDebugButtonUp = new THREE.Vector3();
const poseDebugButtonForward = new THREE.Vector3();
const controllerModelFactory = new XRControllerModelFactory();
const handModelFactory = new XRHandModelFactory();
const handPresence = [];
const HAND_PRESENCE_ROOM_PAD = 0.45;

function makeDistanceRay() {
  const group = new THREE.Group();
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.05), new THREE.Vector3(0, 0, -0.82)]),
    new THREE.LineBasicMaterial({
      color: 0x82f7ff,
      transparent: true,
      opacity: 0.58,
      depthTest: false,
    })
  );
  line.renderOrder = 1200;
  group.add(line);

  const beadMaterial = new THREE.MeshBasicMaterial({
    color: 0x8effff,
    transparent: true,
    opacity: 0.76,
    depthTest: false,
  });
  for (const z of [-0.28, -0.54, -0.82]) {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 10), beadMaterial);
    bead.position.z = z;
    bead.renderOrder = 1201;
    group.add(bead);
  }
  return group;
}

function makeFallbackQuestController(side) {
  const group = new THREE.Group();
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x101820,
    metalness: 0.32,
    roughness: 0.42,
    transparent: true,
    opacity: 0.92,
  });
  const gripMaterial = new THREE.MeshStandardMaterial({
    color: 0x05080c,
    metalness: 0.25,
    roughness: 0.5,
    transparent: true,
    opacity: 0.88,
  });
  const accentMaterial = new THREE.MeshBasicMaterial({
    color: 0x1d9dff,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
  });
  const handMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa4ae,
    transparent: true,
    opacity: 0.22,
    roughness: 0.75,
    depthWrite: false,
  });

  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.105, 8, 18), gripMaterial);
  handle.position.set(0, -0.055, 0.018);
  handle.rotation.x = -0.2;
  group.add(handle);

  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.04, 0.026, 32), shellMaterial);
  face.position.set(0, 0.018, -0.02);
  face.rotation.x = Math.PI / 2;
  group.add(face);

  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 10), accentMaterial);
  thumb.position.set(side === "left" ? 0.02 : -0.02, 0.028, -0.055);
  thumb.renderOrder = 1202;
  group.add(thumb);

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 14), handMaterial);
  palm.scale.set(0.7, 1.0, 0.42);
  palm.position.set(side === "left" ? -0.045 : 0.045, -0.035, 0.035);
  palm.renderOrder = 1198;
  group.add(palm);

  for (let i = 0; i < 4; i += 1) {
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.052, 5, 10), handMaterial);
    finger.position.set((side === "left" ? -1 : 1) * (0.012 + i * 0.01), -0.01 - i * 0.008, -0.02);
    finger.rotation.x = 0.9;
    finger.rotation.z = (side === "left" ? -1 : 1) * (0.15 + i * 0.04);
    finger.renderOrder = 1198;
    group.add(finger);
  }

  group.add(makeDistanceRay());
  return group;
}

function isViewerInsideEarthFrame() {
  if (!renderer.xr.isPresenting) return false;
  getViewerPose(viewerWorld);
  tmpVec.copy(viewerWorld).sub(roomCenter);
  return (
    Math.abs(tmpVec.x) <= roomHalf.x + HAND_PRESENCE_ROOM_PAD &&
    Math.abs(tmpVec.y) <= roomHalf.y + HAND_PRESENCE_ROOM_PAD &&
    Math.abs(tmpVec.z) <= roomHalf.z + HAND_PRESENCE_ROOM_PAD
  );
}

// The taxi analytics room sits outside the Earth frame (x = 11..19 m vs. the
// solar room's |x| <= 4.5 m), so hands/controllers/rays must also be allowed
// while the player is in that room (reached by the button OR by walking with
// the thumbstick) and in the corridor between the two rooms.
function isPointInPaddedBox(p, center, half, pad) {
  return (
    Math.abs(p.x - center.x) <= half.x + pad &&
    Math.abs(p.y - center.y) <= half.y + pad &&
    Math.abs(p.z - center.z) <= half.z + pad
  );
}

// "solar" | "corridor" | "taxi" | null (outside every room, e.g. black-hole tour)
function getViewerXrRoomZone() {
  if (!renderer.xr.isPresenting) return null;
  getViewerPose(viewerWorld);
  if (isPointInPaddedBox(viewerWorld, roomCenter, roomHalf, HAND_PRESENCE_ROOM_PAD)) return "solar";
  if (!taxiAnalyticsGroup.visible) return null; // taxi room not opened yet
  if (isPointInPaddedBox(viewerWorld, TAXI_ANALYTICS_ROOM_POSITION, TAXI_ANALYTICS_ROOM_HALF, HAND_PRESENCE_ROOM_PAD)) return "taxi";
  const corridorMinX = roomCenter.x + roomHalf.x;
  const corridorMaxX = TAXI_ANALYTICS_ROOM_POSITION.x - TAXI_ANALYTICS_ROOM_HALF.x;
  if (
    viewerWorld.x >= corridorMinX && viewerWorld.x <= corridorMaxX &&
    Math.abs(viewerWorld.y - roomCenter.y) <= Math.min(roomHalf.y, TAXI_ANALYTICS_ROOM_HALF.y) + HAND_PRESENCE_ROOM_PAD &&
    Math.abs(viewerWorld.z - roomCenter.z) <= Math.min(roomHalf.z, TAXI_ANALYTICS_ROOM_HALF.z) + HAND_PRESENCE_ROOM_PAD
  ) return "corridor";
  return null;
}

function isViewerInTaxiAnalyticsRoomXr() {
  return renderer.xr.isPresenting && inTaxiAnalyticsRoom && taxiAnalyticsGroup.visible;
}

let xrViewerRoomZone = null;

function isXrHandUiAllowed() {
  return xrViewerRoomZone !== null || isViewerInTaxiAnalyticsRoomXr();
}

// Walking in/out with the thumbstick must switch the taxi-room state just like
// the teleport button / return button do (return button, taxi UI raycast targets).
function syncTaxiRoomStateWithViewerZone(zone) {
  if (!renderer.xr.isPresenting) return;
  if (zone === "taxi" && !inTaxiAnalyticsRoom) {
    inTaxiAnalyticsRoom = true;
    taxiReturnXrButton.visible = true;
    document.getElementById("taxiChatPanel")?.removeAttribute("hidden");
    statusEl.textContent = "分析用の部屋に入りました。";
  } else if (zone === "solar" && inTaxiAnalyticsRoom) {
    inTaxiAnalyticsRoom = false;
    taxiReturnXrButton.visible = false;
    document.getElementById("taxiChatPanel")?.setAttribute("hidden", "");
    statusEl.textContent = "太陽系の部屋に戻りました。";
  }
}

function setHandPresenceVisible(visible) {
  for (const item of handPresence) {
    item.root.visible = visible;
    if (item.model && item.fallback) item.fallback.visible = item.model.children.length === 0;
  }
}

function updateHandPresence() {
  xrViewerRoomZone = getViewerXrRoomZone();
  syncTaxiRoomStateWithViewerZone(xrViewerRoomZone);
  const visible = isXrHandUiAllowed();
  setHandPresenceVisible(visible);
}

function activateXrButtonAction(action) {
  if (!action || elapsed - lastXrButtonActionAt < 0.22) return false;
  lastXrButtonActionAt = elapsed;
  playXrButtonPressSound();

  if (action === "exit") renderer.xr.getSession()?.end();
  else if (action === "reset") resetBall();
  else if (action === "enterprise") requestEnterpriseRareOrbit();
  else if (action === "klingon") requestKlingonPass();
  else if (action === "blackHole") requestBlackHoleTour();
  else if (action === "taxiAnalytics") requestTaxiAnalyticsRoom();
  else if (action === "help") toggleControllerHelp();
  else return false;

  return true;
}

function getTouchedXrButtonAction(point) {
  for (const hitBox of xrButtonHitTargets) {
    if (!hitBox.visible) continue;
    tmpVec.copy(point);
    hitBox.worldToLocal(tmpVec);
    const size = hitBox.userData.xrHitSize || { w: XR_BUTTON_HIT_W, h: XR_BUTTON_HIT_H, d: XR_BUTTON_HIT_DEPTH };
    if (
      Math.abs(tmpVec.x) <= size.w * 0.5 &&
      Math.abs(tmpVec.y) <= size.h * 0.5 &&
      Math.abs(tmpVec.z) <= size.d * 0.5
    ) {
      return xrButtonActions.get(hitBox) || null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// XR controllers: touch the Earth to launch it; trigger launches along the
// pointing direction as a fallback for when it is out of reach.
// ---------------------------------------------------------------------------
const grips = [];
const gripPrev = []; // previous world position of each grip
const gripValid = []; // whether gripPrev holds a usable value
const gripTouching = []; // latch so one touch == one kick
const poseDebugTouching = []; // latch so one hand press records once
const xrButtonTouching = []; // latch so a physical button press fires once
const taxiButtonTouching = []; // same latch for the taxi-room buttons (return / mic / questions / scroll)
const xrAimControllers = [];
const xrAimRays = [];
const xrAimReticles = [];
const xrAimHoverChat = []; // ray of controller i points at the taxi chat panel / its scroll buttons
const XR_AIM_RAY_LENGTH = 2.4;

function getXrUiTargets() {
  const targets = [
    ...xrButtonHitTargets,
    exitButton,
    resetButton,
    enterpriseOrbitXrButton,
    klingonXrButton,
    blackHoleTourXrButton,
    taxiAnalyticsXrButton,
  ];
  if (poseDebugXrButton.visible) targets.push(poseDebugXrHitArea, poseDebugXrButton);
  if (taxiReturnXrButton.visible) targets.push(taxiReturnXrButton);
  if (inTaxiAnalyticsRoom) {
    if (taxiMicButtonMesh) targets.push(taxiMicButtonMesh);
    targets.push(...taxiQuestionButtons);
    targets.push(...taxiAnalyticsPanels); // fixed dashboard panels: select = focus/highlight
    targets.push(...taxiChatScrollButtons);
    if (taxiChatPanelMesh) targets.push(taxiChatPanelMesh); // hover + thumbstick = scroll
  }
  return targets;
}

function makeXrAimRay() {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.035), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({
      color: 0x8ff7ff,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
    })
  );
  line.scale.z = XR_AIM_RAY_LENGTH;
  line.renderOrder = 1304;
  line.visible = false;
  return line;
}

function makeXrAimReticle() {
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.018, 0.031, 36),
    new THREE.MeshBasicMaterial({
      color: 0x7affa7,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  reticle.renderOrder = 1305;
  reticle.visible = false;
  scene.add(reticle);
  return reticle;
}

for (let index = 0; index < 2; index += 1) {
  const grip = renderer.xr.getControllerGrip(index);
  const side = index === 0 ? "left" : "right";
  const presenceRoot = new THREE.Group();
  presenceRoot.visible = false;
  const fallbackController = makeFallbackQuestController(side);
  const controllerModel = controllerModelFactory.createControllerModel(grip);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0x9be7ff, emissive: 0x0a2230, roughness: 0.4 })
  );
  marker.renderOrder = 1203;
  presenceRoot.add(fallbackController);
  presenceRoot.add(controllerModel);
  presenceRoot.add(marker);
  grip.add(presenceRoot);
  scene.add(grip);
  handPresence.push({ root: presenceRoot, fallback: fallbackController, model: controllerModel });

  const hand = renderer.xr.getHand(index);
  const handRoot = new THREE.Group();
  handRoot.visible = false;
  const handModel = handModelFactory.createHandModel(hand, "spheres");
  handRoot.add(handModel);
  hand.add(handRoot);
  scene.add(hand);
  handPresence.push({ root: handRoot });

  grips.push(grip);
  gripPrev.push(new THREE.Vector3());
  gripValid.push(false);
  gripTouching.push(false);
  poseDebugTouching.push(false);
  xrButtonTouching.push(null);
  taxiButtonTouching.push(null);

  const controller = renderer.xr.getController(index);
  const aimRay = makeXrAimRay();
  const aimReticle = makeXrAimReticle();
  controller.add(aimRay);
  xrAimControllers.push(controller);
  xrAimRays.push(aimRay);
  xrAimReticles.push(aimReticle);
  xrAimHoverChat.push(false);
  controller.addEventListener("connected", (event) => {
    controller.userData.inputSource = event.data;
  });
  controller.addEventListener("disconnected", () => {
    controller.userData.inputSource = null;
  });
  controller.addEventListener("select", () => {
    initAudio();
    // If aiming at the Exit button, leave the XR session instead of launching.
    if (exitButton.visible) {
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
      const uiHit = raycaster.intersectObjects(getXrUiTargets())[0];
      if (uiHit) {
        const action = xrButtonActions.get(uiHit.object);
        if (action) activateXrButtonAction(action);
        else if (uiHit.object === poseDebugXrButton || uiHit.object === poseDebugXrHitArea) capturePoseDebugUrl();
        else if (uiHit.object === taxiReturnXrButton || uiHit.object.userData?.isTaxiReturn) {
          playXrButtonPressSound();
          returnFromTaxiAnalyticsRoom();
        }
        else if (uiHit.object.userData?.isTaxiMicButton) {
          toggleTaxiVoiceInput(); // silent: no press sound for the mic (start/stop)
        }
        else if (uiHit.object.userData?.isTaxiQuestionButton) {
          playXrButtonPressSound();
          processTaxiConversation(uiHit.object.userData.questionText);
        }
        else if (taxiAnalyticsPanels.includes(uiHit.object)) {
          playXrButtonPressSound();
          setTaxiFocusedPanel(taxiAnalyticsPanels.indexOf(uiHit.object));
        }
        else if (uiHit.object.userData?.isTaxiChatScroll) {
          scrollTaxiChatPanel(uiHit.object.userData.scrollDir * TAXI_CHAT_SCROLL_STEP_PX); // silent scroll
        }
        return;
      }
    }
    // In the taxi room the Earth is in another room: don't launch it from here.
    if (inTaxiAnalyticsRoom) return;
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

function isPoseDebugButtonTouched(point) {
  if (!poseDebugXrButton.visible) return false;
  tmpVec.copy(point).sub(poseDebugXrButton.position);
  const localX = tmpVec.dot(poseDebugButtonRight);
  const localY = tmpVec.dot(poseDebugButtonUp);
  const localZ = tmpVec.dot(poseDebugButtonForward);
  return Math.abs(localX) <= 0.43 && Math.abs(localY) <= 0.2 && Math.abs(localZ) <= 0.12;
}

function updateHandTouch(dt) {
  updatePoseDebugButton();
  tmpBall.copy(roomCenter).add(ballOffset);

  for (let i = 0; i < grips.length; i += 1) {
    const grip = grips[i];
    if (!grip.visible) {
      gripValid[i] = false;
      gripTouching[i] = false;
      poseDebugTouching[i] = false;
      xrButtonTouching[i] = null;
      taxiButtonTouching[i] = null;
      continue;
    }

    tmpHand.setFromMatrixPosition(grip.matrixWorld);

    const touchedXrButtonAction = getTouchedXrButtonAction(tmpHand);
    if (touchedXrButtonAction && xrButtonTouching[i] !== touchedXrButtonAction) {
      initAudio();
      activateXrButtonAction(touchedXrButtonAction);
    }
    xrButtonTouching[i] = touchedXrButtonAction;

    // Taxi-room buttons fire once per touch (entering the hit box), not every frame.
    let taxiTouch = null;
    let touchedQuestion = null;
    let touchedScrollDir = 0;
    if (!xrButtonTouching[i]) {
      if (checkTaxiReturnButtonHit(tmpHand)) taxiTouch = "return";
      else if (inTaxiAnalyticsRoom && checkTaxiMicButtonHit(tmpHand)) taxiTouch = "mic";
      else if (inTaxiAnalyticsRoom && (touchedQuestion = checkTaxiQuestionButtonHit(tmpHand))) taxiTouch = `q:${touchedQuestion}`;
      else if (inTaxiAnalyticsRoom && (touchedScrollDir = checkTaxiChatScrollHit(tmpHand))) taxiTouch = `s:${touchedScrollDir}`;
    }
    if (taxiTouch && taxiTouch !== taxiButtonTouching[i]) {
      initAudio();
      // mic (start/stop) and chat scroll buttons are silent; other taxi buttons keep the press sound
      if (taxiTouch !== "mic" && !touchedScrollDir) playXrButtonPressSound();
      if (taxiTouch === "return") returnFromTaxiAnalyticsRoom();
      else if (taxiTouch === "mic") toggleTaxiVoiceInput();
      else if (touchedQuestion) processTaxiConversation(touchedQuestion);
      else if (touchedScrollDir) scrollTaxiChatPanel(touchedScrollDir * TAXI_CHAT_SCROLL_STEP_PX);
    }
    taxiButtonTouching[i] = taxiTouch;

    const touchingPoseDebug = isPoseDebugButtonTouched(tmpHand);
    if (touchingPoseDebug && !poseDebugTouching[i]) {
      initAudio();
      capturePoseDebugUrl();
    }
    poseDebugTouching[i] = touchingPoseDebug;

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

function updateXrAimRays() {
  const visible = renderer.xr.isPresenting && isXrHandUiAllowed() && exitButton.visible;
  const uiTargets = visible ? getXrUiTargets() : [];
  for (let i = 0; i < xrAimControllers.length; i += 1) {
    const controller = xrAimControllers[i];
    const ray = xrAimRays[i];
    const reticle = xrAimReticles[i];
    xrAimHoverChat[i] = false;
    if (!visible || !controller.visible) {
      ray.visible = false;
      reticle.visible = false;
      continue;
    }

    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const uiHit = raycaster.intersectObjects(uiTargets)[0];
    xrAimHoverChat[i] = !!(uiHit && (uiHit.object.userData?.isTaxiChatPanel || uiHit.object.userData?.isTaxiChatScroll));
    const hitDistance = uiHit ? Math.max(0.08, Math.min(XR_AIM_RAY_LENGTH, uiHit.distance)) : XR_AIM_RAY_LENGTH;
    const activeColor = uiHit ? 0x7affa7 : 0x8ff7ff;

    ray.scale.z = hitDistance;
    ray.material.color.setHex(activeColor);
    ray.material.opacity = uiHit ? 0.92 : 0.62;
    ray.visible = true;

    if (uiHit) {
      reticle.position.copy(uiHit.point).addScaledVector(raycaster.ray.direction, -0.006);
      reticle.quaternion.copy(controller.getWorldQuaternion(new THREE.Quaternion()));
      reticle.material.color.setHex(activeColor);
      reticle.visible = true;
    } else {
      reticle.visible = false;
    }
  }
}

function updateXrButtonIcons(dt) {
  for (let i = 0; i < xrButtonIcons.length; i += 1) {
    const icon = xrButtonIcons[i];
    if (!icon.visible) continue;
    icon.rotation.y += dt * XR_ICON_SPIN * (i % 2 === 0 ? 1 : -1);
  }
  for (const item of xrIconHitTargets) {
    item.hitBox.visible = item.icon.visible;
    item.hitBox.position.copy(item.icon.position);
    item.hitBox.rotation.copy(item.icon.rotation);
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
const XR_HOME_LOCOMOTION = new THREE.Vector3(0.1, 0, 1.1);
const LOCO_SPEED = 4.0; // m/s

renderer.xr.addEventListener("sessionstart", () => {
  xrBaseRefSpace = renderer.xr.getReferenceSpace();
  locomotion.copy(XR_HOME_LOCOMOTION);
});

// Snap the player to the front-on lobby position where the whole XR button
// stack and its icons fit comfortably in view.
function resetToHome() {
  if (inTaxiAnalyticsRoom) {
    inTaxiAnalyticsRoom = false;
    taxiAnalyticsPreview2D = false;
    taxiReturnXrButton.visible = false;
    statusEl.textContent = "太陽系の部屋へ戻りました。";
  }
  locomotion.copy(XR_HOME_LOCOMOTION);
  applyXrLocomotionOffset();
}

function applyXrLocomotionOffset() {
  if (!xrBaseRefSpace) return;
  const offset = new XRRigidTransform({ x: -locomotion.x, y: -locomotion.y, z: -locomotion.z });
  renderer.xr.setReferenceSpace(xrBaseRefSpace.getOffsetReferenceSpace(offset));
}

function getViewerPose(out) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
  cam.getWorldPosition(out);
  cam.getWorldDirection(viewerForward);
  return cam;
}

function formatPoseNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function setPoseDebugPanelValues(values) {
  const nextTexture = makePoseDebugPanelTexture(values);
  const prevTexture = poseDebugPanelTexture;
  poseDebugPanelTexture = nextTexture;
  poseDebugXrPanel.material.map = poseDebugPanelTexture;
  poseDebugXrPanel.material.needsUpdate = true;
  prevTexture?.dispose?.();
}

function capturePoseDebugUrl() {
  initAudio();
  const cam = getViewerPose(viewerWorld);
  const pos = viewerWorld.clone();
  const forward = viewerForward.clone().normalize();
  const look = pos.clone().addScaledVector(forward, 80);
  const values = {
    camX: formatPoseNumber(pos.x),
    camY: formatPoseNumber(pos.y),
    camZ: formatPoseNumber(pos.z),
    lookX: formatPoseNumber(look.x),
    lookY: formatPoseNumber(look.y),
    lookZ: formatPoseNumber(look.z),
  };
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("cameraDebug", "1");
  url.searchParams.set("camX", values.camX);
  url.searchParams.set("camY", values.camY);
  url.searchParams.set("camZ", values.camZ);
  url.searchParams.set("lookX", values.lookX);
  url.searchParams.set("lookY", values.lookY);
  url.searchParams.set("lookZ", values.lookZ);
  const debugUrl = url.toString();

  setPoseDebugPanelValues(values);
  playPoseRecordSound();

  if (poseDebugOutputEl) {
    poseDebugOutputEl.hidden = false;
    poseDebugOutputEl.value = debugUrl;
    poseDebugOutputEl.focus?.();
    poseDebugOutputEl.select?.();
  }

  statusEl.textContent = "視線を記録しました。XR内の白いパネルに6つの数字を表示しています。";
  console.log("Pose debug values:", values, "Pose debug URL:", debugUrl, "cameraQuaternion:", cam.quaternion.toArray().map(formatPoseNumber).join(","));

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(debugUrl).catch(() => {
      /* Quest Browser may block clipboard writes; the HUD still shows the URL. */
    });
  }

  return debugUrl;
}

window.__questXrDebug = Object.assign(window.__questXrDebug || {}, {
  capturePoseDebugUrl,
});

function updatePoseDebugButton() {
  if (!poseDebugXrButton.visible || !renderer.xr.isPresenting) return;
  const cam = renderer.xr.getCamera(camera);
  cam.getWorldPosition(viewerWorld);
  cam.getWorldDirection(poseDebugButtonForward);
  poseDebugButtonRight.set(1, 0, 0).applyQuaternion(cam.quaternion).normalize();
  poseDebugButtonUp.set(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
  // Panel sits near eye level so all six numbers stay readable; the button is
  // parked well below it. The panel bottom is at up -0.20 and the button's hit
  // area top is at up -0.33, leaving a clear 0.13 gap that never overlaps.
  poseDebugXrButton.position
    .copy(viewerWorld)
    .addScaledVector(poseDebugButtonForward, 0.62)
    .addScaledVector(poseDebugButtonRight, -0.28)
    .addScaledVector(poseDebugButtonUp, -0.50);
  poseDebugXrHitArea.position.copy(poseDebugXrButton.position);
  poseDebugXrPanel.position
    .copy(viewerWorld)
    .addScaledVector(poseDebugButtonForward, 0.64)
    .addScaledVector(poseDebugButtonRight, -0.28)
    .addScaledVector(poseDebugButtonUp, 0.06);
  poseDebugXrButton.quaternion.copy(cam.quaternion);
  poseDebugXrHitArea.quaternion.copy(cam.quaternion);
  poseDebugXrPanel.quaternion.copy(cam.quaternion);
}

function isInputSourceHoveringTaxiChat(src) {
  for (let i = 0; i < xrAimControllers.length; i += 1) {
    if (xrAimHoverChat[i] && xrAimControllers[i].userData.inputSource === src) return true;
  }
  return false;
}

function updateLocomotion(dt) {
  const session = renderer.xr.getSession();
  if (!session || !xrBaseRefSpace) return;

  // Left thumbstick glides across the horizontal plane; the right thumbstick's
  // vertical axis lifts / lowers the player so you can rise up to any planet.
  let mx = 0;
  let mz = 0;
  let my = 0;
  let chatScroll = 0;
  for (const src of session.inputSources) {
    const ax = src.gamepad?.axes;
    if (!ax || ax.length < 2) continue;
    const x = ax.length >= 4 ? ax[2] : ax[0];
    const y = ax.length >= 4 ? ax[3] : ax[1];
    if (inTaxiAnalyticsRoom && isInputSourceHoveringTaxiChat(src)) {
      // Pointing at the chat panel: stick up = older messages, down = newer. No locomotion.
      if (Math.abs(y) > 0.15) chatScroll += -y;
      continue;
    }
    if (src.handedness === "right") {
      if (Math.abs(y) > 0.15) my += -y; // push stick up to rise
    } else {
      if (Math.abs(x) > 0.15) mx += x;
      if (Math.abs(y) > 0.15) mz += y;
    }
  }
  if (chatScroll !== 0) scrollTaxiChatPanel(chatScroll * TAXI_CHAT_STICK_SCROLL_PX_PER_S * dt);
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

  applyXrLocomotionOffset();
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

float wave(vec3 p,float scale,float speed,float phase){
  return sin(dot(p,vec3(scale,scale*.63,-scale*.41))+uTime*speed+phase);
}
void main(){
  vec3 n=normalize(vPosition);
  float t=uTime;

  // Quest向けに重い3Dノイズを避け、複数の低コストな波で表面流を作る。
  float flowA=wave(n,7.2,.18,0.0);
  float flowB=wave(n.yzx,13.0,-.12,1.9);
  float granule=wave(n.zxy,34.0,.26,3.4)*wave(n.xyz,23.0,-.21,0.7);
  vec2 warp=vec2(flowA*.010+flowB*.006,flowB*.009-granule*.004);

  vec3 tex=texture2D(uTex,vUv+warp).rgb;
  vec3 texFlow=texture2D(uTex,vUv-warp*.55+vec2(t*.0012,-t*.0007)).rgb;
  tex=mix(tex,texFlow,.34);

  float lum=dot(tex,vec3(0.299,0.587,0.114));
  float brightCells=smoothstep(.18,.92,granule*.5+.5);
  float moltenBand=smoothstep(.72,.98,abs(wave(n.xzy,11.0,.09,2.7)));
  float darkFilament=smoothstep(.76,.99,abs(wave(n.zyx,5.4,.05,4.1))*abs(wave(n,8.8,-.04,1.2)));

  vec3 ember=vec3(.92,.20,.015);
  vec3 orange=vec3(1.0,.46,.035);
  vec3 whiteHot=vec3(1.0,.86,.42);
  vec3 col=mix(ember,orange,clamp(lum*1.35+brightCells*.18,0.,1.));
  col+=tex*.72;
  col+=whiteHot*smoothstep(.48,.9,lum+brightCells*.18)*.62;
  col+=vec3(1.0,.34,.025)*moltenBand*.20;
  col-=vec3(.36,.11,.02)*darkFilament*.55;

  float rim=pow(1.-abs(dot(normalize(vNormal),vec3(0.,0.,1.))),2.4);
  col+=rim*vec3(1.0,.28,.025)*1.05;

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

const SUN_HEAT_HAZE_VERT = `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalDir;
void main(){
  vec4 worldPosition=modelMatrix*vec4(position,1.0);
  vWorldPosition=worldPosition.xyz;
  vWorldNormal=normalize(mat3(modelMatrix)*normal);
  vLocalDir=normalize(position);
  gl_Position=projectionMatrix*viewMatrix*worldPosition;
}`;

const SUN_HEAT_HAZE_FRAG = `
precision mediump float;
uniform float uTime;
uniform float uIntensity;
uniform float uEdgePower;
uniform float uWaveScale;
uniform float uVeil;
uniform vec3 uInnerColor;
uniform vec3 uOuterColor;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalDir;
float wave(vec3 p,float scale,float speed,float phase){
  return sin(dot(p,vec3(scale,scale*.58,-scale*.37))+uTime*speed+phase);
}
void main(){
  vec3 viewDir=normalize(cameraPosition-vWorldPosition);
  float facing=abs(dot(normalize(vWorldNormal),viewDir));
  float rim=pow(1.0-facing,uEdgePower);
  float broad=pow(1.0-facing,0.62);
  float plume=0.68+0.30*wave(vLocalDir,uWaveScale,.24,0.0)+0.18*wave(vLocalDir.yzx,uWaveScale*1.55,-.17,2.4);
  float tongues=smoothstep(.36,1.0,abs(wave(vLocalDir.zxy,uWaveScale*.72,.13,4.1)));
  float hotEdge=smoothstep(.18,.92,rim)*(0.92+tongues*.55);
  float alpha=uIntensity*(hotEdge+broad*uVeil)*clamp(plume,0.18,1.18);
  vec3 color=mix(uOuterColor,uInnerColor,smoothstep(.12,.96,tongues+rim*.36));
  gl_FragColor=vec4(color*(1.08+tongues*.68+rim*.5),alpha);
}`;

function makeSunHeatHazeMaterial({ intensity, edgePower, waveScale, veil, innerColor, outerColor }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uEdgePower: { value: edgePower },
      uWaveScale: { value: waveScale },
      uVeil: { value: veil },
      uInnerColor: { value: new THREE.Color(innerColor) },
      uOuterColor: { value: new THREE.Color(outerColor) },
    },
    vertexShader: SUN_HEAT_HAZE_VERT,
    fragmentShader: SUN_HEAT_HAZE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

const sunHeatHazeLayers = [
  { scale: 1.018, intensity: 0.055, edgePower: 1.2, waveScale: 10.2, veil: 0.008, innerColor: 0xffb13a, outerColor: 0xc61e00 },
  { scale: 1.046, intensity: 0.038, edgePower: 1.45, waveScale: 7.4, veil: 0.006, innerColor: 0xff7318, outerColor: 0xa90c00 },
].map((spec, index) => {
  const material = makeSunHeatHazeMaterial(spec);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS * spec.scale, 48, 32), material);
  mesh.renderOrder = 8 + index;
  sunMesh.add(mesh);
  return { mesh, material };
});

const SUN_HEAT_CORONA_VERT = `
varying vec2 vUv;
void main(){
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

const SUN_HEAT_CORONA_FRAG = `
precision mediump float;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p){
  return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);
}
float noise(vec2 p){
  vec2 i=floor(p);
  vec2 f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);
}
void main(){
  vec2 d=vUv-vec2(.5);
  float r=length(d);
  float a=atan(d.y,d.x);
  vec2 flowUv=d*5.4+vec2(uTime*.055,-uTime*.035);
  float flow=noise(flowUv)+noise(flowUv*2.15+vec2(-uTime*.13,uTime*.09))*.5;
  flow/=1.5;
  float turbulence=
    sin(a*8.0+uTime*.22)*.005+
    sin(a*15.0-uTime*.16)*.003+
    (flow-.5)*.016;
  float disk=.268+turbulence;
  float dist=max(0.0,r-disk);
  float innerFade=smoothstep(disk-.055,disk+.028,r);
  float outerFade=1.0-smoothstep(.455,.54,r);
  float softGlow=exp(-dist*4.9);
  float nearHeat=exp(-dist*13.0);
  float hotSkin=exp(-dist*23.0);
  float filament=.66+flow*.30+.045*sin(a*11.0+uTime*.19)+.028*sin(a*21.0-uTime*.13);
  float lick=smoothstep(.78,1.0,filament);
  float flameReach=smoothstep(.0,.10,dist)*(1.0-smoothstep(.11,.26,dist))*lick;
  float streaming=.80+.20*noise(d*8.5+vec2(-uTime*.10,uTime*.18));
  float alpha=innerFade*outerFade*(softGlow*.54+nearHeat*.68+hotSkin*.20+flameReach*.18)*streaming*(0.94+lick*.18);
  vec3 deep=vec3(.36,.0,.0);
  vec3 red=vec3(.94,.055,.0);
  vec3 orange=vec3(1.0,.25,.025);
  vec3 color=mix(orange,red,smoothstep(.025,.19,dist));
  color=mix(color,deep,smoothstep(.22,.40,dist));
  color+=orange*(nearHeat*.42+hotSkin*.20+flameReach*.22);
  if(alpha<.003) discard;
  gl_FragColor=vec4(color*(1.06+lick*.24+flow*.16),alpha*.88);
}`;

const sunHeatCoronaMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
  },
  vertexShader: SUN_HEAT_CORONA_VERT,
  fragmentShader: SUN_HEAT_CORONA_FRAG,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: true,
  side: THREE.DoubleSide,
  toneMapped: false,
});
const sunHeatCoronaMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sunHeatCoronaMaterial);
sunHeatCoronaMesh.renderOrder = 7;
sunHeatCoronaMesh.scale.setScalar(SUN_RADIUS * 3.78);
scene.add(sunHeatCoronaMesh);
const sunHeatCoronaWorld = new THREE.Vector3();

function updateSunHeatHaze(timeSeconds) {
  for (let i = 0; i < sunHeatHazeLayers.length; i += 1) {
    const layer = sunHeatHazeLayers[i];
    layer.material.uniforms.uTime.value = timeSeconds + i * 7.3;
  }
  const pulse = 1 + Math.sin(timeSeconds * 0.21) * 0.025 + Math.sin(timeSeconds * 0.047) * 0.018;
  sunMesh.getWorldPosition(sunHeatCoronaWorld);
  sunHeatCoronaMesh.position.copy(sunHeatCoronaWorld);
  sunHeatCoronaMesh.quaternion.copy(camera.quaternion);
  sunHeatCoronaMesh.scale.setScalar(SUN_RADIUS * 3.78 * pulse);
  sunHeatCoronaMaterial.uniforms.uTime.value = timeSeconds;
}

sun.position.copy(sunMesh.position);
sun.target.position.set(0, 0, 0);
scene.add(sun.target);

const sunLight = new THREE.PointLight(0xfff2e6, 2.4, 0, 0.0);
sunLight.position.copy(sunMesh.position);
scene.add(sunLight);

// Rare sunspots: dark, soft-edged patches that appear on the Sun's surface for
// a while and then fade out. They are an overlay bound to the rotating Sun.
const SOLAR_SPOT_FRAG = `
precision mediump float;
uniform vec4 uSpotA;
uniform vec4 uSpotB;
uniform float uSpotOpacity;
uniform float uTime;
varying vec3 vLocalDir;
float spotMask(vec3 dir, vec4 spot, float opacity, float seed){
  if(opacity<=0.001) return 0.0;
  vec3 center=normalize(spot.xyz);
  float radius=spot.w;
  float angular=acos(clamp(dot(normalize(dir),center),-1.0,1.0));
  float penumbra=1.0-smoothstep(radius*0.58,radius*1.22,angular);
  float umbra=1.0-smoothstep(radius*0.2,radius*0.52,angular);
  float mottled=0.72+0.28*sin((dir.x+seed)*46.0+uTime*0.35)*sin((dir.y-dir.z-seed)*53.0-uTime*0.22);
  return opacity*(penumbra*0.32+umbra*0.88)*mottled;
}
void main(){
  float mask=max(spotMask(vLocalDir,uSpotA,uSpotOpacity,0.17),spotMask(vLocalDir,uSpotB,uSpotOpacity*0.8,0.53));
  if(mask<0.01) discard;
  vec3 col=mix(vec3(0.12,0.018,0.0),vec3(0.0,0.0,0.0),smoothstep(0.34,0.82,mask));
  gl_FragColor=vec4(col,clamp(mask*1.05,0.0,0.96));
}`;

const solarSpotUniforms = {
  uSpotA: { value: new THREE.Vector4(0, 0, 1, 0.06) },
  uSpotB: { value: new THREE.Vector4(0, 0, 1, 0.035) },
  uSpotOpacity: { value: 0 },
  uTime: { value: 0 },
};
const solarSpotMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS * 1.004, 64, 48),
  new THREE.ShaderMaterial({
    uniforms: solarSpotUniforms,
    vertexShader: `
varying vec3 vLocalDir;
void main(){
  vLocalDir=normalize(position);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`,
    fragmentShader: SOLAR_SPOT_FRAG,
    transparent: true,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
  })
);
sunMesh.add(solarSpotMesh);
solarSpotMesh.visible = false;

let solarSpotActive = false;
let solarSpotT = 0;
let solarSpotDuration = 46;
let nextSolarSpotAt = DEBUG_SOLAR_SPOT_VIEW ? 0.5 : 70;
const solarSpotViewLocal = new THREE.Vector3();
const solarSpotAxisA = new THREE.Vector3();
const solarSpotAxisB = new THREE.Vector3();
const solarSpotDir = new THREE.Vector3();
const solarSpotTmp = new THREE.Vector3();
const solarSpotPole = new THREE.Vector3(0, 1, 0);

function scheduleNextSolarSpot() {
  nextSolarSpotAt = elapsed + 170 + Math.random() * 190;
}

function spawnSolarSpot() {
  sunMesh.updateWorldMatrix(true, false);
  camera.getWorldPosition(solarSpotViewLocal);
  sunMesh.worldToLocal(solarSpotViewLocal);
  solarSpotViewLocal.normalize();

  solarSpotAxisA.crossVectors(solarSpotViewLocal, solarSpotPole);
  if (solarSpotAxisA.lengthSq() < 1e-5) solarSpotAxisA.set(1, 0, 0);
  solarSpotAxisA.normalize();
  solarSpotAxisB.crossVectors(solarSpotViewLocal, solarSpotAxisA).normalize();
  const angle = Math.random() * Math.PI * 2;
  const offset = 0.12 + Math.random() * 0.34;
  solarSpotDir
    .copy(solarSpotViewLocal)
    .multiplyScalar(1 - offset * 0.36)
    .addScaledVector(solarSpotAxisA, Math.cos(angle) * offset)
    .addScaledVector(solarSpotAxisB, Math.sin(angle) * offset * 0.72)
    .normalize();

  const radius = 0.055 + Math.random() * 0.034;
  solarSpotUniforms.uSpotA.value.set(solarSpotDir.x, solarSpotDir.y, solarSpotDir.z, radius);

  solarSpotTmp.copy(solarSpotDir).addScaledVector(solarSpotAxisA, (Math.random() - 0.5) * 0.11).addScaledVector(
    solarSpotAxisB,
    (Math.random() - 0.5) * 0.08
  ).normalize();
  solarSpotUniforms.uSpotB.value.set(solarSpotTmp.x, solarSpotTmp.y, solarSpotTmp.z, radius * (0.45 + Math.random() * 0.25));

  solarSpotDuration = 38 + Math.random() * 24;
  solarSpotT = 0;
  solarSpotActive = true;
  solarSpotMesh.visible = true;
}

function updateSolarSpots(dt) {
  solarSpotUniforms.uTime.value = elapsed;
  if (!solarSpotActive) {
    if (elapsed >= nextSolarSpotAt) spawnSolarSpot();
    solarSpotMesh.visible = solarSpotActive;
    return;
  }

  solarSpotT += dt;
  const p = Math.min(1, solarSpotT / solarSpotDuration);
  const fade = THREE.MathUtils.smoothstep(p, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(p, 0.78, 1.0));
  solarSpotUniforms.uSpotOpacity.value = fade;
  solarSpotMesh.visible = fade > 0.006;
  if (p >= 1) {
    solarSpotActive = false;
    solarSpotUniforms.uSpotOpacity.value = 0;
    solarSpotMesh.visible = false;
    scheduleNextSolarSpot();
  }
}

// ---------------------------------------------------------------------------
// Solar prominences: occasional additive plasma arcs rising from the visible
// limb of the Sun. They stay tied to the Sun rather than flying toward Earth.
// ---------------------------------------------------------------------------
function makeSolarFootTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,232,150,0.9)");
  g.addColorStop(0.48, "rgba(255,92,16,0.35)");
  g.addColorStop(1.0, "rgba(255,60,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SOLAR_PROM_VERT = `
varying vec2 vUv;
void main() {
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const SOLAR_PROM_FRAG = `
precision mediump float;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uHot;
uniform vec3 uCool;
varying vec2 vUv;
void main(){
  float along=clamp(vUv.x,0.,1.);
  float taper=smoothstep(0.0,0.12,along)*(1.0-smoothstep(0.88,1.0,along));
  float strand=0.5+0.5*sin(along*38.0+uTime*3.1+sin(vUv.y*6.283)*2.2);
  float ripple=0.68+0.32*sin(along*11.0-uTime*1.7);
  float alpha=uOpacity*taper*(0.48+0.52*strand)*ripple;
  vec3 col=mix(uCool,uHot,smoothstep(0.18,0.9,strand));
  gl_FragColor=vec4(col*(1.05+strand*0.55),alpha);
}`;
const SOLAR_FLAME_RIBBON_FRAG = `
precision mediump float;
uniform float uTime;
uniform float uOpacity;
uniform float uSeed;
uniform vec3 uHot;
uniform vec3 uCool;
varying vec2 vUv;
float hash(vec2 p){
  return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);
}
float noise(vec2 p){
  vec2 i=floor(p);
  vec2 f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0.;
  float a=.5;
  for(int i=0;i<4;i++){
    v+=a*noise(p);
    p=p*2.03+vec2(7.1,3.7);
    a*=.5;
  }
  return v;
}
void main(){
  float along=clamp(vUv.x,0.,1.);
  float across=abs(vUv.y*2.0-1.0);
  float endFade=smoothstep(0.0,0.08,along)*(1.0-smoothstep(0.88,1.0,along));
  float edgeFade=1.0-smoothstep(0.50,1.02,across);
  float flow=fbm(vec2(along*5.2-uTime*.11+uSeed, vUv.y*2.4+uTime*.2));
  float filaments=fbm(vec2(along*21.0+uSeed*2.1, vUv.y*8.5-uTime*.48));
  float torn=edgeFade*(0.42+0.58*smoothstep(0.18,0.92,filaments));
  float holes=1.0-smoothstep(0.76,0.98,fbm(vec2(along*8.0+uSeed*.4, vUv.y*5.5-uTime*.16)));
  float body=0.34+0.66*smoothstep(0.2,0.86,flow+filaments*.32);
  float alpha=uOpacity*endFade*torn*(0.45+0.55*holes)*body;
  vec3 col=mix(uCool,uHot,smoothstep(0.2,0.86,flow+filaments*.35));
  col*=0.9+pow(max(0.0,1.0-across),2.0)*1.35;
  col.g*=0.64;
  col.b*=0.22;
  if(alpha<0.004) discard;
  gl_FragColor=vec4(col,alpha);
}`;

function makeSolarProminenceMaterial(opacityScale, hotColor, coolColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uHot: { value: new THREE.Color(hotColor) },
      uCool: { value: new THREE.Color(coolColor) },
    },
    vertexShader: SOLAR_PROM_VERT,
    fragmentShader: SOLAR_PROM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    userData: { opacityScale },
  });
}

function makeSolarFlameRibbonMaterial(opacityScale, hotColor, coolColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSeed: { value: Math.random() * 1000 },
      uHot: { value: new THREE.Color(hotColor) },
      uCool: { value: new THREE.Color(coolColor) },
    },
    vertexShader: SOLAR_PROM_VERT,
    fragmentShader: SOLAR_FLAME_RIBBON_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    userData: { opacityScale },
  });
}

const solarFootTex = makeSolarFootTexture();
const SOLAR_PROM_MAX_ACTIVE = 3;
const SOLAR_PROM_MIN_DURATION = 60;
const SOLAR_PROM_MAX_DURATION = 180;
const SOLAR_PROM_MAX_START_GAP = 30 * 60;
const SOLAR_PROM_FIRST_AT = DEBUG_SOLAR_PROM_VIEW ? 1 : 6;

function makeSolarFootMaterial() {
  return new THREE.SpriteMaterial({
    map: solarFootTex,
    color: 0xffb15a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function makeSolarProminenceSlot() {
  const group = new THREE.Group();
  group.visible = false;
  sunMesh.add(group);

  const coreMat = makeSolarProminenceMaterial(0.34, 0xfff8c8, 0xff5a0c);
  const glowMat = makeSolarProminenceMaterial(0.12, 0xffd36a, 0xff2500);
  const strandMat = makeSolarProminenceMaterial(0.18, 0xffc86e, 0xd91b00);
  const strandBMat = makeSolarProminenceMaterial(0.15, 0xffc86e, 0xd91b00);
  const sheetMat = makeSolarFlameRibbonMaterial(1.9, 0xff7a22, 0x8c0e00);
  const flameMat = makeSolarFlameRibbonMaterial(0.2, 0xffb24f, 0xd91b00);
  const flameBMat = makeSolarFlameRibbonMaterial(0.12, 0xff7a24, 0xa70f00);
  const sheet = new THREE.Mesh(new THREE.BufferGeometry(), sheetMat);
  const flame = new THREE.Mesh(new THREE.BufferGeometry(), flameMat);
  const flameB = new THREE.Mesh(new THREE.BufferGeometry(), flameBMat);
  const core = new THREE.Mesh(new THREE.BufferGeometry(), coreMat);
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
  const strandA = new THREE.Mesh(new THREE.BufferGeometry(), strandMat);
  const strandB = new THREE.Mesh(new THREE.BufferGeometry(), strandBMat);
  sheet.renderOrder = 12;
  flameB.renderOrder = 13;
  flame.renderOrder = 14;
  glow.renderOrder = 15;
  strandA.renderOrder = 16;
  strandB.renderOrder = 17;
  core.renderOrder = 18;
  group.add(sheet, flameB, flame, glow, strandA, strandB, core);

  const footA = new THREE.Sprite(makeSolarFootMaterial());
  const footB = new THREE.Sprite(makeSolarFootMaterial());
  const apexGlow = new THREE.Sprite(makeSolarFootMaterial());
  group.add(footA, footB, apexGlow);

  return {
    active: false,
    t: 0,
    duration: SOLAR_PROM_MIN_DURATION,
    group,
    core,
    glow,
    sheet,
    flame,
    flameB,
    strandA,
    strandB,
    materials: [coreMat, glowMat, strandMat, strandBMat, sheetMat, flameMat, flameBMat],
    footA,
    footB,
    apexGlow,
    footScale: new THREE.Vector3(),
    apexGlowBaseScale: SUN_RADIUS * 0.31,
    points: [],
    localSurfaceDir: new THREE.Vector3(),
    localImpactDir: new THREE.Vector3(),
    earthFacingFactor: 0,
    auroraDrive: 0,
  };
}

const solarProminenceSlots = Array.from({ length: SOLAR_PROM_MAX_ACTIVE }, makeSolarProminenceSlot);
let nextSolarProminenceAt = SOLAR_PROM_FIRST_AT;
const solarCameraLocal = new THREE.Vector3();
const solarViewDir = new THREE.Vector3();
const solarLimbDir = new THREE.Vector3();
const solarTangent = new THREE.Vector3();
const solarSide = new THREE.Vector3();
const solarDir = new THREE.Vector3();
const solarLimbAxisA = new THREE.Vector3();
const solarLimbAxisB = new THREE.Vector3();
const solarPromCandidateWorld = new THREE.Vector3();
const solarPromCandidateNdc = new THREE.Vector3();
const solarEarthLocal = new THREE.Vector3();

function getActiveSolarProminenceCount() {
  let count = 0;
  for (const slot of solarProminenceSlots) {
    if (slot.active) count += 1;
  }
  return count;
}

function scheduleNextSolarProminence(activeCount = getActiveSolarProminenceCount()) {
  let delay;
  if (activeCount > 0 && activeCount < SOLAR_PROM_MAX_ACTIVE && Math.random() < 0.58) {
    delay = 24 + Math.random() * 108;
  } else {
    delay = 180 + Math.random() * (SOLAR_PROM_MAX_START_GAP - 180);
  }
  nextSolarProminenceAt = elapsed + Math.min(delay, SOLAR_PROM_MAX_START_GAP);
}

function rotateAroundAxis(vec, axis, angle) {
  return vec.applyAxisAngle(axis, angle).normalize();
}

function randomSolarProminenceScale() {
  if (DEBUG_SOLAR_PROM_VIEW) return 1.42;
  const r = Math.random();
  if (r < 0.24) return 0.56 + Math.random() * 0.18;
  if (r > 0.76) return 1.34 + Math.random() * 0.2;
  return 0.82 + Math.random() * 0.42;
}

function randomSolarProminenceThickness() {
  if (DEBUG_SOLAR_PROM_VIEW) return 1.34;
  const r = Math.random();
  if (r < 0.18) return 0.76 + Math.random() * 0.16;
  if (r > 0.78) return 1.24 + Math.random() * 0.24;
  return 0.94 + Math.random() * 0.28;
}

function getSolarProminenceEarthFacingFactor(localSurfaceDir) {
  sunMesh.updateWorldMatrix(true, false);
  solarEarthLocal.copy(ballGroup.position);
  sunMesh.worldToLocal(solarEarthLocal);
  solarEarthLocal.normalize();

  // Aurora is driven by solar-wind/CME impact on Earth. Far-side events should
  // not energize Earth's aurora in this compressed visual model.
  const earthward = localSurfaceDir.dot(solarEarthLocal);
  return THREE.MathUtils.smoothstep(earthward, -0.22, 0.52);
}

function makeSolarFlameRibbonGeometry(points, side, tangent, widthBase, seed, widthMul = 1, tangentMul = 1) {
  const crossSegments = 5;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = i / (points.length - 1);
    const rise = Math.sin(p * Math.PI);
    const endFade = THREE.MathUtils.smoothstep(p, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(p, 0.84, 1));
    const baseWidth = widthBase * widthMul * (0.34 + rise * 1.25) * (0.42 + endFade * 0.72);
    for (let j = 0; j < crossSegments; j += 1) {
      const v = j / (crossSegments - 1);
      const offset = (v - 0.5) * 2;
      const ragged =
        Math.sin(p * 19 + seed * 3.1 + offset * 2.4) * 0.22 +
        Math.sin(p * 43 - seed * 1.7 + offset * 5.1) * 0.1;
      const width = baseWidth * (1 + ragged * rise);
      const flutter =
        SUN_RADIUS *
        (Math.sin(p * 31 + seed * 4.2 + offset * 2.6) * 0.006 + Math.sin(p * 13 - seed * 2.8) * 0.004) *
        rise *
        tangentMul;
      const pos = points[i]
        .clone()
        .addScaledVector(side, offset * width)
        .addScaledVector(tangent, flutter);
      positions.push(pos.x, pos.y, pos.z);
      uvs.push(p, v);
    }
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = 0; j < crossSegments - 1; j += 1) {
      const a = i * crossSegments + j;
      const b = a + 1;
      const c = a + crossSegments;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function makeSolarFlameSheetGeometry(limbDir, tangent, viewDir, width, height, seed) {
  const xSegments = 34;
  const ySegments = 14;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= xSegments; i += 1) {
    const u = i / xSegments;
    const bulge = Math.pow(Math.sin(u * Math.PI), 0.55);
    const plumeHeight = height * (0.18 + bulge * 0.9) * (1 - u * 0.18);
    const centerShift =
      height *
      (Math.sin(u * Math.PI * 2.1 + seed) * 0.12 + Math.sin(u * Math.PI * 5.2 - seed * 0.4) * 0.045) *
      bulge;
    const radialLift = width * (u * 0.94 + Math.sin(u * Math.PI) * 0.16);
    for (let j = 0; j <= ySegments; j += 1) {
      const v = j / ySegments;
      const y = (v - 0.5) * 2;
      const ragged =
        Math.sin(u * 18 + y * 4.1 + seed) * 0.035 +
        Math.sin(u * 39 - y * 6.7 + seed * 0.31) * 0.018;
      const pos = limbDir
        .clone()
        .multiplyScalar(SUN_RADIUS * 1.012 + radialLift)
        .addScaledVector(tangent, centerShift + y * plumeHeight * (1 + ragged))
        .addScaledVector(viewDir, SUN_RADIUS * (0.026 + 0.012 * bulge));
      positions.push(pos.x, pos.y, pos.z);
      uvs.push(u, v);
    }
  }

  const row = ySegments + 1;
  for (let i = 0; i < xSegments; i += 1) {
    for (let j = 0; j < ySegments; j += 1) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function setRandomVisibleSolarLimbDir() {
  let bestAngle = Math.random() * Math.PI * 2;
  if (DEBUG_SOLAR_PROM_VIEW) {
    bestAngle = 0.12;
  } else {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      solarLimbDir
        .copy(solarLimbAxisA)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(solarLimbAxisB, Math.sin(angle))
        .normalize();
      solarPromCandidateWorld.copy(solarLimbDir).multiplyScalar(SUN_RADIUS * 1.18);
      sunMesh.localToWorld(solarPromCandidateWorld);
      solarPromCandidateNdc.copy(solarPromCandidateWorld).project(camera);
      const outsideHud = solarPromCandidateNdc.x > -0.44 || solarPromCandidateNdc.y < 0.56;
      if (
        outsideHud &&
        solarPromCandidateNdc.x > -0.96 &&
        solarPromCandidateNdc.x < 0.96 &&
        solarPromCandidateNdc.y > -0.94 &&
        solarPromCandidateNdc.y < 0.94
      ) {
        bestAngle = angle;
        break;
      }
    }
  }
  solarLimbDir
    .copy(solarLimbAxisA)
    .multiplyScalar(Math.cos(bestAngle))
    .addScaledVector(solarLimbAxisB, Math.sin(bestAngle))
    .normalize();
}

function spawnSolarProminence() {
  const slot = solarProminenceSlots.find((item) => !item.active);
  if (!slot) return false;

  sunMesh.updateWorldMatrix(true, false);
  camera.getWorldPosition(solarCameraLocal);
  sunMesh.worldToLocal(solarCameraLocal);
  solarViewDir.copy(solarCameraLocal).normalize();

  solarLimbAxisA.crossVectors(solarViewDir, _yUp);
  if (solarLimbAxisA.lengthSq() < 1e-5) solarLimbAxisA.set(1, 0, 0);
  solarLimbAxisA.normalize();
  solarLimbAxisB.crossVectors(solarViewDir, solarLimbAxisA).normalize();
  setRandomVisibleSolarLimbDir();
  solarDir.copy(solarLimbDir).addScaledVector(solarViewDir, 0.04).normalize();
  slot.localSurfaceDir.copy(solarLimbDir);
  slot.localImpactDir.copy(solarDir);
  slot.earthFacingFactor = getSolarProminenceEarthFacingFactor(solarLimbDir);

  solarTangent.crossVectors(solarViewDir, solarDir);
  if (solarTangent.lengthSq() < 1e-5) solarTangent.crossVectors(_yUp, solarDir);
  solarTangent.normalize();
  solarSide.crossVectors(solarDir, solarTangent).normalize();

  const sizeScale = randomSolarProminenceScale();
  const thicknessScale = randomSolarProminenceThickness();
  const flameSeed = Math.random() * 1000;
  const sizeT = THREE.MathUtils.clamp((sizeScale - 0.56) / 0.98, 0, 1);
  const thicknessT = THREE.MathUtils.clamp((thicknessScale - 0.76) / 0.72, 0, 1);
  const halfAngle = THREE.MathUtils.degToRad(7 + Math.random() * 8.0) * THREE.MathUtils.lerp(0.62, 1.72, sizeT);
  const lift = THREE.MathUtils.lerp(0.11, 0.6, sizeT) + Math.random() * THREE.MathUtils.lerp(0.035, 0.09, sizeT);
  const twist = (Math.random() - 0.5) * SUN_RADIUS * THREE.MathUtils.lerp(0.045, 0.14, sizeT);
  const filamentScale = THREE.MathUtils.lerp(0.58, 1.48, sizeT) * THREE.MathUtils.lerp(0.9, 1.08, thicknessT);
  slot.points.length = 0;
  for (let i = 0; i <= 24; i += 1) {
    const p = i / 24;
    const a = THREE.MathUtils.lerp(-halfAngle, halfAngle, p);
    const rise = Math.sin(p * Math.PI);
    const plumeLift =
      rise *
      (1 +
        Math.sin(p * Math.PI * 3.0 + flameSeed) * 0.16 +
        Math.sin(p * Math.PI * 7.0 - flameSeed * 0.31) * 0.07);
    const raggedSide =
      SUN_RADIUS *
      rise *
      (Math.sin(p * Math.PI * 5.0 + flameSeed * 0.5) * 0.018 + Math.sin(p * Math.PI * 11.0 + flameSeed) * 0.009) *
      (0.75 + sizeT);
    solarDir
      .copy(solarLimbDir)
      .multiplyScalar(Math.cos(a))
      .addScaledVector(solarTangent, Math.sin(a))
      .addScaledVector(solarViewDir, 0.04)
      .normalize();
    const wave = Math.sin(p * Math.PI * 2.0) * twist * rise;
    slot.points.push(
      solarDir
        .clone()
        .multiplyScalar(SUN_RADIUS * (1.01 + lift * plumeLift))
        .addScaledVector(solarSide, wave)
        .addScaledVector(solarTangent, raggedSide)
        .addScaledVector(solarViewDir, SUN_RADIUS * 0.018 * (0.25 + rise))
    );
  }
  slot.localImpactDir.copy(slot.points[Math.floor(slot.points.length / 2)]).normalize();

  const strandPointsA = slot.points.map((point, index) => {
    const p = index / (slot.points.length - 1);
    const rise = Math.sin(p * Math.PI);
    return point
      .clone()
      .addScaledVector(solarSide, SUN_RADIUS * (0.02 + rise * 0.05) * filamentScale)
      .addScaledVector(solarTangent, SUN_RADIUS * Math.sin(p * Math.PI * 2.0) * 0.015 * filamentScale);
  });
  const strandPointsB = slot.points.map((point, index) => {
    const p = index / (slot.points.length - 1);
    const rise = Math.sin(p * Math.PI);
    return point
      .clone()
      .addScaledVector(solarSide, -SUN_RADIUS * (0.014 + rise * 0.036) * filamentScale)
      .addScaledVector(solarTangent, SUN_RADIUS * Math.sin(p * Math.PI * 1.5 + 0.7) * 0.012 * filamentScale);
  });

  const curve = new THREE.CatmullRomCurve3(slot.points);
  const strandCurveA = new THREE.CatmullRomCurve3(strandPointsA);
  const strandCurveB = new THREE.CatmullRomCurve3(strandPointsB);
  const tubeScale = THREE.MathUtils.lerp(0.58, 1.52, sizeT) * thicknessScale;
  const coreGeo = new THREE.TubeGeometry(curve, 96, SUN_RADIUS * 0.0046 * tubeScale, 10, false);
  const glowGeo = new THREE.TubeGeometry(curve, 96, SUN_RADIUS * 0.015 * tubeScale, 12, false);
  const strandGeoA = new THREE.TubeGeometry(strandCurveA, 80, SUN_RADIUS * 0.0036 * tubeScale, 8, false);
  const strandGeoB = new THREE.TubeGeometry(strandCurveB, 80, SUN_RADIUS * 0.0029 * tubeScale, 8, false);
  const flameGeo = makeSolarFlameRibbonGeometry(
    slot.points,
    solarSide,
    solarTangent,
    SUN_RADIUS * THREE.MathUtils.lerp(0.045, 0.13, sizeT) * thicknessScale,
    flameSeed,
    1.0,
    1.0
  );
  const flameBGeo = makeSolarFlameRibbonGeometry(
    slot.points,
    solarSide,
    solarTangent,
    SUN_RADIUS * THREE.MathUtils.lerp(0.032, 0.098, sizeT) * thicknessScale,
    flameSeed + 17.3,
    0.74,
    1.35
  );
  const sheetGeo = makeSolarFlameSheetGeometry(
    solarLimbDir,
    solarTangent,
    solarViewDir,
    SUN_RADIUS * THREE.MathUtils.lerp(0.42, 0.86, sizeT),
    SUN_RADIUS * THREE.MathUtils.lerp(0.22, 0.42, sizeT) * thicknessScale,
    flameSeed + 33.7
  );
  slot.core.geometry.dispose();
  slot.glow.geometry.dispose();
  slot.sheet.geometry.dispose();
  slot.flame.geometry.dispose();
  slot.flameB.geometry.dispose();
  slot.strandA.geometry.dispose();
  slot.strandB.geometry.dispose();
  slot.core.geometry = coreGeo;
  slot.glow.geometry = glowGeo;
  slot.sheet.geometry = sheetGeo;
  slot.flame.geometry = flameGeo;
  slot.flameB.geometry = flameBGeo;
  slot.strandA.geometry = strandGeoA;
  slot.strandB.geometry = strandGeoB;
  slot.sheet.material.uniforms.uSeed.value = flameSeed + 33.7;
  slot.flame.material.uniforms.uSeed.value = flameSeed;
  slot.flameB.material.uniforms.uSeed.value = flameSeed + 17.3;

  slot.footScale.setScalar(SUN_RADIUS * THREE.MathUtils.lerp(0.13, 0.27, sizeT));
  slot.apexGlowBaseScale = SUN_RADIUS * THREE.MathUtils.lerp(0.18, 0.42, sizeT);
  slot.footA.position.copy(slot.points[0]).normalize().multiplyScalar(SUN_RADIUS * 1.014);
  slot.footB.position.copy(slot.points[slot.points.length - 1]).normalize().multiplyScalar(SUN_RADIUS * 1.014);
  slot.apexGlow.position.copy(slot.points[Math.floor(slot.points.length / 2)]);
  slot.footA.scale.copy(slot.footScale);
  slot.footB.scale.copy(slot.footScale);
  slot.apexGlow.scale.setScalar(slot.apexGlowBaseScale);

  slot.duration = SOLAR_PROM_MIN_DURATION + Math.random() * (SOLAR_PROM_MAX_DURATION - SOLAR_PROM_MIN_DURATION);
  slot.t = 0;
  slot.group.visible = true;
  slot.active = true;
  return true;
}

function updateSolarProminence(dt) {
  const activeBeforeSpawn = getActiveSolarProminenceCount();
  if (elapsed >= nextSolarProminenceAt) {
    if (activeBeforeSpawn < SOLAR_PROM_MAX_ACTIVE) {
      spawnSolarProminence();
    }
    scheduleNextSolarProminence(getActiveSolarProminenceCount());
  }

  let strongestAuroraDrive = 0;
  for (const slot of solarProminenceSlots) {
    if (!slot.active) continue;

    slot.t += dt;
    slot.earthFacingFactor = Math.max(
      getSolarProminenceEarthFacingFactor(slot.localSurfaceDir),
      getSolarProminenceEarthFacingFactor(slot.localImpactDir)
    );
    const fadeIn = THREE.MathUtils.smoothstep(slot.t, 0, 9);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(slot.t, Math.max(12, slot.duration - 18), slot.duration);
    const fade = fadeIn * fadeOut;
    const pulse = 0.86 + Math.sin(elapsed * 1.1 + slot.duration * 0.13) * 0.06 + Math.sin(elapsed * 2.3) * 0.035;
    const opacity = Math.max(0, fade * pulse);
    const activeLife = THREE.MathUtils.smoothstep(slot.t, 0, 2) *
      (1 - THREE.MathUtils.smoothstep(slot.t, Math.max(8, slot.duration - 6), slot.duration));
    const earthFacingActivation = THREE.MathUtils.smoothstep(slot.earthFacingFactor, 0.16, 0.40);
    const visibleDrive = opacity * slot.earthFacingFactor;
    const guaranteedDrive = activeLife * earthFacingActivation * 0.38;
    slot.auroraDrive = Math.max(visibleDrive, guaranteedDrive);
    strongestAuroraDrive = Math.max(strongestAuroraDrive, slot.auroraDrive);

    for (const mat of slot.materials) {
      mat.uniforms.uTime.value = elapsed;
      mat.uniforms.uOpacity.value = opacity * mat.userData.opacityScale;
    }
    slot.footA.material.opacity = opacity * 0.62;
    slot.footB.material.opacity = opacity * 0.48;
    slot.apexGlow.material.opacity = opacity * 0.22;
    const breathing = 1 + Math.sin(elapsed * 1.35 + slot.duration * 0.07) * 0.035;
    slot.footA.scale.copy(slot.footScale).multiplyScalar(breathing);
    slot.footB.scale.copy(slot.footScale).multiplyScalar(0.92 + (breathing - 1) * 0.8);
    slot.apexGlow.scale.setScalar(slot.apexGlowBaseScale * (0.96 + breathing * 0.04));

    if (slot.t >= slot.duration) {
      slot.active = false;
      slot.group.visible = false;
      slot.earthFacingFactor = 0;
      slot.auroraDrive = 0;
      for (const mat of slot.materials) {
        mat.uniforms.uOpacity.value = 0;
      }
      slot.footA.material.opacity = 0;
      slot.footB.material.opacity = 0;
      slot.apexGlow.material.opacity = 0;
    }
  }

  auroraFlareTarget = THREE.MathUtils.clamp(strongestAuroraDrive * 1.18, 0, 1);
}

function getSolarProminenceDebugState() {
  return {
    activeCount: getActiveSolarProminenceCount(),
    nextIn: Math.max(0, nextSolarProminenceAt - elapsed),
    maxActive: SOLAR_PROM_MAX_ACTIVE,
    minDuration: SOLAR_PROM_MIN_DURATION,
    maxDuration: SOLAR_PROM_MAX_DURATION,
    maxStartGap: SOLAR_PROM_MAX_START_GAP,
    slots: solarProminenceSlots.map((slot) => ({
      active: slot.active,
      t: slot.t,
      duration: slot.duration,
      remaining: Math.max(0, slot.duration - slot.t),
      earthFacingFactor: slot.earthFacingFactor,
      auroraDrive: slot.auroraDrive,
    })),
  };
}

window.__questXrDebug = Object.assign(window.__questXrDebug || {}, {
  getSolarProminenceState: getSolarProminenceDebugState,
  forceSolarProminence: () => {
    const spawned = spawnSolarProminence();
    if (spawned) scheduleNextSolarProminence(getActiveSolarProminenceCount());
    return { spawned, ...getSolarProminenceDebugState() };
  },
});

const planetSunWorld = new THREE.Vector3();
const planetSunLocal = new THREE.Vector3();

function makeSunlitPlanetMaterial(file, options = {}) {
  const sunDir = new THREE.Vector3(1, 0, 0);
  const tintDay = new THREE.Color(options.tintDay || 0xffffff);
  const tintNight = new THREE.Color(options.tintNight || 0x555c66);
  return {
    sunDir,
    material: new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: loadTex(file) },
        uSunDir: { value: sunDir },
        uTexel: { value: new THREE.Vector2(1 / (options.texWidth || 2048), 1 / (options.texHeight || 1024)) },
        uNight: { value: options.night ?? 0.18 },
        uDay: { value: options.day ?? 0.7 },
        uDirect: { value: options.direct ?? 0.5 },
        uRelief: { value: options.relief ?? 1.8 },
        uSoftness: { value: options.softness ?? 0.18 },
        uTintDay: { value: tintDay },
        uTintNight: { value: tintNight },
      },
      vertexShader: `
varying vec2 vUv;
varying vec3 vNormal;
void main(){
  vUv=uv;
  vNormal=normalize(normal);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`,
      fragmentShader: `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uSunDir;
uniform vec2 uTexel;
uniform float uNight;
uniform float uDay;
uniform float uDirect;
uniform float uRelief;
uniform float uSoftness;
uniform vec3 uTintDay;
uniform vec3 uTintNight;
varying vec2 vUv;
varying vec3 vNormal;
float luma(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
void main(){
  vec3 tex=texture2D(uTex,vUv).rgb;
  float center=luma(tex);
  float blur=0.0;
  blur+=luma(texture2D(uTex,vUv+vec2(uTexel.x,0.0)).rgb);
  blur+=luma(texture2D(uTex,vUv-vec2(uTexel.x,0.0)).rgb);
  blur+=luma(texture2D(uTex,vUv+vec2(0.0,uTexel.y)).rgb);
  blur+=luma(texture2D(uTex,vUv-vec2(0.0,uTexel.y)).rgb);
  blur*=0.25;
  float dark=clamp((blur-center)*uRelief,0.0,0.28);
  float bright=clamp((center-blur)*uRelief*0.36,0.0,0.12);
  float relief=clamp(1.0-dark+bright,0.72,1.18);

  float lit=dot(normalize(vNormal),normalize(uSunDir));
  float day=smoothstep(-uSoftness,uSoftness,lit);
  float direct=pow(max(lit,0.0),0.85);
  float light=mix(uNight,uDay+uDirect*direct,day);
  vec3 tint=mix(uTintNight,uTintDay,day);
  gl_FragColor=vec4(tex*relief*light*tint,1.0);
}`,
    }),
  };
}

const SATURN_R = EARTH_RADIUS * 15;
const saturnGroup = new THREE.Group();
saturnGroup.position.set(45, -9, -35);
saturnGroup.rotation.z = THREE.MathUtils.degToRad(26.7); // axial tilt
scene.add(saturnGroup);
const saturnLighting = makeSunlitPlanetMaterial("2k_saturn.jpg", {
  texWidth: 2048,
  texHeight: 1024,
  night: 0.2,
  day: 0.74,
  direct: 0.42,
  relief: 1.1,
  softness: 0.2,
  tintDay: 0xfff1d8,
  tintNight: 0x5a5046,
});
const saturnBall = new THREE.Mesh(
  new THREE.SphereGeometry(SATURN_R, 64, 48),
  saturnLighting.material
);
saturnGroup.add(saturnBall);
const saturnRingLightingUniforms = {
  uSunDirWorld: { value: new THREE.Vector3(1, 0, 0) },
  uSaturnCenterWorld: { value: new THREE.Vector3() },
  uSaturnRadius: { value: SATURN_R },
};

function makeSaturnRingBandTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4096;
  canvas.height = 4;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x += 1) {
    const t = x / (canvas.width - 1);
    const innerFade = THREE.MathUtils.smoothstep(t, 0.0, 0.035);
    const outerFade = 1 - THREE.MathUtils.smoothstep(t, 0.93, 1.0);
    const cRing = Math.exp(-Math.pow((t - 0.08) / 0.07, 2)) * 0.34;
    const bRing = Math.exp(-Math.pow((t - 0.34) / 0.23, 2)) * 1.0;
    const aRing = Math.exp(-Math.pow((t - 0.74) / 0.24, 2)) * 0.78;
    const cassiniGap = 1 - Math.exp(-Math.pow((t - 0.61) / 0.026, 2)) * 0.96;
    const enckeGap = 1 - Math.exp(-Math.pow((t - 0.84) / 0.008, 2)) * 0.62;
    const fineBands = 0.92 + 0.055 * Math.sin(t * 180.0) + 0.03 * Math.sin(t * 430.0);
    const density = THREE.MathUtils.clamp((cRing + bRing + aRing) * innerFade * outerFade * cassiniGap * enckeGap * fineBands, 0, 1);
    const warm = 0.76 + 0.16 * Math.sin(t * 11.0) + 0.06 * Math.sin(t * 47.0);
    for (let y = 0; y < canvas.height; y += 1) {
      const i = (y * canvas.width + x) * 4;
      img.data[i + 0] = Math.round(170 + 56 * warm);
      img.data[i + 1] = Math.round(154 + 48 * warm);
      img.data[i + 2] = Math.round(122 + 38 * warm);
      img.data[i + 3] = Math.round(THREE.MathUtils.clamp(density * 242, 0, 242));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const SATURN_RING_SHADE_GLSL = `
float ringLight(vec3 worldPos){
  vec3 rel=worldPos-uSaturnCenterWorld;
  vec3 radial=normalize(rel);
  float day=smoothstep(-0.32,0.68,dot(radial,normalize(uSunDirWorld)));
  return mix(0.28,1.0,day);
}
float saturnBodyShadow(vec3 worldPos){
  vec3 rel=worldPos-uSaturnCenterWorld;
  float along=dot(rel,normalize(uSunDirWorld));
  float behind=smoothstep(0.10*uSaturnRadius,-0.08*uSaturnRadius,along);
  vec3 axis=normalize(uSunDirWorld)*along;
  float dist=length(rel-axis);
  float blocked=1.0-smoothstep(uSaturnRadius*0.88,uSaturnRadius*1.08,dist);
  return behind*blocked;
}`;

function makeSaturnRingBandMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: texture },
      ...saturnRingLightingUniforms,
    },
    vertexShader: `
varying vec2 vUv;
varying vec3 vWorldPos;
void main(){
  vUv=uv;
  vec4 worldPos=modelMatrix*vec4(position,1.0);
  vWorldPos=worldPos.xyz;
  gl_Position=projectionMatrix*viewMatrix*worldPos;
}`,
    fragmentShader: `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uSunDirWorld;
uniform vec3 uSaturnCenterWorld;
uniform float uSaturnRadius;
varying vec2 vUv;
varying vec3 vWorldPos;
${SATURN_RING_SHADE_GLSL}
void main(){
  vec4 tex=texture2D(uTex,vUv);
  if(tex.a<0.012) discard;
  float radial=clamp(vUv.x,0.0,1.0);
  float band=0.94+0.06*sin(radial*120.0)+0.035*sin(radial*310.0);
  float light=ringLight(vWorldPos);
  float shadow=saturnBodyShadow(vWorldPos);
  vec3 base=mix(vec3(0.64,0.58,0.44),vec3(0.96,0.88,0.66),max(max(tex.r,tex.g),tex.b));
  vec3 color=base*band*(0.46+0.76*light)*mix(1.0,0.18,shadow);
  float alpha=clamp(tex.a*1.52*(0.74+0.26*light)*mix(1.0,0.48,shadow),0.0,0.96);
  gl_FragColor=vec4(color,alpha);
}`,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

const saturnRingInner = SATURN_R * 1.2;
const saturnRingOuter = SATURN_R * 2.3;
const ringGeo = new THREE.RingGeometry(saturnRingInner, saturnRingOuter, 256, 3);
const rpos = ringGeo.attributes.position;
const ruv = ringGeo.attributes.uv;
const rvec = new THREE.Vector3();
for (let i = 0; i < rpos.count; i += 1) {
  rvec.fromBufferAttribute(rpos, i);
  const u = (rvec.length() - saturnRingInner) / (saturnRingOuter - saturnRingInner);
  const v = 1.0;
  ruv.setXY(i, u, v);
}
const saturnRing = new THREE.Mesh(
  ringGeo,
  makeSaturnRingBandMaterial(makeSaturnRingBandTexture())
);
saturnRing.rotation.x = -Math.PI / 2; // lay flat in the equatorial plane
saturnRing.renderOrder = 2;
saturnGroup.add(saturnRing);

// ---------------------------------------------------------------------------
// Other planets, scattered well outside the room so they read as distant
// worlds. Each is a textured sphere on a tilted spin axis; `spin` is the
// per-second rotation applied in the animation loop.
// ---------------------------------------------------------------------------
const planets = [];
const planetMoonSystems = [];

function addPlanet(file, radius, position, tiltDeg, spin, options = {}) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.z = THREE.MathUtils.degToRad(tiltDeg);
  const lit = options.sunlit ? makeSunlitPlanetMaterial(file, options) : null;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    lit
      ? lit.material
      : new THREE.MeshStandardMaterial({ map: loadTex(file), roughness: 0.95, metalness: 0.0 })
  );
  group.add(mesh);
  scene.add(group);
  planets.push({ mesh, radius, spin, sunDir: lit && lit.sunDir });
  return mesh;
}

function makePlanetMoonOrbit(radius, color, opacity) {
  const points = [];
  const segments = 96;
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    })
  );
}

function addPlanetMoonSystem(parent, specs, options = {}) {
  const system = new THREE.Group();
  system.rotation.x = THREE.MathUtils.degToRad(options.inclinationDeg ?? 0);
  parent.add(system);
  const moons = [];

  for (const spec of specs) {
    const orbit = new THREE.Group();
    orbit.rotation.y = spec.phase ?? 0;
    orbit.rotation.z = THREE.MathUtils.degToRad(spec.tiltDeg ?? 0);

    const orbitLine = makePlanetMoonOrbit(
      spec.orbitRadius,
      spec.orbitColor ?? 0x9fb8c9,
      spec.orbitOpacity ?? 0.13
    );
    orbitLine.renderOrder = 1;
    orbit.add(orbitLine);

    const moonLighting = spec.texture
      ? makeSunlitPlanetMaterial(spec.texture, {
          texWidth: 1024,
          texHeight: 512,
          night: spec.night ?? 0.20,
          day: spec.day ?? 0.70,
          direct: spec.direct ?? 0.42,
          relief: spec.relief ?? 1.25,
          softness: spec.softness ?? 0.20,
          tintDay: spec.tintDay ?? 0xffffff,
          tintNight: spec.tintNight ?? 0x4b5260,
        })
      : null;
    const moonGroup = new THREE.Group();
    moonGroup.position.set(spec.orbitRadius, 0, 0);

    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(spec.radius, 18, 12),
      moonLighting
        ? moonLighting.material
        : new THREE.MeshStandardMaterial({
            color: spec.color,
            roughness: spec.roughness ?? 0.94,
            metalness: 0,
            emissive: new THREE.Color(spec.emissive ?? spec.color ?? 0xffffff).multiplyScalar(spec.emissiveScale ?? 0.035),
          })
    );
    moonGroup.add(moonMesh);

    if (spec.atmosphereColor) {
      const haze = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius * (spec.atmosphereScale ?? 1.16), 18, 12),
        new THREE.MeshBasicMaterial({
          color: spec.atmosphereColor,
          transparent: true,
          opacity: spec.atmosphereOpacity ?? 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      moonGroup.add(haze);
    }

    orbit.add(moonGroup);
    system.add(orbit);
    moons.push({ orbit, mesh: moonMesh, speed: spec.speed, spin: spec.spin ?? spec.speed * 0.35, sunDir: moonLighting && moonLighting.sunDir });
  }

  planetMoonSystems.push({ system, moons });
  return system;
}

function updatePlanetMoonSystems(dt) {
  sunMesh.getWorldPosition(planetSunWorld);
  for (const moonSystem of planetMoonSystems) {
    for (const moon of moonSystem.moons) {
      moon.orbit.rotation.y += dt * moon.speed;
      moon.mesh.rotation.y += dt * moon.spin;
      if (moon.sunDir) {
        moon.mesh.updateWorldMatrix(true, false);
        planetSunLocal.copy(planetSunWorld);
        moon.mesh.worldToLocal(planetSunLocal);
        planetSunLocal.normalize();
        moon.sunDir.copy(planetSunLocal);
      }
    }
  }
}

addPlanetMoonSystem(
  saturnGroup,
  [
    {
      orbitRadius: SATURN_R * 2.75,
      radius: EARTH_RADIUS * 0.18,
      color: 0xd8c09a,
      texture: "moon_titan_1024.jpg",
      speed: 0.045,
      phase: 0.2,
      orbitOpacity: 0.026,
      emissiveScale: 0.02,
      atmosphereColor: 0xffa34c,
      atmosphereOpacity: 0.12,
      atmosphereScale: 1.18,
    }, // Titan
    { orbitRadius: SATURN_R * 2.38, radius: EARTH_RADIUS * 0.095, color: 0xbfc6c8, texture: "moon_rhea_1024.jpg", speed: -0.062, phase: 1.7, orbitOpacity: 0.022 }, // Rhea
    { orbitRadius: SATURN_R * 2.08, radius: EARTH_RADIUS * 0.078, color: 0xcfd7d9, texture: "moon_dione_1024.jpg", speed: 0.078, phase: 3.5, orbitOpacity: 0.020 }, // Dione
    { orbitRadius: SATURN_R * 1.82, radius: EARTH_RADIUS * 0.068, color: 0xdde5e5, texture: "moon_enceladus_1024.jpg", speed: -0.093, phase: 4.8, orbitOpacity: 0.018 }, // Enceladus
  ],
  { inclinationDeg: 5.2 }
);

function updatePlanetLighting() {
  sunMesh.getWorldPosition(planetSunWorld);
  saturnBall.updateWorldMatrix(true, false);
  saturnBall.getWorldPosition(saturnRingLightingUniforms.uSaturnCenterWorld.value);
  saturnRingLightingUniforms.uSunDirWorld.value
    .copy(planetSunWorld)
    .sub(saturnRingLightingUniforms.uSaturnCenterWorld.value)
    .normalize();
  planetSunLocal.copy(planetSunWorld);
  saturnBall.worldToLocal(planetSunLocal);
  planetSunLocal.normalize();
  saturnLighting.sunDir.copy(planetSunLocal);

  for (const p of planets) {
    if (!p.sunDir) continue;
    p.mesh.updateWorldMatrix(true, false);
    planetSunLocal.copy(planetSunWorld);
    p.mesh.worldToLocal(planetSunLocal);
    planetSunLocal.normalize();
    p.sunDir.copy(planetSunLocal);
  }
}

// Mars — 0.5x Earth, rusty and small, just outside the right-hand wall.
addPlanet("2k_mars.jpg", EARTH_RADIUS * 0.5, new THREE.Vector3(5.4, 2.4, -2.2), 25.2, 0.12, {
  sunlit: true,
  texWidth: 2048,
  texHeight: 1024,
  night: 0.22,
  day: 0.72,
  direct: 0.5,
  relief: 2.35,
  softness: 0.16,
  tintDay: 0xfff0dc,
  tintNight: 0x5e3a30,
});
// Venus — same size as Earth, pale thick atmosphere, just outside the left wall.
addPlanet("2k_venus_atmosphere.jpg", EARTH_RADIUS * 1.0, new THREE.Vector3(-5.6, 2.2, -2.2), 2.6, -0.03, {
  sunlit: true,
  texWidth: 2048,
  texHeight: 1024,
  night: 0.34,
  day: 0.78,
  direct: 0.34,
  relief: 0.9,
  softness: 0.24,
  tintDay: 0xfff5dc,
  tintNight: 0x6a5c4a,
});
// Jupiter — 20x Earth, banded giant, far to the left-behind.
const jupiterBall = addPlanet("2k_jupiter.jpg", EARTH_RADIUS * 20, new THREE.Vector3(-42, 6, 26), 3.1, 0.22, {
  sunlit: true,
  texWidth: 2048,
  texHeight: 1024,
  night: 0.2,
  day: 0.76,
  direct: 0.44,
  relief: 0.85,
  softness: 0.2,
  tintDay: 0xffead2,
  tintNight: 0x56483e,
});
addPlanetMoonSystem(
  jupiterBall.parent,
  [
    { orbitRadius: EARTH_RADIUS * 23.5, radius: EARTH_RADIUS * 0.13, color: 0xe6c287, texture: "moon_io_1024.jpg", speed: 0.058, phase: 0.4, orbitOpacity: 0.034 }, // Io
    { orbitRadius: EARTH_RADIUS * 27.5, radius: EARTH_RADIUS * 0.12, color: 0xd9d2bd, texture: "moon_europa_1024.jpg", speed: -0.046, phase: 1.8, orbitOpacity: 0.030 }, // Europa
    { orbitRadius: EARTH_RADIUS * 32.0, radius: EARTH_RADIUS * 0.16, color: 0xa99886, texture: "moon_ganymede_1024.jpg", speed: 0.035, phase: 3.1, orbitOpacity: 0.027 }, // Ganymede
    { orbitRadius: EARTH_RADIUS * 38.5, radius: EARTH_RADIUS * 0.15, color: 0x8b7868, texture: "moon_callisto_1024.jpg", speed: -0.026, phase: 5.2, orbitOpacity: 0.024 }, // Callisto
  ],
  { inclinationDeg: 2.1 }
);

// ---------------------------------------------------------------------------
// Interstellar-inspired black hole: a distant but reachable feature with a
// dark event horizon, bright accretion disk, view-dependent lensing arcs, and
// a short safe fall-through experience when the viewer crosses the horizon.
// ---------------------------------------------------------------------------
const BLACK_HOLE_HORIZON_R = EARTH_RADIUS * 3.75;
const BLACK_HOLE_DISK_INNER = BLACK_HOLE_HORIZON_R * 1.24;
const BLACK_HOLE_DISK_OUTER = BLACK_HOLE_HORIZON_R * 6.4;
const BLACK_HOLE_PULL_R = BLACK_HOLE_DISK_OUTER * 1.38;
const BLACK_HOLE_TRIGGER_R = BLACK_HOLE_HORIZON_R * 1.08;
const BLACK_HOLE_RETURN_COOLDOWN = 5.0;
const BLACK_HOLE_SOUND_START_R = BLACK_HOLE_PULL_R * 9.9;
const BLACK_HOLE_SOUND_FULL_R = BLACK_HOLE_PULL_R * 0.9;
const BLACK_HOLE_SOUND_MAX_GAIN = 1.0;
const BLACK_HOLE_SHADER_TIME_SCALE = 2.85;
const BLACK_HOLE_DISK_SPIN = 1.65;
const BLACK_HOLE_PARTICLE_SPIN = 3.35;
const BLACK_HOLE_TUNNEL_SPIN = 3.1;
const BLACK_HOLE_LENS_PLANE_SCALE = 4.0;
const BLACK_HOLE_TOUR_START_EDGE = 1.015;
const blackHoleGroup = new THREE.Group();
blackHoleGroup.position.copy(BLACK_HOLE_POSITION);
scene.add(blackHoleGroup);

const BLACK_HOLE_DISK_VERT = `
varying vec3 vLocalPos;
varying vec2 vUv;
void main(){
  vLocalPos=position;
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

const BLACK_HOLE_DISK_FRAG_CURRENT = `
uniform float uTime;
uniform float uInner;
uniform float uOuter;
varying vec3 vLocalPos;
float hash(vec2 p){
  p=fract(p*vec2(123.34,456.21));
  p+=dot(p,p+45.32);
  return fract(p.x*p.y);
}
float noise(vec2 p){
  vec2 i=floor(p);
  vec2 f=fract(p);
  f=f*f*(3.0-2.0*f);
  float a=hash(i);
  float b=hash(i+vec2(1.0,0.0));
  float c=hash(i+vec2(0.0,1.0));
  float d=hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fbm(vec2 p){
  float v=0.0;
  float amp=0.55;
  for(int i=0;i<4;i++){
    v+=noise(p)*amp;
    p*=2.03;
    amp*=0.5;
  }
  return v;
}
void main(){
  float r=length(vLocalPos.xy);
  float t=clamp((r-uInner)/(uOuter-uInner),0.0,1.0);
  vec2 dir=normalize(vLocalPos.xy+vec2(0.00001,0.0));
  float edge=smoothstep(0.0,0.08,t)*(1.0-smoothstep(0.88,1.0,t));
  float inner=1.0-smoothstep(0.02,0.42,t);
  float swirl=uTime*(2.2-1.35*t);
  float bands=0.48+0.52*sin(t*86.0+dir.x*18.0+dir.y*11.0-swirl*7.2);
  bands*=0.62+0.38*sin(t*178.0-dir.x*8.5+dir.y*13.0+uTime*1.45);
  float dust=fbm(vec2(dir.x*5.5+dir.y*3.2+uTime*0.08,t*38.0-uTime*0.34));
  float lane=fbm(vec2(dir.x*2.8-dir.y*4.1-uTime*0.16,t*14.0+3.7));
  bands*=0.64+0.48*dust;
  float doppler=0.58+0.58*smoothstep(-0.42,0.92,dir.x*0.91-dir.y*0.41);
  float hotLane=exp(-pow((t-0.105)/0.065,2.0));
  float pulse=0.92+0.18*sin(uTime*3.4+dir.x*4.7+dir.y*3.8);
  float alpha=edge*(0.2+0.68*bands+0.25*dust)*(0.66+inner*2.0+hotLane*1.75)*doppler*(0.72+0.38*lane)*pulse;
  vec3 hot=vec3(1.0,0.92,0.76);
  vec3 amber=vec3(1.0,0.46,0.12);
  vec3 ember=vec3(0.65,0.12,0.035);
  vec3 col=mix(amber,hot,inner*0.98+hotLane*0.82+smoothstep(0.62,1.0,bands)*0.35);
  col=mix(col,ember,smoothstep(0.52,1.0,t)*0.55);
  col*=1.08+inner*2.85+hotLane*3.4+dust*0.32;
  if(alpha<0.004) discard;
  gl_FragColor=vec4(col,alpha);
}`;

const BLACK_HOLE_DISK_FRAG_GARGANTUA_A = `
uniform float uTime;
uniform float uInner;
uniform float uOuter;
varying vec3 vLocalPos;
float hash(vec2 p){
  p=fract(p*vec2(123.34,456.21));
  p+=dot(p,p+45.32);
  return fract(p.x*p.y);
}
float noise(vec2 p){
  vec2 i=floor(p);
  vec2 f=fract(p);
  f=f*f*(3.0-2.0*f);
  float a=hash(i);
  float b=hash(i+vec2(1.0,0.0));
  float c=hash(i+vec2(0.0,1.0));
  float d=hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fbm(vec2 p){
  float v=0.0;
  float amp=0.55;
  for(int i=0;i<4;i++){
    v+=noise(p)*amp;
    p*=2.03;
    amp*=0.5;
  }
  return v;
}
void main(){
  float r=length(vLocalPos.xy);
  float t=clamp((r-uInner)/(uOuter-uInner),0.0,1.0);
  vec2 dir=normalize(vLocalPos.xy+vec2(0.00001,0.0));
  float ang=atan(dir.y,dir.x);
  // smooth radial envelope — no concentric stripes
  float edge=smoothstep(0.0,0.12,t)*(1.0-smoothstep(0.74,1.0,t));
  float inner=1.0-smoothstep(0.0,0.52,t);
  // turbulence that flows ALONG the orbit (angular), giving wispy gas lanes
  float spin=uTime*(1.65-1.0*t);
  vec2 flowUV=vec2(ang*2.3-spin,t*3.0);
  float turb=fbm(flowUV);
  float fine=fbm(flowUV*2.7+vec2(0.0,uTime*0.32));
  float streak=fbm(vec2(ang*8.5-spin*1.3,t*1.7));
  float dust=0.4+0.55*turb+0.22*fine+0.3*streak;
  // relativistic doppler beaming — one side dramatically brighter
  float doppler=0.30+1.00*smoothstep(-0.85,0.85,dir.x);
  // hot inner rim hugging the photon orbit
  float hotLane=exp(-pow((t-0.055)/0.11,2.0));
  float alpha=edge*dust*(0.46+inner*1.7+hotLane*1.85)*doppler;
  vec3 white=vec3(1.0,0.95,0.85);
  vec3 amber=vec3(1.0,0.52,0.18);
  vec3 ember=vec3(0.5,0.12,0.04);
  vec3 col=mix(amber,white,clamp(inner*1.05+hotLane*0.9*doppler,0.0,1.0));
  col=mix(col,ember,smoothstep(0.46,1.0,t)*0.6);
  col*=0.7+inner*2.2+hotLane*3.4*doppler+dust*0.25;
  col=mix(col,white,smoothstep(0.85,1.25,doppler)*0.45);
  if(alpha<0.004) discard;
  gl_FragColor=vec4(col,alpha);
}`;

const BLACK_HOLE_LENS_FRAG_CURRENT = `
uniform float uTime;
uniform float uPlaneScale;
varying vec2 vUv;
float ring(float r,float target,float width){
  return exp(-pow((r-target)/width,2.0));
}
void main(){
  vec2 p=(vUv-0.5)*2.0*uPlaneScale;
  float r=length(p);
  float angle=atan(p.y,p.x);
  float horizon=1.0-smoothstep(0.28,0.34,r);
  float spin=angle-uTime*1.15;
  float photon=ring(r,0.42,0.019)*(0.76+0.24*sin(spin*13.0));
  float outer=ring(r,0.66,0.015)*(0.48+0.62*smoothstep(-0.32,0.88,p.x));
  float upper=ring(length(vec2((p.x+0.12)*0.72,(p.y-0.3)*1.7)),0.62,0.052)*smoothstep(-0.04,0.44,p.y);
  float lower=ring(length(vec2((p.x-0.05)*0.78,(p.y+0.32)*1.58)),0.62,0.068)*(1.0-smoothstep(-0.5,0.12,p.y));
  float flare=ring(r,0.50,0.038)*smoothstep(0.1,0.95,sin(spin*5.0+uTime*0.7))*0.28;
  float lens=photon*1.8+outer*1.38+upper*1.18+lower*0.8+flare;
  vec3 white=vec3(1.0,0.94,0.82);
  vec3 orange=vec3(1.0,0.46,0.12);
  vec3 col=mix(orange,white,photon*0.96+outer*0.82+upper*0.45);
  float alpha=clamp(lens,0.0,1.0)*(1.0-horizon)*1.0;
  if(alpha<0.004) discard;
  gl_FragColor=vec4(col,alpha);
}`;

const BLACK_HOLE_LENS_FRAG_GARGANTUA_A = `
uniform float uTime;
uniform float uPlaneScale;
varying vec2 vUv;
float ring(float r,float target,float width){
  return exp(-pow((r-target)/width,2.0));
}
float fbmLike(vec2 p){
  float v=0.0;
  v+=sin(p.x*37.0+p.y*11.0+uTime*0.7)*0.5+0.5;
  v+=sin(p.x*83.0-p.y*19.0-uTime*1.1)*0.25+0.25;
  return clamp(v*0.62,0.0,1.0);
}
void main(){
  vec2 p=(vUv-0.5)*2.0*uPlaneScale;
  p.x*=1.35; // compensate the plane's 1.35:1 aspect so the shadow and halo read as a true circle
  float r=length(p);
  float angle=atan(p.y,p.x);
  // black shadow of the event horizon
  float horizon=1.0-smoothstep(0.265,0.305,r);
  float spin=angle-uTime*0.7;
  float grain=0.8+0.2*fbmLike(vec2(angle*1.6,r*2.4));
  // relativistic doppler — right side brighter, but the ring stays visible all the way around
  float doppler=0.52+0.62*smoothstep(-0.85,0.85,p.x);

  // wispy filament streaks stretched along the orbit
  float filament=0.55+0.55*fbmLike(vec2(angle*7.0-uTime*0.9,r*3.2));
  // thin bright photon ring hugging the shadow
  float photon=ring(r,0.325,0.010)*(0.86+0.14*sin(spin*6.0));
  vec2 nrm=normalize(p+vec2(0.00001,0.0));
  // complete lensed halo hugging the shadow — over-top and under-bottom arcs joined into one closed ring
  float halo=ring(r,0.36,0.05)*(0.5+0.62*filament);
  // extra glow piled up directly above and below the shadow (the vertical lensed arcs that close the ring)
  float vert=ring(r,0.38,0.105)*pow(abs(nrm.y),1.15)*(0.55+0.55*filament);
  // bright horizontal sweep of the disk crossing in front, fanning out to both sides
  // (fades out before the plane edge so the disk never ends in a hard rectangular cut)
  float band=exp(-pow((p.y+0.01-p.x*0.05)/0.07,2.0))*exp(-pow(p.x/2.7,2.0))*(0.5+0.5*fbmLike(vec2(angle*1.8-uTime*0.5,r*2.2)))*(0.55+0.55*filament);
  // faint top-surface spread of the near disk receding into the foreground (slightly from above)
  float sheet=exp(-pow((p.y+0.48)/0.24,2.0))*exp(-pow(p.x/2.4,2.0))*(0.4+0.6*fbmLike(vec2(angle*2.2-uTime*0.4,r*2.0)))*0.35;
  // warm glare on the bright doppler side
  float glare=exp(-pow(length(vec2((p.x-0.34)*0.62,p.y*0.85))/0.19,2.0));

  float lens=(photon*2.0+halo*2.3+vert*1.8+band*1.2+sheet*0.45+glare*0.75)*grain*doppler;
  vec3 white=vec3(1.0,0.98,0.9);
  vec3 cream=vec3(1.0,0.82,0.52);
  vec3 orange=vec3(1.0,0.46,0.16);
  vec3 col=mix(orange,cream,clamp(halo*0.5+band*0.5+vert*0.4+glare*0.5,0.0,1.0));
  col=mix(col,white,clamp(photon*1.3+halo*0.5+band*0.35+glare*0.5,0.0,1.0));
  float alpha=clamp(lens,0.0,1.0)*(1.0-horizon);
  if(alpha<0.004) discard;
  gl_FragColor=vec4(col*(1.0+photon*0.7+glare*0.5),alpha);
}`;

const BLACK_HOLE_VISUAL_PROFILES = {
  current: {
    diskFragmentShader: BLACK_HOLE_DISK_FRAG_CURRENT,
    lensFragmentShader: BLACK_HOLE_LENS_FRAG_CURRENT,
    shaderTimeScale: BLACK_HOLE_SHADER_TIME_SCALE,
    diskSpin: BLACK_HOLE_DISK_SPIN,
    particleSpin: BLACK_HOLE_PARTICLE_SPIN,
    diskRotationZDeg: -10,
    diskTiltXDeg: 72,
    diskTiltYDeg: -24,
    particleSize: 2.6,
    particleOpacity: 0.9,
  },
  gargantuaA: {
    diskFragmentShader: BLACK_HOLE_DISK_FRAG_GARGANTUA_A,
    lensFragmentShader: BLACK_HOLE_LENS_FRAG_GARGANTUA_A,
    shaderTimeScale: 2.25,
    diskSpin: 1.25,
    particleSpin: 2.45,
    diskRotationZDeg: 6,
    diskTiltXDeg: -79,
    diskTiltYDeg: -8,
    particleSize: 1.2,
    particleOpacity: 0.22,
  },
  referenceImageA: {
    diskFragmentShader: BLACK_HOLE_DISK_FRAG_CURRENT,
    lensFragmentShader: BLACK_HOLE_LENS_FRAG_CURRENT,
    shaderTimeScale: 0.85,
    diskSpin: 0,
    particleSpin: 0,
    diskRotationZDeg: -10,
    diskTiltXDeg: 72,
    diskTiltYDeg: -24,
    particleSize: 0,
    particleOpacity: 0,
    imageTextureFile: "black-hole-reference-image-a.png",
    imageAspect: 2048 / 870,
  },
};
const blackHoleVisualProfile = BLACK_HOLE_VISUAL_PROFILES[BLACK_HOLE_VISUAL_VARIANT] || BLACK_HOLE_VISUAL_PROFILES.current;
if (!BLACK_HOLE_VISUAL_PROFILES[BLACK_HOLE_VISUAL_VARIANT]) {
  console.warn(`Unknown blackHoleVisual="${BLACK_HOLE_VISUAL_VARIANT}". Falling back to current.`);
}

const blackHoleDiskMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uInner: { value: BLACK_HOLE_DISK_INNER },
    uOuter: { value: BLACK_HOLE_DISK_OUTER },
  },
  vertexShader: BLACK_HOLE_DISK_VERT,
  fragmentShader: blackHoleVisualProfile.diskFragmentShader,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

const blackHoleDisk = new THREE.Mesh(
  new THREE.RingGeometry(BLACK_HOLE_DISK_INNER, BLACK_HOLE_DISK_OUTER, 256, 18),
  blackHoleDiskMaterial
);
blackHoleDisk.rotation.set(
  THREE.MathUtils.degToRad(blackHoleVisualProfile.diskTiltXDeg ?? 72),
  THREE.MathUtils.degToRad(blackHoleVisualProfile.diskTiltYDeg ?? -24),
  THREE.MathUtils.degToRad(blackHoleVisualProfile.diskRotationZDeg)
);
blackHoleDisk.renderOrder = 5;
blackHoleGroup.add(blackHoleDisk);

const blackHoleLensMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPlaneScale: { value: BLACK_HOLE_LENS_PLANE_SCALE },
  },
  vertexShader: `
varying vec2 vUv;
void main(){
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`,
  fragmentShader: blackHoleVisualProfile.lensFragmentShader,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const blackHoleLens = new THREE.Mesh(
  new THREE.PlaneGeometry(
    BLACK_HOLE_DISK_OUTER * 1.35 * BLACK_HOLE_LENS_PLANE_SCALE,
    BLACK_HOLE_DISK_OUTER * 1.0 * BLACK_HOLE_LENS_PLANE_SCALE
  ),
  blackHoleLensMaterial
);
blackHoleLens.renderOrder = 7;
blackHoleGroup.add(blackHoleLens);

const blackHoleCore = new THREE.Mesh(
  new THREE.SphereGeometry(BLACK_HOLE_HORIZON_R * 0.72, 64, 32),
  new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
);
blackHoleCore.renderOrder = 8;
blackHoleGroup.add(blackHoleCore);

const blackHoleParticlePositions = [];
const blackHoleParticleColors = [];
const blackHoleParticleRand = seededRandom(992313);
for (let i = 0; i < 920; i += 1) {
  const r = BLACK_HOLE_DISK_INNER * 1.04 + Math.pow(blackHoleParticleRand(), 1.6) * (BLACK_HOLE_DISK_OUTER * 0.82 - BLACK_HOLE_DISK_INNER);
  const a = blackHoleParticleRand() * Math.PI * 2;
  const y = (blackHoleParticleRand() - 0.5) * BLACK_HOLE_HORIZON_R * 0.1;
  blackHoleParticlePositions.push(Math.cos(a) * r, Math.sin(a) * r, y);
  const warm = 0.65 + blackHoleParticleRand() * 0.35;
  blackHoleParticleColors.push(1.0, warm * 0.74, warm * 0.34);
}
const blackHoleParticleGeo = new THREE.BufferGeometry();
blackHoleParticleGeo.setAttribute("position", new THREE.Float32BufferAttribute(blackHoleParticlePositions, 3));
blackHoleParticleGeo.setAttribute("color", new THREE.Float32BufferAttribute(blackHoleParticleColors, 3));
const blackHoleParticles = new THREE.Points(
  blackHoleParticleGeo,
  new THREE.PointsMaterial({
    size: blackHoleVisualProfile.particleSize,
    sizeAttenuation: false,
    transparent: true,
    opacity: blackHoleVisualProfile.particleOpacity,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
);
blackHoleParticles.rotation.copy(blackHoleDisk.rotation);
blackHoleGroup.add(blackHoleParticles);

const blackHoleReferenceImageTexture = blackHoleVisualProfile.imageTextureFile
  ? loadTex(blackHoleVisualProfile.imageTextureFile)
  : null;
const blackHoleReferenceImageMaterial = new THREE.MeshBasicMaterial({
  map: blackHoleReferenceImageTexture,
  transparent: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});
const blackHoleReferenceImageWidth = BLACK_HOLE_DISK_OUTER * 2.92;
const blackHoleReferenceImagePlane = new THREE.Mesh(
  new THREE.PlaneGeometry(
    blackHoleReferenceImageWidth,
    blackHoleReferenceImageWidth / (blackHoleVisualProfile.imageAspect || 2.35)
  ),
  blackHoleReferenceImageMaterial
);
blackHoleReferenceImagePlane.renderOrder = 9;
blackHoleReferenceImagePlane.visible = Boolean(blackHoleVisualProfile.imageTextureFile);
blackHoleGroup.add(blackHoleReferenceImagePlane);

if (blackHoleVisualProfile.imageTextureFile) {
  blackHoleDisk.visible = false;
  blackHoleLens.visible = false;
  blackHoleCore.visible = false;
  blackHoleParticles.visible = false;
}

const blackHoleTunnel = new THREE.Group();
blackHoleTunnel.visible = false;
scene.add(blackHoleTunnel);
const tunnelPositions = [];
const tunnelRand = seededRandom(146081);
for (let i = 0; i < 120; i += 1) {
  const a = tunnelRand() * Math.PI * 2;
  const r = 0.18 + Math.pow(tunnelRand(), 0.6) * 1.45;
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  const depth = 1.0 + tunnelRand() * 2.4;
  tunnelPositions.push(x, y, -0.18, x * 0.18, y * 0.18, -depth);
}
const blackHoleTunnelLines = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(tunnelPositions, 3)),
  new THREE.LineBasicMaterial({
    color: 0xffd6a6,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
);
blackHoleTunnel.add(blackHoleTunnelLines);
const blackHoleVeil = new THREE.Mesh(
  new THREE.CircleGeometry(1.9, 80),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
);
blackHoleVeil.position.z = -1.4;
blackHoleTunnel.add(blackHoleVeil);

const blackHoleTmp = new THREE.Vector3();
const blackHoleLookDir = new THREE.Vector3();
const blackHoleTourTarget = new THREE.Vector3();
const blackHoleTourDelta = new THREE.Vector3();
let blackHoleWarpHudTexture = null;
let blackHoleFallActive = false;
let blackHoleFallT = 0;
let blackHoleCooldown = 0;
let blackHoleStatusArmed = true;
let blackHoleTourCountdownActive = false;
let blackHoleTourCountdownStart = 0;
let blackHoleTourCountdownTimer = null;
let blackHoleTourCountdownTextureTick = -1;
let blackHoleTourCountdownBeep = -1;
const BLACK_HOLE_TOUR_COUNTDOWN = 8.0;

function makeBlackHoleWarpHudTexture(secondsLeft = BLACK_HOLE_TOUR_COUNTDOWN, progress = 0) {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 640;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);

  const bg = ctx.createLinearGradient(0, 0, c.width, c.height);
  bg.addColorStop(0, "rgba(34,9,12,0.9)");
  bg.addColorStop(0.46, "rgba(8,12,18,0.88)");
  bg.addColorStop(1, "rgba(36,21,6,0.9)");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(28, 28, c.width - 56, c.height - 56, 38);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,188,105,0.86)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(36, 36, c.width - 72, c.height - 72, 34);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,92,110,0.38)";
  ctx.lineWidth = 2;
  for (let x = 92; x < c.width - 70; x += 78) {
    ctx.beginPath();
    ctx.moveTo(x, 48);
    ctx.lineTo(x, c.height - 48);
    ctx.stroke();
  }
  for (let y = 100; y < c.height - 64; y += 58) {
    ctx.beginPath();
    ctx.moveTo(52, y);
    ctx.lineTo(c.width - 52, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,92,110,0.95)";
  ctx.font = "900 46px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(255,92,110,0.55)";
  ctx.shadowBlur = 18;
  ctx.fillText("WARNING", 86, 72);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#fff3df";
  ctx.font = "900 76px Arial, Helvetica, sans-serif";
  ctx.fillText("BLACK HOLE TOUR", 86, 136);

  ctx.fillStyle = "rgba(255,236,210,0.94)";
  ctx.font = "700 34px Arial, Helvetica, sans-serif";
  ctx.fillText("重力航路をロックしました。ワープ前安全確認を開始します。", 88, 244);
  ctx.fillText("姿勢を保ち、視界中央のカウントダウンを確認してください。", 88, 292);

  const countText = String(Math.max(0, secondsLeft)).padStart(2, "0");
  ctx.fillStyle = "rgba(255,188,105,0.96)";
  ctx.font = "900 54px Arial, Helvetica, sans-serif";
  ctx.fillText("WARP IN", 88, 386);
  ctx.font = "900 154px Arial, Helvetica, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(countText, c.width - 112, 330);
  ctx.textAlign = "left";

  const barX = 88;
  const barY = 540;
  const barW = c.width - 176;
  const barH = 28;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 14);
  ctx.fill();
  const fill = Math.max(0.02, THREE.MathUtils.clamp(progress, 0, 1));
  const bar = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  bar.addColorStop(0, "rgba(255,92,110,0.94)");
  bar.addColorStop(0.5, "rgba(255,188,105,0.96)");
  bar.addColorStop(1, "rgba(122,255,167,0.92)");
  ctx.fillStyle = bar;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * fill, barH, 14);
  ctx.fill();

  ctx.fillStyle = "rgba(122,255,167,0.88)";
  ctx.font = "700 24px Arial, Helvetica, sans-serif";
  ctx.fillText("GRAVITY LINK: ARMED", 88, 588);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

blackHoleWarpHudTexture = makeBlackHoleWarpHudTexture(BLACK_HOLE_TOUR_COUNTDOWN, 0);
const blackHoleWarpHud = new THREE.Mesh(
  new THREE.PlaneGeometry(1.62, 0.81),
  new THREE.MeshBasicMaterial({
    map: blackHoleWarpHudTexture,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
);
blackHoleWarpHud.renderOrder = 1300;
blackHoleWarpHud.visible = false;
scene.add(blackHoleWarpHud);

function startBlackHoleFall() {
  if (blackHoleFallActive || blackHoleCooldown > 0) return;
  blackHoleFallActive = true;
  blackHoleFallT = 0;
  blackHoleTunnel.visible = true;
  blackHoleStatusArmed = true;
  statusEl.textContent = "ブラックホールの事象の地平面に入りました。安全復帰シーケンスを開始します。";
}

function finishBlackHoleFall() {
  blackHoleFallActive = false;
  blackHoleCooldown = BLACK_HOLE_RETURN_COOLDOWN;
  blackHoleTunnel.visible = false;
  blackHoleTunnelLines.material.opacity = 0;
  blackHoleVeil.material.opacity = 0;
  if (renderer.xr.isPresenting) resetToHome();
  statusEl.textContent = "ブラックホールから安全な観測位置へ復帰しました。";
}

function getBlackHoleTourTarget(out) {
  blackHoleTmp.copy(BLACK_HOLE_POSITION).sub(roomCenter);
  if (blackHoleTmp.lengthSq() < 1e-6) blackHoleTmp.set(0, 0, -1);
  blackHoleTmp.normalize();
  return out.copy(BLACK_HOLE_POSITION).addScaledVector(blackHoleTmp, -BLACK_HOLE_SOUND_START_R * BLACK_HOLE_TOUR_START_EDGE);
}

function playBlackHoleCountdownBeep(secondsLeft) {
  if (!audioContext || audioContext.state !== "running") return;
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const soundPos = blackHoleWarpHud.visible
    ? blackHoleWarpHud.position.clone()
    : getViewerAudioPosition(audioSourceWorld).clone();
  osc.type = secondsLeft <= 0 ? "sawtooth" : "triangle";
  osc.frequency.setValueAtTime(secondsLeft <= 0 ? 220 : 440 + secondsLeft * 90, now);
  osc.frequency.exponentialRampToValueAtTime(secondsLeft <= 0 ? 88 : 220, now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(secondsLeft <= 0 ? 0.18 : 0.1, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (secondsLeft <= 0 ? 0.42 : 0.2));
  osc.connect(gain);
  const spatialAudio = connectDistanceGain(gain, soundPos, 1, LOCAL_AUDIO_MIN_RATIO);
  const tracked = trackSpatialAudio(spatialAudio, soundPos);
  osc.onended = () => {
    untrackSpatialAudio(tracked);
    disconnectSpatialAudio(spatialAudio);
  };
  osc.start(now);
  osc.stop(now + (secondsLeft <= 0 ? 0.46 : 0.24));
}

function refreshBlackHoleWarpHud(secondsLeft, progress) {
  const nextTexture = makeBlackHoleWarpHudTexture(secondsLeft, progress);
  const prevTexture = blackHoleWarpHudTexture;
  blackHoleWarpHudTexture = nextTexture;
  blackHoleWarpHud.material.map = blackHoleWarpHudTexture;
  blackHoleWarpHud.material.needsUpdate = true;
  prevTexture?.dispose?.();
}

function requestBlackHoleTour() {
  initAudio();
  if (audioContext?.state === "suspended") audioContext.resume();
  if (!blackHoleBuffer && !blackHoleBufferPromise && !blackHoleBufferTried) loadBlackHoleBuffer();
  if (blackHoleTourCountdownTimer) clearTimeout(blackHoleTourCountdownTimer);
  blackHoleTourCountdownActive = true;
  blackHoleTourCountdownStart = elapsed;
  blackHoleTourCountdownTextureTick = -1;
  blackHoleTourCountdownBeep = -1;
  blackHoleWarpHud.visible = true;
  refreshBlackHoleWarpHud(BLACK_HOLE_TOUR_COUNTDOWN, 0);
  blackHoleTourCountdownTimer = window.setTimeout(() => {
    finishBlackHoleTourCountdown();
  }, BLACK_HOLE_TOUR_COUNTDOWN * 1000);
  statusEl.textContent = "ブラックホール探訪: 8秒のワープ前警告シーケンスを開始します。";
}

function finishBlackHoleTourCountdown() {
  if (!blackHoleTourCountdownActive) return;
  blackHoleTourCountdownActive = false;
  if (blackHoleTourCountdownTimer) {
    clearTimeout(blackHoleTourCountdownTimer);
    blackHoleTourCountdownTimer = null;
  }
  blackHoleWarpHud.visible = false;
  teleportToBlackHoleTour();
}

function updateBlackHoleTourCountdown() {
  if (!blackHoleTourCountdownActive) {
    blackHoleWarpHud.visible = false;
    return;
  }

  const t = elapsed - blackHoleTourCountdownStart;
  const progress = THREE.MathUtils.clamp(t / BLACK_HOLE_TOUR_COUNTDOWN, 0, 1);
  const secondsLeft = Math.max(0, Math.ceil(BLACK_HOLE_TOUR_COUNTDOWN - t));
  const textureTick = Math.floor(progress * 24);
  if (textureTick !== blackHoleTourCountdownTextureTick) {
    blackHoleTourCountdownTextureTick = textureTick;
    refreshBlackHoleWarpHud(secondsLeft, progress);
  }
  if (secondsLeft !== blackHoleTourCountdownBeep) {
    blackHoleTourCountdownBeep = secondsLeft;
    playBlackHoleCountdownBeep(secondsLeft);
  }

  const cam = getViewerPose(viewerWorld);
  blackHoleWarpHud.position.copy(viewerWorld).addScaledVector(viewerForward, 1.08);
  blackHoleWarpHud.quaternion.copy(cam.quaternion);
  blackHoleWarpHud.scale.setScalar(1 + Math.sin(elapsed * 18) * 0.012);
  blackHoleWarpHud.visible = true;

  if (progress >= 1) {
    finishBlackHoleTourCountdown();
  }
}

function teleportToBlackHoleTour() {
  initAudio();
  if (audioContext?.state === "suspended") audioContext.resume();
  if (!blackHoleBuffer && !blackHoleBufferPromise && !blackHoleBufferTried) loadBlackHoleBuffer();

  blackHoleFallActive = false;
  blackHoleFallT = 0;
  blackHoleCooldown = 0;
  blackHoleTunnel.visible = false;
  blackHoleTunnelLines.material.opacity = 0;
  blackHoleVeil.material.opacity = 0;

  getBlackHoleTourTarget(blackHoleTourTarget);
  if (renderer.xr.isPresenting && xrBaseRefSpace) {
    getViewerPose(viewerWorld);
    blackHoleTourDelta.copy(blackHoleTourTarget).sub(viewerWorld);
    locomotion.add(blackHoleTourDelta);
    applyXrLocomotionOffset();
  } else {
    camera.up.set(0, 1, 0);
    camera.position.copy(blackHoleTourTarget);
    camera.lookAt(BLACK_HOLE_POSITION);
  }

  statusEl.textContent = "ブラックホール探訪地点へ移動しました。少し中心へ進むと低音が立ち上がります。";
}

function updateBlackHole(dt, timeSeconds) {
  const blackHoleTime = timeSeconds * blackHoleVisualProfile.shaderTimeScale;
  blackHoleDiskMaterial.uniforms.uTime.value = blackHoleTime;
  blackHoleLensMaterial.uniforms.uTime.value = blackHoleTime;
  blackHoleDisk.rotation.z += dt * blackHoleVisualProfile.diskSpin;
  blackHoleParticles.rotation.z += dt * blackHoleVisualProfile.particleSpin;

  getViewerPose(viewerWorld);
  blackHoleTmp.copy(viewerWorld).sub(BLACK_HOLE_POSITION);
  const distance = blackHoleTmp.length();
  blackHoleLens.lookAt(viewerWorld);
  if (blackHoleReferenceImagePlane.visible) blackHoleReferenceImagePlane.lookAt(viewerWorld);
  updateBlackHoleRumble(distance, dt, timeSeconds);

  if (blackHoleCooldown > 0) blackHoleCooldown = Math.max(0, blackHoleCooldown - dt);

  if (!blackHoleFallActive && blackHoleCooldown <= 0 && (renderer.xr.isPresenting || DEBUG_BLACK_HOLE_FALL)) {
    if (distance < BLACK_HOLE_TRIGGER_R || (DEBUG_BLACK_HOLE_FALL && timeSeconds > 2.0)) {
      startBlackHoleFall();
    } else if (renderer.xr.isPresenting && distance < BLACK_HOLE_PULL_R && blackHoleStatusArmed) {
      blackHoleStatusArmed = false;
      statusEl.textContent = "ブラックホール接近中。中心へ入りすぎると落下演出に入ります。";
    } else if (distance > BLACK_HOLE_PULL_R * 1.18) {
      blackHoleStatusArmed = true;
    }
  }

  if (!blackHoleFallActive) {
    blackHoleTunnel.visible = false;
    return;
  }

  blackHoleFallT += dt;
  const p = THREE.MathUtils.clamp(blackHoleFallT / 3.8, 0, 1);
  const cam = getViewerPose(viewerWorld);
  blackHoleTunnel.visible = true;
  blackHoleTunnel.position.copy(viewerWorld).addScaledVector(viewerForward, 1.2);
  blackHoleTunnel.quaternion.copy(cam.quaternion);
  blackHoleTunnel.rotation.z += timeSeconds * (BLACK_HOLE_TUNNEL_SPIN + p * 8.8);
  blackHoleTunnel.scale.setScalar(0.94 + p * 0.96);
  blackHoleLookDir.copy(BLACK_HOLE_POSITION).sub(viewerWorld);
  const facingBlackHole = blackHoleLookDir.lengthSq() > 1e-6 ? viewerForward.dot(blackHoleLookDir.normalize()) : 1;
  const forwardFade = smoothFade01((facingBlackHole + 0.08) / 0.48);
  blackHoleTunnelLines.material.opacity = THREE.MathUtils.lerp(0.22, 1.0, smoothFade01(Math.min(1, p * 1.55))) * forwardFade;
  blackHoleVeil.material.opacity = smoothFade01((p - 0.62) / 0.32) * 0.96 * forwardFade;

  if (renderer.xr.isPresenting && xrBaseRefSpace) {
    blackHoleTmp.copy(BLACK_HOLE_POSITION).sub(viewerWorld);
    const pullDistance = blackHoleTmp.length();
    if (pullDistance > 0.02) {
      blackHoleTmp.normalize();
      locomotion.addScaledVector(blackHoleTmp, dt * THREE.MathUtils.lerp(1.45, 6.8, p));
      applyXrLocomotionOffset();
    }
  }

  if (p >= 1) finishBlackHoleFall();
}

// ---------------------------------------------------------------------------
// Taxi Analytics Room: a separate analysis space next to the solar system room
// with dashboard panels showing placeholder taxi business metrics.
// ---------------------------------------------------------------------------
const TAXI_ANALYTICS_ROOM_POSITION = new THREE.Vector3(15, 2.2, -2.2);
const TAXI_ANALYTICS_ROOM_HALF = new THREE.Vector3(4.0, 2.2, 4.0);
const TAXI_ANALYTICS_PANEL_ROW_CENTER = new THREE.Vector3(15, 2.3, -5.0);
const taxiAnalyticsGroup = new THREE.Group();
taxiAnalyticsGroup.visible = false;
scene.add(taxiAnalyticsGroup);

let inTaxiAnalyticsRoom = false;
let taxiAnalyticsPreview2D = false;
const taxiAnalyticsTeleportTarget = new THREE.Vector3();
const taxiAnalyticsTeleportDelta = new THREE.Vector3();

const taxiAnalyticsFloor = new THREE.GridHelper(
  Math.max(TAXI_ANALYTICS_ROOM_HALF.x, TAXI_ANALYTICS_ROOM_HALF.z) * 2,
  12,
  0x4a3d6e,
  0x2a1f42
);
taxiAnalyticsFloor.position.set(
  TAXI_ANALYTICS_ROOM_POSITION.x,
  TAXI_ANALYTICS_ROOM_POSITION.y - TAXI_ANALYTICS_ROOM_HALF.y,
  TAXI_ANALYTICS_ROOM_POSITION.z
);
taxiAnalyticsGroup.add(taxiAnalyticsFloor);

const taxiAnalyticsBounds = new THREE.LineSegments(
  new THREE.EdgesGeometry(
    new THREE.BoxGeometry(
      TAXI_ANALYTICS_ROOM_HALF.x * 2,
      TAXI_ANALYTICS_ROOM_HALF.y * 2,
      TAXI_ANALYTICS_ROOM_HALF.z * 2
    )
  ),
  new THREE.LineBasicMaterial({ color: 0xa884ff, transparent: true, opacity: 0.55 })
);
taxiAnalyticsBounds.position.copy(TAXI_ANALYTICS_ROOM_POSITION);
taxiAnalyticsGroup.add(taxiAnalyticsBounds);

const taxiAnalyticsLight1 = new THREE.PointLight(0xa884ff, 3.5, 12);
taxiAnalyticsLight1.position.set(
  TAXI_ANALYTICS_ROOM_POSITION.x,
  TAXI_ANALYTICS_ROOM_POSITION.y + 1.6,
  TAXI_ANALYTICS_ROOM_POSITION.z
);
taxiAnalyticsGroup.add(taxiAnalyticsLight1);

const taxiAnalyticsLight2 = new THREE.PointLight(0xffffff, 2.5, 10);
taxiAnalyticsLight2.position.set(
  TAXI_ANALYTICS_ROOM_POSITION.x,
  TAXI_ANALYTICS_ROOM_POSITION.y + 1.2,
  TAXI_ANALYTICS_ROOM_POSITION.z - 2.5
);
taxiAnalyticsGroup.add(taxiAnalyticsLight2);

function makeTaxiAnalyticsPanelTexture(title, value, unit, chartType) {
  const c = document.createElement("canvas");
  // 2x resolution for the 2x panel; drawing uses the old 512x384 logical layout
  const W = 512;
  const H = 384;
  c.width = W * 2;
  c.height = H * 2;
  const ctx = c.getContext("2d");
  ctx.scale(2, 2);

  ctx.fillStyle = "rgba(18, 12, 32, 0.92)";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(168, 132, 255, 0.65)";
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  ctx.fillStyle = "rgba(168, 132, 255, 0.12)";
  ctx.fillRect(12, 12, W - 24, 52);

  ctx.font = "bold 32px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#e4daff";
  ctx.textAlign = "center";
  ctx.fillText(title, W / 2, 48);

  ctx.font = "17px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "rgba(255, 200, 100, 0.9)";
  ctx.fillText("⚠ サンプルデータ", W / 2, 82);

  ctx.font = "bold 64px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(value, W / 2, 160);

  ctx.font = "26px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#a884ff";
  ctx.fillText(unit, W / 2, 195);

  if (chartType === "bar") {
    const bars = [0.6, 0.8, 0.45, 0.9, 0.7, 0.55, 0.85];
    const barW = 48;
    const barGap = 12;
    const startX = (W - (bars.length * barW + (bars.length - 1) * barGap)) / 2;
    const maxH = 100;
    const baseY = 340;
    ctx.fillStyle = "rgba(168, 132, 255, 0.75)";
    for (let i = 0; i < bars.length; i++) {
      const h = bars[i] * maxH;
      ctx.fillRect(startX + i * (barW + barGap), baseY - h, barW, h);
    }
    ctx.font = "15px Arial";
    ctx.fillStyle = "#8866cc";
    const days = ["月", "火", "水", "木", "金", "土", "日"];
    for (let i = 0; i < days.length; i++) {
      ctx.fillText(days[i], startX + i * (barW + barGap) + barW / 2, baseY + 18);
    }
  } else if (chartType === "line") {
    const points = [0.3, 0.25, 0.5, 0.8, 1.0, 0.7, 0.4, 0.2];
    const startX = 50;
    const endX = W - 50;
    const baseY = 340;
    const maxH = 100;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(100, 200, 255, 0.9)";
    ctx.lineWidth = 3;
    for (let i = 0; i < points.length; i++) {
      const x = startX + (i / (points.length - 1)) * (endX - startX);
      const y = baseY - points[i] * maxH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.font = "15px Arial";
    ctx.fillStyle = "#8866cc";
    const hours = ["6時", "9時", "12時", "15時", "18時", "21時", "24時", "3時"];
    for (let i = 0; i < hours.length; i++) {
      const x = startX + (i / (hours.length - 1)) * (endX - startX);
      ctx.fillText(hours[i], x, baseY + 18);
    }
  } else if (chartType === "pie") {
    const cx = W / 2;
    const cy = 280;
    const r = 60;
    const segments = [0.35, 0.25, 0.22, 0.18];
    const colors = ["rgba(168, 132, 255, 0.85)", "rgba(100, 200, 255, 0.85)", "rgba(255, 180, 100, 0.85)", "rgba(120, 255, 160, 0.85)"];
    let angle = -Math.PI / 2;
    for (let i = 0; i < segments.length; i++) {
      const slice = segments[i] * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.fill();
      angle += slice;
    }
    ctx.font = "15px Arial";
    ctx.fillStyle = "#e4daff";
    ctx.fillText("走行中 35%", cx - 85, cy + 85);
    ctx.fillText("待機 25%", cx + 55, cy + 85);
  } else if (chartType === "gauge") {
    const cx = W / 2;
    const cy = 295;
    const r = 65;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.strokeStyle = "rgba(80, 60, 120, 0.6)";
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * 0.78);
    ctx.strokeStyle = "rgba(168, 132, 255, 0.9)";
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.font = "15px Arial";
    ctx.fillStyle = "#8866cc";
    ctx.fillText("0%", cx - r - 5, cy + 20);
    ctx.fillText("100%", cx + r - 10, cy + 20);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const taxiPanelData = [
  { title: "日次売上", value: "¥847,200", unit: "本日合計", chart: "bar" },
  { title: "乗車回数", value: "156", unit: "件 / 本日", chart: "line" },
  { title: "ピーク時間帯", value: "18-21時", unit: "最多乗車時間", chart: "line" },
  { title: "車両稼働率", value: "78%", unit: "全車両平均", chart: "gauge" },
];

// ---------------------------------------------------------------------------
// Synthetic Trip Dataset Generator
// Creates deterministic sample data for taxi analytics
// ---------------------------------------------------------------------------
const TAXI_DATASET_SEED = 42;
const TAXI_MONTHS = 6;
const TAXI_VEHICLES = ["車両A", "車両B", "車両C", "車両D", "車両E", "車両F", "車両G", "車両H"];
const TAXI_DRIVERS = ["田中", "鈴木", "佐藤", "山田", "高橋", "伊藤", "渡辺", "中村"];
// 営業エリア: 調布市を中心に三鷹市・府中市（8エリア。抽選インデックスは従来と同じ）
const TAXI_AREAS = ["調布駅周辺", "国領", "仙川", "つつじヶ丘・柴崎", "深大寺", "西調布・飛田給", "三鷹", "府中"];
const TAXI_WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// 住所 per 乗車地/降車地: [区市＋町名, 読み, 丁目の最大値(0=丁目なし)]. Real town names only, no 番地.
const TAXI_AREA_TOWNS = {
  調布駅周辺: [["調布市布田", "ふだ", 6], ["調布市小島町", "こじまちょう", 3], ["調布市下石原", "しもいしわら", 3], ["調布市富士見町", "ふじみちょう", 4], ["調布市八雲台", "やくもだい", 2]],
  国領: [["調布市国領町", "こくりょうちょう", 8], ["調布市染地", "そめち", 3], ["調布市多摩川", "たまがわ", 7], ["調布市調布ケ丘", "ちょうふがおか", 4]],
  仙川: [["調布市仙川町", "せんがわちょう", 3], ["調布市若葉町", "わかばちょう", 3], ["調布市緑ケ丘", "みどりがおか", 2], ["調布市入間町", "いりまちょう", 3]],
  "つつじヶ丘・柴崎": [["調布市西つつじケ丘", "にしつつじがおか", 4], ["調布市東つつじケ丘", "ひがしつつじがおか", 3], ["調布市菊野台", "きくのだい", 3], ["調布市柴崎", "しばさき", 2], ["調布市佐須町", "さずまち", 5]],
  深大寺: [["調布市深大寺元町", "じんだいじもとまち", 5], ["調布市深大寺北町", "じんだいじきたまち", 7], ["調布市深大寺南町", "じんだいじみなみまち", 5], ["調布市深大寺東町", "じんだいじひがしまち", 8], ["調布市野水", "のみず", 2]],
  "西調布・飛田給": [["調布市上石原", "かみいしわら", 3], ["調布市飛田給", "とびたきゅう", 3], ["調布市西町", "にしまち", 0]],
  三鷹: [["三鷹市大沢", "おおさわ", 6], ["三鷹市下連雀", "しもれんじゃく", 9], ["三鷹市上連雀", "かみれんじゃく", 9], ["三鷹市野崎", "のざき", 4], ["三鷹市深大寺", "じんだいじ", 3], ["三鷹市新川", "しんかわ", 6]],
  府中: [["府中市白糸台", "しらいとだい", 6], ["府中市多磨町", "たまちょう", 0], ["府中市紅葉丘", "もみじがおか", 3], ["府中市若松町", "わかまつちょう", 5], ["府中市朝日町", "あさひちょう", 0], ["府中市小柳町", "こやなぎちょう", 0], ["府中市押立町", "おしたてちょう", 0]],
};
const TAXI_ALL_AREAS = TAXI_AREAS;
const TAXI_SERVICE_MUNICIPALITIES = ["調布市", "三鷹市", "府中市"];
const TAXI_KANJI_NUM = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
// Homophones heard by speech recognition -> reading (e.g. 札 -> ふだ = 布田)
const TAXI_HOMOPHONES = { 札: "ふだ" };
const TAXI_TOWNS = Object.values(TAXI_AREA_TOWNS).flat().map(([t]) => t);
const TAXI_TOWN_READINGS = Object.fromEntries(Object.values(TAXI_AREA_TOWNS).flat().map(([t, r]) => [t, r]));
function taxiTownPart(name) {
  return String(name).replace(/^.+?[区市]/u, "");
}
function taxiStripChome(name) {
  return String(name).replace(/[一二三四五六七八九十]+丁目$/u, "");
}
function taxiReadingOf(name) {
  return TAXI_READINGS[name] || TAXI_TOWN_READINGS[name] || TAXI_TOWN_READINGS[taxiStripChome(name)] || null;
}
function taxiAddressFor(townEntry, r) {
  const [town, , maxChome] = townEntry;
  if (maxChome > 0 && r < 0.7) return `${town}${TAXI_KANJI_NUM[Math.floor((r / 0.7) * maxChome) + 1]}丁目`;
  return town;
}
// Sample-data fare rule: fare (税抜) = distance(km) × 600円, 税込 = 税抜 × (1 + 10%)
const TAXI_FARE_PER_KM = 600;
const TAXI_TAX_RATE = 0.10;
const TAXI_DISPATCH_FEE = 400; // 迎車料金 (not taxed, added after tax)
const TAXI_DISPATCH_RATE = 0.25;

// 税抜 = 距離×600, 消費税 = round(税抜×10%), 税込 = 税抜+消費税, 収入 = 税込 + 迎車料金(迎車時400円)
function taxiFareForDistance(distanceKm, dispatch = false) {
  const fare = Math.round(distanceKm * TAXI_FARE_PER_KM);
  const tax = Math.round(fare * TAXI_TAX_RATE);
  const fareWithTax = fare + tax;
  const dispatchFee = dispatch ? TAXI_DISPATCH_FEE : 0;
  return { fare, tax, fareWithTax, dispatchFee, totalFare: fareWithTax + dispatchFee };
}

function taxiSeededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function generateTaxiDataset() {
  const rand = taxiSeededRandom(TAXI_DATASET_SEED);
  // Separate RNG for minutes so the main rand() sequence (and every other field) is unchanged
  const minuteRand = taxiSeededRandom(TAXI_DATASET_SEED + 1000);
  // Another separate RNG for 迎車 (dispatch) flags
  const dispatchRand = taxiSeededRandom(TAXI_DATASET_SEED + 2000);
  // Another separate RNG for 町名 (pickupTown / dropoffTown)
  const townRand = taxiSeededRandom(TAXI_DATASET_SEED + 3000);
  // Another separate RNG for the 丁目 choice
  const addrRand = taxiSeededRandom(TAXI_DATASET_SEED + 4000);
  const trips = [];
  const today = new Date();
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - TAXI_MONTHS);
  
  let tripId = 1;
  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    const weekday = TAXI_WEEKDAYS[dayOfWeek];
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const baseTripsPerDay = isWeekend ? 120 : 160;
    const tripsToday = Math.floor(baseTripsPerDay * (0.8 + rand() * 0.4));
    
    for (let t = 0; t < tripsToday; t++) {
      const hour = Math.floor(weightedHourRandom(rand, isWeekend));
      const minute = Math.min(59, Math.floor(minuteRand() * 60));
      const vehicle = TAXI_VEHICLES[Math.floor(rand() * TAXI_VEHICLES.length)];
      const driver = TAXI_DRIVERS[Math.floor(rand() * TAXI_DRIVERS.length)];
      const pickupArea = TAXI_AREAS[Math.floor(rand() * TAXI_AREAS.length)];
      const dropoffArea = TAXI_AREAS[Math.floor(rand() * TAXI_AREAS.length)];
      const distance = Math.round((1 + rand() * 15) * 10) / 10;
      rand(); // former random fare multiplier: keep the RNG sequence so all other fields stay identical
      const dispatch = dispatchRand() < TAXI_DISPATCH_RATE;
      const pickupTowns = TAXI_AREA_TOWNS[pickupArea];
      const dropoffTowns = TAXI_AREA_TOWNS[dropoffArea];
      const pickupEntry = pickupTowns[Math.min(pickupTowns.length - 1, Math.floor(townRand() * pickupTowns.length))];
      const dropoffEntry = dropoffTowns[Math.min(dropoffTowns.length - 1, Math.floor(townRand() * dropoffTowns.length))];
      const pickupTown = pickupEntry[0];
      const dropoffTown = dropoffEntry[0];
      const pickupAddress = taxiAddressFor(pickupEntry, addrRand());
      const dropoffAddress = taxiAddressFor(dropoffEntry, addrRand());
      const occupiedMinutes = Math.round(distance * 4 + rand() * 10);
      const emptyMinutes = Math.round(rand() * 20 + 5);

      // Raw record (same shape an imported real record would have), normalised below
      trips.push(taxiTripFromRecord({
        id: tripId++,
        date: taxiLocalDateString(d),
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        vehicle,
        driver,
        pickupArea,
        pickupTown,
        pickupAddress,
        dropoffArea,
        dropoffTown,
        dropoffAddress,
        distance,
        dispatch,
        occupiedMinutes,
        emptyMinutes,
      }));
    }
  }
  return trips;
}

// ---------------------------------------------------------------------------
// Trip normaliser: builds the analysis record (derived calendar fields, fares,
// dropoff time) from a raw record. Real imported data (e.g. from a PDF) should be
// passed through this same function so query_data works unchanged.
// Raw fields: id, date "YYYY-MM-DD", time "HH:MM" (乗車時刻), vehicle, driver,
// pickupArea, pickupTown, pickupAddress, dropoffArea, dropoffTown, dropoffAddress,
// distance (km), dispatch (bool), occupiedMinutes, emptyMinutes,
// optional fare (税抜) / dropoffTime / dropoffDate if the source provides them.
// Addresses are kept verbatim (never normalised or completed).
// ---------------------------------------------------------------------------
function taxiTripFromRecord(rec) {
  const [y, mo, da] = String(rec.date).split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const [hh, mm] = String(rec.time || "00:00").split(":").map(Number);
  const occupiedMinutes = Number(rec.occupiedMinutes) || 0;
  let dropoffTime = rec.dropoffTime;
  let dropoffDate = rec.dropoffDate;
  if (!dropoffTime) {
    const total = hh * 60 + mm + occupiedMinutes;
    const dayShift = Math.floor(total / 1440);
    const m = total % 1440;
    dropoffTime = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (!dropoffDate) {
      const dd = new Date(d);
      dd.setDate(dd.getDate() + dayShift);
      dropoffDate = taxiLocalDateString(dd);
    }
  }
  if (!dropoffDate) dropoffDate = rec.date;
  const [dh, dm] = dropoffTime.split(":").map(Number);
  const dispatch = !!rec.dispatch;
  const computed = taxiFareForDistance(Number(rec.distance) || 0, dispatch);
  let { fare, tax, fareWithTax, dispatchFee, totalFare } = computed;
  if (rec.fare !== undefined && rec.fare !== null && rec.fare !== "") {
    fare = Math.round(Number(rec.fare));
    tax = Math.round(fare * TAXI_TAX_RATE);
    fareWithTax = fare + tax;
    totalFare = fareWithTax + dispatchFee;
  }
  return {
    id: rec.id,
    date: rec.date,
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: TAXI_WEEKDAYS[d.getDay()],
    dayOfWeek: d.getDay(),
    hour: hh,
    minute: mm,
    time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    dropoffDate,
    dropoffTime,
    dropoffHour: dh,
    dropoffMinute: dm,
    vehicle: rec.vehicle,
    driver: rec.driver,
    pickupArea: rec.pickupArea ?? "",
    pickupTown: rec.pickupTown ?? "",
    pickupAddress: rec.pickupAddress ?? rec.pickupTown ?? "",
    dropoffArea: rec.dropoffArea ?? "",
    dropoffTown: rec.dropoffTown ?? "",
    dropoffAddress: rec.dropoffAddress ?? rec.dropoffTown ?? "",
    distance: Number(rec.distance) || 0,
    dispatch,
    fare,
    tax,
    fareWithTax,
    dispatchFee,
    totalFare,
    occupiedMinutes,
    emptyMinutes: Number(rec.emptyMinutes) || 0,
  };
}

function weightedHourRandom(rand, isWeekend) {
  const weights = isWeekend
    ? [0.5, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1.2, 1.5, 1.8, 2.0, 2.2, 2.5, 2.3, 2.0, 1.8, 1.5, 2.0, 2.5, 3.0, 2.8, 2.5, 2.0, 1.2]
    : [0.3, 0.2, 0.1, 0.1, 0.2, 0.5, 1.0, 2.5, 3.0, 2.0, 1.5, 1.2, 1.5, 1.3, 1.2, 1.5, 2.0, 3.0, 3.5, 2.8, 2.2, 1.8, 1.2, 0.6];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let h = 0; h < 24; h++) {
    r -= weights[h];
    if (r <= 0) return h;
  }
  return 12;
}

const taxiTrips = generateTaxiDataset();
console.log(`Generated ${taxiTrips.length} synthetic taxi trips for analytics`);

// ---------------------------------------------------------------------------
// Analysis Spec Schema & Query Engine
// ---------------------------------------------------------------------------
const TAXI_METRICS = {
  fare: { label: "売上", unit: "円", aggregate: "sum", format: v => `¥${v.toLocaleString()}` },
  fareWithTax: { label: "売上(税込)", unit: "円", aggregate: "sum", field: "fareWithTax", format: v => `¥${v.toLocaleString()}` },
  totalFare: { label: "収入(税込+迎車)", unit: "円", aggregate: "sum", field: "totalFare", format: v => `¥${v.toLocaleString()}` },
  dispatchFee: { label: "迎車料金", unit: "円", aggregate: "sum", field: "dispatchFee", format: v => `¥${v.toLocaleString()}` },
  tripCount: { label: "乗車回数", unit: "件", aggregate: "count", format: v => `${v.toLocaleString()}件` },
  distance: { label: "走行距離", unit: "km", aggregate: "sum", format: v => `${v.toFixed(1)}km` },
  avgFare: { label: "平均運賃", unit: "円", aggregate: "avg", field: "fare", format: v => `¥${Math.round(v).toLocaleString()}` },
  avgDistance: { label: "平均距離", unit: "km", aggregate: "avg", field: "distance", format: v => `${v.toFixed(1)}km` },
  occupiedTime: { label: "実車時間", unit: "分", aggregate: "sum", field: "occupiedMinutes", format: v => `${Math.round(v).toLocaleString()}分` },
  emptyTime: { label: "空車時間", unit: "分", aggregate: "sum", field: "emptyMinutes", format: v => `${Math.round(v).toLocaleString()}分` },
  utilizationRate: { label: "稼働率", unit: "%", aggregate: "custom", format: v => `${v.toFixed(1)}%` },
};

const TAXI_DIMENSIONS = {
  month: { label: "月別", field: "month", format: v => `${v}月` },
  weekday: { label: "曜日別", field: "weekday", sort: (a, b) => TAXI_WEEKDAYS.indexOf(a) - TAXI_WEEKDAYS.indexOf(b) },
  hour: { label: "時間帯別", field: "hour", format: v => `${v}時` },
  vehicle: { label: "車両別", field: "vehicle" },
  driver: { label: "ドライバー別", field: "driver" },
  pickupArea: { label: "乗車地別", field: "pickupArea" },
  dropoffArea: { label: "降車地別", field: "dropoffArea" },
  pickupTown: { label: "乗車地町名別", field: "pickupTown" },
  dropoffTown: { label: "降車地町名別", field: "dropoffTown" },
  date: { label: "日別", field: "date" },
};

const TAXI_CHART_TYPES = ["bar", "line", "table", "kpi"];

function validateAnalysisSpec(spec) {
  const errors = [];
  if (!spec.metric || !TAXI_METRICS[spec.metric]) {
    errors.push(`無効なメトリック: ${spec.metric}`);
  }
  if (spec.groupBy && !TAXI_DIMENSIONS[spec.groupBy]) {
    errors.push(`無効なグループ化: ${spec.groupBy}`);
  }
  if (spec.chartType && !TAXI_CHART_TYPES.includes(spec.chartType)) {
    errors.push(`無効なチャートタイプ: ${spec.chartType}`);
  }
  return { valid: errors.length === 0, errors };
}

function queryTaxiData(spec) {
  const validation = validateAnalysisSpec(spec);
  if (!validation.valid) {
    return { error: validation.errors.join(", "), data: [] };
  }
  
  let data = [...taxiTrips];
  
  if (spec.filters) {
    for (const [field, value] of Object.entries(spec.filters)) {
      if (Array.isArray(value)) {
        data = data.filter(row => value.includes(row[field]));
      } else {
        data = data.filter(row => row[field] === value);
      }
    }
  }
  
  const metricDef = TAXI_METRICS[spec.metric];
  
  if (!spec.groupBy) {
    const value = aggregateMetric(data, spec.metric, metricDef);
    return {
      data: [{ label: metricDef.label, value, formatted: metricDef.format(value) }],
      total: value,
      totalFormatted: metricDef.format(value),
    };
  }
  
  const dimDef = TAXI_DIMENSIONS[spec.groupBy];
  const groups = new Map();
  
  for (const row of data) {
    const key = row[dimDef.field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  
  let result = [];
  for (const [key, rows] of groups) {
    const value = aggregateMetric(rows, spec.metric, metricDef);
    const label = dimDef.format ? dimDef.format(key) : String(key);
    result.push({ key, label, value, formatted: metricDef.format(value), count: rows.length });
  }
  
  if (dimDef.sort) {
    result.sort((a, b) => dimDef.sort(a.key, b.key));
  } else if (spec.sort === "desc") {
    result.sort((a, b) => b.value - a.value);
  } else if (spec.sort === "asc") {
    result.sort((a, b) => a.value - b.value);
  }
  
  if (spec.limit && spec.limit > 0) {
    result = result.slice(0, spec.limit);
  }
  
  const total = result.reduce((sum, r) => sum + r.value, 0);
  return {
    data: result,
    total,
    totalFormatted: metricDef.format(total),
  };
}

function aggregateMetric(rows, metric, metricDef) {
  if (rows.length === 0) return 0;
  
  switch (metricDef.aggregate) {
    case "count":
      return rows.length;
    case "sum":
      return rows.reduce((sum, r) => sum + (r[metricDef.field || metric] || 0), 0);
    case "avg":
      const field = metricDef.field || metric;
      return rows.reduce((sum, r) => sum + (r[field] || 0), 0) / rows.length;
    case "custom":
      if (metric === "utilizationRate") {
        const occupied = rows.reduce((sum, r) => sum + r.occupiedMinutes, 0);
        const empty = rows.reduce((sum, r) => sum + r.emptyMinutes, 0);
        return occupied / (occupied + empty) * 100;
      }
      return 0;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Free-form query tool for the AI assistant (query_data)
// Aggregates the synthetic trips with arbitrary filters and returns compact
// statistics (total / count / avg / max / min, per-group and per-day) that
// are sent back to the LLM as tool results.
// ---------------------------------------------------------------------------
const TAXI_QUERY_MAX_GROUPS = 31;
const TAXI_QUERY_DEFAULT_GROUPS = 10;
const TAXI_ADDITIVE_METRICS = ["tripCount", "fare", "fareWithTax", "totalFare", "dispatchFee", "distance", "occupiedTime", "emptyTime"];
const TAXI_PER_TRIP_FIELDS = { fare: "fare", fareWithTax: "fareWithTax", totalFare: "totalFare", avgFare: "fare", distance: "distance", avgDistance: "distance", occupiedTime: "occupiedMinutes", emptyTime: "emptyMinutes" };
const TAXI_READINGS = {
  調布駅周辺: "ちょうふえきしゅうへん", 国領: "こくりょう", 仙川: "せんがわ", "つつじヶ丘・柴崎": "つつじがおかしばさき",
  深大寺: "じんだいじ", "西調布・飛田給": "にしちょうふとびたきゅう", 三鷹: "みたか", 府中: "ふちゅう",
  田中: "たなか", 鈴木: "すずき", 佐藤: "さとう", 山田: "やまだ",
  高橋: "たかはし", 伊藤: "いとう", 渡辺: "わたなべ", 中村: "なかむら",
};
const TAXI_WEEKDAY_ALIASES = { sun: "日", mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土" };

function taxiRound(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function taxiLocalDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function taxiNormText(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

function taxiEditDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}

const TAXI_TERM_SUFFIX_RE = /(区|駅|周辺|エリア|地区|さん|氏|運転手|ドライバー|号車)$/u;

// Reading / suffix variant of exactly one valid value (e.g. "コクリョウ", "仙川駅", "スズキさん")
function taxiStrongMatch(value, validValues) {
  const v = taxiNormText(value).replace(TAXI_TERM_SUFFIX_RE, "");
  if (!v) return null;
  const hv = TAXI_HOMOPHONES[v] || v;
  const hits = validValues.filter(c => v === taxiNormText(c) || v === taxiNormText(taxiTownPart(c)) || hv === taxiReadingOf(c));
  return hits.length === 1 ? hits[0] : null;
}

// Suggest the closest valid values (kanji or reading, e.g. "センガワ" -> 仙川, "ふだ" -> 調布市布田)
function taxiSuggest(value, validValues, max = 3) {
  const v0 = taxiNormText(value).replace(TAXI_TERM_SUFFIX_RE, "");
  const v = TAXI_HOMOPHONES[v0] || v0;
  const scored = validValues.map(cand => {
    const forms = [taxiNormText(cand), taxiNormText(taxiTownPart(cand)), taxiNormText(taxiStripChome(taxiTownPart(cand))), taxiReadingOf(cand)].filter(Boolean);
    let best = Infinity;
    for (const f of forms) {
      let d = taxiEditDistance(v, f) / Math.max(v.length, f.length, 1);
      if (v && (f.includes(v) || v.includes(f))) d = Math.min(d, 0.1);
      best = Math.min(best, d);
    }
    return { cand, d: best };
  });
  scored.sort((a, b) => a.d - b.d || a.cand.length - b.cand.length);
  // No clear candidate (e.g. "車両Z": every vehicle is equally far) -> let validValues speak
  if (scored.length > max && scored[0].d === scored[max].d && scored[0].d > 0.1) return [];
  return scored.filter(s => s.d <= 0.67).slice(0, max).map(s => s.cand);
}

// Normalise trivial formatting variants; returns null when the value is unknown.
function taxiCanonicalValue(kind, raw) {
  const s = String(raw ?? "").normalize("NFKC").trim();
  if (kind === "weekday") {
    const w = s.replace(/曜日?$/u, "");
    if (TAXI_WEEKDAYS.includes(w)) return w;
    const alias = TAXI_WEEKDAY_ALIASES[w.toLowerCase().slice(0, 3)];
    return alias || null;
  }
  if (kind === "vehicle") {
    const m = /^(?:車両)?\s*([A-Za-z])(?:号車)?$/u.exec(s);
    const c = m ? `車両${m[1].toUpperCase()}` : s;
    return TAXI_VEHICLES.includes(c) ? c : null;
  }
  if (kind === "driver") {
    const c = s.replace(/(さん|氏)$/u, "");
    return TAXI_DRIVERS.includes(c) ? c : null;
  }
  if (kind === "area") return TAXI_ALL_AREAS.includes(s) ? s : null;
  if (kind === "town") {
    if (TAXI_TOWNS.includes(s)) return s;
    const hits = TAXI_TOWNS.filter(t => taxiTownPart(t) === s || taxiTownPart(t) === taxiTownPart(s) && t.startsWith(s.slice(0, s.length - taxiTownPart(s).length)));
    return hits.length === 1 ? hits[0] : null;
  }
  return null;
}

function taxiFilterValues(kind, input, fieldName, validValues, errors, applied) {
  if (input === undefined || input === null || input === "") return null;
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) return null;
  const out = [];
  for (const raw of list) {
    const c = taxiCanonicalValue(kind, raw);
    const strong = c ? null : taxiStrongMatch(raw, validValues);
    if (c) {
      out.push(c);
    } else if (strong) {
      out.push(strong);
      (applied.corrections = applied.corrections || []).push({
        from: raw,
        to: strong,
        message: `「${raw}」はデータに無い表記のため「${strong}」として集計した。回答では必ず「もしかして${strong}のことですか？」と確認を添えること`,
      });
    } else {
      errors.push({
        field: fieldName,
        value: raw,
        message: `「${raw}」はデータに存在しない値です`,
        ...(kind === "area" || kind === "town" ? { serviceArea: `データは営業エリア（${TAXI_SERVICE_MUNICIPALITIES.join("・")}）のみ。エリア外の地名なら該当0件` } : {}),
        suggestions: taxiSuggest(raw, validValues),
        validValues,
      });
    }
  }
  applied[fieldName] = out;
  return out.length ? new Set(out) : null;
}

function taxiNumberOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function taxiMetricValue(rows, metric) {
  if (!rows.length) return TAXI_ADDITIVE_METRICS.includes(metric) ? 0 : null;
  return aggregateMetric(rows, metric, TAXI_METRICS[metric]);
}

function taxiStatsOver(entries) {
  // entries: [{ key, value }] (value may be null for empty groups)
  const vals = entries.filter(e => e.value !== null && Number.isFinite(e.value));
  if (!vals.length) return null;
  let max = vals[0], min = vals[0], sum = 0;
  for (const e of vals) {
    sum += e.value;
    if (e.value > max.value) max = e;
    if (e.value < min.value) min = e;
  }
  return {
    groupCount: vals.length,
    sum: taxiRound(sum, 1),
    average: taxiRound(sum / vals.length, 1),
    max: { key: max.key, value: taxiRound(max.value, 1) },
    min: { key: min.key, value: taxiRound(min.value, 1) },
  };
}

function runTaxiFreeQuery(args = {}) {
  const metric = args.metric || "tripCount";
  const errors = [];
  if (!TAXI_METRICS[metric]) {
    errors.push({ field: "metric", value: metric, message: `無効なメトリック: ${metric}`, validValues: Object.keys(TAXI_METRICS) });
  }
  const groupBy = args.groupBy || "";
  if (groupBy && !TAXI_DIMENSIONS[groupBy]) {
    errors.push({ field: "groupBy", value: groupBy, message: `無効な集計軸: ${groupBy}`, validValues: Object.keys(TAXI_DIMENSIONS) });
  }

  const allDates = [...new Set(taxiTrips.map(t => t.date))].sort();
  const dataRange = { from: allDates[0], to: allDates[allDates.length - 1] };
  const applied = {};
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const dateFrom = args.dateFrom ? String(args.dateFrom) : null;
  const dateTo = args.dateTo ? String(args.dateTo) : null;
  for (const [k, v] of [["dateFrom", dateFrom], ["dateTo", dateTo]]) {
    if (v && !dateRe.test(v)) errors.push({ field: k, value: v, message: "日付は YYYY-MM-DD 形式で指定してください", validRange: dataRange });
  }
  if (dateFrom) applied.dateFrom = dateFrom;
  if (dateTo) applied.dateTo = dateTo;

  const hourFrom = taxiNumberOrNull(args.hourFrom);
  const hourTo = taxiNumberOrNull(args.hourTo);
  if (hourFrom !== null && !(Number.isInteger(hourFrom) && hourFrom >= 0 && hourFrom <= 23)) {
    errors.push({ field: "hourFrom", value: args.hourFrom, message: "hourFrom は 0〜23 の整数です（開始時刻・含む）" });
  }
  if (hourTo !== null && !(Number.isInteger(hourTo) && hourTo >= 1 && hourTo <= 24)) {
    errors.push({ field: "hourTo", value: args.hourTo, message: "hourTo は 1〜24 の整数です（終了時刻・含まない）" });
  }
  let hourSet = null;
  if ((hourFrom !== null || hourTo !== null) && !errors.some(e => e.field.startsWith("hour"))) {
    const hf = hourFrom ?? 0;
    const ht = hourTo ?? 24;
    hourSet = new Set();
    if (hf < ht) {
      for (let h = hf; h < ht; h++) hourSet.add(h);
    } else {
      for (let h = hf; h < 24; h++) hourSet.add(h);
      for (let h = 0; h < ht; h++) hourSet.add(h);
    }
    const hs = [...hourSet];
    applied.hours = `${hf}:00〜${ht}:00（${ht}時ちょうどは含まない。乗車開始hour=${hs.join(",")}）`;
  }

  // timeFrom / timeTo ("HH:MM", from inclusive, to exclusive, wraps past midnight). Wins over hourFrom/hourTo.
  const parseHm = (v, allow24) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).normalize("NFKC").trim());
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (mi > 59 || h > 24 || (h === 24 && (mi !== 0 || !allow24))) return null;
    return h * 60 + mi;
  };
  let timeRange = null;
  const hasTimeFrom = args.timeFrom !== undefined && args.timeFrom !== null && args.timeFrom !== "";
  const hasTimeTo = args.timeTo !== undefined && args.timeTo !== null && args.timeTo !== "";
  if (hasTimeFrom || hasTimeTo) {
    const tf = hasTimeFrom ? parseHm(args.timeFrom, false) : 0;
    const tt = hasTimeTo ? parseHm(args.timeTo, true) : 1440;
    if (tf === null) errors.push({ field: "timeFrom", value: args.timeFrom, message: "timeFrom は \"HH:MM\"（00:00〜23:59、含む）で指定してください" });
    if (tt === null) errors.push({ field: "timeTo", value: args.timeTo, message: "timeTo は \"HH:MM\"（00:01〜24:00、含まない）で指定してください" });
    if (tf !== null && tt !== null) {
      timeRange = { from: tf, to: tt };
      const fmt = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      applied.time = `${fmt(tf)}〜${fmt(tt)}（${fmt(tt)}ちょうどは含まない${tf >= tt ? "、深夜をまたぐ" : ""}）`;
      if (hourSet) {
        applied.hoursIgnored = "timeFrom/timeTo を優先したため hourFrom/hourTo は無視";
        delete applied.hours;
      }
      // hours touched by the time range (for groupBy=hour)
      hourSet = new Set();
      const span = tf < tt ? tt - tf : 1440 - tf + tt;
      for (let k = 0; k < span; k++) hourSet.add(Math.floor(((tf + k) % 1440) / 60));
    }
  }
  const inTimeRange = t => {
    if (!timeRange) return true;
    const m = t.hour * 60 + t.minute;
    return timeRange.from < timeRange.to ? (m >= timeRange.from && m < timeRange.to) : (m >= timeRange.from || m < timeRange.to);
  };

  // Dropoff time range (降車時刻) "HH:MM", from inclusive, to exclusive, wraps past midnight
  let dropoffRange = null;
  const hasDf = args.dropoffTimeFrom !== undefined && args.dropoffTimeFrom !== null && args.dropoffTimeFrom !== "";
  const hasDt = args.dropoffTimeTo !== undefined && args.dropoffTimeTo !== null && args.dropoffTimeTo !== "";
  if (hasDf || hasDt) {
    const df = hasDf ? parseHm(args.dropoffTimeFrom, false) : 0;
    const dt = hasDt ? parseHm(args.dropoffTimeTo, true) : 1440;
    if (df === null) errors.push({ field: "dropoffTimeFrom", value: args.dropoffTimeFrom, message: "dropoffTimeFrom は \"HH:MM\"（含む）で指定してください" });
    if (dt === null) errors.push({ field: "dropoffTimeTo", value: args.dropoffTimeTo, message: "dropoffTimeTo は \"HH:MM\"（含まない、\"24:00\"可）で指定してください" });
    if (df !== null && dt !== null) {
      dropoffRange = { from: df, to: dt };
      const fmt = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      applied.dropoffTime = `降車 ${fmt(df)}〜${fmt(dt)}（${fmt(dt)}ちょうどは含まない${df >= dt ? "、深夜をまたぐ" : ""}）`;
    }
  }
  const inDropoffRange = t => {
    if (!dropoffRange) return true;
    const m = t.dropoffHour * 60 + t.dropoffMinute;
    return dropoffRange.from < dropoffRange.to ? (m >= dropoffRange.from && m < dropoffRange.to) : (m >= dropoffRange.from || m < dropoffRange.to);
  };

  // Address keywords: verbatim substring match (OR within an array) against the raw address
  const keywordList = v => (v === undefined || v === null || v === "" ? null : (Array.isArray(v) ? v : [v]).map(k => String(k).normalize("NFKC").trim()).filter(Boolean));
  const pickupKeywords = keywordList(args.pickupKeyword);
  const dropoffKeywords = keywordList(args.dropoffKeyword);
  for (const [kws, field, label] of [[pickupKeywords, "pickupAddress", "pickupKeyword"], [dropoffKeywords, "dropoffAddress", "dropoffKeyword"]]) {
    if (!kws || !kws.length) continue;
    applied[label] = kws;
    const addresses = [...new Set(taxiTrips.map(t => t[field]).filter(Boolean))];
    const otherField = field === "pickupAddress" ? "dropoffAddress" : "pickupAddress";
    for (const kw of kws) {
      if (!addresses.some(a => a.normalize("NFKC").includes(kw))) {
        const otherTrips = taxiTrips.filter(t => String(t[otherField] || "").normalize("NFKC").includes(kw)).length;
        errors.push({
          ...(otherTrips ? { foundInOtherSide: { field: otherField === "dropoffAddress" ? "降車地住所" : "乗車地住所", trips: otherTrips } } : {}),
          field: label,
          value: kw,
          message: `「${kw}」を含む住所はデータにありません（0件）。データは営業エリア（${TAXI_SERVICE_MUNICIPALITIES.join("・")}）のみ`,
          suggestions: taxiSuggest(kw, addresses, 5),
          knownAddressesSample: addresses.slice(0, 30),
        });
      }
    }
  }
  const matchKw = (kws, addr) => !kws || !kws.length || kws.some(k => String(addr || "").normalize("NFKC").includes(k));

  const weekdaySet = taxiFilterValues("weekday", args.weekdays, "weekdays", TAXI_WEEKDAYS, errors, applied);
  const vehicleSet = taxiFilterValues("vehicle", args.vehicles, "vehicles", TAXI_VEHICLES, errors, applied);
  const driverSet = taxiFilterValues("driver", args.drivers, "drivers", TAXI_DRIVERS, errors, applied);
  const pickupSet = taxiFilterValues("area", args.pickupAreas, "pickupAreas", TAXI_ALL_AREAS, errors, applied);
  const dropoffSet = taxiFilterValues("area", args.dropoffAreas, "dropoffAreas", TAXI_ALL_AREAS, errors, applied);
  const pickupTownSet = taxiFilterValues("town", args.pickupTowns, "pickupTowns", TAXI_TOWNS, errors, applied);
  const dropoffTownSet = taxiFilterValues("town", args.dropoffTowns, "dropoffTowns", TAXI_TOWNS, errors, applied);

  let dispatchFilter = null;
  if (args.dispatch !== undefined && args.dispatch !== null && args.dispatch !== "") {
    const dv = String(args.dispatch).normalize("NFKC").trim().toLowerCase();
    if (["true", "1", "yes", "はい", "あり", "有"].includes(dv)) dispatchFilter = true;
    else if (["false", "0", "no", "いいえ", "なし", "無"].includes(dv)) dispatchFilter = false;
    else errors.push({ field: "dispatch", value: args.dispatch, message: "dispatch は true(迎車あり) / false(迎車なし) で指定してください" });
    if (dispatchFilter !== null) applied.dispatch = dispatchFilter ? "迎車ありのみ" : "迎車なしのみ";
  }

  const ranges = {};
  for (const k of ["distanceMin", "distanceMax", "fareMin", "fareMax"]) {
    const n = taxiNumberOrNull(args[k]);
    if (Number.isNaN(n)) errors.push({ field: k, value: args[k], message: `${k} は数値で指定してください` });
    else if (n !== null) { ranges[k] = n; applied[k] = n; }
  }

  if (errors.length) {
    return {
      error: "指定された条件に無効な値があります。suggestions の候補をユーザーに「もしかして〇〇のことですか？」と確認してください。",
      invalid: errors,
      dataRange,
    };
  }

  // Base calendar filter (date range + weekday) defines which days exist
  const inCalendar = t =>
    (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo) &&
    (!weekdaySet || weekdaySet.has(t.weekday));
  const calendarDays = [...new Set(taxiTrips.filter(inCalendar).map(t => t.date))].sort();

  const rows = taxiTrips.filter(t =>
    inCalendar(t) &&
    (timeRange ? inTimeRange(t) : (!hourSet || hourSet.has(t.hour))) &&
    (!vehicleSet || vehicleSet.has(t.vehicle)) &&
    (!driverSet || driverSet.has(t.driver)) &&
    (!pickupSet || pickupSet.has(t.pickupArea)) &&
    (!dropoffSet || dropoffSet.has(t.dropoffArea)) &&
    (dispatchFilter === null || t.dispatch === dispatchFilter) &&
    (!pickupTownSet || pickupTownSet.has(t.pickupTown)) &&
    inDropoffRange(t) &&
    matchKw(pickupKeywords, t.pickupAddress) &&
    matchKw(dropoffKeywords, t.dropoffAddress) &&
    (!dropoffTownSet || dropoffTownSet.has(t.dropoffTown)) &&
    (ranges.distanceMin === undefined || t.distance >= ranges.distanceMin) &&
    (ranges.distanceMax === undefined || t.distance <= ranges.distanceMax) &&
    (ranges.fareMin === undefined || t.fare >= ranges.fareMin) &&
    (ranges.fareMax === undefined || t.fare <= ranges.fareMax)
  );

  const def = TAXI_METRICS[metric];
  const overall = taxiMetricValue(rows, metric);
  const result = {
    metric,
    metricLabel: def.label,
    unit: def.unit,
    filters: applied,
    dataRange,
    matchedTrips: rows.length,
    daysInPeriod: calendarDays.length,
    value: taxiRound(overall, 1),
    valueFormatted: overall === null ? "データなし" : def.format(overall),
  };

  // Per-trip stats (1回あたり) for fare / distance / time metrics
  const tripField = TAXI_PER_TRIP_FIELDS[metric];
  if (tripField && rows.length) {
    let max = rows[0], min = rows[0], sum = 0;
    for (const t of rows) {
      sum += t[tripField];
      if (t[tripField] > max[tripField]) max = t;
      if (t[tripField] < min[tripField]) min = t;
    }
    const brief = t => ({ value: t[tripField], date: t.date, time: t.time, dropoffTime: t.dropoffTime, vehicle: t.vehicle, driver: t.driver, pickupArea: t.pickupArea, dropoffArea: t.dropoffArea });
    result.perTrip = { field: tripField, average: taxiRound(sum / rows.length, 1), max: brief(max), min: brief(min) };
  }

  // Per-day stats (1日あたり): average / max day / min day over all days in the period
  if (TAXI_ADDITIVE_METRICS.includes(metric) && groupBy !== "date" && calendarDays.length) {
    const byDay = new Map(calendarDays.map(d => [d, []]));
    for (const t of rows) byDay.get(t.date)?.push(t);
    const dayEntries = calendarDays.map(d => ({ key: d, value: taxiMetricValue(byDay.get(d), metric) }));
    const s = taxiStatsOver(dayEntries);
    if (s) result.perDay = { days: s.groupCount, average: s.average, max: s.max, min: s.min };
  }

  // Fare summary for every query: 税抜 / 税込 / 収入(税込+迎車) totals, per-trip avg/max/min,
  // per-day avg/max/min, plus a 迎車あり/なし breakdown
  if (rows.length) {
    const fields = ["fare", "fareWithTax", "totalFare"];
    const byDayFare = new Map(calendarDays.map(d => [d, [0, 0, 0]]));
    const acc = fields.map(() => ({ total: 0, max: -Infinity, min: Infinity }));
    const disp = { with: [0, 0, 0, 0, 0], without: [0, 0, 0, 0, 0] }; // trips, fare, fareWithTax, dispatchFee, totalFare
    for (const t of rows) {
      const b = byDayFare.get(t.date);
      fields.forEach((f, i) => {
        const v = t[f];
        acc[i].total += v;
        if (v > acc[i].max) acc[i].max = v;
        if (v < acc[i].min) acc[i].min = v;
        if (b) b[i] += v;
      });
      const d = t.dispatch ? disp.with : disp.without;
      d[0]++; d[1] += t.fare; d[2] += t.fareWithTax; d[3] += t.dispatchFee; d[4] += t.totalFare;
    }
    const dayStats = i => {
      const e = taxiStatsOver([...byDayFare.entries()].map(([k, v]) => ({ key: k, value: v[i] })));
      return e ? { avg: e.average, max: e.max, min: e.min } : null;
    };
    const block = i => ({ total: acc[i].total, perTripAvg: taxiRound(acc[i].total / rows.length, 1), perTripMax: acc[i].max, perTripMin: acc[i].min, perDay: dayStats(i) });
    const dBlock = d => ({ trips: d[0], fare: d[1], fareWithTax: d[2], dispatchFee: d[3], totalFare: d[4] });
    result.fareSummary = {
      rule: `税抜=距離×${TAXI_FARE_PER_KM}円, 税込=税抜+消費税${TAXI_TAX_RATE * 100}%, 収入=税込+迎車料金${TAXI_DISPATCH_FEE}円(迎車時のみ・非課税)`,
      taxExcluded: block(0),
      taxIncluded: block(1),
      totalIncome: block(2),
      dispatchFeeTotal: disp.with[3] + disp.without[3],
      byDispatch: { 迎車あり: dBlock(disp.with), 迎車なし: dBlock(disp.without) },
    };
  }

  if (groupBy) {
    const dim = TAXI_DIMENSIONS[groupBy];
    let domain;
    if (groupBy === "date") domain = calendarDays;
    else if (groupBy === "month") domain = [...new Set(taxiTrips.filter(inCalendar).map(t => t.month))];
    else if (groupBy === "hour") domain = hourSet ? [...hourSet] : Array.from({ length: 24 }, (_, h) => h);
    else if (groupBy === "weekday") domain = weekdaySet ? TAXI_WEEKDAYS.filter(w => weekdaySet.has(w)) : [...TAXI_WEEKDAYS];
    else if (groupBy === "vehicle") domain = vehicleSet ? [...vehicleSet] : [...TAXI_VEHICLES];
    else if (groupBy === "driver") domain = driverSet ? [...driverSet] : [...TAXI_DRIVERS];
    else if (groupBy === "pickupArea") domain = pickupSet ? [...pickupSet] : [...TAXI_AREAS];
    else if (groupBy === "dropoffArea") domain = dropoffSet ? [...dropoffSet] : [...TAXI_ALL_AREAS];
    else if (groupBy === "pickupTown") domain = pickupTownSet ? [...pickupTownSet] : (pickupSet ? [...pickupSet].flatMap(a => TAXI_AREA_TOWNS[a].map(x => x[0])) : [...TAXI_TOWNS]);
    else if (groupBy === "dropoffTown") domain = dropoffTownSet ? [...dropoffTownSet] : (dropoffSet ? [...dropoffSet].flatMap(a => TAXI_AREA_TOWNS[a].map(x => x[0])) : [...TAXI_TOWNS]);
    else domain = [...new Set(rows.map(t => t[dim.field]))];

    const buckets = new Map(domain.map(k => [k, []]));
    for (const t of rows) {
      const k = t[dim.field];
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    }
    const labelOf = k => (dim.format ? dim.format(k) : String(k));
    let entries = [...buckets.entries()].map(([k, rs]) => ({ key: labelOf(k), rawKey: k, value: taxiMetricValue(rs, metric), trips: rs.length }));
    result.groupStats = { groupBy, groupLabel: dim.label, ...taxiStatsOver(entries) };
    if (!TAXI_ADDITIVE_METRICS.includes(metric)) delete result.groupStats.sum;

    const sort = args.sort || (groupBy === "date" || groupBy === "hour" || groupBy === "month" || groupBy === "weekday" ? "key" : "desc");
    if (sort === "desc") entries.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    else if (sort === "asc") entries.sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity));
    else if (dim.sort) entries.sort((a, b) => dim.sort(a.rawKey, b.rawKey));
    else entries.sort((a, b) => (a.rawKey < b.rawKey ? -1 : a.rawKey > b.rawKey ? 1 : 0));

    const limit = Math.max(1, Math.min(TAXI_QUERY_MAX_GROUPS, parseInt(args.limit, 10) || TAXI_QUERY_DEFAULT_GROUPS));
    result.groups = entries.slice(0, limit).map(e => ({ key: e.key, value: taxiRound(e.value, 1), trips: e.trips }));
    if (entries.length > limit) result.groupsTruncated = `${entries.length}グループ中 ${limit}件のみ表示（sort=${sort}）`;
  }

  result.note = "サンプル（合成）データによる集計結果";
  return result;
}

// ---------------------------------------------------------------------------
// Dynamic Panel Renderer
// ---------------------------------------------------------------------------
const MAX_DYNAMIC_PANELS = 4;
const dynamicTaxiPanels = [];
const DYNAMIC_PANEL_WIDTH = 2.0; // v19: 2x (was 1.0 x 0.85)
const DYNAMIC_PANEL_HEIGHT = 1.7;

function renderDynamicPanelTexture(spec, queryResult) {
  const c = document.createElement("canvas");
  const W = 480;
  const H = 400;
  c.width = W * 2;
  c.height = H * 2;
  const ctx = c.getContext("2d");
  ctx.scale(2, 2);
  
  ctx.fillStyle = "rgba(15, 10, 28, 0.94)";
  ctx.fillRect(0, 0, W, H);
  
  ctx.strokeStyle = "rgba(100, 180, 255, 0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  
  ctx.fillStyle = "rgba(100, 180, 255, 0.12)";
  ctx.fillRect(8, 8, W - 16, 44);
  
  const title = spec.title || `${TAXI_METRICS[spec.metric]?.label || spec.metric}${spec.groupBy ? ` (${TAXI_DIMENSIONS[spec.groupBy]?.label || spec.groupBy})` : ""}`;
  ctx.font = "bold 24px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#a8d4ff";
  ctx.textAlign = "center";
  ctx.fillText(truncateText(ctx, title, W - 40), W / 2, 38);
  
  ctx.font = "14px Arial";
  ctx.fillStyle = "rgba(255, 200, 100, 0.85)";
  ctx.fillText("⚠ サンプルデータ", W / 2, 58);
  
  const chartType = spec.chartType || (spec.groupBy ? "bar" : "kpi");
  const data = queryResult.data || [];
  
  if (chartType === "kpi" || (!spec.groupBy && data.length === 1)) {
    ctx.font = "bold 56px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(data[0]?.formatted || "N/A", W / 2, 180);
    ctx.font = "22px Arial";
    ctx.fillStyle = "#8899bb";
    ctx.fillText(TAXI_METRICS[spec.metric]?.label || "", W / 2, 215);
  } else if (chartType === "bar") {
    renderBarChart(ctx, data, 30, 80, W - 60, 280);
  } else if (chartType === "line") {
    renderLineChart(ctx, data, 30, 80, W - 60, 280);
  } else if (chartType === "table") {
    renderTable(ctx, data, spec, 20, 75, W - 40, 300);
  }
  
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 3 && ctx.measureText(text + "...").width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + "...";
}

function renderBarChart(ctx, data, x, y, width, height) {
  if (data.length === 0) return;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barWidth = Math.min(40, (width - 20) / data.length - 8);
  const chartHeight = height - 50;
  const startX = x + (width - (barWidth + 8) * data.length) / 2;
  
  for (let i = 0; i < Math.min(data.length, 12); i++) {
    const d = data[i];
    const barH = (d.value / maxVal) * chartHeight;
    const bx = startX + i * (barWidth + 8);
    const by = y + chartHeight - barH;
    
    ctx.fillStyle = "rgba(100, 180, 255, 0.8)";
    ctx.fillRect(bx, by, barWidth, barH);
    
    ctx.font = "13px Arial";
    ctx.fillStyle = "#aabbcc";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(bx + barWidth / 2, y + chartHeight + 12);
    ctx.fillText(truncateText(ctx, d.label, barWidth + 6), 0, 0);
    ctx.restore();
    
    ctx.fillStyle = "#ffffff";
    ctx.fillText(abbreviateNumber(d.value), bx + barWidth / 2, by - 5);
  }
}

function renderLineChart(ctx, data, x, y, width, height) {
  if (data.length < 2) {
    renderBarChart(ctx, data, x, y, width, height);
    return;
  }
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const chartHeight = height - 50;
  const stepX = (width - 40) / (data.length - 1);
  
  ctx.beginPath();
  ctx.strokeStyle = "rgba(100, 200, 255, 0.9)";
  ctx.lineWidth = 3;
  
  for (let i = 0; i < data.length; i++) {
    const px = x + 20 + i * stepX;
    const py = y + chartHeight - (data[i].value / maxVal) * chartHeight;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  
  for (let i = 0; i < data.length; i++) {
    const px = x + 20 + i * stepX;
    const py = y + chartHeight - (data[i].value / maxVal) * chartHeight;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#64c8ff";
    ctx.fill();
  }
  
  ctx.font = "13px Arial";
  ctx.fillStyle = "#aabbcc";
  ctx.textAlign = "center";
  const labelStep = Math.ceil(data.length / 8);
  for (let i = 0; i < data.length; i += labelStep) {
    const px = x + 20 + i * stepX;
    ctx.fillText(truncateText(ctx, data[i].label, stepX * labelStep - 4), px, y + chartHeight + 15);
  }
}

function renderTable(ctx, data, spec, x, y, width, height) {
  const rowHeight = 24;
  const maxRows = Math.floor((height - 30) / rowHeight);
  const displayData = data.slice(0, maxRows);
  
  ctx.fillStyle = "rgba(60, 80, 100, 0.3)";
  ctx.fillRect(x, y, width, 26);
  
  ctx.font = "bold 15px Arial";
  ctx.fillStyle = "#a8d4ff";
  ctx.textAlign = "left";
  ctx.fillText(TAXI_DIMENSIONS[spec.groupBy]?.label || "項目", x + 10, y + 18);
  ctx.textAlign = "right";
  ctx.fillText(TAXI_METRICS[spec.metric]?.label || "値", x + width - 10, y + 18);
  
  ctx.font = "15px Arial";
  for (let i = 0; i < displayData.length; i++) {
    const ry = y + 30 + i * rowHeight;
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(40, 50, 70, 0.3)";
      ctx.fillRect(x, ry, width, rowHeight);
    }
    ctx.fillStyle = "#c8d8e8";
    ctx.textAlign = "left";
    ctx.fillText(truncateText(ctx, displayData[i].label, width * 0.5), x + 10, ry + 16);
    ctx.textAlign = "right";
    ctx.fillText(displayData[i].formatted, x + width - 10, ry + 16);
  }
}

function abbreviateNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 10000) return (num / 10000).toFixed(1) + "万";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toFixed(0);
}

function createDynamicPanel(spec) {
  const validation = validateAnalysisSpec(spec);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join(", ") };
  }
  
  const queryResult = queryTaxiData(spec);
  if (queryResult.error) {
    return { success: false, error: queryResult.error };
  }
  
  // slot: own slot if the same kind exists, else the first free slot, else the oldest panel's slot
  const key = taxiDynamicPanelKey(spec);
  let slot = -1;
  let replaced = false;
  const sameIdx = dynamicTaxiPanels.findIndex((p) => p.key === key);
  if (sameIdx >= 0) {
    const same = dynamicTaxiPanels.splice(sameIdx, 1)[0];
    slot = same.slot;
    replaced = true;
    disposeDynamicPanel(same);
  } else {
    const used = new Set(dynamicTaxiPanels.map((p) => p.slot));
    for (let i = 0; i < Math.min(MAX_DYNAMIC_PANELS, TAXI_DISPLAY_SLOT_COUNT); i++) {
      if (!used.has(i)) { slot = i; break; }
    }
    if (slot < 0) {
      const oldest = dynamicTaxiPanels.shift();
      slot = oldest.slot;
      disposeDynamicPanel(oldest);
    }
  }
  
  const texture = renderDynamicPanelTexture(spec, queryResult);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(DYNAMIC_PANEL_WIDTH, DYNAMIC_PANEL_HEIGHT),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
  );
  
  placeTaxiDisplaySlot(mesh, slot, TAXI_CREATED_ROW_Y);
  taxiAnalyticsGroup.add(mesh);
  
  const panelInfo = { spec, queryResult, mesh, key, slot, replaced, createdAt: Date.now() };
  dynamicTaxiPanels.push(panelInfo);
  
  return {
    success: true,
    panel: panelInfo,
    summary: `${spec.title || TAXI_METRICS[spec.metric]?.label}を表示しました（${queryResult.data.length}件のデータ）`,
  };
}

// Display slots (v19): one "row" of 4 slots that wraps from the left wall (front -> back)
// onto the back wall, i.e. left-to-right as seen from the room. Fixed dashboard panels
// occupy the top row; LLM-created panels go into the row directly BELOW, same slot index,
// on the same wall plane (no forward offset, no tilt).
const TAXI_DISPLAY_SLOT_COUNT = 4;
const TAXI_DISPLAY_SLOT_PITCH = 2.6; // fixed panel width 2.4 + gap 0.2
const TAXI_FIXED_ROW_Y = TAXI_ANALYTICS_ROOM_POSITION.y + 1.1; // 3.3 (2.4..4.2)
const TAXI_CREATED_ROW_Y = TAXI_FIXED_ROW_Y - 0.9 - 0.1 - DYNAMIC_PANEL_HEIGHT / 2; // 1.45 (0.6..2.3)

function placeTaxiDisplaySlot(mesh, slot, y) {
  const wallX = TAXI_ANALYTICS_ROOM_POSITION.x - TAXI_ANALYTICS_ROOM_HALF.x + 0.3; // 11.3
  const wallZ = TAXI_ANALYTICS_ROOM_POSITION.z - TAXI_ANALYTICS_ROOM_HALF.z + 0.4; // -5.8
  mesh.rotation.set(0, 0, 0);
  if (slot < 2) {
    mesh.position.set(wallX, y, TAXI_ANALYTICS_ROOM_POSITION.z + (0.5 - slot) * TAXI_DISPLAY_SLOT_PITCH);
    mesh.rotation.y = Math.PI / 2; // faces +x
  } else {
    mesh.position.set(TAXI_ANALYTICS_ROOM_POSITION.x + (slot - 2.5) * TAXI_DISPLAY_SLOT_PITCH, y, wallZ);
  }
}

// Same kind of panel (metric + grouping) replaces itself instead of stacking duplicates.
function taxiDynamicPanelKey(spec) {
  return `${spec.metric || ""}|${spec.groupBy || ""}`;
}

function disposeDynamicPanel(panel) {
  if (!panel?.mesh) return;
  panel.mesh.geometry.dispose();
  panel.mesh.material.map?.dispose();
  panel.mesh.material.dispose();
  taxiAnalyticsGroup.remove(panel.mesh);
}

function clearDynamicPanels() {
  for (const panel of dynamicTaxiPanels) {
    if (panel.mesh) {
      panel.mesh.geometry.dispose();
      panel.mesh.material.map?.dispose();
      panel.mesh.material.dispose();
      taxiAnalyticsGroup.remove(panel.mesh);
    }
  }
  dynamicTaxiPanels.length = 0;
  return { success: true, message: "動的パネルをすべてクリアしました。" };
}

function listAvailableAnalyses() {
  const metrics = Object.entries(TAXI_METRICS).map(([k, v]) => `${v.label}`).join("、");
  const dimensions = Object.entries(TAXI_DIMENSIONS).map(([k, v]) => `${v.label}`).join("、");
  return {
    metrics: Object.keys(TAXI_METRICS),
    dimensions: Object.keys(TAXI_DIMENSIONS),
    chartTypes: TAXI_CHART_TYPES,
    description: `利用可能なメトリック: ${metrics}\n利用可能な集計軸: ${dimensions}\nチャートタイプ: 棒グラフ、折れ線、表、KPI`,
    examples: [
      "月別の売上推移を出して",
      "曜日別の乗車回数を見せて",
      "車両ごとの稼働率比較",
      "時間帯別の売上をグラフで",
      "ドライバー別の走行距離",
      "乗車地別の乗車回数トップ5",
    ],
  };
}

const taxiAnalyticsPanels = [];
const TAXI_PANEL_WIDTH = 2.4; // v19: 2x (was 1.2 x 0.9)
const TAXI_PANEL_HEIGHT = 1.8;
const TAXI_PANEL_GAP = 0.2;
const TAXI_PANEL_START_X = TAXI_ANALYTICS_ROOM_POSITION.x - ((taxiPanelData.length - 1) * (TAXI_PANEL_WIDTH + TAXI_PANEL_GAP)) / 2;

for (let i = 0; i < taxiPanelData.length; i++) {
  const data = taxiPanelData[i];
  const panelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TAXI_PANEL_WIDTH, TAXI_PANEL_HEIGHT),
    new THREE.MeshBasicMaterial({
      map: makeTaxiAnalyticsPanelTexture(data.title, data.value, data.unit, data.chart),
      transparent: true,
      side: THREE.DoubleSide,
    })
  );
  // v19: top row of the display slots (left wall front, left wall back, back wall left, back wall right)
  placeTaxiDisplaySlot(panelMesh, i, TAXI_FIXED_ROW_Y);
  taxiAnalyticsGroup.add(panelMesh);
  taxiAnalyticsPanels.push(panelMesh);
}

const taxiRoomTitleCanvas = document.createElement("canvas");
taxiRoomTitleCanvas.width = 1200;
taxiRoomTitleCanvas.height = 120;
const taxiTitleCtx = taxiRoomTitleCanvas.getContext("2d");
taxiTitleCtx.fillStyle = "rgba(18, 12, 32, 0.85)";
taxiTitleCtx.fillRect(0, 0, 1200, 120);
taxiTitleCtx.strokeStyle = "rgba(168, 132, 255, 0.5)";
taxiTitleCtx.lineWidth = 2;
taxiTitleCtx.strokeRect(4, 4, 1192, 112);
const taxiRoomTitleText = "分析用の部屋 - タクシー業務ダッシュボード";
const maxTitleTextWidth = 1120;
let titleFontSize = 48;
do {
  taxiTitleCtx.font = `bold ${titleFontSize}px Arial, Helvetica, sans-serif`;
  titleFontSize -= 2;
} while (titleFontSize > 28 && taxiTitleCtx.measureText(taxiRoomTitleText).width > maxTitleTextWidth);
taxiTitleCtx.fillStyle = "#e4daff";
taxiTitleCtx.textAlign = "center";
taxiTitleCtx.fillText(taxiRoomTitleText, 600, 75);
const taxiRoomTitleTex = new THREE.CanvasTexture(taxiRoomTitleCanvas);
taxiRoomTitleTex.colorSpace = THREE.SRGBColorSpace;

const taxiRoomTitleMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(3.6, 0.36),
  new THREE.MeshBasicMaterial({ map: taxiRoomTitleTex, transparent: true, side: THREE.DoubleSide })
);
taxiRoomTitleMesh.position.set(
  TAXI_ANALYTICS_ROOM_POSITION.x,
  TAXI_ANALYTICS_ROOM_POSITION.y + 1.5,
  TAXI_ANALYTICS_ROOM_POSITION.z - TAXI_ANALYTICS_ROOM_HALF.z + 0.3
);
taxiAnalyticsGroup.add(taxiRoomTitleMesh);

function makeTaxiReturnButtonTexture() {
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 100;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(60, 180, 255, 0.92)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
  ctx.font = "bold 36px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText("← 太陽系の部屋へ戻る", c.width / 2, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const taxiReturnXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(0.72, 0.18),
  new THREE.MeshBasicMaterial({
    map: makeTaxiReturnButtonTexture(),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
taxiReturnXrButton.position.set(
  TAXI_ANALYTICS_ROOM_POSITION.x,
  TAXI_ANALYTICS_ROOM_POSITION.y - 0.65,
  TAXI_ANALYTICS_ROOM_POSITION.z - TAXI_ANALYTICS_ROOM_HALF.z + 1.2
);
taxiReturnXrButton.rotation.x = -0.25;
taxiReturnXrButton.renderOrder = 1000;
taxiReturnXrButton.visible = false;
taxiReturnXrButton.userData.xrHitSize = { w: 0.72, h: 0.18, d: 0.04 };
taxiReturnXrButton.userData.isTaxiReturn = true;
taxiAnalyticsGroup.add(taxiReturnXrButton);

function getTaxiAnalyticsViewTarget() {
  return taxiAnalyticsTeleportTarget.set(
    TAXI_ANALYTICS_ROOM_POSITION.x,
    TAXI_ANALYTICS_ROOM_POSITION.y - 0.4,
    TAXI_ANALYTICS_ROOM_POSITION.z + 1.8
  );
}

function requestTaxiAnalyticsRoom() {
  if (!TAXI_ALLOWED) return; // Gated: requires valid authentication
  if (inTaxiAnalyticsRoom || taxiAnalyticsPreview2D) {
    returnFromTaxiAnalyticsRoom();
    return;
  }
  teleportToTaxiAnalyticsRoom();
}

function teleportToTaxiAnalyticsRoom() {
  inTaxiAnalyticsRoom = true;
  taxiAnalyticsGroup.visible = true;
  taxiReturnXrButton.visible = renderer.xr.isPresenting;

  getTaxiAnalyticsViewTarget();

  if (renderer.xr.isPresenting && xrBaseRefSpace) {
    getViewerPose(viewerWorld);
    taxiAnalyticsTeleportDelta.copy(taxiAnalyticsTeleportTarget).sub(viewerWorld);
    locomotion.add(taxiAnalyticsTeleportDelta);
    applyXrLocomotionOffset();
    statusEl.textContent = "分析用の部屋に移動しました。パネルを見回してください。グリップでホームに戻れます。";
  } else {
    taxiAnalyticsPreview2D = true;
    camera.up.set(0, 1, 0);
    // v19: panels are on the left + back walls, so look into that corner from the front-right
    camera.position.set(TAXI_ANALYTICS_ROOM_POSITION.x + 3.0, TAXI_ANALYTICS_ROOM_POSITION.y + 0.2, TAXI_ANALYTICS_ROOM_POSITION.z + 3.8);
    camera.lookAt(TAXI_ANALYTICS_ROOM_POSITION.x - 1.8, TAXI_ANALYTICS_ROOM_POSITION.y + 0.15, TAXI_ANALYTICS_ROOM_POSITION.z - 2.4);
    statusEl.textContent = "分析用の部屋（2Dプレビュー）。AIアシスタントに質問できます。";
  }
  
  const chatPanelEl = document.getElementById("taxiChatPanel");
  if (chatPanelEl) {
    chatPanelEl.removeAttribute("hidden");
  }
}

function returnFromTaxiAnalyticsRoom() {
  if (!inTaxiAnalyticsRoom && !taxiAnalyticsPreview2D) return;
  inTaxiAnalyticsRoom = false;
  taxiAnalyticsPreview2D = false;
  taxiReturnXrButton.visible = false;

  const chatPanelEl = document.getElementById("taxiChatPanel");
  if (chatPanelEl) chatPanelEl.setAttribute("hidden", "");

  if (renderer.xr.isPresenting && xrBaseRefSpace) {
    resetToHome();
    statusEl.textContent = "太陽系の部屋へ戻りました。";
  } else {
    const halfFovY = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const halfFovX = Math.atan(Math.tan(halfFovY) * camera.aspect);
    const fitDist = Math.max(roomHalf.y / Math.tan(halfFovY), roomHalf.x / Math.tan(halfFovX));
    camera.position.set(0, roomCenter.y, roomCenter.z + fitDist + roomHalf.z + 0.5);
    camera.lookAt(roomCenter);
    statusEl.textContent = "太陽系の部屋へ戻りました。";
  }
}

function checkTaxiReturnButtonHit(point) {
  if (!taxiReturnXrButton.visible) return false;
  tmpVec.copy(point);
  taxiReturnXrButton.worldToLocal(tmpVec);
  const size = taxiReturnXrButton.userData.xrHitSize;
  return (
    Math.abs(tmpVec.x) <= size.w * 0.5 &&
    Math.abs(tmpVec.y) <= size.h * 0.5 &&
    Math.abs(tmpVec.z) <= size.d * 0.5
  );
}

function updateTaxiAnalyticsRoom() {
  if (!inTaxiAnalyticsRoom && !taxiAnalyticsGroup.visible) return;
  
  if (renderer.xr.isPresenting) {
    taxiReturnXrButton.visible = inTaxiAnalyticsRoom;
  }
  
  updateTaxiPanelFocus();
}

// ---------------------------------------------------------------------------
// Taxi Analytics AI Conversation System
// ---------------------------------------------------------------------------

const TAXI_CONVERSATION_STORAGE_KEY = "questXrTaxiLlmConfig";
let taxiConversationHistory = [];
let taxiFocusedPanelIndex = -1;
let taxiFocusAnimationT = 0;
let taxiSpeechRecognition = null;
let taxiIsListening = false;
let taxiVoiceBusy = false; // recorded audio is being transcribed
let taxiWebSpeechUnusable = false; // Web Speech exists but failed (network/service) -> use recording
let taxiRecorder = null;
let taxiLastVoiceToggleAt = -1e9;
const TAXI_STT_MAX_SEC = 12;
const TAXI_VAD_RMS = 0.012;
const TAXI_VAD_SILENCE_MS = 1400;
const TAXI_VAD_NO_SPEECH_SEC = 7;
const TAXI_MIC_PERMISSION_TIMEOUT_MS = 10000;

const taxiPanelKeywords = {
  0: ["売上", "売り上げ", "収益", "金額", "日次", "revenue", "sales", "daily"],
  1: ["乗車", "回数", "件数", "トリップ", "trips", "rides", "count"],
  2: ["ピーク", "時間", "時間帯", "いつ", "何時", "peak", "hours", "when", "busy"],
  3: ["稼働", "稼働率", "効率", "車両", "utilization", "efficiency", "vehicle"],
};

const taxiPanelResponses = {
  0: {
    summary: "本日の日次売上は ¥847,200 です。週の中では水曜日が最も高く、土曜日がそれに続いています。",
    detail: "売上データを詳しく見ると、月曜から日曜にかけて60%、80%、45%、90%、70%、55%、85%の相対的な売上パターンが見られます。週末と週の真ん中が好調です。"
  },
  1: {
    summary: "本日の乗車回数は 156 件です。これは平均的な1日の数値です。",
    detail: "時間帯別では、通勤時間（9時頃）と夕方（18時頃）にピークがあります。深夜3時頃が最も少なく、全体の約20%程度まで落ち込みます。"
  },
  2: {
    summary: "ピーク時間帯は 18時から21時 です。夕方の通勤・外出需要が集中しています。",
    detail: "詳細を見ると、6時に30%、9時に25%、12時に50%、15時に80%、18時に100%（ピーク）、21時に70%、24時に40%、3時に20%の需要分布があります。"
  },
  3: {
    summary: "全車両の平均稼働率は 78% です。良好な稼働状況です。",
    detail: "稼働状況の内訳は、走行中が35%、待機が25%、その他（休憩・充電等）が残りを占めています。80%以上を目指すと更なる効率化が可能です。"
  },
};

const taxiGeneralResponses = {
  greeting: "こんにちは！タクシー業務分析アシスタントです。サンプルデータを使って分析のお手伝いをします。「売上は？」「ピーク時間は？」などと質問してください。",
  unknown: "すみません、その質問はサンプルデータでは対応できません。「売上」「乗車回数」「ピーク時間」「稼働率」について質問してみてください。",
  allPanels: "現在4つの分析パネルがあります：日次売上（¥847,200）、乗車回数（156件）、ピーク時間帯（18-21時）、車両稼働率（78%）。詳しく知りたい項目を教えてください。",
  sampleDataNote: "※ これらはすべてサンプルデータです。実際のデータ連携には別途設定が必要です。",
};

// LLM requests go through the same-origin Worker relay (/api/llm), which
// forwards to the settings endpoint (many providers send no CORS headers).
const TAXI_LLM_RELAY_PATH = "/api/llm";
const taxiLlmSessionId = (typeof crypto !== "undefined" && crypto.randomUUID)
  ? crypto.randomUUID()
  : `taxi-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function getTaxiLlmConfig() {
  try {
    const stored = localStorage.getItem(TAXI_CONVERSATION_STORAGE_KEY);
    if (stored) {
      const config = JSON.parse(stored);
      if (config && typeof config === "object") {
        config.endpoint = String(config.endpoint || "").trim();
        config.apiKey = taxiSanitizeApiKey(config.apiKey);
      }
      if (config.endpoint && config.apiKey) return config;
    }
  } catch (e) {
    console.warn("Failed to load LLM config:", e);
  }
  return null;
}

function setTaxiLlmConfig(endpoint, apiKey) {
  try {
    localStorage.setItem(TAXI_CONVERSATION_STORAGE_KEY, JSON.stringify({ endpoint, apiKey }));
    return true;
  } catch (e) {
    console.error("Failed to save LLM config:", e);
    return false;
  }
}

function clearTaxiLlmConfig() {
  try {
    localStorage.removeItem(TAXI_CONVERSATION_STORAGE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

function matchTaxiPanelIntent(text) {
  const lowerText = text.toLowerCase();
  let bestMatch = -1;
  let bestScore = 0;
  
  for (const [panelIdx, keywords] of Object.entries(taxiPanelKeywords)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        score += keyword.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = parseInt(panelIdx);
    }
  }
  
  return bestMatch;
}

// ---------------------------------------------------------------------------
// Intent & Slot Extraction for Dynamic Panel Generation
// ---------------------------------------------------------------------------
const METRIC_KEYWORDS = {
  fare: ["売上", "売り上げ", "収益", "金額", "売上高", "revenue"],
  tripCount: ["乗車", "回数", "件数", "トリップ", "trips", "rides"],
  distance: ["距離", "走行距離", "キロ", "km", "distance"],
  avgFare: ["平均運賃", "平均売上", "客単価"],
  avgDistance: ["平均距離"],
  occupiedTime: ["実車", "乗車時間"],
  emptyTime: ["空車", "待機時間"],
  utilizationRate: ["稼働率", "稼働", "効率", "utilization"],
};

const DIMENSION_KEYWORDS = {
  month: ["月別", "月ごと", "月毎", "各月", "monthly"],
  weekday: ["曜日", "曜日別", "曜日ごと", "weekly"],
  hour: ["時間帯", "時間別", "時間ごと", "hourly", "時"],
  vehicle: ["車両", "車両別", "車ごと", "vehicle"],
  driver: ["ドライバー", "運転手", "driver"],
  pickupArea: ["乗車エリア", "乗車地", "ピックアップ"],
  dropoffArea: ["降車エリア", "降車地", "ドロップオフ"],
};

const CHART_KEYWORDS = {
  bar: ["棒グラフ", "バー", "bar"],
  line: ["折れ線", "推移", "グラフ", "トレンド", "line"],
  table: ["表", "一覧表", "テーブル", "リスト", "table"],
  kpi: ["数値", "合計", "トータル", "kpi"],
};

function extractAnalysisIntent(text) {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes("どの一覧") || lowerText.includes("何ができ") || lowerText.includes("出せますか") || 
      lowerText.includes("どんな分析") || lowerText.includes("利用可能") || lowerText.includes("できること")) {
    return { type: "list_capabilities" };
  }
  
  if (lowerText.includes("クリア") || lowerText.includes("消して") || lowerText.includes("削除") || 
      lowerText.includes("片付け") || lowerText.includes("閉じて")) {
    return { type: "clear_panels" };
  }
  
  const wantsPanel = lowerText.includes("出して") || lowerText.includes("見せて") || lowerText.includes("表示") ||
                     lowerText.includes("グラフ") || lowerText.includes("一覧") || lowerText.includes("比較") ||
                     lowerText.includes("分析") || lowerText.includes("推移");
  
  if (!wantsPanel) {
    return { type: "question" };
  }
  
  let metric = null;
  let metricScore = 0;
  for (const [m, keywords] of Object.entries(METRIC_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        const score = kw.length;
        if (score > metricScore) {
          metric = m;
          metricScore = score;
        }
      }
    }
  }
  
  let dimension = null;
  let dimScore = 0;
  for (const [d, keywords] of Object.entries(DIMENSION_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        const score = kw.length;
        if (score > dimScore) {
          dimension = d;
          dimScore = score;
        }
      }
    }
  }
  
  let chartType = null;
  for (const [ct, keywords] of Object.entries(CHART_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        chartType = ct;
        break;
      }
    }
    if (chartType) break;
  }
  
  let limit = null;
  const topMatch = text.match(/トップ\s*(\d+)|上位\s*(\d+)|(\d+)\s*件/);
  if (topMatch) {
    limit = parseInt(topMatch[1] || topMatch[2] || topMatch[3]);
  }
  
  if (!metric && !dimension) {
    return { type: "ambiguous", text };
  }
  
  return {
    type: "create_panel",
    spec: {
      metric: metric || "fare",
      groupBy: dimension,
      chartType: chartType || (dimension ? "bar" : "kpi"),
      limit,
      sort: "desc",
    },
  };
}

function generateOfflineResponse(userMessage) {
  const lowerMsg = userMessage.toLowerCase();
  
  if (lowerMsg.includes("こんにちは") || lowerMsg.includes("はじめ") || lowerMsg.includes("hello")) {
    return { 
      text: "こんにちは！タクシー業務分析アシスタントです。「月別の売上推移を出して」「車両ごとの稼働率を見せて」などと話しかけてください。「どの一覧表を出せますか？」で利用可能な分析を確認できます。", 
      focusPanel: -1 
    };
  }
  
  const intent = extractAnalysisIntent(userMessage);
  
  if (intent.type === "list_capabilities") {
    const info = listAvailableAnalyses();
    return {
      text: `以下の分析が可能です：\n\n【メトリック】${info.metrics.map(m => TAXI_METRICS[m].label).join("、")}\n\n【集計軸】${info.dimensions.map(d => TAXI_DIMENSIONS[d].label).join("、")}\n\n【例】\n${info.examples.slice(0, 4).join("\n")}`,
      focusPanel: -1,
    };
  }
  
  if (intent.type === "clear_panels") {
    const result = clearDynamicPanels();
    return { text: result.message, focusPanel: -1 };
  }
  
  if (intent.type === "create_panel") {
    const result = createDynamicPanel(intent.spec);
    if (result.success) {
      const metricLabel = TAXI_METRICS[intent.spec.metric]?.label || intent.spec.metric;
      const dimLabel = intent.spec.groupBy ? TAXI_DIMENSIONS[intent.spec.groupBy]?.label : "";
      const dataCount = result.panel?.queryResult?.data?.length || 0;
      return {
        text: `${dimLabel}${metricLabel}のパネルを作成しました。${dataCount}件のデータを集計しています。\n\n（サンプルデータ：過去6ヶ月の約${taxiTrips.length.toLocaleString()}件のトリップ記録）`,
        focusPanel: -1,
        panelCreated: true,
      };
    } else {
      return { text: `パネル作成エラー: ${result.error}`, focusPanel: -1 };
    }
  }
  
  if (intent.type === "ambiguous") {
    return {
      text: "どのような分析をご希望ですか？\n\n例えば：\n・「月別の売上推移を出して」\n・「曜日別の乗車回数を見せて」\n・「車両ごとの稼働率比較」\n\n「どの一覧表を出せますか？」で全ての選択肢を確認できます。",
      focusPanel: -1,
    };
  }
  
  const panelIdx = matchTaxiPanelIntent(userMessage);
  if (panelIdx >= 0) {
    const response = taxiPanelResponses[panelIdx];
    const wantsDetail = lowerMsg.includes("詳") || lowerMsg.includes("もっと");
    return { text: wantsDetail ? response.detail : response.summary, focusPanel: panelIdx };
  }
  
  return { text: taxiGeneralResponses.unknown, focusPanel: -1 };
}

const LLM_TOOLS = [
  {
    type: "function",
    function: {
      name: "query_data",
      description: "サンプルのタクシー乗車データを自由な条件で集計し、統計値(JSON)を返す。数値を答える前に必ずこれを呼ぶこと。返り値: value=条件全体の集計値, matchedTrips=該当乗車数, perDay=1日あたりの平均/最大日/最小日(加算系メトリック), perTrip=1乗車あたりの平均/最大/最小(売上・距離・時間), groupBy指定時は groupStats(グループ間の平均/最大/最小) と groups(上位N件)。fareSummary には常に税抜(taxExcluded)・税込(taxIncluded)・収入=税込+迎車料金(totalIncome)それぞれの合計/1乗車平均・最高・最低/1日あたり平均・最高日・最低日と、迎車あり/なし別(byDispatch)の件数・金額が入る。未知の値を指定すると error と suggestions(近い候補) と validValues が返る。",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: Object.keys(TAXI_METRICS),
            description: "tripCount=乗車回数(件), fare=売上(円,税抜,合計), fareWithTax=売上(円,税込10%,合計), totalFare=収入(円,税込+迎車料金,合計), dispatchFee=迎車料金(円,合計), distance=走行距離(km,合計), avgFare=平均運賃(円/回,税抜), avgDistance=平均距離(km/回), occupiedTime=実車時間(分), emptyTime=空車時間(分), utilizationRate=稼働率(%)=実車/(実車+空車)",
          },
          dateFrom: { type: "string", description: "開始日 YYYY-MM-DD（この日を含む）" },
          dateTo: { type: "string", description: "終了日 YYYY-MM-DD（この日を含む）" },
          hourFrom: { type: "integer", description: "乗車開始時刻の下限 0-23（含む）。例:「15時から18時まで」→ hourFrom=15, hourTo=18（15:00〜17:59）" },
          hourTo: { type: "integer", description: "乗車開始時刻の上限 1-24（含まない）。hourFrom>hourTo なら深夜をまたぐ（例 22→2）" },
          timeFrom: { type: "string", description: "分単位の開始時刻 \"HH:MM\"（含む）。例:「15時半から17時まで」→ timeFrom=\"15:30\", timeTo=\"17:00\"。分の指定があるときは hourFrom/hourTo ではなくこちらを使う（両方あれば time が優先）" },
          timeTo: { type: "string", description: "分単位の終了時刻 \"HH:MM\"（含まない、\"24:00\"可）。timeFrom>timeTo なら深夜をまたぐ" },
          weekdays: { type: "array", items: { type: "string", enum: TAXI_WEEKDAYS }, description: "曜日（日,月,火,水,木,金,土）。例: 日曜日→[\"日\"], 週末→[\"土\",\"日\"]" },
          vehicles: { type: "array", items: { type: "string" }, description: `車両: ${TAXI_VEHICLES.join(",")}。車両・ドライバー・乗車地・降車地・町名はユーザーが言った表記をそのまま渡す（読み替えはツール側で行い、corrections や suggestions を返す）` },
          drivers: { type: "array", items: { type: "string" }, description: `ドライバー: ${TAXI_DRIVERS.join(",")}` },
          pickupAreas: { type: "array", items: { type: "string" }, description: `乗車地（pickupArea）: ${TAXI_AREAS.join(",")}` },
          dropoffAreas: { type: "array", items: { type: "string" }, description: `降車地（dropoffArea）: ${TAXI_AREAS.join(",")}` },
          pickupTowns: { type: "array", items: { type: "string" }, description: "乗車地の町名（市＋町名、丁目なし。市は省略可、例: \"布田\" → 調布市布田）。町名だけ言われて乗車/降車の指定がなければ乗車地として扱う。丁目まで指定されたら pickupKeyword を使う" },
          dropoffTowns: { type: "array", items: { type: "string" }, description: "降車地の町名（市＋町名、丁目なし。市は省略可）" },
          pickupKeyword: { type: "array", items: { type: "string" }, description: "乗車住所のキーワード（住所文字列への部分一致、配列はOR）。例:「調布市下石原三丁目から乗った回数」→ [\"調布市下石原三丁目\"]。0件なら error と似た住所の suggestions を返す" },
          dropoffKeyword: { type: "array", items: { type: "string" }, description: "降車住所のキーワード（部分一致、配列はOR）。例:「府中市白糸台への降車回数」→ [\"府中市白糸台\"]" },
          dropoffTimeFrom: { type: "string", description: "降車時刻の開始 \"HH:MM\"（含む）。例:「22時以降に降車」→ \"22:00\"" },
          dropoffTimeTo: { type: "string", description: "降車時刻の終了 \"HH:MM\"（含まない、\"24:00\"可）。From>To なら深夜をまたぐ" },
          distanceMin: { type: "number", description: "1乗車の距離(km)の下限（含む）" },
          distanceMax: { type: "number", description: "1乗車の距離(km)の上限（含む）" },
          dispatch: { type: "boolean", description: "迎車の有無で絞り込む（true=迎車ありのみ, false=迎車なしのみ, 省略=両方）。「芸者」「げいしゃ」は音声認識の誤りで迎車のこと" },
          fareMin: { type: "number", description: "1乗車の運賃(円,税抜)の下限（含む）" },
          fareMax: { type: "number", description: "1乗車の運賃(円,税抜)の上限（含む）" },
          groupBy: {
            type: "string",
            enum: Object.keys(TAXI_DIMENSIONS),
            description: "集計軸（任意）: date=日別, month=月別, weekday=曜日別, hour=時間帯別, vehicle=車両別, driver=ドライバー別, pickupArea=乗車地別, dropoffArea=降車地別, pickupTown=乗車地町名別, dropoffTown=降車地町名別",
          },
          sort: { type: "string", enum: ["desc", "asc", "key"], description: "groups の並び順（desc=値の大きい順, asc=小さい順, key=軸の順）" },
          limit: { type: "integer", description: `groups に返す件数（既定${TAXI_QUERY_DEFAULT_GROUPS}, 最大${TAXI_QUERY_MAX_GROUPS}）` },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calc_fare",
      description: `距離(km)から運賃を計算する（サンプルデータの前提: 税抜=距離×${TAXI_FARE_PER_KM}円、税込=税抜+消費税${TAXI_TAX_RATE * 100}%、迎車なら非課税の迎車料金${TAXI_DISPATCH_FEE}円を加算）。「10キロ走ったらいくら？」「10キロで迎車ありだと？」などに使う。`,
      parameters: {
        type: "object",
        properties: {
          distanceKm: { type: "number", description: "距離(km)" },
          dispatch: { type: "boolean", description: "迎車あり(true)なら迎車料金を加算。省略時は false" },
        },
        required: ["distanceKm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_panel",
      description: "Create a new analysis panel with specified metric and grouping. The panel will be rendered with data from the sample dataset.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: Object.keys(TAXI_METRICS),
            description: "The metric to display: fare (売上), tripCount (乗車回数), distance (走行距離), avgFare (平均運賃), avgDistance (平均距離), utilizationRate (稼働率)",
          },
          groupBy: {
            type: "string",
            enum: [...Object.keys(TAXI_DIMENSIONS), ""],
            description: "Dimension to group by: month (月別), weekday (曜日別), hour (時間帯別), vehicle (車両別), driver (ドライバー別), pickupArea (乗車地別), dropoffArea (降車地別). Empty string for total/KPI view.",
          },
          chartType: {
            type: "string",
            enum: TAXI_CHART_TYPES,
            description: "Chart type: bar, line, table, kpi",
          },
          title: {
            type: "string",
            description: "Optional custom title for the panel",
          },
          limit: {
            type: "number",
            description: "Limit number of items (e.g., top 5)",
          },
          sort: {
            type: "string",
            enum: ["asc", "desc", ""],
            description: "Sort order for the data",
          },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "focus_panel",
      description: "Highlight/focus one of the fixed dashboard panels (0-3)",
      parameters: {
        type: "object",
        properties: {
          panelIndex: {
            type: "number",
            description: "Panel index: 0=日次売上, 1=乗車回数, 2=ピーク時間帯, 3=車両稼働率",
          },
        },
        required: ["panelIndex"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_panels",
      description: "Clear all dynamically generated panels",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_capabilities",
      description: "List available metrics, dimensions, and example analyses",
      parameters: { type: "object", properties: {} },
    },
  },
];

const TAXI_LLM_MAX_ROUNDS = 5;
const TAXI_LLM_MAX_TOKENS = 1600;
const TAXI_LLM_RETRY_MAX_TOKENS = 3200;

// Known speech-recognition mishearings, detected in the user's own words (the model tends to
// silently convert them, so the client adds the もしかして confirmation deterministically)
const TAXI_KNOWN_MISHEARINGS = [
  { re: /芸者|げいしゃ|ゲイシャ/u, meant: "迎車", reading: "げいしゃ" },
  { re: /札(?!幌)|ふだ(?!ん)|フダ/u, meant: "布田", reading: "ふだ" },
];

function taxiDetectMishearings(text) {
  const found = [];
  for (const m of TAXI_KNOWN_MISHEARINGS) {
    const hit = m.re.exec(String(text || ""));
    if (hit) found.push({ heard: hit[0], meant: m.meant, reading: m.reading });
  }
  return found;
}

function taxiCompactToolJson(obj) {
  let s = JSON.stringify(obj);
  if (s.length > 6000) s = s.slice(0, 6000) + "…(truncated)";
  return s;
}

function executeTaxiToolCall(funcName, args, state) {
  if (funcName === "query_data") {
    return runTaxiFreeQuery(args);
  }
  if (funcName === "calc_fare") {
    const km = Number(args.distanceKm);
    if (!Number.isFinite(km) || km < 0) return { ok: false, error: "distanceKm は0以上の数値で指定してください" };
    const dispatch = args.dispatch === true || String(args.dispatch).toLowerCase() === "true";
    return { distanceKm: km, dispatch, ...taxiFareForDistance(km, dispatch), rule: `税抜=距離×${TAXI_FARE_PER_KM}円, 消費税${TAXI_TAX_RATE * 100}%, 迎車料金${TAXI_DISPATCH_FEE}円(非課税・迎車時のみ), totalFare=税込+迎車料金` };
  }
  if (funcName === "create_panel") {
    const validation = validateAnalysisSpec(args);
    if (!validation.valid) {
      return { ok: false, error: `無効なパネル仕様: ${validation.errors.join(", ")}`, validMetrics: Object.keys(TAXI_METRICS), validGroupBy: Object.keys(TAXI_DIMENSIONS) };
    }
    const panelResult = createDynamicPanel(args);
    if (!panelResult.success) return { ok: false, error: `パネル作成エラー: ${panelResult.error}` };
    state.panelCreated = true;
    const metricLabel = TAXI_METRICS[args.metric]?.label || args.metric;
    const dimLabel = args.groupBy ? `${TAXI_DIMENSIONS[args.groupBy]?.label}` : "";
    const qr = panelResult.panel?.queryResult || {};
    const data = (qr.data || []).slice(0, 12).map(d => ({ label: d.label, value: taxiRound(d.value, 1) }));
    return { ok: true, message: `${dimLabel}${metricLabel}のパネルを作成しました`, items: (qr.data || []).length, data, total: taxiRound(qr.total, 1) };
  }
  if (funcName === "focus_panel") {
    const idx = Number(args.panelIndex);
    if (idx >= 0 && idx < 4) {
      state.focusPanel = idx;
      return { ok: true, message: `${taxiPanelData[idx]?.title}パネルをハイライトしました`, panel: taxiPanelData[idx] };
    }
    return { ok: false, error: "panelIndex は 0〜3 です" };
  }
  if (funcName === "clear_panels") {
    const clearResult = clearDynamicPanels();
    return { ok: true, message: clearResult.message };
  }
  if (funcName === "list_capabilities") {
    const info = listAvailableAnalyses();
    return {
      metrics: info.metrics.map(m => `${m}(${TAXI_METRICS[m].label})`),
      dimensions: info.dimensions.map(d => `${d}(${TAXI_DIMENSIONS[d].label})`),
      examples: info.examples,
    };
  }
  return { ok: false, error: `未知のツール: ${funcName}` };
}

// ---------------------------------------------------------------------------
// LLM relay fetch with readable (Japanese) errors, API-key sanitising, and
// speech-to-text through the same relay (Quest Browser has no Web Speech API).
// ---------------------------------------------------------------------------
const TAXI_LLM_CLIENT_TIMEOUT_MS = 75000;
const TAXI_STT_MODEL_DEFAULT = "mimo-v2.5"; // OpenCode Go: accepts input_audio (wav) in chat/completions
const TAXI_STT_MAX_TOKENS = 1200;
const TAXI_STT_PROMPT = `タクシー業務分析アシスタントへの日本語の音声質問です。聞こえたとおりに日本語で文字起こしし、文字起こし結果の1文だけを出力してください（説明・引用符なし）。
よく出る語: 迎車（げいしゃ）, 乗車, 降車, 乗車地, 降車地, 売上, 乗車回数, 運賃, 税込, 1号車〜, ドライバー, 月別, 曜日別, 車両別, 稼働率, 布田（ふだ）, 国領, 仙川, 調布, つつじヶ丘, 柴崎, 深大寺, 西調布, 飛田給, 三鷹, 府中, 下石原, 白糸台`;

// Pasted keys often carry spaces/newlines/zero-width chars or a "Bearer " prefix.
function taxiSanitizeApiKey(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, "");
}

class TaxiLlmError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = "TaxiLlmError";
    Object.assign(this, info);
  }
}

// status + response body (+ X-Taxi-Relay-Error header from our worker) -> Japanese message
function taxiDescribeLlmHttpError(status, bodyText, relayHeader) {
  let body = null;
  try { body = JSON.parse(bodyText); } catch (e) { body = null; }
  const err = body && typeof body === "object" ? (body.error ?? null) : null;
  const detail = String(
    (err && typeof err === "object" ? err.message : typeof err === "string" ? err : "") ||
    (body && typeof body.message === "string" ? body.message : "") ||
    (!body && bodyText ? String(bodyText).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "")
  ).slice(0, 120);
  const type = String((err && typeof err === "object" && (err.type || err.code)) || "");
  // Our relay's own errors: header (new worker) or the bare {error:{message}} shape without upstream "type"
  const fromRelay = !!relayHeader || (status === 401 && detail === "Unauthorized" && !type && !(body && body.type));
  const withDetail = (msg) => (detail && !fromRelay ? `${msg}（詳細: ${detail}）` : msg);

  if (status === 401) {
    if (fromRelay) return { kind: "relay-auth", message: "タクシー分析の利用認証（Cookie）がありません。キー付きURL（…/quest-mr/?key=…）で開き直してください" };
    return { kind: "api-key", message: withDetail("APIキーが正しくありません（設定の⚙でキーを貼り直してください）") };
  }
  if (status === 403) return { kind: "forbidden", message: withDetail("このAPIキーではこのエンドポイント/モデルを利用できません（設定の⚙でキーとモデルを確認してください）") };
  if (status === 400) {
    if (/Missing API key/i.test(detail)) return { kind: "no-key", message: "APIキーが未設定です（設定の⚙でキーを入力してください）" };
    if (fromRelay && /endpoint|https|port|host/i.test(detail)) return { kind: "endpoint", message: `エンドポイントURLが正しくありません（設定の⚙で https://…/chat/completions を確認してください）（${detail}）` };
    if (/ModelProtocolUnsupported|model/i.test(type + " " + detail)) return { kind: "model", message: withDetail("モデル名が正しくないか、このエンドポイントでは使えないモデルです（設定の⚙でモデルを確認してください）") };
    return { kind: "bad-request", message: withDetail("リクエストが受け付けられませんでした（400）") };
  }
  if (status === 404) return { kind: "not-found", message: withDetail("エンドポイントURLまたはモデルが見つかりません（404）。設定の⚙で確認してください") };
  if (status === 413) return { kind: "too-large", message: "送信データが大きすぎます（413）。質問や録音を短くしてください" };
  if (status === 429) return { kind: "rate-limit", message: withDetail("リクエストが多すぎるか利用上限に達しました（429）。少し待ってから再試行してください") };
  if (status === 504) return { kind: "timeout", message: "LLMの応答がタイムアウトしました（504）。もう一度お試しください" };
  if (status === 502 && fromRelay) return { kind: "unreachable", message: "LLMサーバーに接続できませんでした（502）。エンドポイントURLとネットワークを確認してください" };
  if (status >= 500) return { kind: "server", message: withDetail(`LLMサーバーでエラーが発生しました（${status}）。時間をおいて再試行してください`) };
  return { kind: "http", message: withDetail(`LLMの呼び出しに失敗しました（${status}）`) };
}

async function taxiLlmRelayFetch(config, payload) {
  const apiKey = taxiSanitizeApiKey(config.apiKey);
  if (!apiKey) throw new TaxiLlmError("APIキーが未設定です（設定の⚙でキーを入力してください）", { kind: "no-key" });
  if (/[^\x21-\x7e]/.test(apiKey)) throw new TaxiLlmError("APIキーに使えない文字（全角文字など）が含まれています（設定の⚙でキーを貼り直してください）", { kind: "api-key" });
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TAXI_LLM_CLIENT_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetch(TAXI_LLM_RELAY_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-LLM-Endpoint": String(config.endpoint || "").trim(),
        "X-Opencode-Session": taxiLlmSessionId,
      },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new TaxiLlmError(`LLMの応答がタイムアウトしました（${Math.round(TAXI_LLM_CLIENT_TIMEOUT_MS / 1000)}秒）。もう一度お試しください`, { kind: "timeout" });
    }
    throw new TaxiLlmError("LLMに接続できませんでした（ネットワークエラー）。通信状態を確認してください", { kind: "network" });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) {
    let text = "";
    try { text = await response.text(); } catch (e) { text = ""; }
    const relayHeader = response.headers && typeof response.headers.get === "function" ? response.headers.get("X-Taxi-Relay-Error") : null;
    const d = taxiDescribeLlmHttpError(response.status, text, relayHeader);
    throw new TaxiLlmError(d.message, { kind: d.kind, status: response.status });
  }
  try {
    return await response.json();
  } catch (e) {
    throw new TaxiLlmError("LLMの応答を読み取れませんでした（JSONではありません）。エンドポイントURLを確認してください", { kind: "bad-json" });
  }
}

// Float32 PCM chunks at inputRate -> 16 kHz mono 16-bit WAV bytes
function taxiEncodeWav16k(chunks, inputRate) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const input = new Float32Array(n);
  let off = 0;
  for (const c of chunks) { input.set(c, off); off += c.length; }
  const outRate = 16000;
  const ratio = inputRate / outRate;
  const outLen = Math.max(0, Math.floor(n / ratio));
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(n, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let k = start; k < end; k++) sum += input[k];
    const v = Math.max(-1, Math.min(1, sum / (end - start)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(bytes.buffer);
  const writeStr = (o, str) => { for (let i = 0; i < str.length; i++) bytes[o + i] = str.charCodeAt(i); };
  writeStr(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, outRate, true); dv.setUint32(28, outRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  writeStr(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}

function taxiBytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function taxiCleanTranscript(text) {
  let t = String(text ?? "").trim().split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
  t = t.replace(/^(文字起こし(結果)?|書き起こし|transcript(ion)?)\s*[:：]\s*/i, "");
  t = t.replace(/^[「『"“]+/, "").replace(/[」』"”]+$/, "").trim();
  return t;
}

async function taxiTranscribeAudioBase64(wavBase64, config) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await taxiLlmRelayFetch(config, {
      model: String(config.sttModel || "").trim() || TAXI_STT_MODEL_DEFAULT,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: TAXI_STT_PROMPT },
          { type: "input_audio", input_audio: { data: wavBase64, format: "wav" } },
        ],
      }],
      max_tokens: attempt === 0 ? TAXI_STT_MAX_TOKENS : TAXI_STT_MAX_TOKENS * 2,
      temperature: 0,
    });
    const text = taxiCleanTranscript(data?.choices?.[0]?.message?.content);
    if (text) return text;
  }
  return "";
}

async function callLlmBackend(userMessage, config) {
  const dataRange = taxiTrips.length ? `${taxiTrips[0].date}〜${taxiTrips[taxiTrips.length - 1].date}` : "-";
  const datasetSummary = `
サンプルデータセット情報（合成データ）:
- 期間: 過去${TAXI_MONTHS}ヶ月（${dataRange}、今日=${taxiLocalDateString(new Date())}）
- 総トリップ数: ${taxiTrips.length.toLocaleString()}件
- 運賃の前提: 運賃（税抜）＝距離(km)×${TAXI_FARE_PER_KM}円（初乗り・割増なし）。税込額＝税抜に消費税${TAXI_TAX_RATE * 100}%を加えた額（1乗車ごとに円未満四捨五入）。例: 10km → 6,000円（税込6,600円）。fare/売上は税抜、fareWithTax は税込。
- 迎車（配車での迎え）: 約25%の乗車が迎車。迎車料金${TAXI_DISPATCH_FEE}円は非課税で税込額の後に加算。収入(totalFare)＝税込運賃＋迎車料金。例: 10km・迎車あり → 6,000円＋消費税600円＋迎車料金400円＝7,000円。query_data の dispatch で迎車あり/なしを絞り込める。
- 音声認識では「迎車（げいしゃ）」が「芸者」と誤認識されやすい。「芸者」「げいしゃ」「ゲイシャ」は迎車として扱い、「もしかして迎車のことですか？」と確認してから迎車として答える。
- 有効な値の一覧（これ以外の値はデータに存在しない）:
  - 車両: ${TAXI_VEHICLES.join("、")}
  - ドライバー: ${TAXI_DRIVERS.join("、")}
  - 営業エリア: ${TAXI_SERVICE_MUNICIPALITIES.join("・")}のみ（調布市中心）。これ以外の地名（23区など）はデータに存在しない
  - 乗車地・降車地: ${TAXI_AREAS.join("、")}
  - 町名（乗車地/降車地の住所の町名部分。住所には丁目が付く場合あり。乗車地: 町名）: ${Object.entries(TAXI_AREA_TOWNS).map(([a, ts]) => `${a}: ${ts.map(x => taxiTownPart(x[0])).join("・")}`).join(" / ")}
  - 町名の読み注意: 布田＝ふだ（「札」「ふだ」「フダ」と聞こえたら「もしかして布田（ふだ）のことですか？」と確認してから布田として答える）
  - 曜日: ${TAXI_WEEKDAYS.join("、")}
  - 時刻: 00:00〜23:59（乗車時刻 time="HH:MM"、降車時刻 dropoffTime="HH:MM"＝乗車時刻＋実車時間、日付をまたぐ場合あり）
  - 住所: pickupAddress / dropoffAddress は元データの文字列そのまま（丁目を含む場合や町名が無い場合もある。補完・正規化しない）。住所の質問は pickupKeyword / dropoffKeyword（部分一致）を使う

利用可能なメトリック: ${Object.entries(TAXI_METRICS).map(([k, v]) => `${k}(${v.label})`).join(", ")}
利用可能な集計軸: ${Object.entries(TAXI_DIMENSIONS).map(([k, v]) => `${k}(${v.label})`).join(", ")}
`;

  const systemPrompt = `あなたはタクシー業務分析アシスタントです。ユーザーの質問にはツールでサンプルデータを集計してから答えてください。

${datasetSummary}

固定パネル（focus_panelで参照可能）:
${taxiPanelData.map((p, i) => `${i}: ${p.title} - ${p.value} (${p.unit})`).join("\n")}

ルール:
1. 数値の質問（売上・乗車回数・平均・最高・最低・比較など）は必ず query_data を呼び、その結果の数値だけを使って答える。数値は絶対に自分で生成・推測しない。
2. 「平均」「最高」「最低」で単位が曖昧なときは、乗車回数・売上なら1日あたり（perDay）、運賃・距離なら1乗車あたり（perTrip）を基本にし、どちらの意味か一言添える。最高/最低の日付やグループ名も添える。
3. 条件（期間・曜日・時間帯・車両・ドライバー・乗車地・降車地・住所・距離・運賃）は query_data の引数で指定する。「15時から18時まで」は hourFrom=15, hourTo=18。分を含む指定（「15時半から17時まで」「15時30分から17時まで」）は timeFrom="15:30", timeTo="17:00"（開始を含み終了を含まない）。時刻指定は乗車時刻が基本、「降車した」「降りた」なら dropoffTimeFrom/dropoffTimeTo（例:「22時以降に降車」→ dropoffTimeFrom="22:00"、「22時から23時の間に降車」→ "22:00"〜"23:00"）。住所は「調布市下石原三丁目から乗った回数」→ pickupKeyword=["調布市下石原三丁目"]、「府中市白糸台への降車回数」→ dropoffKeyword=["府中市白糸台"]。住所キーワードが0件ならデータに無いことを伝え、suggestions があれば「もしかして〇〇のことですか？」と聞く。
4. 音声認識の聞き間違い・誤字・存在しない値（例: 一覧にない乗車地・降車地名/町名/ドライバー名/車両名、25時などありえない時刻、似た音の名前）に見えるときは、有効な値の一覧から最も近い候補を選び「もしかして〇〇のことですか？」と提案する。query_data が error と suggestions を返した場合も同様にする。ユーザーの言葉が有効な値と完全に一致しないとき（カタカナ・ひらがな表記、「国領駅」「仙川駅」のような付け足し、似た音の別名など）も、黙って読み替えずに必ず「もしかして〇〇のことですか？」と一言添える。ただし市の省略（「布田」→調布市布田、「白糸台」→府中市白糸台）や丁目の省略は聞き間違いではないので、もしかしてを付けずにそのまま答える。候補が1つに絞れる場合は、その候補で query_data を実行して「〇〇であれば…です」と数値も添える。query_data の filters.corrections に読み替えがあれば、回答の最初に必ず「もしかして〇〇のことですか？」と書く。ありえない時刻（25時など）を自分で別の時刻に読み替えた場合も「もしかして〇時のことですか？」と確認する。
5. パネル表示を頼まれたら create_panel、固定パネルについての質問は focus_panel、分析の一覧は list_capabilities、パネル削除は clear_panels を使う。
6. 回答は自然な日本語で簡潔に（2〜4文程度）。表・Markdown（**など）・ツールの内部名や英語のキー名（perDay, groupStats, fareSummary など）は書かない。金額・件数はツールの数値をそのまま3桁カンマ区切りで書き（例: 101,757,180円）、万・億への換算はしない。
7. 運賃・売上を答えるときは税抜と税込の両方を「6,000円（消費税込みで6,600円）」の形で示す（query_data の fareSummary を使う）。距離からの運賃計算は calc_fare を使う。売上の質問では通常、運賃（税抜/税込）を答え、迎車料金を含む収入や「迎車を除くと〜」は fareSummary.byDispatch / totalIncome を使って必要に応じて添える。
8. 回答の最後に、これはサンプルデータであることを必ず一言添える（例:「※サンプルデータです」）。`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...taxiConversationHistory.slice(-6),
  ];
  // processTaxiConversation already pushed the user message into the history
  const last = messages[messages.length - 1];
  if (!(last && last.role === "user" && last.content === userMessage)) {
    messages.push({ role: "user", content: userMessage });
  }

  const state = { focusPanel: -1, panelCreated: false, toolNotes: [], emptyRetries: 0 };
  const mishearings = taxiDetectMishearings(userMessage);
  if (mishearings.length) {
    messages.push({
      role: "system",
      content: mishearings.map(h => `注意（自動検出）: ユーザーの発言「${h.heard}」は音声認識の誤りで「${h.meant}」（${h.reading}）の可能性が高い。「${h.meant}」として集計し、回答の最初に必ず「もしかして${h.meant}のことですか？」と書くこと。`).join("\n"),
    });
  }

  try {
    for (let round = 0; round < TAXI_LLM_MAX_ROUNDS; round++) {
      const finalRound = round === TAXI_LLM_MAX_ROUNDS - 1;
      const data = await taxiLlmRelayFetch(config, {
        model: config.model || "gpt-4o-mini",
        messages,
        tools: LLM_TOOLS,
        tool_choice: finalRound ? "none" : "auto",
        max_tokens: state.emptyRetries > 0 ? TAXI_LLM_RETRY_MAX_TOKENS : TAXI_LLM_MAX_TOKENS,
        temperature: 0.3,
      });
      const choice = data.choices?.[0];
      if (!choice) {
        return { text: "応答を取得できませんでした。", focusPanel: -1, fallback: true };
      }

      const msg = choice.message || {};
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (toolCalls.length > 0 && !finalRound) {
        messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });
        for (const toolCall of toolCalls) {
          const funcName = toolCall.function?.name;
          let result;
          try {
            const args = JSON.parse(toolCall.function?.arguments || "{}") || {};
            result = executeTaxiToolCall(funcName, args, state);
          } catch (e) {
            result = { ok: false, error: `ツール引数のパースエラー: ${e.message}` };
          }
          if (result && result.message) state.toolNotes.push(result.message);
          if (result && typeof result === "object" && mishearings.length) {
            result.confirmationNeeded = mishearings.map(h => `ユーザーは「${h.heard}」と言っている → 「${h.meant}」として扱い、回答冒頭で「もしかして${h.meant}のことですか？」と確認すること`);
          }
          console.log("[taxi-ai] tool", funcName, toolCall.function?.arguments, result);
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: taxiCompactToolJson(result) });
        }
        continue;
      }

      let text = (msg.content || "").trim();
      // Reasoning models sometimes return an empty message (token budget spent on thinking): retry once with a larger budget
      if (!text && !finalRound && state.emptyRetries < 1) {
        state.emptyRetries++;
        continue;
      }
      let focusPanel = state.focusPanel;
      const focusMatch = text.match(/\[FOCUS_PANEL:(\d)\]/);
      if (focusMatch) {
        focusPanel = parseInt(focusMatch[1]);
        text = text.replace(/\[FOCUS_PANEL:\d\]/g, "").trim();
      }
      text = text.replace(/\*\*/g, "");
      for (const h of mishearings) {
        if (text && !(text.includes("もしかして") && text.includes(h.meant))) {
          text = `もしかして${h.meant}のことですか？（「${h.heard}」と聞こえました）\n${text}`;
        }
      }
      if (!text) text = state.toolNotes.length ? state.toolNotes.join("\n") : "応答を取得できませんでした。";
      return { text, focusPanel, panelCreated: state.panelCreated };
    }
    return { text: state.toolNotes.join("\n") || "処理を完了しました。", focusPanel: state.focusPanel, panelCreated: state.panelCreated };
  } catch (error) {
    console.error("LLM API error:", error);
    const detail = error instanceof TaxiLlmError ? error.message : `${error?.message || error}`;
    return { text: `LLMエラー: ${detail}\n（オフラインモードで応答します）`, focusPanel: -1, fallback: true, errorKind: error?.kind || "unknown" };
  }
}

// Animated "・・・" while waiting for the AI. Shown as a temporary AI message in the XR
// chat panel and the 2D chat; never stored in taxiConversationHistory.
let taxiThinkingText = "";
let taxiThinkingCount = 0;
let taxiThinkingTimer = null;
let taxiThinkingStep = 0;
let taxiThinkingEl = null;
const TAXI_THINKING_FRAMES = ["・", "・・", "・・・"];
const TAXI_THINKING_INTERVAL_MS = 400;

function renderTaxiThinking() {
  if (taxiChatPanelMesh) makeTaxiChatPanelTexture(taxiConversationHistory);
  if (taxiThinkingEl && taxiThinkingEl.isConnected) {
    const textDiv = taxiThinkingEl.lastChild;
    if (textDiv) textDiv.textContent = taxiThinkingText;
  } else if (taxiThinkingText) {
    update2DTaxiChatMessages();
  }
}

function startTaxiThinking() {
  taxiThinkingCount += 1;
  if (taxiThinkingCount > 1) return;
  taxiThinkingStep = 0;
  taxiThinkingText = TAXI_THINKING_FRAMES[0];
  taxiChatScrollPx = 0; // auto-scroll to the indicator
  update2DTaxiChatMessages();
  renderTaxiThinking();
  taxiThinkingTimer = setInterval(() => {
    taxiThinkingStep = (taxiThinkingStep + 1) % TAXI_THINKING_FRAMES.length;
    taxiThinkingText = TAXI_THINKING_FRAMES[taxiThinkingStep];
    renderTaxiThinking();
  }, TAXI_THINKING_INTERVAL_MS);
}

function stopTaxiThinking() {
  taxiThinkingCount = Math.max(0, taxiThinkingCount - 1);
  if (taxiThinkingCount > 0) return;
  if (taxiThinkingTimer) clearInterval(taxiThinkingTimer);
  taxiThinkingTimer = null;
  taxiThinkingText = "";
  if (taxiThinkingEl) taxiThinkingEl.remove();
  taxiThinkingEl = null;
  if (taxiChatPanelMesh) makeTaxiChatPanelTexture(taxiConversationHistory);
}

async function processTaxiConversation(userMessage) {
  if (!userMessage.trim()) return;
  
  taxiConversationHistory.push({ role: "user", content: userMessage });
  updateTaxiChatPanel();
  
  let response;
  const llmConfig = getTaxiLlmConfig();
  
  startTaxiThinking();
  try {
    if (llmConfig) {
      response = await callLlmBackend(userMessage, llmConfig);
      if (response.fallback) {
        const offlineResponse = generateOfflineResponse(userMessage);
        response.text += "\n\n" + offlineResponse.text;
        response.focusPanel = offlineResponse.focusPanel;
      }
    } else {
      response = generateOfflineResponse(userMessage);
    }
  } catch (e) {
    console.error("[taxi-ai] conversation failed", e);
    response = { text: `エラーが発生しました: ${e?.message || e}`, focusPanel: -1 };
  } finally {
    stopTaxiThinking();
  }
  
  taxiConversationHistory.push({ role: "assistant", content: response.text });
  if (!taxiIsListening && !taxiVoiceBusy) taxiVoiceStatusText = "";
  updateTaxiChatPanel();
  
  if (response.focusPanel >= 0 && response.focusPanel < taxiAnalyticsPanels.length) {
    setTaxiFocusedPanel(response.focusPanel);
  }
}

function setTaxiVoiceStatus(text) {
  taxiVoiceStatusText = text || "";
  if (text) statusEl.textContent = text;
  if (taxiChatPanelMesh) makeTaxiChatPanelTexture(taxiConversationHistory);
}

function initTaxiSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;
  
  taxiSpeechRecognition = new SpeechRecognition();
  taxiSpeechRecognition.lang = "ja-JP";
  taxiSpeechRecognition.continuous = false;
  taxiSpeechRecognition.interimResults = false;
  
  taxiSpeechRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    taxiIsListening = false;
    updateTaxiMicButton();
    setTaxiVoiceStatus(`認識: 「${transcript}」`);
    processTaxiConversation(transcript);
  };
  
  taxiSpeechRecognition.onerror = (event) => {
    console.log("Speech recognition error:", event.error);
    taxiIsListening = false;
    updateTaxiMicButton();
    if (event.error === "no-speech") setTaxiVoiceStatus("音声が検出されませんでした。もう一度お試しください。");
    else if (event.error === "not-allowed") setTaxiVoiceStatus("マイクの使用が許可されていません。ブラウザのサイト設定でマイクを許可してください。");
    else if (event.error === "audio-capture") setTaxiVoiceStatus("マイクが見つかりません。");
    else if (event.error === "aborted") setTaxiVoiceStatus("");
    else {
      // network / service-not-allowed / language-not-supported: the browser has the API but no working service
      taxiWebSpeechUnusable = true;
      setTaxiVoiceStatus(`ブラウザの音声認識が使えません（${event.error}）。もう一度🎤を押すと録音→AI文字起こしで入力します。`);
    }
  };
  
  taxiSpeechRecognition.onend = () => {
    taxiIsListening = false;
    updateTaxiMicButton();
  };
  
  return true;
}

function toggleTaxiVoiceInput() {
  const now = performance.now();
  if (now - taxiLastVoiceToggleAt < 400) return; // ray select + touch in the same press
  taxiLastVoiceToggleAt = now;

  if (taxiVoiceBusy) {
    setTaxiVoiceStatus("文字起こし中です。少しお待ちください…");
    return;
  }
  if (taxiRecorder) {
    stopTaxiRecording("manual");
    return;
  }
  if (taxiIsListening && taxiSpeechRecognition) {
    taxiSpeechRecognition.stop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && !taxiWebSpeechUnusable) {
    if (!taxiSpeechRecognition) initTaxiSpeechRecognition();
    try {
      taxiSpeechRecognition.start();
      taxiIsListening = true;
      setTaxiVoiceStatus("🎤 聞いています…（例：売上は？）");
    } catch (e) {
      taxiIsListening = false;
      setTaxiVoiceStatus(`音声認識を開始できませんでした: ${e.message}`);
    }
    updateTaxiMicButton();
    return;
  }
  startTaxiRecording();
}

function taxiMicErrorMessage(e) {
  const name = e?.name || "";
  if (name === "TaxiPermissionTimeout") {
    return "マイク許可の確認がVR内に表示されていない可能性があります。VRを終了し、2D画面の🎤ボタンでマイクを許可してから、もう一度お試しください。";
  }
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "マイクの使用が許可されていません。VRを終了して2D画面の🎤ボタンでマイクを許可してから、もう一度VRに入ってください（Questの設定 > プライバシー > マイク、ブラウザのサイト設定も確認）。";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "マイクが見つかりません。";
  if (name === "NotReadableError") return "マイクを使用できません（他のアプリが使用中の可能性があります）。";
  return `マイクを開始できませんでした（${name || "Error"}: ${e?.message || e}）`;
}

async function startTaxiRecording() {
  const config = getTaxiLlmConfig();
  if (!config) {
    setTaxiVoiceStatus("このブラウザ（Quest Browserなど）は音声認識APIに非対応です。録音をAIで文字起こしするには、設定⚙でLLMのエンドポイントとAPIキーを保存してください。");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setTaxiVoiceStatus("このブラウザではマイクを使用できません（getUserMedia 非対応）。");
    return;
  }
  const rec = { chunks: [], samples: 0, stopped: false, speechStarted: false, voiceBlocks: 0, level: 0, lastStatusAt: 0 };
  taxiRecorder = rec;
  taxiIsListening = true;
  updateTaxiMicButton();
  setTaxiVoiceStatus("マイクを準備しています…");

  let stream;
  try {
    let timedOut = false;
    const gum = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    gum.then((st) => { if (timedOut || rec.stopped) st.getTracks().forEach((t) => t.stop()); }, () => {});
    stream = await Promise.race([
      gum,
      new Promise((_, reject) => setTimeout(() => {
        timedOut = true;
        const err = new Error("permission timeout");
        err.name = "TaxiPermissionTimeout";
        reject(err);
      }, TAXI_MIC_PERMISSION_TIMEOUT_MS)),
    ]);
  } catch (e) {
    console.warn("[taxi-voice] getUserMedia failed", e);
    if (taxiRecorder === rec) taxiRecorder = null;
    rec.stopped = true;
    taxiIsListening = false;
    updateTaxiMicButton();
    setTaxiVoiceStatus(taxiMicErrorMessage(e));
    return;
  }
  if (rec.stopped || taxiRecorder !== rec) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  try {
    // Reuse the app's (already running, gesture-unlocked) AudioContext; a new one could stay suspended in XR.
    initAudio();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const actx = audioContext || new AudioContextCtor();
    rec.ownContext = actx !== audioContext;
    if (actx.state === "suspended") { try { await actx.resume(); } catch (e) { /* ignore */ } }
    const source = actx.createMediaStreamSource(stream);
    const proc = actx.createScriptProcessor(4096, 1, 1);
    const sink = actx.createGain();
    sink.gain.value = 0;
    source.connect(proc);
    proc.connect(sink);
    sink.connect(actx.destination);
    Object.assign(rec, { stream, actx, source, proc, sink, rate: actx.sampleRate, startedAt: performance.now(), lastVoiceAt: performance.now() });
    proc.onaudioprocess = (ev) => {
      if (rec.stopped) return;
      const d = ev.inputBuffer.getChannelData(0);
      rec.chunks.push(new Float32Array(d));
      rec.samples += d.length;
      let sum = 0;
      for (let k = 0; k < d.length; k++) sum += d[k] * d[k];
      const rms = Math.sqrt(sum / d.length);
      rec.level = Math.max(rms, rec.level * 0.8);
      const t = performance.now();
      if (rms > TAXI_VAD_RMS) {
        rec.voiceBlocks += 1;
        if (rec.voiceBlocks >= 2) rec.speechStarted = true;
        rec.lastVoiceAt = t;
      } else {
        rec.voiceBlocks = 0;
      }
      const elapsedSec = rec.samples / rec.rate;
      if (elapsedSec >= TAXI_STT_MAX_SEC) stopTaxiRecording("max");
      else if (rec.speechStarted && t - rec.lastVoiceAt > TAXI_VAD_SILENCE_MS) stopTaxiRecording("silence");
      else if (!rec.speechStarted && elapsedSec > TAXI_VAD_NO_SPEECH_SEC) stopTaxiRecording("nospeech");
      else if (t - rec.lastStatusAt > 250) {
        rec.lastStatusAt = t;
        const bars = Math.max(0, Math.min(5, Math.round(rec.level / 0.02)));
        setTaxiVoiceStatus(`🎤 聞いています… 音量${"▮".repeat(bars)}${"▯".repeat(5 - bars)} 残り${Math.max(0, Math.ceil(TAXI_STT_MAX_SEC - elapsedSec))}秒（話し終えると自動送信／もう一度押すと終了）`);
      }
    };
    setTaxiVoiceStatus("🎤 聞いています…（話し終えると自動送信／もう一度押すと終了）");
  } catch (e) {
    console.warn("[taxi-voice] audio graph failed", e);
    stream.getTracks().forEach((t) => t.stop());
    if (taxiRecorder === rec) taxiRecorder = null;
    rec.stopped = true;
    taxiIsListening = false;
    updateTaxiMicButton();
    setTaxiVoiceStatus(`録音を開始できませんでした（${e?.name || "Error"}: ${e?.message || e}）`);
  }
}

function stopTaxiRecording(reason) {
  const rec = taxiRecorder;
  if (!rec || rec.stopped) return;
  rec.stopped = true;
  taxiRecorder = null;
  taxiIsListening = false;
  try {
    if (rec.proc) rec.proc.onaudioprocess = null;
    rec.source?.disconnect();
    rec.proc?.disconnect();
    rec.sink?.disconnect();
  } catch (e) { /* ignore */ }
  rec.stream?.getTracks().forEach((t) => t.stop());
  if (rec.ownContext) rec.actx?.close?.().catch?.(() => {});
  updateTaxiMicButton();

  const seconds = rec.rate ? rec.samples / rec.rate : 0;
  if (reason === "cancel" || seconds < 0.3) {
    setTaxiVoiceStatus(reason === "cancel" ? "" : "録音が短すぎます。もう一度お試しください。");
    return;
  }
  if (reason === "nospeech" || (!rec.speechStarted && reason !== "manual")) {
    setTaxiVoiceStatus("音声が検出されませんでした（マイクに向かって、もう少し大きな声で話してください）。");
    return;
  }
  const b64 = taxiBytesToBase64(taxiEncodeWav16k(rec.chunks, rec.rate));
  taxiTranscribeAndAsk(b64);
}

async function taxiTranscribeAndAsk(wavBase64) {
  const config = getTaxiLlmConfig();
  if (!config) {
    setTaxiVoiceStatus("設定⚙でLLMのエンドポイントとAPIキーを保存してください。");
    return;
  }
  taxiVoiceBusy = true;
  updateTaxiMicButton();
  setTaxiVoiceStatus("文字起こし中…（AI）");
  let text = "";
  try {
    text = await taxiTranscribeAudioBase64(wavBase64, config);
  } catch (e) {
    taxiVoiceBusy = false;
    updateTaxiMicButton();
    setTaxiVoiceStatus(`音声の文字起こしに失敗しました: ${e?.message || e}`);
    return;
  }
  taxiVoiceBusy = false;
  updateTaxiMicButton();
  if (!text) {
    setTaxiVoiceStatus("聞き取れませんでした。もう一度お試しください。");
    return;
  }
  setTaxiVoiceStatus(`認識: 「${text}」`);
  processTaxiConversation(text);
}

// Ask for the microphone while still in the 2D page (a permission prompt may not show inside immersive VR).
async function primeTaxiMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    st.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (e) {
    return e?.name || "error";
  }
}

function setTaxiFocusedPanel(index) {
  taxiFocusedPanelIndex = index;
  taxiFocusAnimationT = 0;
}

function updateTaxiPanelFocus() {
  if (!inTaxiAnalyticsRoom) {
    for (let i = 0; i < taxiAnalyticsPanels.length; i++) {
      const panel = taxiAnalyticsPanels[i];
      panel.scale.setScalar(1);
      if (panel.material.emissive) panel.material.emissive.setHex(0x000000);
    }
    return;
  }
  
  taxiFocusAnimationT += 0.016;
  
  for (let i = 0; i < taxiAnalyticsPanels.length; i++) {
    const panel = taxiAnalyticsPanels[i];
    const isFocused = i === taxiFocusedPanelIndex;
    
    const targetScale = isFocused ? 1.06 : 1.0;
    const currentScale = panel.scale.x;
    panel.scale.setScalar(THREE.MathUtils.lerp(currentScale, targetScale, 0.08));
    
    if (isFocused) {
      const pulse = Math.sin(taxiFocusAnimationT * 3) * 0.015 + 1.05;
      panel.scale.setScalar(pulse);
    }
  }
}

// XR chat panel: the whole (recent) conversation is laid out on a virtual
// column and a scroll window is drawn onto a persistent canvas. 0 = latest.
// v19: panel 2.2 x 1.84 m (2x), canvas 1200 x 1000 (same px/m as before), body text 34px (was 15px on 600 px).
const TAXI_CHAT_PANEL_W = 2.2;
const TAXI_CHAT_PANEL_H = 1.84;
const TAXI_CHAT_CANVAS_W = 1200;
const TAXI_CHAT_CANVAS_H = 1000;
const TAXI_CHAT_VIEW_TOP = 108;
const TAXI_CHAT_VIEW_BOTTOM = TAXI_CHAT_CANVAS_H - 70;
const TAXI_CHAT_FONT_PX = 34;
const TAXI_CHAT_LINE_H = 44;
const TAXI_CHAT_MAX_RENDER_MESSAGES = 40;
const TAXI_CHAT_SCROLL_STEP_PX = 320;
const TAXI_CHAT_STICK_SCROLL_PX_PER_S = 1100;
let taxiChatScrollPx = 0; // how far the view is scrolled up from the latest message
let taxiChatMaxScrollPx = 0;
let taxiChatRenderedCount = -1;
let taxiVoiceStatusText = "";
let taxiChatCanvas = null;
let taxiChatCtx = null;

function layoutTaxiChatMessages(ctx, messages, textWidth) {
  const blocks = [];
  let total = 0;
  for (const msg of messages.slice(-TAXI_CHAT_MAX_RENDER_MESSAGES)) {
    const lines = [];
    for (const para of String(msg.content ?? "").split("\n")) {
      if (!para.trim()) {
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        continue;
      }
      lines.push(...wrapText(ctx, para, textWidth, TAXI_CHAT_FONT_PX));
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    const h = 46 + Math.max(1, lines.length) * TAXI_CHAT_LINE_H + 12;
    blocks.push({ isUser: msg.role === "user", thinking: !!msg.thinking, lines, y: total, h });
    total += h + 16;
  }
  return { blocks, total: Math.max(0, total - 16) };
}

function drawTaxiChatPanel(ctx, messages, scrollPx, statusText) {
  const W = TAXI_CHAT_CANVAS_W;
  const H = TAXI_CHAT_CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12, 8, 20, 0.92)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(100, 180, 255, 0.6)";
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.fillStyle = "rgba(100, 180, 255, 0.15)";
  ctx.fillRect(12, 12, W - 24, 80);
  ctx.font = "bold 40px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#a8d4ff";
  ctx.textAlign = "center";
  ctx.fillText("AI 分析アシスタント（サンプルデータ）", W / 2, 66);

  const viewH = TAXI_CHAT_VIEW_BOTTOM - TAXI_CHAT_VIEW_TOP;
  const padding = 28;
  const scrollbarW = 18;
  const boxW = W - padding * 2 - scrollbarW - 12;
  const textWidth = boxW - 28;
  ctx.textAlign = "left";

  if (messages.length === 0) {
    taxiChatMaxScrollPx = 0;
    ctx.fillStyle = "rgba(200, 200, 200, 0.6)";
    ctx.font = "italic 32px Arial";
    ctx.textAlign = "center";
    ctx.fillText("マイクボタンを押すか、下の質問ボタンを押してください", W / 2, H / 2);
    ctx.fillText("例：「売上は？」「ピーク時間は？」", W / 2, H / 2 + 52);
    ctx.textAlign = "left";
  } else {
    const { blocks, total } = layoutTaxiChatMessages(ctx, messages, textWidth);
    const maxScroll = Math.max(0, total - viewH);
    taxiChatMaxScrollPx = maxScroll;
    const scroll = Math.min(Math.max(scrollPx, 0), maxScroll);
    const offsetY = TAXI_CHAT_VIEW_TOP - (maxScroll - scroll);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TAXI_CHAT_VIEW_TOP, W, viewH);
    ctx.clip();
    for (const block of blocks) {
      const y = offsetY + block.y;
      if (y + block.h < TAXI_CHAT_VIEW_TOP || y > TAXI_CHAT_VIEW_BOTTOM) continue;
      ctx.fillStyle = block.isUser ? "rgba(168, 132, 255, 0.2)" : "rgba(100, 180, 255, 0.15)";
      ctx.fillRect(padding, y, boxW, block.h);
      ctx.fillStyle = block.isUser ? "#d4c4ff" : "#c8e4ff";
      ctx.font = "bold 26px Arial";
      ctx.fillText(block.isUser ? "あなた:" : block.thinking ? "AI（考え中）:" : "AI:", padding + 14, y + 34);
      ctx.font = `${TAXI_CHAT_FONT_PX}px Arial`;
      for (let i = 0; i < block.lines.length; i++) {
        ctx.fillText(block.lines[i], padding + 14, y + 46 + (i + 1) * TAXI_CHAT_LINE_H - 10);
      }
    }
    ctx.restore();
    if (maxScroll > 0) {
      const trackX = W - padding - scrollbarW;
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(trackX, TAXI_CHAT_VIEW_TOP, scrollbarW, viewH);
      const thumbH = Math.max(56, (viewH * viewH) / (total || 1));
      const thumbY = TAXI_CHAT_VIEW_TOP + (viewH - thumbH) * ((maxScroll - scroll) / maxScroll);
      ctx.fillStyle = "rgba(143, 247, 255, 0.75)";
      ctx.fillRect(trackX, thumbY, scrollbarW, thumbH);
    }
  }

  ctx.font = "28px Arial";
  ctx.fillStyle = statusText ? "#ffd27a" : "rgba(200, 200, 220, 0.65)";
  const footer = statusText || (taxiChatMaxScrollPx > 0
    ? (Math.min(Math.max(scrollPx, 0), taxiChatMaxScrollPx) > 0 ? "▼で最新へ / パネルを指してスティック上下でスクロール" : "▲で過去の会話 / パネルを指してスティック上下でスクロール")
    : "🎤 または下の質問ボタンで質問できます");
  ctx.fillText(truncateTaxiChatLine(ctx, footer, W - padding * 2), padding, H - 26);
}

function truncateTaxiChatLine(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

function makeTaxiChatPanelTexture(messages = []) {
  if (!taxiChatCanvas) {
    taxiChatCanvas = document.createElement("canvas");
    taxiChatCanvas.width = TAXI_CHAT_CANVAS_W;
    taxiChatCanvas.height = TAXI_CHAT_CANVAS_H;
    taxiChatCtx = taxiChatCanvas.getContext("2d");
  }
  // the thinking indicator is drawn as a temporary AI message; it is never part of taxiConversationHistory
  const shown = taxiThinkingText ? [...messages, { role: "assistant", content: taxiThinkingText, thinking: true }] : messages;
  drawTaxiChatPanel(taxiChatCtx, shown, taxiChatScrollPx, taxiVoiceStatusText);
  if (!taxiChatPanelTexture) {
    taxiChatPanelTexture = new THREE.CanvasTexture(taxiChatCanvas);
    taxiChatPanelTexture.colorSpace = THREE.SRGBColorSpace;
  } else {
    taxiChatPanelTexture.needsUpdate = true;
  }
  return taxiChatPanelTexture;
}

function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `${fontSize}px Arial`;
  const words = text.split("");
  const lines = [];
  let currentLine = "";
  
  for (const char of words) {
    const testLine = currentLine + char;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

let taxiChatPanelMesh = null;
let taxiChatPanelTexture = null;

function createTaxiChatPanel() {
  makeTaxiChatPanelTexture([]);
  taxiChatPanelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TAXI_CHAT_PANEL_W, TAXI_CHAT_PANEL_H),
    new THREE.MeshBasicMaterial({
      map: taxiChatPanelTexture,
      transparent: true,
      side: THREE.DoubleSide,
    })
  );
  // v19: (17.8, 2.3, -2.0), 45° like before; moved inward so the 2.2 m panel + side buttons stay inside x <= 19
  taxiChatPanelMesh.position.set(
    TAXI_ANALYTICS_ROOM_POSITION.x + TAXI_ANALYTICS_ROOM_HALF.x - 1.2,
    TAXI_ANALYTICS_ROOM_POSITION.y + 0.1,
    TAXI_ANALYTICS_ROOM_POSITION.z + 0.2
  );
  taxiChatPanelMesh.rotation.y = -Math.PI / 4;
  taxiChatPanelMesh.userData.isTaxiChatPanel = true;
  taxiAnalyticsGroup.add(taxiChatPanelMesh);
}

// Place a control relative to the chat panel (panel-local x = right, y = up, z = toward the viewer).
function placeOnTaxiChatPanel(mesh, localX, localY, localZ = 0.01) {
  mesh.position.set(localX, localY, localZ).applyEuler(taxiChatPanelMesh.rotation).add(taxiChatPanelMesh.position);
  mesh.rotation.copy(taxiChatPanelMesh.rotation);
}

function updateTaxiChatPanel() {
  if (!taxiChatPanelMesh) return;
  if (taxiConversationHistory.length !== taxiChatRenderedCount) {
    taxiChatRenderedCount = taxiConversationHistory.length;
    taxiChatScrollPx = 0; // new message: jump to the latest
  }
  makeTaxiChatPanelTexture(taxiConversationHistory);
}

// deltaPx > 0 scrolls toward older messages. Returns true when the view moved.
function scrollTaxiChatPanel(deltaPx) {
  if (!taxiChatPanelMesh) return false;
  const next = Math.min(Math.max(taxiChatScrollPx + deltaPx, 0), taxiChatMaxScrollPx);
  if (Math.abs(next - taxiChatScrollPx) < 0.5) return false;
  taxiChatScrollPx = next;
  makeTaxiChatPanelTexture(taxiConversationHistory);
  return true;
}

function makeTaxiChatScrollButtonTexture(dir) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(40, 60, 90, 0.92)";
  ctx.roundRect(4, 4, 120, 120, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(143, 247, 255, 0.8)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#dff8ff";
  ctx.beginPath();
  if (dir > 0) {
    ctx.moveTo(64, 30); ctx.lineTo(100, 90); ctx.lineTo(28, 90);
  } else {
    ctx.moveTo(64, 98); ctx.lineTo(100, 38); ctx.lineTo(28, 38);
  }
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const taxiChatScrollButtons = [];

function createTaxiChatScrollButtons() {
  for (const dir of [1, -1]) {
    const btn = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.13),
      new THREE.MeshBasicMaterial({ map: makeTaxiChatScrollButtonTexture(dir), transparent: true, side: THREE.DoubleSide })
    );
    placeOnTaxiChatPanel(btn, TAXI_CHAT_PANEL_W / 2 + 0.03 + 0.065, dir > 0 ? 0.62 : 0.42, 0.01);
    btn.userData.isTaxiChatScroll = true;
    btn.userData.scrollDir = dir;
    btn.userData.xrHitSize = { w: 0.13, h: 0.13, d: 0.06 };
    taxiAnalyticsGroup.add(btn);
    taxiChatScrollButtons.push(btn);
  }
}

function checkTaxiChatScrollHit(point) {
  for (const btn of taxiChatScrollButtons) {
    tmpVec.copy(point);
    btn.worldToLocal(tmpVec);
    const size = btn.userData.xrHitSize;
    if (Math.abs(tmpVec.x) <= size.w * 0.5 && Math.abs(tmpVec.y) <= size.h * 0.5 && Math.abs(tmpVec.z) <= size.d * 0.5) {
      return btn.userData.scrollDir;
    }
  }
  return 0;
}

function makeTaxiMicButtonTexture(isListening, isBusy = false) {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 200;
  const ctx = c.getContext("2d");
  
  ctx.beginPath();
  ctx.arc(100, 100, 90, 0, Math.PI * 2);
  ctx.fillStyle = isBusy ? "rgba(255, 170, 60, 0.9)" : isListening ? "rgba(255, 100, 100, 0.9)" : "rgba(100, 180, 255, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 4;
  ctx.stroke();
  
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(85, 55, 30, 50, 8);
  ctx.fill();
  
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(100, 95, 25, 0, Math.PI);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(100, 120);
  ctx.lineTo(100, 140);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(85, 140);
  ctx.lineTo(115, 140);
  ctx.stroke();
  
  if (isListening || isBusy) {
    ctx.font = "bold 14px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(isBusy ? "文字起こし中..." : "聴いています...", 100, 175);
  }
  
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let taxiMicButtonMesh = null;
let taxiMicButtonTexture = null;

function createTaxiMicButton() {
  taxiMicButtonTexture = makeTaxiMicButtonTexture(false);
  taxiMicButtonMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({
      map: taxiMicButtonTexture,
      transparent: true,
      side: THREE.DoubleSide,
    })
  );
  // Right of the chat panel, below the ▲▼ scroll buttons.
  placeOnTaxiChatPanel(taxiMicButtonMesh, TAXI_CHAT_PANEL_W / 2 + 0.03 + 0.11, -0.15, 0.02);
  taxiMicButtonMesh.userData.isTaxiMicButton = true;
  taxiMicButtonMesh.userData.xrHitSize = { w: 0.22, h: 0.22, d: 0.06 };
  taxiAnalyticsGroup.add(taxiMicButtonMesh);
}

function updateTaxiMicButton() {
  if (!taxiMicButtonMesh) return;
  const oldTex = taxiMicButtonTexture;
  taxiMicButtonTexture = makeTaxiMicButtonTexture(taxiIsListening, taxiVoiceBusy);
  taxiMicButtonMesh.material.map = taxiMicButtonTexture;
  taxiMicButtonMesh.material.needsUpdate = true;
  if (oldTex) oldTex.dispose();
}

// Same labels/questions as the 2D quick buttons (index.html .taxiQuickBtn).
const taxiSuggestedQuestions = [
  { label: "月別売上", question: "月別の売上推移を出して" },
  { label: "曜日別", question: "曜日別の乗車回数を見せて" },
  { label: "車両別", question: "車両ごとの稼働率比較" },
  { label: "一覧", question: "どの一覧表を出せますか？" },
  { label: "クリア", question: "パネルをクリアして" },
];
const TAXI_QUESTION_BTN_W = 0.2;
const TAXI_QUESTION_BTN_H = 0.085;
const TAXI_QUESTION_BTN_GAP = 0.025;

function makeTaxiQuestionButtonTexture(text) {
  const c = document.createElement("canvas");
  c.width = 236;
  c.height = 100;
  const ctx = c.getContext("2d");
  
  ctx.fillStyle = "rgba(60, 45, 90, 0.9)";
  ctx.roundRect(0, 0, c.width, c.height, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(168, 132, 255, 0.7)";
  ctx.lineWidth = 3;
  ctx.stroke();
  
  ctx.font = "bold 36px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#e4daff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2);
  
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const taxiQuestionButtons = [];

// One row directly under the chat panel (panel is 1.1 m wide x 0.92 m tall).
function createTaxiQuestionButtons() {
  const n = taxiSuggestedQuestions.length;
  const rowW = n * TAXI_QUESTION_BTN_W + (n - 1) * TAXI_QUESTION_BTN_GAP;
  const localY = -TAXI_CHAT_PANEL_H / 2 - 0.025 - TAXI_QUESTION_BTN_H / 2;
  
  for (let i = 0; i < n; i++) {
    const q = taxiSuggestedQuestions[i];
    const btn = new THREE.Mesh(
      new THREE.PlaneGeometry(TAXI_QUESTION_BTN_W, TAXI_QUESTION_BTN_H),
      new THREE.MeshBasicMaterial({
        map: makeTaxiQuestionButtonTexture(q.label),
        transparent: true,
        side: THREE.DoubleSide,
      })
    );
    placeOnTaxiChatPanel(btn, -rowW / 2 + TAXI_QUESTION_BTN_W / 2 + i * (TAXI_QUESTION_BTN_W + TAXI_QUESTION_BTN_GAP), localY, 0.01);
    btn.userData.isTaxiQuestionButton = true;
    btn.userData.questionText = q.question;
    btn.userData.xrHitSize = { w: TAXI_QUESTION_BTN_W, h: TAXI_QUESTION_BTN_H, d: 0.06 };
    taxiAnalyticsGroup.add(btn);
    taxiQuestionButtons.push(btn);
  }
}

function checkTaxiQuestionButtonHit(point) {
  for (const btn of taxiQuestionButtons) {
    tmpVec.copy(point);
    btn.worldToLocal(tmpVec);
    const size = btn.userData.xrHitSize;
    if (
      Math.abs(tmpVec.x) <= size.w * 0.5 &&
      Math.abs(tmpVec.y) <= size.h * 0.5 &&
      Math.abs(tmpVec.z) <= size.d * 0.5
    ) {
      return btn.userData.questionText;
    }
  }
  return null;
}

function checkTaxiMicButtonHit(point) {
  if (!taxiMicButtonMesh) return false;
  tmpVec.copy(point);
  taxiMicButtonMesh.worldToLocal(tmpVec);
  const size = taxiMicButtonMesh.userData.xrHitSize;
  return (
    Math.abs(tmpVec.x) <= size.w * 0.5 &&
    Math.abs(tmpVec.y) <= size.h * 0.5 &&
    Math.abs(tmpVec.z) <= size.d * 0.5
  );
}

createTaxiChatPanel();
createTaxiChatScrollButtons();
createTaxiMicButton();
createTaxiQuestionButtons();
// v19: return button under the quick-question row (it used to cover the back-wall panels)
placeOnTaxiChatPanel(taxiReturnXrButton, 0, -TAXI_CHAT_PANEL_H / 2 - 0.025 - TAXI_QUESTION_BTN_H - 0.06 - 0.09, 0.02);

// 2D UI Elements for Taxi Conversation
const taxiChatPanelEl = document.getElementById("taxiChatPanel");
const taxiChatMessagesEl = document.getElementById("taxiChatMessages");
const taxiChatInputEl = document.getElementById("taxiChatInput");
const taxiSendBtnEl = document.getElementById("taxiSendBtn");
const taxiMicBtnEl = document.getElementById("taxiMicBtn");
const taxiSettingsBtnEl = document.getElementById("taxiSettingsBtn");
const taxiSettingsModalEl = document.getElementById("taxiSettingsModal");
const llmEndpointEl = document.getElementById("llmEndpoint");
const llmApiKeyEl = document.getElementById("llmApiKey");
const llmModelEl = document.getElementById("llmModel");
const llmSttModelEl = document.getElementById("llmSttModel");
const llmApiKeyToggleEl = document.getElementById("llmApiKeyToggle");
const llmApiKeyHintEl = document.getElementById("llmApiKeyHint");

function setTaxiApiKeyVisible(visible) {
  if (!llmApiKeyEl) return;
  llmApiKeyEl.type = visible ? "text" : "password";
  if (llmApiKeyToggleEl) {
    llmApiKeyToggleEl.textContent = visible ? "非表示" : "表示";
    llmApiKeyToggleEl.setAttribute("aria-pressed", visible ? "true" : "false");
  }
}

// Shows what the app will actually send (after removing spaces/newlines/"Bearer " etc.).
function updateTaxiApiKeyHint(storedRaw) {
  if (!llmApiKeyHintEl || !llmApiKeyEl) return;
  const raw = llmApiKeyEl.value;
  const key = taxiSanitizeApiKey(raw);
  if (!key) {
    llmApiKeyHintEl.textContent = raw ? "⚠ 空白・改行だけでキーがありません。" : "";
    return;
  }
  const peek = key.length > 12 ? `先頭「${key.slice(0, 4)}」…末尾「${key.slice(-4)}」` : "";
  let text = `使用するキー: ${key.length}文字 ${peek}`;
  if (key !== raw) text += `\n⚠ 入力に空白・改行・「Bearer 」などが含まれています。取り除いた${key.length}文字のキーを使います（保存すると欄も置き換わります）。`;
  else if (typeof storedRaw === "string" && storedRaw !== key) text += "\n⚠ 保存済みキーに空白・改行などが含まれていたため、取り除いて使っています。";
  if (/[^\x21-\x7e]/.test(key)) text += "\n⚠ 全角文字など使えない文字が含まれています。キーを貼り直してください。";
  llmApiKeyHintEl.textContent = text;
}

llmApiKeyToggleEl?.addEventListener("click", () => {
  setTaxiApiKeyVisible(llmApiKeyEl?.type === "password");
});
llmApiKeyEl?.addEventListener("input", () => updateTaxiApiKeyHint());
setTaxiApiKeyVisible(true);
const llmSaveBtnEl = document.getElementById("llmSaveBtn");
const llmClearBtnEl = document.getElementById("llmClearBtn");
const llmCloseBtnEl = document.getElementById("llmCloseBtn");
const llmStatusEl = document.getElementById("llmStatus");
const taxiQuickBtns = document.querySelectorAll(".taxiQuickBtn");

function update2DTaxiChatMessages() {
  if (!taxiChatMessagesEl) return;
  taxiChatMessagesEl.innerHTML = "";
  for (const msg of taxiConversationHistory.slice(-10)) {
    const div = document.createElement("div");
    div.className = `taxiChatMsg ${msg.role}`;
    const roleSpan = document.createElement("div");
    roleSpan.className = "role";
    roleSpan.textContent = msg.role === "user" ? "あなた" : "AI";
    div.appendChild(roleSpan);
    const textSpan = document.createElement("div");
    textSpan.textContent = msg.content;
    div.appendChild(textSpan);
    taxiChatMessagesEl.appendChild(div);
  }
  taxiThinkingEl = null;
  if (taxiThinkingText) {
    const div = document.createElement("div");
    div.className = "taxiChatMsg assistant thinking";
    const roleSpan = document.createElement("div");
    roleSpan.className = "role";
    roleSpan.textContent = "AI";
    div.appendChild(roleSpan);
    const textSpan = document.createElement("div");
    textSpan.textContent = taxiThinkingText;
    div.appendChild(textSpan);
    taxiChatMessagesEl.appendChild(div);
    taxiThinkingEl = div;
  }
  taxiChatMessagesEl.scrollTop = taxiChatMessagesEl.scrollHeight;
}

const originalUpdateTaxiChatPanel = updateTaxiChatPanel;
updateTaxiChatPanel = function() {
  originalUpdateTaxiChatPanel();
  update2DTaxiChatMessages();
};

function handle2DTaxiSend() {
  if (!taxiChatInputEl) return;
  const text = taxiChatInputEl.value.trim();
  if (text) {
    processTaxiConversation(text);
    taxiChatInputEl.value = "";
  }
}

taxiSendBtnEl?.addEventListener("click", handle2DTaxiSend);
taxiChatInputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handle2DTaxiSend();
  }
});

taxiMicBtnEl?.addEventListener("click", () => {
  toggleTaxiVoiceInput();
});

const originalUpdateTaxiMicButton = updateTaxiMicButton;
updateTaxiMicButton = function() {
  originalUpdateTaxiMicButton();
  if (taxiMicBtnEl) {
    taxiMicBtnEl.classList.toggle("listening", taxiIsListening);
    taxiMicBtnEl.textContent = taxiVoiceBusy ? "…" : taxiIsListening ? "⏹" : "🎤";
  }
};

taxiQuickBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const question = btn.dataset.question;
    if (question) processTaxiConversation(question);
  });
});

taxiSettingsBtnEl?.addEventListener("click", () => {
  if (taxiSettingsModalEl) {
    taxiSettingsModalEl.hidden = false;
    setTaxiApiKeyVisible(true);
    const config = getTaxiLlmConfig();
    let storedRawKey;
    try { storedRawKey = JSON.parse(localStorage.getItem(TAXI_CONVERSATION_STORAGE_KEY) || "null")?.apiKey; } catch (e) { storedRawKey = undefined; }
    if (config) {
      if (llmEndpointEl) llmEndpointEl.value = config.endpoint || "";
      if (llmApiKeyEl) llmApiKeyEl.value = config.apiKey || "";
      if (llmModelEl) llmModelEl.value = config.model || "";
      if (llmSttModelEl) llmSttModelEl.value = config.sttModel || "";
    }
    updateTaxiApiKeyHint(storedRawKey);
  }
});

llmSaveBtnEl?.addEventListener("click", () => {
  const endpoint = llmEndpointEl?.value.trim();
  const apiKey = taxiSanitizeApiKey(llmApiKeyEl?.value);
  const model = llmModelEl?.value.trim();
  const sttModel = llmSttModelEl?.value.trim() || "";
  if (llmApiKeyEl) llmApiKeyEl.value = apiKey;
  updateTaxiApiKeyHint();
  
  if (!endpoint || !apiKey) {
    if (llmStatusEl) llmStatusEl.textContent = "エンドポイントとAPIキーは必須です。";
    return;
  }
  
  try {
    localStorage.setItem(TAXI_CONVERSATION_STORAGE_KEY, JSON.stringify({ endpoint, apiKey, model, sttModel }));
    if (llmStatusEl) llmStatusEl.textContent = "設定を保存しました。LLMモードで動作します。";
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      // No Web Speech (Quest Browser): voice input records audio -> ask for the mic now, outside VR.
      primeTaxiMicPermission().then((r) => {
        if (!llmStatusEl) return;
        llmStatusEl.textContent = r === "granted"
          ? "設定を保存しました。マイクも許可済みです（音声は録音→AI文字起こしで入力）。"
          : `設定を保存しました。マイクは未許可です（${r}）。音声入力を使う場合はマイクを許可してください。`;
      });
    }
  } catch (e) {
    if (llmStatusEl) llmStatusEl.textContent = "保存に失敗しました: " + e.message;
  }
});

llmClearBtnEl?.addEventListener("click", () => {
  clearTaxiLlmConfig();
  if (llmEndpointEl) llmEndpointEl.value = "";
  if (llmApiKeyEl) llmApiKeyEl.value = "";
  if (llmModelEl) llmModelEl.value = "";
  if (llmSttModelEl) llmSttModelEl.value = "";
  updateTaxiApiKeyHint();
  if (llmStatusEl) llmStatusEl.textContent = "設定をクリアしました。オフラインモードで動作します。";
});

llmCloseBtnEl?.addEventListener("click", () => {
  if (taxiSettingsModalEl) taxiSettingsModalEl.hidden = true;
});

taxiSettingsModalEl?.addEventListener("click", (e) => {
  if (e.target === taxiSettingsModalEl) taxiSettingsModalEl.hidden = true;
});

// ---------------------------------------------------------------------------
// Ship flight safety: Enterprise and Klingon passes are cinematic, but they
// should still respect obvious physical obstacles. At spawn time, build the
// current obstacle list in world space and bend a route only when its straight
// path would cut through a protected sphere.
// ---------------------------------------------------------------------------
const FLIGHT_ROUTE_SAMPLES = 32;
const FLIGHT_ROUTE_SOLVE_PASSES = 4;
const flightObstacles = [];
const flightSeg = new THREE.Vector3();
const flightDir = new THREE.Vector3();
const flightClosest = new THREE.Vector3();
const flightAvoid = new THREE.Vector3();
const flightSample = new THREE.Vector3();
const flightMid = new THREE.Vector3();
const flightFallbackSide = new THREE.Vector3();
const flightTmpCenter = new THREE.Vector3();

function addFlightObstacle(name, object3d, radius, shipClearance, extraClearance = 0) {
  object3d.updateWorldMatrix(true, false);
  object3d.getWorldPosition(flightTmpCenter);
  flightObstacles.push({
    name,
    center: flightTmpCenter.clone(),
    radius: radius + shipClearance + extraClearance,
  });
}

function collectFlightObstacles(shipClearance) {
  flightObstacles.length = 0;
  addFlightObstacle("Earth", ballGroup, EARTH_RADIUS, shipClearance, EARTH_RADIUS * 0.25);
  addFlightObstacle("Moon", moon, MOON_RADIUS, shipClearance, EARTH_RADIUS * 0.9);
  addFlightObstacle("Sun", sunMesh, SUN_RADIUS, shipClearance, SUN_RADIUS * 0.04);
  addFlightObstacle("Saturn", saturnBall, SATURN_R * 2.35, shipClearance, EARTH_RADIUS * 0.8);
  addFlightObstacle("Black hole", blackHoleGroup, BLACK_HOLE_PULL_R, shipClearance, EARTH_RADIUS * 1.0);
  for (const planet of planets) {
    addFlightObstacle("Planet", planet.mesh, planet.radius, shipClearance, EARTH_RADIUS * 0.35);
  }
  return flightObstacles;
}

function sampleFlightRoutePoint(start, control, end, t, out) {
  const u = 1 - t;
  return out
    .copy(start)
    .multiplyScalar(u * u)
    .addScaledVector(control, 2 * u * t)
    .addScaledVector(end, t * t);
}

function sampleFlightRouteTangent(start, control, end, t, out) {
  return out
    .copy(control)
    .sub(start)
    .multiplyScalar(2 * (1 - t))
    .addScaledVector(flightMid.copy(end).sub(control), 2 * t);
}

function estimateFlightRouteLength(start, control, end) {
  let length = 0;
  flightMid.copy(start);
  for (let i = 1; i <= FLIGHT_ROUTE_SAMPLES; i += 1) {
    sampleFlightRoutePoint(start, control, end, i / FLIGHT_ROUTE_SAMPLES, flightSample);
    length += flightSample.distanceTo(flightMid);
    flightMid.copy(flightSample);
  }
  return Math.max(0.001, length);
}

function addFlightAvoidanceOffset(point, body, routeDir, extraDistance) {
  flightAvoid.copy(point).sub(body.center).projectOnPlane(routeDir);
  if (flightAvoid.lengthSq() < 1e-6) {
    flightFallbackSide.crossVectors(routeDir, worldUp);
    if (flightFallbackSide.lengthSq() < 1e-6) flightFallbackSide.set(1, 0, 0);
    flightAvoid.copy(flightFallbackSide);
  }
  flightAvoid.normalize();
  return flightAvoid.multiplyScalar(extraDistance);
}

function planSafeFlightRoute(start, end, control, options = {}) {
  const shipClearance = options.shipClearance ?? EARTH_RADIUS * 1.5;
  control.copy(start).lerp(end, 0.5);
  flightSeg.copy(end).sub(start);
  const routeLength = flightSeg.length();
  if (routeLength < 1e-5) return 0.001;
  flightDir.copy(flightSeg).multiplyScalar(1 / routeLength);

  const bodies = collectFlightObstacles(shipClearance);
  let adjusted = false;
  for (const body of bodies) {
    const t = THREE.MathUtils.clamp(flightTmpCenter.copy(body.center).sub(start).dot(flightSeg) / (routeLength * routeLength), 0, 1);
    if (t <= 0.03 || t >= 0.97) continue;
    flightClosest.copy(start).addScaledVector(flightSeg, t);
    const missDistance = flightClosest.distanceTo(body.center);
    if (missDistance >= body.radius) continue;
    const push = body.radius - missDistance + shipClearance * 0.55;
    control.add(addFlightAvoidanceOffset(flightClosest, body, flightDir, push));
    adjusted = true;
  }

  if (!adjusted) return routeLength;

  for (let pass = 0; pass < FLIGHT_ROUTE_SOLVE_PASSES; pass += 1) {
    let worstBody = null;
    let worstPoint = null;
    let worstPenetration = 0;
    for (const body of bodies) {
      for (let i = 1; i < FLIGHT_ROUTE_SAMPLES; i += 1) {
        sampleFlightRoutePoint(start, control, end, i / FLIGHT_ROUTE_SAMPLES, flightSample);
        const dist = flightSample.distanceTo(body.center);
        const penetration = body.radius - dist;
        if (penetration > worstPenetration) {
          worstPenetration = penetration;
          worstBody = body;
          if (!worstPoint) worstPoint = new THREE.Vector3();
          worstPoint.copy(flightSample);
        }
      }
    }
    if (!worstBody || !worstPoint) break;
    control.add(addFlightAvoidanceOffset(worstPoint, worstBody, flightDir, worstPenetration + shipClearance * 0.35));
  }

  return estimateFlightRouteLength(start, control, end);
}

// ---------------------------------------------------------------------------
// Apollo 11-inspired mission. The scale and timing are still compressed for the
// demo, but the sequence follows a more natural flow: launch/staging, a curved
// translunar coast, lunar orbit insertion, LM separation, powered descent, and
// touchdown at the same site where the surface lander/flag appear.
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

// Saturn V: a 3-stage stack (+Y up). This is the launch vehicle only; once the
// translunar coast begins, a separate docked CSM+LM model represents the crewed
// spacecraft after launch escape tower jettison and spacecraft extraction.
function buildSaturnV() {
  const group = new THREE.Group();
  const R = 0.014;

  // Upper stack visible during launch; the separate CSM+LM model takes over
  // after ascent so the escape tower does not ride all the way to the Moon.
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
const SPACECRAFT_SCALE = 0.68;
const LM_SCALE = SPACECRAFT_SCALE * 0.72;
const saturnV = buildSaturnV();
const csm = buildCSM();
csm.scale.setScalar(SPACECRAFT_SCALE);
const lmDocked = buildLM(matSilver);
lmDocked.scale.setScalar(0.72);
lmDocked.position.y = 0.067; // LM leads the docked stack, touching the CSM nose
csm.add(lmDocked);
const lmFlying = buildLM(matSilver);
lmFlying.scale.setScalar(LM_SCALE);
saturnV.group.visible = false;
csm.visible = false;
lmFlying.visible = false;
scene.add(saturnV.group);
scene.add(csm);
scene.add(lmFlying);

// Surface site appears only after touchdown. It is kept in world space and
// repositioned relative to the current Moon center each frame so the landing
// point stays continuous with the descending LM.
const SURF_SCALE = LM_SCALE;
const surfaceSite = new THREE.Group();
surfaceSite.visible = false;
const surfaceLander = buildLM(matSilver);
surfaceLander.scale.setScalar(SURF_SCALE);
surfaceLander.position.y = 0.0205 * SURF_SCALE + 0.001;
surfaceSite.add(surfaceLander);
const flag = buildFlag();
flag.scale.setScalar(SPACECRAFT_SCALE);
const FLAG_OFFSET_X = 0.045;
const FLAG_OFFSET_Z = 0.014;
const flagSag =
  Math.sqrt(Math.max(0, MOON_RADIUS * MOON_RADIUS - FLAG_OFFSET_X * FLAG_OFFSET_X - FLAG_OFFSET_Z * FLAG_OFFSET_Z)) -
  MOON_RADIUS;
flag.position.set(FLAG_OFFSET_X, flagSag - 0.001, FLAG_OFFSET_Z);
surfaceSite.add(flag);
scene.add(surfaceSite);

// Lunar orbit, defined fresh each frame so angle 0 always sits on the Moon's
// Earth-facing (near) side. The incoming craft therefore arrives at the near
// side and circles at a constant radius — it can never cross the Moon body.
const ORBIT_AXIS = new THREE.Vector3(0.2, 1, 0.15).normalize();
const inPlane1 = new THREE.Vector3(); // angle-0 direction (toward Earth)
const inPlane2 = new THREE.Vector3(); // perpendicular in the orbit plane
function updateOrbitBasis() {
  inPlane1.copy(apDirEM).multiplyScalar(-1); // moon -> Earth (unit; apDirEM is unit)
  inPlane2.crossVectors(ORBIT_AXIS, inPlane1);
  if (inPlane2.lengthSq() < 1e-6) inPlane2.set(1, 0, 0);
  inPlane2.normalize();
}
function orbitPos(center, r, ang, out) {
  return out
    .copy(center)
    .addScaledVector(inPlane1, Math.cos(ang) * r)
    .addScaledVector(inPlane2, Math.sin(ang) * r);
}

// Mission timeline, in seconds. These are compressed, but the coast and lunar
// operations dominate the loop instead of the launch jumping straight to the
// Moon.
const T_LIFTOFF = 3; // clear the pad before first-stage separation starts
const T_STAGE1 = 5; // S-IC falls away
const T_WAIT = 1; // short interstage coast
const T_STAGE2 = 4; // S-II falls away; S-IVB continues the final push
const T_ASCENT = T_LIFTOFF + T_STAGE1 + T_WAIT + T_STAGE2; // 13 s
const T_COAST = 22; // curved translunar coast
const T_PITCH = 4; // lunar orbit insertion / pitch to tangent
const T_ORBIT = 28; // low lunar orbit, LM separation, and powered descent
const T_GAP = 3; // brief pause before relaunch
const T_TOTAL = T_ASCENT + T_COAST + T_PITCH + T_ORBIT + T_GAP;
const B_ASCENT = T_ASCENT;
const B_COAST = B_ASCENT + T_COAST;
const B_PITCH = B_COAST + T_PITCH;
const B_ORBIT = B_PITCH + T_ORBIT;
const STAGE2_START = T_LIFTOFF + T_STAGE1 + T_WAIT; // 9 s

let missionT = 0;
const earthWorld = new THREE.Vector3();
const moonWorld = new THREE.Vector3();
const apA = new THREE.Vector3();
const apB = new THREE.Vector3();
const apC = new THREE.Vector3();
const apDirEM = new THREE.Vector3();
const apTangent = new THREE.Vector3();
const apSurfUp = new THREE.Vector3();
const apPrev = new THREE.Vector3();
const transferCtrl = new THREE.Vector3();
const landingSiteUpWorld = new THREE.Vector3();
const descentStart = new THREE.Vector3();
const descentEnd = new THREE.Vector3();
let apPrevValid = false;
const NOSE_OFFSET = 0.054 * SPACECRAFT_SCALE; // CSM center -> nose tip
const ARRIVAL_CLEAR = 0.01; // keep the nose clear of the surface at pitch-over
const ORBIT_R = MOON_RADIUS + NOSE_OFFSET + ARRIVAL_CLEAR; // craft center; nose stops short of the surface
// The Earth-Moon distance is visually compressed, so launch distances stay well
// short of the Moon and the coast covers most of the transfer.
const PAD_CENTER = EARTH_RADIUS + 0.13; // full-stack center with the base on the pad
const LAUNCH_TOP = EARTH_RADIUS + 0.28; // end-of-ascent center, still far short of the Moon
const LANDING_START_P = 0.44; // fraction of lunar-orbit phase before LM separation
const LANDING_DURATION_P = 0.38;
const LM_TOUCHDOWN_CENTER = MOON_RADIUS + 0.0205 * LM_SCALE + 0.001; // center height so LM feet sit on the surface
let landingSiteLocked = false;
let apolloLanded = false;
const _qRad = new THREE.Quaternion();
const _qTan = new THREE.Quaternion();
const _qDir = new THREE.Vector3();
function quatAlignY(dir, out) {
  _qDir.copy(dir);
  if (_qDir.lengthSq() < 1e-9) return;
  _qDir.normalize();
  out.setFromUnitVectors(_yUp, _qDir);
}

function transferPoint(a, c, b, p, out) {
  const q = 1 - p;
  return out
    .copy(a)
    .multiplyScalar(q * q)
    .addScaledVector(c, 2 * q * p)
    .addScaledVector(b, p * p);
}

function transferDerivative(a, c, b, p, out) {
  return out
    .copy(c)
    .sub(a)
    .multiplyScalar(2 * (1 - p))
    .addScaledVector(apC.copy(b).sub(c), 2 * p);
}

function hideApolloSurfaceSite() {
  surfaceSite.visible = false;
  apolloLanded = false;
  landingSiteLocked = false;
}

function placeApolloSurfaceSite(upWorld) {
  surfaceSite.visible = true;
  surfaceSite.position.copy(moonWorld).addScaledVector(upWorld, MOON_RADIUS);
  alignY(surfaceSite, upWorld);
}

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
  missionT += dt;
  if (missionT >= T_TOTAL) {
    missionT -= T_TOTAL;
    apPrevValid = false;
    hideApolloSurfaceSite();
    resetSaturnV();
  }
  const t = missionT;

  earthWorld.copy(ballGroup.position); // roomCenter + ballOffset
  moon.getWorldPosition(moonWorld);
  apDirEM.copy(moonWorld).sub(earthWorld).normalize();
  updateOrbitBasis();

  saturnV.group.visible = false;
  saturnV.plume.visible = false;
  csm.visible = false;
  lmFlying.visible = false;
  lmDocked.visible = true;

  if (t < B_ASCENT) {
    // Launch + staging: climb off the pad, drop S-IC, briefly coast, then drop
    // S-II while the upper stack continues toward the transfer point.
    saturnV.group.visible = true;
    const dist = THREE.MathUtils.lerp(PAD_CENTER, LAUNCH_TOP, smooth(t / B_ASCENT));
    saturnV.group.position.copy(earthWorld).addScaledVector(apDirEM, dist);
    alignY(saturnV.group, apDirEM);

    if (t > T_LIFTOFF) {
      const sp = smooth((t - T_LIFTOFF) / T_STAGE1);
      saturnV.stage1.position.y = -0.095 - sp * 0.5;
      saturnV.stage1.scale.setScalar(1 - sp * 0.7);
      if (sp >= 1) saturnV.stage1.visible = false;
    }
    if (t > STAGE2_START) {
      const sp = smooth((t - STAGE2_START) / T_STAGE2);
      saturnV.stage2.position.y = -0.04 - sp * 0.5;
      saturnV.stage2.scale.setScalar(1 - sp * 0.7);
      if (sp >= 1) saturnV.stage2.visible = false;
    }

    // Keep the engine plume glued to the base of whichever stage is burning.
    saturnV.plume.visible = true;
    let plumeY;
    let plumeScale;
    if (t < T_LIFTOFF) {
      plumeY = -0.155; // S-IC base
      plumeScale = 1;
    } else if (t < STAGE2_START) {
      plumeY = -0.0875; // S-II base
      plumeScale = 0.75;
    } else {
      plumeY = -0.043; // S-IVB base
      plumeScale = 0.5;
    }
    saturnV.plume.position.y = plumeY;
    saturnV.plume.scale.set(plumeScale, plumeScale * (0.7 + Math.random() * 0.6), plumeScale);
    apPrev.copy(saturnV.group.position);
    apPrevValid = true;
  } else if (t < B_COAST) {
    // Translunar coast: a shallow curved transfer arc instead of a straight
    // line. The CSM+LM stays docked and points along the instantaneous path.
    const p = (t - B_ASCENT) / T_COAST;
    const sp = smooth(p);
    csm.visible = true;
    apA.copy(earthWorld).addScaledVector(apDirEM, LAUNCH_TOP);
    orbitPos(moonWorld, ORBIT_R, 0, apB); // near-side arrival point
    transferCtrl.copy(apA).add(apB).multiplyScalar(0.5).addScaledVector(ORBIT_AXIS, apA.distanceTo(apB) * 0.24);
    transferPoint(apA, transferCtrl, apB, sp, csm.position);
    transferDerivative(apA, transferCtrl, apB, sp, apTangent);
    alignY(csm, apTangent);
    apPrev.copy(csm.position);
    apPrevValid = true;
  } else if (t < B_PITCH) {
    // Lunar orbit insertion: the docked spacecraft pitches from an inbound
    // radial attitude to a tangent lunar-orbit attitude.
    const p = (t - B_COAST) / T_PITCH;
    csm.visible = true;
    orbitPos(moonWorld, ORBIT_R, 0, apA);
    csm.position.copy(apA);
    apTangent.copy(moonWorld).sub(apA); // nose pointing down at the Moon
    quatAlignY(apTangent, _qRad);
    apB.copy(inPlane2).multiplyScalar(-1); // orbit travels the -inPlane2 way
    quatAlignY(apB, _qTan);
    csm.quaternion.slerpQuaternions(_qRad, _qTan, smooth(p));
    apPrevValid = false;
  } else if (t < B_ORBIT) {
    // Lunar orbit: the CSM ("母艦") circles while the docked LM waits for a
    // descent opportunity. Once separated, the LM descends to the exact surface
    // point that becomes the visible landing site.
    const p = (t - B_PITCH) / T_ORBIT;
    csm.visible = true;
    const ang = -p * Math.PI * 2.4; // a little over one orbit, reversed direction
    orbitPos(moonWorld, ORBIT_R, ang, apA);
    csm.position.copy(apA);
    orbitPos(moonWorld, ORBIT_R, ang - 0.01, apB); // next point along the reversed motion
    apTangent.copy(apB).sub(apA);
    alignY(csm, apTangent);

    if (p > LANDING_START_P) {
      lmDocked.visible = false;
      if (!landingSiteLocked) {
        landingSiteUpWorld.copy(apA).sub(moonWorld).normalize();
        landingSiteLocked = true;
      }
      const dp = (p - LANDING_START_P) / LANDING_DURATION_P;
      if (dp < 1) {
        // LM separates from the CSM and follows a short powered descent along
        // the local radius. It remains stylized, but it no longer teleports to a
        // pre-existing lander.
        lmFlying.visible = true;
        apSurfUp.copy(landingSiteUpWorld);
        descentStart.copy(moonWorld).addScaledVector(apSurfUp, ORBIT_R);
        descentEnd.copy(moonWorld).addScaledVector(apSurfUp, LM_TOUCHDOWN_CENTER);
        lmFlying.position.lerpVectors(descentStart, descentEnd, smooth(dp));
        alignY(lmFlying, apSurfUp);
      } else {
        apolloLanded = true;
      }
    }
    apPrevValid = false;
  }
  // t >= B_ORBIT: brief reset gap before the next launch; keep the landed site
  // visible until the mission loop restarts.
  if (apolloLanded && landingSiteLocked) placeApolloSurfaceSite(landingSiteUpWorld);
}

renderer.setAnimationLoop((timestamp) => {
  const dt = Math.min((timestamp - lastFrameTime) / 1000 || 0, 0.04);
  lastFrameTime = timestamp;

  keyboardSteer();
  updateHandPresence();
  updateXrAimRays();
  updateHandTouch(dt);
  updateLocomotion(dt);
  if (
    audioContext?.state === "running" &&
    (
      shipSourceGain ||
      warpSourceGain ||
      rareOrbitGain ||
      klingonGain ||
      klingonArrivalSound.spatialAudio ||
      klingonDepartureSound.spatialAudio ||
      blackHoleRumbleSpatial ||
      transientSpatialAudios.length > 0 ||
      enterpriseSynthSpatial
    )
  ) {
    updateAudioListenerPose();
    updateTransientSpatialAudios();
  }

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
  updateSunHeatHaze(elapsed);
  sunMesh.rotation.y += dt * 0.03;
  saturnBall.rotation.y += dt * 0.1;
  for (const p of planets) p.mesh.rotation.y += dt * p.spin;
  updatePlanetMoonSystems(dt);
  updatePlanetLighting();
  updateBlackHole(dt, elapsed);
  updateBlackHoleTourCountdown();
  updateTaxiAnalyticsRoom();

  // Refresh world matrices so the Apollo mission can read the live Moon
  // position (the Moon both orbits the Earth and the Earth roams the room).
  ballGroup.updateWorldMatrix(true, true);
  updateEarthNightSide(elapsed);
  updateMoonLighting();
  updateApollo(dt);

  // Ambient space life: orbiting satellite, shooting stars, distant comet, surface lightning.
  elapsed += dt;
  updateSpaceBackdrop(elapsed);
  satOrbit.rotation.y += dt * SAT_ORBIT_SPEED;
  satOrbit.updateWorldMatrix(true, true);
  updateSatelliteLighting();
  updateMeteor(dt);
  updateComet(dt);
  updateSolarProminence(dt);
  updateAuroraFlare(dt);
  updateSolarSpots(dt);
  updateKlingon(dt);
  updateEnterprise(dt);
  updateLightning(dt);
  updateXrButtonIcons(dt);
  updateControllerHelp();
  updatePoseDebugButton();

  applyDebugTopCamera();
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
