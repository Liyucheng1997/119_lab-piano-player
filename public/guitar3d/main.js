// 吉他页 3D 入口:金色大厅舞台上,一把古典吉他斜靠在琴架上,旁边是演奏椅、脚踏和谱架。
// 对外暴露:
//   window.HallGuitar  —— pluck / damp / setInteractive / setChord / flashNote …(guitar.js 调用)
//   window.ConcertHall —— 机位、灯光氛围、谱架封面

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createStage, HALL } from "../hall/stage.js";
import { createScorePaper } from "../hall/score-paper.js";
import { createClassicalGuitar } from "./classical-guitar.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

function tube(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

function initGuitarHall() {
  const RIG_POS = new THREE.Vector3(0, HALL.stageY, -3.4);
  const stage = createStage({
    wrap: document.getElementById("stage3d"),
    beamTarget: new THREE.Vector3(RIG_POS.x, HALL.stageY, RIG_POS.z),
    beamRadius: 2.2,
  });
  const { renderer, world } = stage;

  // ---------- 琴架 + 吉他 ----------
  const rig = new THREE.Group();
  rig.position.copy(RIG_POS);
  rig.rotation.y = 0.28;
  world.add(rig);

  const guitar = createClassicalGuitar({ renderer });
  guitar.group.position.set(0, 0.13, 0.03);
  guitar.group.rotation.x = -0.28; // 向后斜靠
  rig.add(guitar.group);
  guitar.group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  const black = new THREE.MeshPhysicalMaterial({ color: 0x0c0a09, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd2a650, metalness: 1, roughness: 0.3 });
  const felt = new THREE.MeshStandardMaterial({ color: 0x5a1218, roughness: 0.9 });
  {
    // A 字琴架:两条前腿托住琴底,后腿撑起琴颈托
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    [-1, 1].forEach((s) => {
      rig.add(tube(V(s * 0.19, 0.012, 0.14), V(s * 0.12, 0.1, 0.03), 0.009, black));
      rig.add(tube(V(s * 0.12, 0.1, 0.03), V(s * 0.03, 0.87, -0.2), 0.008, black));
      const cradle = tube(V(s * 0.12, 0.1, 0.09), V(s * 0.12, 0.1, -0.075), 0.011, felt);
      rig.add(cradle);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 10), gold);
      foot.position.set(s * 0.19, 0.012, 0.14);
      rig.add(foot);
    });
    rig.add(tube(V(0, 0.012, -0.36), V(0, 0.87, -0.21), 0.009, black));
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 10), gold);
    back.position.set(0, 0.012, -0.36);
    rig.add(back);
    const yoke = tube(V(-0.045, 0.875, -0.205), V(0.045, 0.875, -0.205), 0.009, felt);
    rig.add(yoke);
    [-1, 1].forEach((s) => rig.add(tube(V(s * 0.045, 0.86, -0.2), V(s * 0.045, 0.92, -0.18), 0.006, gold)));
  }

  // ---------- 演奏椅、脚踏、谱架 ----------
  const walnut = new THREE.MeshPhysicalMaterial({ color: 0x3a2112, roughness: 0.35, clearcoat: 0.8 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0x7a1018, roughness: 0.85 });
  const props = new THREE.Group();
  props.position.set(0.95, HALL.stageY, -3.75);
  props.rotation.y = -0.25;
  world.add(props);
  {
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.07, 0.42, 4, 0.025), velvet);
    seat.position.y = 0.48;
    props.add(seat);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.05, 0.42, 3, 0.01), walnut);
    frame.position.y = 0.43;
    props.add(frame);
    [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.42, 12), walnut);
      leg.position.set(x, 0.21, z);
      props.add(leg);
    });
    const backrest = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.4, 0.035, 4, 0.015), velvet);
    backrest.position.set(0, 0.76, -0.2);
    backrest.rotation.x = -0.1;
    props.add(backrest);
    [-0.21, 0.21].forEach((x) => props.add(tube(new THREE.Vector3(x, 0.45, -0.19), new THREE.Vector3(x, 0.98, -0.24), 0.014, walnut)));
    // 脚踏(古典吉他手左脚踩高)
    const stool = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.03, 0.12, 3, 0.008), black);
    stool.position.set(-0.12, 0.14, 0.36);
    stool.rotation.x = 0.35;
    props.add(stool);
    props.add(tube(new THREE.Vector3(-0.22, 0.0, 0.38), new THREE.Vector3(-0.22, 0.13, 0.36), 0.006, gold));
    props.add(tube(new THREE.Vector3(-0.02, 0.0, 0.38), new THREE.Vector3(-0.02, 0.13, 0.36), 0.006, gold));
  }
  const standGroup = new THREE.Group();
  standGroup.position.set(0.9, HALL.stageY, -3.0);
  standGroup.rotation.y = Math.PI - 0.25; // 谱架面朝演奏椅
  world.add(standGroup);
  const paper = createScorePaper({ renderer, width: 0.5 });
  {
    standGroup.add(tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.05, 0), 0.011, black));
    [0, 2.09, 4.19].forEach((a) => standGroup.add(tube(new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(Math.cos(a) * 0.25, 0.005, Math.sin(a) * 0.25), 0.008, black)));
    const desk = new THREE.Group();
    desk.position.set(0, 1.05, 0);
    desk.rotation.x = -0.35;
    const board = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.36, 0.008, 3, 0.004), black);
    board.position.set(0, 0.17, -0.006);
    desk.add(board);
    const ledge = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.015, 0.035, 2, 0.004), gold);
    ledge.position.set(0, 0.0, 0.012);
    desk.add(ledge);
    paper.group.position.set(0, 0.012 + paper.size.h / 2, 0.004);
    desk.add(paper.group);
    standGroup.add(desk);
  }
  paper.setScore({ title: "Guitarra Clásica", subtitle: "金色大厅 · 古典吉他独奏会", coverLines: ["请从「琴谱柜」挑选一首曲目", "放上谱架后将自动演奏"] });

  stage.setEnvironmentCapture(new THREE.Vector3(0.3, 2.6, -2.2), [rig, props, standGroup]);
  stage.rebuildEnvironment();

  // ---------- 机位 ----------
  guitar.group.updateMatrixWorld(true);
  const G = (x, y, z) => guitar.group.localToWorld(new THREE.Vector3(x, y, z));
  stage.setPresets(
    {
      audience: { label: "观众席", pos: new THREE.Vector3(2.4, 2.75, 4.8), target: new THREE.Vector3(0.2, 1.6, -3.4) },
      stage: { label: "舞台近景", pos: new THREE.Vector3(1.9, 2.05, -0.9), target: new THREE.Vector3(0.25, 1.55, -3.4) },
      front: { label: "吉他全身", pos: G(0.06, 0.5, 1.7), target: G(0, 0.5, 0) },
      fretboard: { label: "指板特写", pos: G(0.05, 0.68, 0.34), target: G(0, 0.68, 0.0) },
      soundhole: { label: "音孔 · 琴弦", pos: G(0.1, 0.22, 0.3), target: G(0, 0.28, 0) },
      headstock: { label: "琴头", pos: G(0.14, 0.92, 0.3), target: G(0, 0.86, 0) },
      overview: { label: "楼座俯瞰", pos: new THREE.Vector3(-8.0, 8.6, 20), target: new THREE.Vector3(0, 2.4, -4) },
    },
    "audience",
    { pos: new THREE.Vector3(0, 7.5, 33), target: new THREE.Vector3(0, 4.5, -4), duration: 5 }
  );

  // ---------- 交互:点弦 / 拖动扫弦 ----------
  let onPluck = null;
  let chord = [0, 0, 0, 0, 0, 0]; // 琴身区域拨弦时用的左手和弦(null = 不弹该弦)
  const lastString = new Map();
  const tmp = new THREE.Vector3();
  function hitString(e) {
    const hit = stage.raycast(e, guitar.hitMeshes);
    if (!hit) return null;
    const local = guitar.group.worldToLocal(tmp.copy(hit.point));
    const s = hit.object.userData.string;
    let fret = guitar.fretAtLocalY(local.y);
    if (fret < 0) fret = chord[s];
    return fret == null ? null : { s, fret };
  }
  function trigger(h) {
    if (onPluck) onPluck(h.s, h.fret);
  }
  stage.setPointerHandler({
    down(e) {
      const h = hitString(e);
      if (!h) return false;
      lastString.set(e.pointerId, h.s);
      trigger(h);
      return true;
    },
    move(e) {
      const h = hitString(e);
      if (h && h.s !== lastString.get(e.pointerId)) {
        lastString.set(e.pointerId, h.s);
        trigger(h);
      }
    },
    up(e) {
      lastString.delete(e.pointerId);
    },
    hover: (e) => !!stage.raycast(e, guitar.hitMeshes),
  });

  stage.onUpdate((dt) => {
    guitar.update(dt);
    paper.update(dt);
  });
  stage.start();

  // ---------- 对外接口 ----------
  window.HallGuitar = {
    is3D: true,
    pluck: guitar.pluck,
    release: guitar.release,
    damp: guitar.damp,
    dampAll: guitar.dampAll,
    setGlow: guitar.setGlow,
    setShowLabels: stage.setShowLabels,
    setInteractive(fn) {
      onPluck = fn;
    },
    setChord(shape) {
      chord = shape.slice();
    },
    flashNote(s, fret, midi) {
      stage.flashLabelAt(guitar.notePosition(s, fret, tmp), noteName(midi), s >= 3 ? "black" : "");
    },
    setTitle(title, subtitle) {
      paper.setScore({ title, subtitle, coverLines: ["六线谱见下方纸页", "Guitarra · Goldener Saal"] });
    },
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
    renderer,
    scene: stage.scene,
    camera: stage.camera,
    bloom: stage.bloom,
  };
}

try {
  initGuitarHall();
} catch (e) {
  console.warn("3D 音乐厅初始化失败:", e);
  document.body.classList.add("no-webgl");
}
