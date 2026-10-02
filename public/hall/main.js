// 钢琴页 3D 入口:在金色大厅舞台(stage.js)上放一台音乐会三角钢琴 + 谱架纸张,并接管琴键拾取交互。
// 对外暴露两个全局对象:
//   window.HallPiano   —— 与 2D 版 Piano 接口一致(highlight / clearAll / flashLabel / setInteractive …),app.js 直接复用
//   window.ConcertHall —— 机位切换、灯光氛围、谱架纸张

import * as THREE from "three";
import { createStage, HALL } from "./stage.js";
import { createGrandPiano, isBlackMidi, LOW_MIDI, HIGH_MIDI } from "./grand-piano.js";
import { createScorePaper } from "./score-paper.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

function initConcertHall() {
  const PIANO_POS = new THREE.Vector3(-1.32, HALL.stageY, -4.9);
  const stage = createStage({
    wrap: document.getElementById("stage3d"),
    beamTarget: new THREE.Vector3(PIANO_POS.x + 1.3, HALL.stageY, PIANO_POS.z),
  });
  const { renderer, world } = stage;

  // ---------- 钢琴 + 谱纸 ----------
  const piano = createGrandPiano({ renderer });
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
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 3.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.003, -1.35);
    piano.group.add(blob);
  }

  stage.setEnvironmentCapture(new THREE.Vector3(0.2, 3.6, -3.2), [piano.group]);
  stage.rebuildEnvironment();

  // ---------- 机位 ----------
  piano.group.updateMatrixWorld(true);
  const P = (x, y, z) => piano.group.localToWorld(new THREE.Vector3(x, y, z));
  stage.setPresets(
    {
      audience: { label: "观众席", pos: new THREE.Vector3(3.3, 3.5, 6.8), target: new THREE.Vector3(-0.1, 1.75, -4.9) },
      stage: { label: "舞台近景", pos: new THREE.Vector3(3.1, 2.75, -0.9), target: new THREE.Vector3(-0.1, 1.5, -4.9) },
      pianist: { label: "演奏者视角", pos: P(0.0, 1.66, 0.95), target: P(0.0, 0.8, -0.36) },
      desk: { label: "谱架特写", pos: P(0.0, 1.36, 0.3), target: P(0.0, 1.2, -0.46) },
      keys: { label: "琴键特写", pos: P(0.62, 1.12, 0.42), target: P(-0.08, 0.66, -0.12) },
      inside: { label: "琴腹 · 制音器", pos: P(1.12, 1.58, -0.95), target: P(-0.12, 0.84, -0.38) },
      overview: { label: "楼座俯瞰", pos: new THREE.Vector3(-8.0, 8.6, 20), target: new THREE.Vector3(0, 2.4, -4.5) },
    },
    "audience",
    // 开场:从大厅最后排缓缓推进到观众席
    { pos: new THREE.Vector3(0, 7.5, 33), target: new THREE.Vector3(0, 4.5, -4), duration: 5 }
  );

  // ---------- 琴键交互:鼠标/触摸按下即发声,可拖动滑奏 ----------
  let onDownCb = null, onUpCb = null;
  const activePointers = new Map(); // pointerId -> midi
  const keyAt = (e) => {
    const hit = stage.raycast(e, piano.keyMeshes);
    return hit ? hit.object.userData.midi : null;
  };
  const tmpV = new THREE.Vector3();
  function flashLabel(midi) {
    if (!piano.keyTopWorld(midi, tmpV)) return;
    tmpV.y += 0.03;
    stage.flashLabelAt(tmpV, noteName(midi), isBlackMidi(midi) ? "black" : "");
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
  stage.setPointerHandler({
    down(e) {
      const midi = keyAt(e);
      if (midi == null) return false;
      activePointers.set(e.pointerId, midi);
      userPress(midi);
      return true;
    },
    move(e) {
      const midi = keyAt(e);
      const prev = activePointers.get(e.pointerId);
      if (midi != null && midi !== prev) {
        if (prev != null) userRelease(prev);
        activePointers.set(e.pointerId, midi);
        userPress(midi);
      }
    },
    up(e) {
      const prev = activePointers.get(e.pointerId);
      if (prev != null) userRelease(prev);
      activePointers.delete(e.pointerId);
    },
    hover: (e) => keyAt(e) != null,
  });

  stage.onUpdate((dt) => {
    piano.update(dt);
    paper.update(dt);
  });
  stage.start();

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
    setShowLabels: stage.setShowLabels,
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
    get presets() {
      return stage.presetLabels;
    },
    flyTo: stage.flyTo,
    get preset() {
      return stage.preset;
    },
    setAutoOrbit: stage.setAutoOrbit,
    setPerformance: stage.setPerformance,
    setScore: (opts) => paper.setScore(opts),
    setCursor: (i, x) => paper.setCursor(i, x),
    renderer,
    scene: stage.scene,
    camera: stage.camera,
    rebuildEnvironment: stage.rebuildEnvironment,
    bloom: stage.bloom,
  };
}

try {
  initConcertHall();
} catch (e) {
  console.warn("3D 音乐厅初始化失败,回退到 2D 键盘:", e);
  document.body.classList.add("no-webgl");
}
