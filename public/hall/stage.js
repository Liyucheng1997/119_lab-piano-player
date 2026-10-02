// 金色大厅通用舞台:渲染器、大厅、舞台光束、环境反射、后期泛光、机位动画、指针交互、漂浮音名。
// 钢琴页(hall/main.js)与吉他页(guitar3d/main.js)共用,各自只需要把乐器模型放上舞台。

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHall, HALL } from "./hall-scene.js";

export { HALL };

export function createStage({ wrap, beamTarget, beamRadius = 3.4 }) {
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
  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 200);

  const hall = createHall({ renderer });
  world.add(hall.root);

  // ---------- 舞台光束(体积光的假象) ----------
  if (beamTarget) {
    const from = hall.lights.key.position.clone();
    const dir = new THREE.Vector3().subVectors(beamTarget, from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(0.25, beamRadius, len, 48, 1, true);
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

  // ---------- 环境反射 ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  let envRT = null;
  let envCapture = new THREE.Vector3(0.2, 3.6, -3.2);
  let envHide = [];
  // 先用中性房间照亮,再从乐器上方拍一张大厅全景,作为漆面/金属的反射
  function rebuildEnvironment(intensity = 0.6) {
    const hidden = [...envHide, hall.beam].filter(Boolean);
    hidden.forEach((o) => (o.visible = false));
    world.position.copy(envCapture).negate();
    world.updateMatrixWorld(true);
    const rt = pmrem.fromScene(scene, 0.015, 0.1, 120);
    world.position.set(0, 0, 0);
    world.updateMatrixWorld(true);
    hidden.forEach((o) => (o.visible = true));
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    scene.environmentIntensity = intensity;
  }

  // ---------- 后期 ----------
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // 先把 HDR 亮度钳到上限:漆面镜面反射聚光灯的极小高光(可达几百倍)不再被泛光放大成一团光晕,
  // 只有吊灯灯泡这种大面积高亮会产生柔和光晕。
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uMax: { value: 8.0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(c.rgb, vec3(uMax)), c.a); }",
    })
  );
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 2.4);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- 镜头 ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.2;
  controls.maxDistance = 38;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;

  let presets = {};
  let currentPreset = null;
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
    tween = { t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: p.pos.clone(), toTarget: p.target.clone() };
  }
  controls.addEventListener("start", () => (tween = null)); // 用户手动拖动时打断机位动画
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

  // ---------- 指针交互(在 OrbitControls 之前拦截) ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function raycast(e, objects) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(objects, false)[0] || null;
  }
  let pointerHandler = null; // { down(e)→bool, move(e), up(e), hover(e)→bool }
  const captured = new Set();
  wrap.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target !== renderer.domElement || !pointerHandler) return;
      if (!pointerHandler.down(e)) return;
      e.stopPropagation();
      e.preventDefault();
      renderer.domElement.setPointerCapture(e.pointerId);
      captured.add(e.pointerId);
    },
    { capture: true }
  );
  wrap.addEventListener(
    "pointermove",
    (e) => {
      if (e.target !== renderer.domElement || !pointerHandler) return;
      if (captured.has(e.pointerId)) {
        e.stopPropagation();
        pointerHandler.move(e);
      } else if (e.pointerType === "mouse" && e.buttons === 0 && pointerHandler.hover) {
        renderer.domElement.style.cursor = pointerHandler.hover(e) ? "pointer" : "grab";
      }
    },
    { capture: true }
  );
  const endPointer = (e) => {
    if (!captured.has(e.pointerId)) return;
    captured.delete(e.pointerId);
    if (pointerHandler) pointerHandler.up(e);
  };
  ["pointerup", "pointercancel"].forEach((t) => wrap.addEventListener(t, endPointer, { capture: true }));

  // ---------- 漂浮音名 ----------
  let showLabels = true;
  const labelLayer = document.createElement("div");
  labelLayer.className = "stage3d-labels";
  wrap.appendChild(labelLayer);
  const tmpV = new THREE.Vector3();
  function flashLabelAt(worldPos, text, extraClass = "") {
    if (!showLabels) return;
    tmpV.copy(worldPos).project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) return;
    const el = document.createElement("div");
    el.className = "key3d-flash" + (extraClass ? " " + extraClass : "");
    el.textContent = text;
    el.style.left = ((tmpV.x + 1) / 2) * wrap.clientWidth + "px";
    el.style.top = ((1 - tmpV.y) / 2) * wrap.clientHeight + "px";
    labelLayer.appendChild(el);
    requestAnimationFrame(() => el.classList.add("rise"));
    setTimeout(() => el.remove(), 900);
  }

  // ---------- 渲染循环 ----------
  const updaters = [];
  const clock = new THREE.Clock();
  let autoOrbit = false;
  function start() {
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
      hall.update(dt, t);
      for (const fn of updaters) fn(dt, t);
      composer.render();
    });
    wrap.classList.add("ready");
  }

  return {
    THREE,
    renderer,
    scene,
    world,
    camera,
    controls,
    hall,
    bloom,
    raycast,
    flashLabelAt,
    flyTo,
    rebuildEnvironment,
    start,
    onUpdate(fn) {
      updaters.push(fn);
    },
    setPointerHandler(h) {
      pointerHandler = h;
    },
    setEnvironmentCapture(point, hide = []) {
      envCapture = point.clone();
      envHide = hide;
    },
    setPresets(map, initial, intro) {
      presets = map;
      currentPreset = initial;
      if (intro) {
        camera.position.copy(intro.pos);
        controls.target.copy(intro.target);
        flyTo(initial, intro.duration || 5);
      } else flyTo(initial, 0);
    },
    get presetLabels() {
      return Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.label]));
    },
    get preset() {
      return currentPreset;
    },
    setAutoOrbit(v) {
      autoOrbit = !!v;
    },
    setPerformance(on) {
      hall.setHouseLights(on ? 0 : 1);
    },
    setShowLabels(v) {
      showLabels = !!v;
    },
  };
}
