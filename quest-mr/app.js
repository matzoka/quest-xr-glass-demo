import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

const statusEl = document.querySelector("#status");
const vrButton = document.querySelector("#vrButton");
const arButton = document.querySelector("#arButton");
const enterpriseOrbitButton = document.querySelector("#enterpriseOrbitButton");
const klingonButton = document.querySelector("#klingonButton");
const poseDebugOutputEl = document.querySelector("#poseDebugOutput");
const DEBUG_TOP_VIEW = new URLSearchParams(window.location.search).has("topDebug");
const DEBUG_TOP_VIEW_DISTANCE = Number(new URLSearchParams(window.location.search).get("topDebugDist"));
const DEBUG_BLACK_HOLE_VIEW = new URLSearchParams(window.location.search).has("blackHoleDebug");
const DEBUG_BLACK_HOLE_FALL = new URLSearchParams(window.location.search).has("blackHoleFallDebug");
const DEBUG_BLACK_HOLE_BACK_VIEW = new URLSearchParams(window.location.search).has("blackHoleBackDebug");
const DEBUG_SOLAR_SPOT_VIEW = new URLSearchParams(window.location.search).has("solarSpotDebug");
const DEBUG_COMET_VIEW = new URLSearchParams(window.location.search).has("cometDebug");
const DEBUG_CAMERA_VIEW = new URLSearchParams(window.location.search).has("cameraDebug");
const DEBUG_POSE_CAPTURE = new URLSearchParams(window.location.search).has("poseDebug");

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
const BLACK_HOLE_POSITION = new THREE.Vector3(24, 11, -48);
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
  if (DEBUG_SOLAR_SPOT_VIEW && !renderer.xr.isPresenting) {
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

const auroraMaterial = new THREE.ShaderMaterial({
  uniforms: {
    ...earthNightUniforms,
    uTime: { value: 0.0 },
  },
  vertexShader: earthNightVert,
  fragmentShader: `
precision mediump float;
uniform vec3 uSunDir;
uniform float uTime;
varying vec2 vUv;
varying vec3 vNormal;
void main(){
  vec3 n=normalize(vNormal);
  float lit=dot(n,normalize(uSunDir));
  float night=1.0-smoothstep(-0.18,0.10,lit);
  float lat=abs(n.y);
  float polarBand=smoothstep(0.66,0.78,lat)*(1.0-smoothstep(0.94,1.0,lat));
  float wave=0.5+0.5*sin(vUv.x*72.0+uTime*1.65+sin(vUv.y*38.0)*2.6);
  float ribbon=smoothstep(0.42,0.98,wave);
  float shimmer=0.68+0.32*sin(uTime*3.4+vUv.x*19.0+vUv.y*7.0);
  float alpha=polarBand*night*(0.16+0.56*ribbon)*shimmer;
  if(alpha<0.01) discard;
  vec3 color=mix(vec3(0.25,1.0,0.48),vec3(0.35,0.86,1.0),ribbon);
  gl_FragColor=vec4(color*alpha*1.75,alpha);
}`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const auroraMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.032, 64, 48),
  auroraMaterial
);
auroraMesh.renderOrder = 6;
earthMesh.add(auroraMesh);

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
satellite.scale.setScalar(0.5); // smaller now that the Moon is in the scene

const satOrbit = new THREE.Group();
satOrbit.rotation.x = THREE.MathUtils.degToRad(35); // inclined orbit
satOrbit.add(satellite);
ballGroup.add(satOrbit);
const SAT_ORBIT_SPEED = 0.8; // rad/s — a clearly visible orbit, even while the Earth moves
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
  new THREE.ConeGeometry(0.0045, 0.13, 12, 1, true),
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
      return;
    }

    shipVel.copy(enterprise.position).sub(shipRarePrevPos);
    if (shipVel.lengthSq() < 1e-6) {
      shipVel.copy(shipRareOrbitU).multiplyScalar(-s).addScaledVector(shipRareOrbitV, c);
    }
    shipVel.normalize().multiplyScalar(ENTERPRISE_RARE_ORBIT_RADIUS * ENTERPRISE_RARE_ORBIT_SPEED);
    orientEnterpriseAlongVelocity();
    return;
  }

  if (shipRarePhase === ENTERPRISE_RARE_DEPART) {
    enterprise.position.addScaledVector(shipVel, dt);
    orientEnterpriseAlongVelocity();
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
  klingonPassDuration = playKlingonTheme();
  planSafeFlightRoute(klingonStart, klingonEnd, klingonControl, {
    shipClearance: EARTH_RADIUS * 2.0,
  });
  sampleFlightRouteTangent(klingonStart, klingonControl, klingonEnd, 0, klingonVel)
    .multiplyScalar(1 / klingonPassDuration);
  klingon.position.copy(klingonStart);
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
      enterpriseOrbitXrButton.visible = false;
      klingonXrButton.visible = false;
      poseDebugXrButton.visible = false;
      poseDebugXrPanel.visible = false;
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
    poseDebugXrButton.visible = DEBUG_POSE_CAPTURE;
    poseDebugXrPanel.visible = DEBUG_POSE_CAPTURE;
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
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  master.connect(audioContext.destination);

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
let warpBuffer = null;
let warpBufferTried = false;
let warpSource = null;
let rareOrbitBuffer = null;
let rareOrbitBufferTried = false;
let rareOrbitSource = null;
let rareOrbitAudioWanted = false;
let klingonBuffer = null;
let klingonBufferTried = false;
let klingonBufferPromise = null;
let klingonSource = null;
let klingonAudioWanted = false;
let blackHoleBuffer = null;
let blackHoleBufferTried = false;
let blackHoleBufferPromise = null;
let blackHoleRumbleSource = null;
let blackHoleRumbleGain = null;
let blackHoleRumbleFilter = null;
let blackHoleRumbleTargetGain = 0;
const klingonArrivalSound = {
  url: "./assets/star-trek-tng-transporter.mp3",
  label: "Klingon arrival sound",
  buffer: null,
  promise: null,
  source: null,
  failed: false,
};
const klingonDepartureSound = {
  url: "./assets/star-trek-transportation.mp3",
  label: "Klingon departure sound",
  buffer: null,
  promise: null,
  source: null,
  failed: false,
};

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
    blackHoleRumbleFilter.connect(blackHoleRumbleGain);
    blackHoleRumbleGain.connect(audioContext.destination);
    blackHoleRumbleSource.onended = () => {
      blackHoleRumbleSource = null;
    };
    blackHoleRumbleSource.start();
  } catch (e) {
    blackHoleRumbleSource = null;
    blackHoleRumbleGain = null;
    blackHoleRumbleFilter = null;
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

function playOneShotAudio(sound, volume = 0.72) {
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
    }
    const gain = audioContext.createGain();
    gain.gain.value = volume;
    gain.connect(audioContext.destination);
    sound.source = audioContext.createBufferSource();
    sound.source.buffer = sound.buffer;
    sound.source.connect(gain);
    sound.source.onended = () => {
      sound.source = null;
      gain.disconnect();
    };
    sound.source.start();
    return sound.buffer.duration || 0;
  } catch (e) {
    sound.source = null;
    return 0;
  }
}

