// 金色大厅 3D 舞台入口:渲染器 + 后期泛光 + 镜头机位 + 琴键拾取交互。
// 对外暴露两个全局对象:
//   window.HallPiano   —— 与 2D 版 Piano 接口一致(highlight / clearAll / flashLabel / setInteractive …),app.js 直接复用
//   window.ConcertHall —— 机位切换、灯光氛围、谱架纸张

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHall, HALL } from "./hall-scene.js";
import { createGrandPiano, isBlackMidi, LOW_MIDI, HIGH_MIDI } from "./grand-piano.js";
import { createScorePaper } from "./score-paper.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

function initConcertHall() {
  const wrap = document.getElementById("stage3d");
  if (!wrap) throw new Error("缺少 #stage3d 容器");
  const testCanvas = document.createElement("canvas");
  if (!(testCanvas.getContext("webgl2") || testCanvas.getContext("webgl"))) throw new Error("浏览器不支持 WebGL");

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);
  renderer.domElement.className = "stage3d-canvas";

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0805);
  scene.fog = new THREE.FogExp2(0x1c1006, 0.012);

  const world = new THREE.Group();
  scene.add(world);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);

  // ---------- 大厅 + 钢琴 + 谱纸 ----------
  const hall = createHall({ renderer });
  world.add(hall.root);

  const piano = createGrandPiano({ renderer });
  const PIANO_POS = new THREE.Vector3(-1.32, HALL.stageY, -4.9);
  piano.group.position.copy(PIANO_POS);
  piano.group.rotation.y = -Math.PI / 2 + 0.1; // 侧对观众,大盖开口朝向观众席
  world.add(piano.group);

  const paper = createScorePaper({ renderer, width: 0.62 });
  paper.group.position.set(0, 0.022 + paper.size.h / 2, 0.006);
  piano.desk.add(paper.group);

  // 地面上的柔和接触阴影(让钢琴"落"在舞台上)
  {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.003, -1.35);
    piano.group.add(blob);
  }

  // 舞台光束(体积光的假象)
  {
    const from = hall.lights.key.position.clone();
    const to = new THREE.Vector3(PIANO_POS.x + 1.3, HALL.stageY, PIANO_POS.z);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(0.25, 3.4, len, 48, 1, true);
    geo.translate(0, -len / 2, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uStrength: { value: 0.07 }, uColor: { value: new THREE.Color(1.0, 0.86, 0.62) } },
      vertexShader: `
        varying float vH; varying vec3 vN; varying vec3 vView; varying float vDist;
        void main(){
          vH = uv.y;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vDist = -mv.z;
          vN = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uStrength; uniform vec3 uColor;
        varying float vH; varying vec3 vN; varying vec3 vView; varying float vDist;
        void main(){
          float near = smoothstep(2.0, 7.0, vDist); // 镜头钻进光束时淡出,避免糊成一团
          float edge = pow(abs(dot(vN, vView)), 1.6);
          float fade = smoothstep(0.0, 0.35, vH) * (0.35 + 0.65 * vH);
          gl_FragColor = vec4(uColor * uStrength * edge * fade * near, 1.0);
        }`,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.copy(from);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    world.add(beam);
    hall.beam = beam;
  }

  // ---------- 环境反射:先用中性房间照亮,再从钢琴上方拍一张大厅全景作为漆面反射 ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  let envRT = null;
  function rebuildEnvironment(intensity = 0.6) {
    const capture = new THREE.Vector3(0.2, 3.6, -3.2);
    piano.group.visible = false;
    hall.beam.visible = false;
    world.position.copy(capture).negate();
    world.updateMatrixWorld(true);
    const rt = pmrem.fromScene(scene, 0.015, 0.1, 120);
    world.position.set(0, 0, 0);
    world.updateMatrixWorld(true);
    piano.group.visible = true;
    hall.beam.visible = true;
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    scene.environmentIntensity = intensity;
  }
  rebuildEnvironment();

  // ---------- 后期 ----------
  const rtTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rtTarget);
  composer.addPass(new RenderPass(scene, camera));
  // 先把 HDR 亮度钳到上限:漆面镜面反射聚光灯的极小高光(可达几百倍)不再被泛光放大成一团光晕,
  // 只有吊灯灯泡这种大面积高亮会产生柔和光晕。
  const clampPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uMax: { value: 8.0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(c.rgb, vec3(uMax)), c.a); }",
  });
  composer.addPass(clampPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 2.4);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- 镜头 ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.35;
  controls.maxDistance = 38;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;

  const P = (x, y, z) => piano.group.localToWorld(new THREE.Vector3(x, y, z));
  piano.group.updateMatrixWorld(true);
  const presets = {
    audience: { label: "观众席", pos: new THREE.Vector3(3.3, 3.5, 6.8), target: new THREE.Vector3(-0.1, 1.75, -4.9) },
    stage: { label: "舞台近景", pos: new THREE.Vector3(3.1, 2.75, -0.9), target: new THREE.Vector3(-0.1, 1.5, -4.9) },
    pianist: { label: "演奏者视角", pos: P(0.0, 1.66, 0.95), target: P(0.0, 0.8, -0.36) },
    desk: { label: "谱架特写", pos: P(0.0, 1.36, 0.3), target: P(0.0, 1.2, -0.46) },
    keys: { label: "琴键特写", pos: P(0.62, 1.12, 0.42), target: P(-0.08, 0.66, -0.12) },
    inside: { label: "琴腹 · 制音器", pos: P(1.12, 1.58, -0.95), target: P(-0.12, 0.84, -0.38) },
    overview: { label: "楼座俯瞰", pos: new THREE.Vector3(-8.0, 8.6, 20), target: new THREE.Vector3(0, 2.4, -4.5) },
  };

  let tween = null;
  function flyTo(name, duration = 1.8) {
    const p = presets[name];
    if (!p) return;
    currentPreset = name;
    if (duration <= 0) {
      tween = null;
      camera.position.copy(p.pos);
      controls.target.copy(p.target);
      controls.update();
      return;
    }
    tween = {
      t: 0,
      duration,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: p.pos.clone(),
      toTarget: p.target.clone(),
    };
    currentPreset = name;
  }
  let currentPreset = "audience";
  // 开场:从大厅最后排缓缓推进到观众席
  camera.position.set(0, 7.5, 33);
  controls.target.set(0, 4.5, -4);
  flyTo("audience", 5.0);

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const bounds = { minX: -HALL.halfW + 0.6, maxX: HALL.halfW - 0.6, minY: 0.5, maxY: HALL.height - 0.8, minZ: HALL.zStageBack + 0.6, maxZ: HALL.zBack - 0.6 };

  // ---------- 尺寸 ----------
  function resize() {
    const w = wrap.clientWidth || 800;
    const h = wrap.clientHeight || 450;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 58 : 42;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  // ---------- 琴键交互:鼠标/触摸按下即发声,可拖动滑奏 ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let onDownCb = null, onUpCb = null;
  const activePointers = new Map(); // pointerId -> midi
  function keyAt(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(piano.keyMeshes, false)[0];
    return hit ? hit.object.userData.midi : null;
  }
  function userPress(midi) {
    piano.press(midi);
    flashLabel(midi);
    if (onDownCb) onDownCb(midi);
  }
  function userRelease(midi) {
    piano.release(midi);
    if (onUpCb) onUpCb(midi);
  }
  wrap.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target !== renderer.domElement) return;
      const midi = keyAt(e);
      if (midi == null) return;
      e.stopPropagation();
      e.preventDefault();
      renderer.domElement.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, midi);
      userPress(midi);
    },
    { capture: true }
  );
  wrap.addEventListener(
    "pointermove",
    (e) => {
      if (e.target !== renderer.domElement) return;
      if (activePointers.has(e.pointerId)) {
        e.stopPropagation();
        const midi = keyAt(e);
        const prev = activePointers.get(e.pointerId);
        if (midi != null && midi !== prev) {
          userRelease(prev);
          activePointers.set(e.pointerId, midi);
          userPress(midi);
        }
      } else if (e.pointerType === "mouse" && e.buttons === 0) {
        renderer.domElement.style.cursor = keyAt(e) != null ? "pointer" : "grab";
      }
    },
    { capture: true }
  );
  const endPointer = (e) => {
    if (!activePointers.has(e.pointerId)) return;
    userRelease(activePointers.get(e.pointerId));
    activePointers.delete(e.pointerId);
  };
  ["pointerup", "pointercancel"].forEach((t) => wrap.addEventListener(t, endPointer, { capture: true }));

  // ---------- 漂浮音名 ----------
  let showLabels = true;
  const labelLayer = document.createElement("div");
  labelLayer.className = "stage3d-labels";
  wrap.appendChild(labelLayer);
  const tmpV = new THREE.Vector3();
  function flashLabel(midi) {
    if (!showLabels) return;
    if (!piano.keyTopWorld(midi, tmpV)) return;
    tmpV.y += 0.03;
    tmpV.project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) return;
    const el = document.createElement("div");
    el.className = "key3d-flash" + (isBlackMidi(midi) ? " black" : "");
    el.textContent = noteName(midi);
    el.style.left = ((tmpV.x + 1) / 2) * wrap.clientWidth + "px";
    el.style.top = ((1 - tmpV.y) / 2) * wrap.clientHeight + "px";
    labelLayer.appendChild(el);
    requestAnimationFrame(() => el.classList.add("rise"));
    setTimeout(() => el.remove(), 900);
  }

  // ---------- 渲染循环 ----------
  const clock = new THREE.Clock();
  let autoOrbit = false;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.duration);
      const k = ease(tween.t);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      if (tween.t >= 1) tween = null;
    }
    controls.autoRotate = autoOrbit && !tween;
    controls.autoRotateSpeed = 0.35;
    controls.update();
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, bounds.minX, bounds.maxX);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, bounds.minY, bounds.maxY);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, bounds.minZ, bounds.maxZ);
    piano.update(dt);
    hall.update(dt, t);
    paper.update(dt);
    composer.render();
  });

  // 用户手动拖动时打断机位动画
  controls.addEventListener("start", () => {
    tween = null;
  });

  // ---------- 对外接口 ----------
  window.HallPiano = {
    is3D: true,
    build() {},
    ensureRange() {
      return { low: LOW_MIDI, high: HIGH_MIDI };
    },
    highlight(midi, on) {
      if (on) piano.press(midi);
      else piano.release(midi);
    },
    clearAll() {
      piano.releaseAll();
    },
    flashLabel,
    setShowLabels(v) {
      showLabels = !!v;
    },
    setInteractive(down, up) {
      onDownCb = down;
      onUpCb = up;
    },
    setSustain(on) {
      piano.setSustain(on);
    },
    setGlow(on) {
      piano.setGlow(on);
    },
    noteName,
    isBlack: isBlackMidi,
  };

  window.ConcertHall = {
    presets: Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.label])),
    flyTo,
    get preset() {
      return currentPreset;
    },
    setAutoOrbit(v) {
      autoOrbit = !!v;
    },
    setPerformance(on) {
      hall.setHouseLights(on ? 0 : 1);
    },
    setScore: (opts) => paper.setScore(opts),
    setCursor: (i, x) => paper.setCursor(i, x),
    renderer,
    scene,
    camera,
    rebuildEnvironment,
    bloom,
  };
  wrap.classList.add("ready");
}

try {
  initConcertHall();
} catch (e) {
  console.warn("3D 音乐厅初始化失败,回退到 2D 键盘:", e);
  document.body.classList.add("no-webgl");
}
