import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
let ballRadius = 0.34; // refined once the model is measured
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
const hemi = new THREE.HemisphereLight(0xe8f7ff, 0x1b2330, 2.0);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(2, 3, 2);
scene.add(key);

const cyan = new THREE.PointLight(0x2fc7ff, 5, 6);
cyan.position.set(-1.5, 1.2, -0.8);
scene.add(cyan);

// ---------------------------------------------------------------------------
// Ball state. `ballOffset` is the displacement from roomCenter; the room is
// never rotated, so offsets/velocities are identical in world and room space.
// ---------------------------------------------------------------------------
const ballGroup = new THREE.Group(); // wraps the model, centered on its geometry
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
// Model
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();
let glassModel = null;

loader.load(
  "./assets/glass_demo.glb",
  (gltf) => {
    glassModel = gltf.scene;
    glassModel.name = "glass_demo";
    glassModel.scale.setScalar(0.82);

    glassModel.traverse((child) => {
      if (!child.isMesh) return;
      child.material = new THREE.MeshPhysicalMaterial({
        color: 0x8fdfff,
        roughness: 0.015,
        metalness: 0,
        transparent: true,
        opacity: 0.62,
        transmission: 0.58,
        thickness: 0.95,
        ior: 1.48,
        clearcoat: 1,
        clearcoatRoughness: 0.012,
        envMapIntensity: 3.0,
        side: THREE.DoubleSide,
      });
    });

    // Measure the model AFTER scaling, then re-center it on its geometric
    // center inside ballGroup. From now on ballGroup.position is the ball's
    // true center, so no per-frame offset correction is needed.
    glassModel.updateWorldMatrix(true, true);
    const modelBox = new THREE.Box3().setFromObject(glassModel);
    const center = modelBox.getCenter(new THREE.Vector3());
    const size = modelBox.getSize(new THREE.Vector3());
    glassModel.position.sub(center);
    ballRadius = Math.max(size.x, size.y, size.z) * 0.5;
    updateCollisionHalf();

    ballGroup.add(glassModel);
    ballGroup.position.copy(roomCenter);

    statusEl.textContent = "準備完了。コントローラーで球に触れると、その方向へ弾けます（PCはWASD/矢印/クリック）。";
    updateXrAvailability();
  },
  undefined,
  (error) => {
    console.error(error);
    statusEl.textContent = "glass_demo.glb を読み込めませんでした。";
  }
);

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
    statusEl.textContent = `${label} 起動中。手（コントローラー）を球に近づけて触れると弾けます。`;
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

// ---------------------------------------------------------------------------
// Launching the ball
// ---------------------------------------------------------------------------
// Kick the ball along a (world == room) direction at a given speed.
function kick(direction, speed) {
  if (!glassModel) return;
  if (direction.lengthSq() < 1e-8) return;
  cruiseSpeed = THREE.MathUtils.clamp(speed, MIN_KICK, MAX_KICK);
  ballVelocity.copy(direction).normalize().multiplyScalar(cruiseSpeed);
  ballActive = true;
}

// ---------------------------------------------------------------------------
// XR controllers: touch the ball to launch it; trigger launches along the
// pointing direction as a fallback for when the ball is out of reach.
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
    if (!glassModel) return;
    // Launch from the controller along its pointing (-Z) direction.
    tmpDir.set(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    kick(tmpDir, CRUISE_DEFAULT);
  });
  scene.add(controller);
}

const MARKER_RADIUS = 0.025;

function updateHandTouch(dt) {
  if (!glassModel) return;
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
      // Push the ball away from the hand (the natural "I bumped it" direction).
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
  if (!glassModel) return;
  camera.getWorldDirection(tmpDir);
  kick(tmpDir, CRUISE_DEFAULT);
});

function keyboardSteer() {
  if (!glassModel) return;
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

  if (glassModel) {
    if (ballActive) {
      if (stepBall(dt)) {
        playCollisionSound();
      }
      ballGroup.position.copy(roomCenter).add(ballOffset);
      ballGroup.rotation.x += ballVelocity.z * dt * 1.4;
      ballGroup.rotation.y += ballVelocity.x * dt * 1.4;
    } else {
      // Idle: gentle float + slow spin until the ball is touched.
      ballGroup.position.copy(roomCenter).add(ballOffset);
      ballGroup.position.y += Math.sin(timestamp * 0.0012) * 0.02;
      ballGroup.rotation.y = timestamp * 0.00035;
    }
  }

  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