function playKlingonArrivalSound() {
  return playOneShotAudio(klingonArrivalSound, 0.74);
}

function playKlingonDepartureSound() {
  return playOneShotAudio(klingonDepartureSound, 0.76);
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
      }
      shipWarpAudioEnded = false;
      warpSource = audioContext.createBufferSource();
      warpSource.buffer = warpBuffer;
      warpSource.connect(audioContext.destination);
      warpSource.onended = () => {
        shipWarpAudioEnded = true;
        warpSource = null;
      };
      warpSource.start();
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
    rareOrbitSource = audioContext.createBufferSource();
    rareOrbitSource.buffer = rareOrbitBuffer;
    rareOrbitSource.loop = true;
    rareOrbitSource.connect(audioContext.destination);
    rareOrbitSource.onended = () => {
      rareOrbitSource = null;
    };
    rareOrbitSource.start();
  } catch (e) {
    rareOrbitSource = null;
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
    }
    klingonSource = audioContext.createBufferSource();
    klingonSource.buffer = klingonBuffer;
    klingonSource.connect(audioContext.destination);
    klingonSource.onended = () => {
      klingonSource = null;
    };
    klingonSource.start();
  } catch (e) {
    klingonSource = null;
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
  const maxTextWidth = 270;
  let fontSize = 46;
  do {
    ctx.font = `bold ${fontSize}px sans-serif`;
    fontSize -= 2;
  } while (fontSize > 28 && ctx.measureText(label).width > maxTextWidth);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 160, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

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
    ctx.fillText(rows[i][1], c.width - 48, y);
    ctx.textAlign = "left";
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

let poseDebugPanelTexture = makePoseDebugPanelTexture();

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

const enterpriseOrbitXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(0.42, 0.15),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("Enterprise 周回", "rgba(20,85,135,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
enterpriseOrbitXrButton.position.set(0, 1.8, -0.5);
enterpriseOrbitXrButton.renderOrder = 999;
enterpriseOrbitXrButton.visible = false;
scene.add(enterpriseOrbitXrButton);

const klingonXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(0.42, 0.15),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("クリンゴン登場", "rgba(22,105,62,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
klingonXrButton.position.set(0, 2.0, -0.5);
klingonXrButton.renderOrder = 999;
klingonXrButton.visible = false;
scene.add(klingonXrButton);

const poseDebugXrButton = new THREE.Mesh(
  new THREE.PlaneGeometry(0.5, 0.18),
  new THREE.MeshBasicMaterial({
    map: makeButtonTexture("視線記録", "rgba(90,62,150,0.95)"),
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
);
poseDebugXrButton.position.set(0, 2.2, -0.5);
poseDebugXrButton.renderOrder = 999;
poseDebugXrButton.visible = false;
scene.add(poseDebugXrButton);

const poseDebugXrPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(0.76, 0.44),
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
      const uiTargets = [exitButton, resetButton, enterpriseOrbitXrButton, klingonXrButton];
      if (poseDebugXrButton.visible) uiTargets.push(poseDebugXrButton);
      const uiHit = raycaster.intersectObjects(uiTargets)[0];
      if (uiHit) {
        if (uiHit.object === exitButton) renderer.xr.getSession()?.end();
        else if (uiHit.object === resetButton) resetBall();
        else if (uiHit.object === enterpriseOrbitXrButton) requestEnterpriseRareOrbit();
        else if (uiHit.object === klingonXrButton) requestKlingonPass();
        else if (uiHit.object === poseDebugXrButton) capturePoseDebugUrl();
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
  poseDebugXrButton.position
    .copy(viewerWorld)
    .addScaledVector(poseDebugButtonForward, 0.45)
    .addScaledVector(poseDebugButtonRight, 0.3)
    .addScaledVector(poseDebugButtonUp, -0.28);
  poseDebugXrPanel.position
    .copy(viewerWorld)
    .addScaledVector(poseDebugButtonForward, 0.46)
    .addScaledVector(poseDebugButtonRight, 0.3)
    .addScaledVector(poseDebugButtonUp, -0.62);
  poseDebugXrButton.quaternion.copy(cam.quaternion);
  poseDebugXrPanel.quaternion.copy(cam.quaternion);
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
}

function updateSolarSpots(dt) {
  solarSpotUniforms.uTime.value = elapsed;
  if (!solarSpotActive) {
    if (elapsed >= nextSolarSpotAt) spawnSolarSpot();
    return;
  }

  solarSpotT += dt;
  const p = Math.min(1, solarSpotT / solarSpotDuration);
  const fade = THREE.MathUtils.smoothstep(p, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(p, 0.78, 1.0));
  solarSpotUniforms.uSpotOpacity.value = fade;
  if (p >= 1) {
    solarSpotActive = false;
    solarSpotUniforms.uSpotOpacity.value = 0;
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

const solarProminenceGroup = new THREE.Group();
solarProminenceGroup.visible = false;
sunMesh.add(solarProminenceGroup);

const solarPromCoreMat = makeSolarProminenceMaterial(1.35, 0xfff8c8, 0xff5a0c);
const solarPromGlowMat = makeSolarProminenceMaterial(0.45, 0xffd36a, 0xff2500);
const solarPromStrandMat = makeSolarProminenceMaterial(0.7, 0xffc86e, 0xd91b00);
const solarPromCore = new THREE.Mesh(new THREE.BufferGeometry(), solarPromCoreMat);
const solarPromGlow = new THREE.Mesh(new THREE.BufferGeometry(), solarPromGlowMat);
const solarPromStrandA = new THREE.Mesh(new THREE.BufferGeometry(), solarPromStrandMat);
const solarPromStrandB = new THREE.Mesh(new THREE.BufferGeometry(), solarPromStrandMat.clone());
solarPromStrandB.material.userData.opacityScale = 0.58;
solarProminenceGroup.add(solarPromGlow, solarPromStrandA, solarPromStrandB, solarPromCore);

const solarFootTex = makeSolarFootTexture();
const solarFootA = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: solarFootTex,
    color: 0xffb15a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
);
const solarFootB = new THREE.Sprite(solarFootA.material.clone());
const solarApexGlow = new THREE.Sprite(solarFootA.material.clone());
solarProminenceGroup.add(solarFootA, solarFootB, solarApexGlow);

let solarProminenceActive = false;
let solarProminenceT = 0;
let solarProminenceDuration = 6;
let nextSolarProminenceAt = 6;
const solarPromPoints = [];
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
const solarFootScale = new THREE.Vector3();
let solarApexGlowBaseScale = SUN_RADIUS * 0.31;

function scheduleNextSolarProminence() {
  nextSolarProminenceAt = elapsed + 18 + Math.random() * 22;
}

function rotateAroundAxis(vec, axis, angle) {
  return vec.applyAxisAngle(axis, angle).normalize();
}

function randomSolarProminenceScale() {
  const r = Math.random();
  if (r < 0.24) return 0.56 + Math.random() * 0.18;
  if (r > 0.76) return 1.34 + Math.random() * 0.2;
  return 0.82 + Math.random() * 0.42;
}

function randomSolarProminenceThickness() {
  const r = Math.random();
  if (r < 0.18) return 0.76 + Math.random() * 0.16;
  if (r > 0.78) return 1.24 + Math.random() * 0.24;
  return 0.94 + Math.random() * 0.28;
}

function setRandomVisibleSolarLimbDir() {
  let bestAngle = Math.random() * Math.PI * 2;
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
  solarLimbDir
    .copy(solarLimbAxisA)
    .multiplyScalar(Math.cos(bestAngle))
    .addScaledVector(solarLimbAxisB, Math.sin(bestAngle))
    .normalize();
}

function spawnSolarProminence() {
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

  solarTangent.crossVectors(solarViewDir, solarDir);
  if (solarTangent.lengthSq() < 1e-5) solarTangent.crossVectors(_yUp, solarDir);
  solarTangent.normalize();
  solarSide.crossVectors(solarDir, solarTangent).normalize();

  const sizeScale = randomSolarProminenceScale();
  const thicknessScale = randomSolarProminenceThickness();
  const sizeT = THREE.MathUtils.clamp((sizeScale - 0.56) / 0.98, 0, 1);
  const thicknessT = THREE.MathUtils.clamp((thicknessScale - 0.76) / 0.72, 0, 1);
  const halfAngle = THREE.MathUtils.degToRad(7 + Math.random() * 8.0) * THREE.MathUtils.lerp(0.62, 1.72, sizeT);
  const lift = THREE.MathUtils.lerp(0.09, 0.46, sizeT) + Math.random() * THREE.MathUtils.lerp(0.03, 0.08, sizeT);
  const twist = (Math.random() - 0.5) * SUN_RADIUS * THREE.MathUtils.lerp(0.045, 0.14, sizeT);
  const filamentScale = THREE.MathUtils.lerp(0.58, 1.48, sizeT) * THREE.MathUtils.lerp(0.9, 1.08, thicknessT);
  solarPromPoints.length = 0;
  for (let i = 0; i <= 24; i += 1) {
    const p = i / 24;
    const a = THREE.MathUtils.lerp(-halfAngle, halfAngle, p);
    const rise = Math.sin(p * Math.PI);
    solarDir
      .copy(solarLimbDir)
      .multiplyScalar(Math.cos(a))
      .addScaledVector(solarTangent, Math.sin(a))
      .addScaledVector(solarViewDir, 0.04)
      .normalize();
    const wave = Math.sin(p * Math.PI * 2.0) * twist * rise;
    solarPromPoints.push(
      solarDir
        .clone()
        .multiplyScalar(SUN_RADIUS * (1.01 + lift * rise))
        .addScaledVector(solarSide, wave)
    );
  }

  const strandPointsA = solarPromPoints.map((point, index) => {
    const p = index / (solarPromPoints.length - 1);
    const rise = Math.sin(p * Math.PI);
    return point
      .clone()
      .addScaledVector(solarSide, SUN_RADIUS * (0.02 + rise * 0.05) * filamentScale)
      .addScaledVector(solarTangent, SUN_RADIUS * Math.sin(p * Math.PI * 2.0) * 0.015 * filamentScale);
  });
  const strandPointsB = solarPromPoints.map((point, index) => {
    const p = index / (solarPromPoints.length - 1);
    const rise = Math.sin(p * Math.PI);
    return point
      .clone()
      .addScaledVector(solarSide, -SUN_RADIUS * (0.014 + rise * 0.036) * filamentScale)
      .addScaledVector(solarTangent, SUN_RADIUS * Math.sin(p * Math.PI * 1.5 + 0.7) * 0.012 * filamentScale);
  });

  const curve = new THREE.CatmullRomCurve3(solarPromPoints);
  const strandCurveA = new THREE.CatmullRomCurve3(strandPointsA);
  const strandCurveB = new THREE.CatmullRomCurve3(strandPointsB);
  const tubeScale = THREE.MathUtils.lerp(0.58, 1.52, sizeT) * thicknessScale;
  const coreGeo = new THREE.TubeGeometry(curve, 96, SUN_RADIUS * 0.0046 * tubeScale, 10, false);
  const glowGeo = new THREE.TubeGeometry(curve, 96, SUN_RADIUS * 0.015 * tubeScale, 12, false);
  const strandGeoA = new THREE.TubeGeometry(strandCurveA, 80, SUN_RADIUS * 0.0036 * tubeScale, 8, false);
  const strandGeoB = new THREE.TubeGeometry(strandCurveB, 80, SUN_RADIUS * 0.0029 * tubeScale, 8, false);
  solarPromCore.geometry.dispose();
  solarPromGlow.geometry.dispose();
  solarPromStrandA.geometry.dispose();
  solarPromStrandB.geometry.dispose();
  solarPromCore.geometry = coreGeo;
  solarPromGlow.geometry = glowGeo;
  solarPromStrandA.geometry = strandGeoA;
  solarPromStrandB.geometry = strandGeoB;

  solarFootScale.setScalar(SUN_RADIUS * THREE.MathUtils.lerp(0.13, 0.27, sizeT));
  solarApexGlowBaseScale = SUN_RADIUS * THREE.MathUtils.lerp(0.18, 0.42, sizeT);
  solarFootA.position.copy(solarPromPoints[0]).normalize().multiplyScalar(SUN_RADIUS * 1.014);
  solarFootB.position.copy(solarPromPoints[solarPromPoints.length - 1]).normalize().multiplyScalar(SUN_RADIUS * 1.014);
  solarApexGlow.position.copy(solarPromPoints[Math.floor(solarPromPoints.length / 2)]);
  solarFootA.scale.copy(solarFootScale);
  solarFootB.scale.copy(solarFootScale);
  solarApexGlow.scale.setScalar(solarApexGlowBaseScale);

  solarProminenceDuration = 6.4 + Math.random() * 2.4;
  solarProminenceT = 0;
  solarProminenceGroup.visible = true;
  solarProminenceActive = true;
}

function updateSolarProminence(dt) {
  if (!solarProminenceActive) {
    if (elapsed >= nextSolarProminenceAt) spawnSolarProminence();
    return;
  }

  solarProminenceT += dt;
  const p = Math.min(1, solarProminenceT / solarProminenceDuration);
  const fade = THREE.MathUtils.smoothstep(p, 0, 0.18) * (1 - THREE.MathUtils.smoothstep(p, 0.72, 1.0));
  const pulse = 0.82 + Math.sin(elapsed * 5.1) * 0.08 + Math.sin(elapsed * 9.3) * 0.04;
  const opacity = Math.max(0, fade * pulse);

  for (const mat of [solarPromCoreMat, solarPromGlowMat, solarPromStrandMat, solarPromStrandB.material]) {
    mat.uniforms.uTime.value = elapsed;
    mat.uniforms.uOpacity.value = opacity * mat.userData.opacityScale;
  }
  solarFootA.material.opacity = opacity * 0.62;
  solarFootB.material.opacity = opacity * 0.48;
  solarApexGlow.material.opacity = opacity * 0.22;
  const breathing = 1 + Math.sin(elapsed * 3.6) * 0.05;
  solarFootA.scale.copy(solarFootScale).multiplyScalar(breathing);
  solarFootB.scale.copy(solarFootScale).multiplyScalar(0.92 + (breathing - 1) * 0.8);
  solarApexGlow.scale.setScalar(solarApexGlowBaseScale * (0.96 + breathing * 0.04));

  if (p >= 1) {
    solarProminenceActive = false;
    solarProminenceGroup.visible = false;
    solarPromCoreMat.uniforms.uOpacity.value = 0;
    solarPromGlowMat.uniforms.uOpacity.value = 0;
    solarPromStrandMat.uniforms.uOpacity.value = 0;
    solarPromStrandB.material.uniforms.uOpacity.value = 0;
    solarFootA.material.opacity = 0;
    solarFootB.material.opacity = 0;
    solarApexGlow.material.opacity = 0;
    scheduleNextSolarProminence();
  }
}

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
const BLACK_HOLE_SOUND_START_R = BLACK_HOLE_PULL_R * 3.3;
const BLACK_HOLE_SOUND_FULL_R = BLACK_HOLE_PULL_R * 0.9;
const BLACK_HOLE_SOUND_MAX_GAIN = 0.18;
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

const BLACK_HOLE_DISK_FRAG = `
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
  float a=atan(vLocalPos.y,vLocalPos.x);
  float edge=smoothstep(0.0,0.08,t)*(1.0-smoothstep(0.88,1.0,t));
  float inner=1.0-smoothstep(0.02,0.42,t);
  float bands=0.55+0.45*sin(t*74.0+a*5.0-uTime*1.4);
  bands*=0.72+0.28*sin(t*151.0-a*2.3+uTime*0.8);
  float dust=fbm(vec2(a*5.8+uTime*0.035,t*32.0-uTime*0.12));
  float lane=fbm(vec2(a*2.4-uTime*0.02,t*11.0+3.7));
  bands*=0.72+0.34*dust;
  float doppler=0.72+0.28*smoothstep(-0.35,0.88,sin(a-0.42));
  float hotLane=exp(-pow((t-0.105)/0.065,2.0));
  float alpha=edge*(0.18+0.58*bands+0.2*dust)*(0.58+inner*1.65+hotLane*1.35)*doppler*(0.76+0.28*lane);
  vec3 hot=vec3(1.0,0.92,0.76);
  vec3 amber=vec3(1.0,0.46,0.12);
  vec3 ember=vec3(0.65,0.12,0.035);
  vec3 col=mix(amber,hot,inner*0.98+hotLane*0.82+smoothstep(0.62,1.0,bands)*0.35);
  col=mix(col,ember,smoothstep(0.52,1.0,t)*0.55);
  col*=0.95+inner*2.15+hotLane*2.7+dust*0.24;
  if(alpha<0.004) discard;
  gl_FragColor=vec4(col,alpha);
}`;

const BLACK_HOLE_LENS_FRAG = `
uniform float uTime;
varying vec2 vUv;
float ring(float r,float target,float width){
  return exp(-pow((r-target)/width,2.0));
}
void main(){
  vec2 p=(vUv-0.5)*2.0;
  float r=length(p);
  float angle=atan(p.y,p.x);
  float horizon=1.0-smoothstep(0.28,0.34,r);
  float photon=ring(r,0.42,0.022)*(0.88+0.12*sin(angle*9.0+uTime*0.45));
  float outer=ring(r,0.66,0.018)*(0.58+0.42*smoothstep(-0.25,0.85,p.x));
  float upper=ring(length(vec2((p.x+0.12)*0.72,(p.y-0.3)*1.7)),0.62,0.054)*smoothstep(-0.04,0.44,p.y);
  float lower=ring(length(vec2((p.x-0.05)*0.78,(p.y+0.32)*1.58)),0.62,0.07)*(1.0-smoothstep(-0.5,0.12,p.y));
  float lens=photon*1.45+outer*1.1+upper*1.02+lower*0.72;
  vec3 white=vec3(1.0,0.94,0.82);
  vec3 orange=vec3(1.0,0.46,0.12);
  vec3 col=mix(orange,white,photon*0.96+outer*0.82+upper*0.45);
  float alpha=clamp(lens,0.0,1.0)*(1.0-horizon)*0.96;
  if(alpha<0.004) discard;
  gl_FragColor=vec4(col,alpha);
}`;

const blackHoleDiskMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uInner: { value: BLACK_HOLE_DISK_INNER },
    uOuter: { value: BLACK_HOLE_DISK_OUTER },
  },
  vertexShader: BLACK_HOLE_DISK_VERT,
  fragmentShader: BLACK_HOLE_DISK_FRAG,
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
blackHoleDisk.rotation.set(THREE.MathUtils.degToRad(72), THREE.MathUtils.degToRad(-24), THREE.MathUtils.degToRad(-10));
blackHoleDisk.renderOrder = 5;
blackHoleGroup.add(blackHoleDisk);

const blackHoleLensMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
varying vec2 vUv;
void main(){
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`,
  fragmentShader: BLACK_HOLE_LENS_FRAG,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const blackHoleLens = new THREE.Mesh(
  new THREE.PlaneGeometry(BLACK_HOLE_DISK_OUTER * 1.35, BLACK_HOLE_DISK_OUTER * 1.0),
  blackHoleLensMaterial
);
blackHoleLens.renderOrder = 7;
blackHoleGroup.add(blackHoleLens);

const blackHoleCore = new THREE.Mesh(
  new THREE.SphereGeometry(BLACK_HOLE_HORIZON_R * 0.98, 64, 32),
  new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
);
blackHoleCore.renderOrder = 8;
blackHoleGroup.add(blackHoleCore);

const blackHoleParticlePositions = [];
const blackHoleParticleColors = [];
const blackHoleParticleRand = seededRandom(992313);
for (let i = 0; i < 420; i += 1) {
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
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
);
blackHoleParticles.rotation.copy(blackHoleDisk.rotation);
blackHoleGroup.add(blackHoleParticles);

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
let blackHoleFallActive = false;
let blackHoleFallT = 0;
let blackHoleCooldown = 0;
let blackHoleStatusArmed = true;

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

function updateBlackHole(dt, timeSeconds) {
  blackHoleDiskMaterial.uniforms.uTime.value = timeSeconds;
  blackHoleLensMaterial.uniforms.uTime.value = timeSeconds;
  blackHoleParticles.rotation.z += dt * 0.16;

  getViewerPose(viewerWorld);
  blackHoleTmp.copy(viewerWorld).sub(BLACK_HOLE_POSITION);
  const distance = blackHoleTmp.length();
  blackHoleLens.lookAt(viewerWorld);
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
  blackHoleTunnel.rotation.z += timeSeconds * (1.8 + p * 5.6);
  blackHoleTunnel.scale.setScalar(0.88 + p * 0.7);
  blackHoleLookDir.copy(BLACK_HOLE_POSITION).sub(viewerWorld);
  const facingBlackHole = blackHoleLookDir.lengthSq() > 1e-6 ? viewerForward.dot(blackHoleLookDir.normalize()) : 1;
  const forwardFade = smoothFade01((facingBlackHole + 0.08) / 0.48);
  blackHoleTunnelLines.material.opacity = THREE.MathUtils.lerp(0.18, 0.9, smoothFade01(Math.min(1, p * 1.4))) * forwardFade;
  blackHoleVeil.material.opacity = smoothFade01((p - 0.62) / 0.32) * 0.96 * forwardFade;

  if (renderer.xr.isPresenting && xrBaseRefSpace) {
    blackHoleTmp.copy(BLACK_HOLE_POSITION).sub(viewerWorld);
    const pullDistance = blackHoleTmp.length();
    if (pullDistance > 0.02) {
      blackHoleTmp.normalize();
      locomotion.addScaledVector(blackHoleTmp, dt * THREE.MathUtils.lerp(1.1, 5.0, p));
      applyXrLocomotionOffset();
    }
  }

  if (p >= 1) finishBlackHoleFall();
}

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
  updatePlanetMoonSystems(dt);
  updatePlanetLighting();
  updateBlackHole(dt, elapsed);

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
  updateSolarSpots(dt);
  updateKlingon(dt);
  updateEnterprise(dt);
  updateLightning(dt);
  updatePoseDebugButton();

  applyDebugTopCamera();
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
