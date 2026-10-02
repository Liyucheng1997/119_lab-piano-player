// 维也纳金色大厅(Großer Musikvereinssaal)程序化建模:
// 鞋盒形大厅 · 舞台与合唱阶梯 · 金色管风琴 · 两侧楼座与栏杆 · 女像柱 · 拱窗 · 天顶油画藻井 · 水晶吊灯 · 红丝绒座椅。
// 世界坐标:观众朝 -z 看向舞台,舞台台面 y = 1.1,大厅宽 19.2 m、长 48 m、高 17.5 m。

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  toTexture, parquetTexture, ornamentWall, goldFrieze, ceilingPainting, velvetTexture, glowSprite, rng,
} from "./textures.js";

export const HALL = {
  halfW: 9.6,
  zStageBack: -12,
  zStageFront: -1.6,
  zBack: 36,
  height: 17.5,
  stageY: 1.1,
  balconyY: 5.2,
  corniceY: 12,
};

function plane(w, h, mat) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

// 拱形(矩形 + 半圆顶)
function archShape(w, h) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  return s;
}

function archFrame(w, h, t) {
  const outer = archShape(w + t * 2, h + t);
  const inner = new THREE.Path();
  const r = w / 2;
  inner.moveTo(-r, 0);
  inner.lineTo(-r, h - r);
  inner.absarc(0, h - r, r, Math.PI, 0, true);
  inner.lineTo(r, 0);
  inner.lineTo(-r, 0);
  outer.holes.push(inner);
  return outer;
}

// 女像柱:车削身体 + 头 + 上举的双臂 + 头顶花篮柱头
function caryatidGeometry() {
  const prof = [
    [0.0, 0], [0.36, 0], [0.38, 0.08], [0.33, 0.3], [0.28, 0.9], [0.25, 1.5], [0.29, 1.95],
    [0.22, 2.35], [0.27, 2.7], [0.25, 2.95], [0.31, 3.1], [0.13, 3.2], [0.1, 3.32], [0, 3.33],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const parts = [];
  const body = new THREE.LatheGeometry(prof, 18);
  parts.push(body);
  const head = new THREE.SphereGeometry(0.16, 14, 10);
  head.translate(0, 3.48, 0.02);
  parts.push(head);
  [-1, 1].forEach((s) => {
    const a = new THREE.Vector3(s * 0.28, 3.06, 0.02);
    const b = new THREE.Vector3(s * 0.2, 3.76, 0.0);
    const dir = new THREE.Vector3().subVectors(b, a);
    const arm = new THREE.CylinderGeometry(0.055, 0.07, dir.length(), 8);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    arm.applyQuaternion(q);
    arm.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(arm);
    // 衣褶垂饰
    const drape = new THREE.CylinderGeometry(0.05, 0.12, 1.2, 8);
    drape.translate(s * 0.24, 1.2, 0.12);
    parts.push(drape);
  });
  const basket = new THREE.CylinderGeometry(0.27, 0.2, 0.26, 16);
  basket.translate(0, 3.74, 0);
  parts.push(basket);
  const abacus = new THREE.BoxGeometry(0.66, 0.12, 0.5);
  abacus.translate(0, 3.93, 0);
  parts.push(abacus);
  const pedestal = new THREE.BoxGeometry(0.72, 0.9, 0.6);
  pedestal.translate(0, -0.45, 0);
  parts.push(pedestal);
  const pedCap = new THREE.BoxGeometry(0.82, 0.1, 0.68);
  pedCap.translate(0, -0.02, 0);
  parts.push(pedCap);
  return mergeGeometries(parts.map((g) => (g.index ? g : g)), false);
}

function balusterGeometry() {
  const prof = [
    [0, 0], [0.045, 0], [0.045, 0.06], [0.03, 0.1], [0.055, 0.32], [0.03, 0.55], [0.022, 0.62],
    [0.04, 0.66], [0.04, 0.72], [0, 0.72],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(prof, 10);
}

function chairGeometry() {
  const seat = new RoundedBoxGeometry(0.5, 0.1, 0.46, 2, 0.04);
  seat.translate(0, 0.46, 0);
  const back = new RoundedBoxGeometry(0.5, 0.5, 0.08, 2, 0.04);
  back.rotateX(-0.12);
  back.translate(0, 0.78, 0.22);
  return mergeGeometries([seat, back]);
}

function chairFrameGeometry() {
  const parts = [];
  [[-0.22, -0.18], [0.22, -0.18], [-0.22, 0.2], [0.22, 0.2]].forEach(([x, z]) => {
    const leg = new THREE.CylinderGeometry(0.018, 0.015, 0.44, 6);
    leg.translate(x, 0.22, z);
    parts.push(leg);
  });
  [-0.26, 0.26].forEach((x) => {
    const arm = new THREE.BoxGeometry(0.04, 0.04, 0.42);
    arm.translate(x, 0.66, 0.0);
    parts.push(arm);
    const post = new THREE.BoxGeometry(0.035, 0.22, 0.035);
    post.translate(x, 0.56, -0.16);
    parts.push(post);
  });
  const topRail = new THREE.BoxGeometry(0.54, 0.05, 0.05);
  topRail.rotateX(-0.12);
  topRail.translate(0, 1.04, 0.255);
  parts.push(topRail);
  return mergeGeometries(parts);
}

export function createHall({ renderer }) {
  const root = new THREE.Group();
  root.name = "GoldenHall";
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const H = HALL;
  const hallLen = H.zBack - H.zStageBack;
  const zMid = (H.zBack + H.zStageBack) / 2;

  // ---------- 材质 ----------
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a944, metalness: 1.0, roughness: 0.32 });
  const goldDeep = new THREE.MeshStandardMaterial({ color: 0xb8832e, metalness: 1.0, roughness: 0.42 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xe4cf9e, roughness: 0.75 });
  const recess = new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.9 });
  const nightGlass = new THREE.MeshStandardMaterial({
    color: 0x101a33, roughness: 0.15, metalness: 0.2, emissive: 0x1b2a55, emissiveIntensity: 0.6,
  });

  const wall = ornamentWall();
  const wallMap = toTexture(wall.map, { anisotropy: aniso });
  const wallMR = toTexture(wall.mr, { srgb: false, anisotropy: aniso });
  const wallMat = (rx, ry) => {
    const m = new THREE.MeshStandardMaterial({
      map: wallMap.clone(), metalnessMap: wallMR.clone(), roughnessMap: wallMR.clone(), metalness: 1, roughness: 1,
    });
    [m.map, m.metalnessMap, m.roughnessMap].forEach((t) => {
      t.repeat.set(rx, ry);
      t.needsUpdate = true;
    });
    return m;
  };
  const friezeTex = toTexture(goldFrieze(), { anisotropy: aniso });
  const friezeMat = (rx) => {
    const t = friezeTex.clone();
    t.repeat.set(rx, 1);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, metalness: 0.9, roughness: 0.35 });
  };

  // ---------- 地面 ----------
  const floorTex = toTexture(parquetTexture(), { repeat: [22, 46], anisotropy: aniso });
  const floor = plane(H.halfW * 2, H.zBack - H.zStageFront, new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (H.zBack + H.zStageFront) / 2);
  floor.receiveShadow = true;
  root.add(floor);

  // ---------- 舞台 ----------
  const stageDepth = H.zStageFront - H.zStageBack;
  const stageTex = toTexture(parquetTexture({ dark: true }), { repeat: [26, 14], anisotropy: aniso });
  const stageMat = new THREE.MeshStandardMaterial({ map: stageTex, roughness: 0.32, metalness: 0.0 });
  const walnut = new THREE.MeshStandardMaterial({ color: 0x3b2414, roughness: 0.45, metalness: 0.0 });
  const stage = new THREE.Mesh(new THREE.BoxGeometry(H.halfW * 2, H.stageY, stageDepth), [
    walnut, walnut, stageMat, walnut, walnut, walnut,
  ]);
  stage.position.set(0, H.stageY / 2, (H.zStageFront + H.zStageBack) / 2);
  stage.receiveShadow = true;
  root.add(stage);
  // 台口金边
  const lip = new THREE.Mesh(new THREE.BoxGeometry(H.halfW * 2, 0.08, 0.1), gold);
  lip.position.set(0, H.stageY - 0.04, H.zStageFront + 0.04);
  root.add(lip);

  // 合唱阶梯(舞台后部逐级升高)
  for (let i = 0; i < 4; i++) {
    const z0 = H.zStageBack + i * 1.15;
    const step = new THREE.Mesh(new THREE.BoxGeometry(H.halfW * 2, 0.36 * (4 - i), 1.15), [cream, cream, stageMat, cream, goldDeep, cream]);
    step.position.set(0, H.stageY + (0.36 * (4 - i)) / 2, z0 + 0.575);
    step.receiveShadow = true;
    root.add(step);
  }

  // ---------- 侧墙 ----------
  [-1, 1].forEach((side) => {
    const x = side * H.halfW;
    // 下层墙面
    const lower = plane(hallLen, H.balconyY, wallMat(hallLen / 2.6, 1));
    lower.rotation.y = -side * Math.PI / 2;
    lower.position.set(x, H.balconyY / 2, zMid);
    root.add(lower);
    // 上层墙面
    const upperH = H.corniceY - H.balconyY;
    const upper = plane(hallLen, upperH, wallMat(hallLen / 3, upperH / 5.2));
    upper.rotation.y = -side * Math.PI / 2;
    upper.position.set(x, H.balconyY + upperH / 2, zMid);
    root.add(upper);
    // 高窗层
    const clereH = H.height - H.corniceY;
    const clere = plane(hallLen, clereH, cream);
    clere.rotation.y = -side * Math.PI / 2;
    clere.position.set(x, H.corniceY + clereH / 2, zMid);
    root.add(clere);
  });

  // 前后墙
  {
    const back = plane(H.halfW * 2, H.height, wallMat(7, 3.3));
    back.rotation.y = Math.PI;
    back.position.set(0, H.height / 2, H.zBack);
    root.add(back);
    const front = plane(H.halfW * 2, H.height, wallMat(7, 3.3));
    front.position.set(0, H.height / 2, H.zStageBack);
    root.add(front);
  }

  // ---------- 拱门与拱窗(下层包厢门、上层壁龛、高窗) ----------
  const archDoorGeo = new THREE.ShapeGeometry(archShape(1.5, 3.2), 12);
  const archFrameGeo = new THREE.ExtrudeGeometry(archFrame(1.5, 3.2, 0.14), { depth: 0.1, bevelEnabled: false, curveSegments: 12 });
  const nicheGeo = new THREE.ShapeGeometry(archShape(1.4, 3.6), 12);
  const nicheFrameGeo = new THREE.ExtrudeGeometry(archFrame(1.4, 3.6, 0.12), { depth: 0.1, bevelEnabled: false, curveSegments: 12 });
  const windowGeo = new THREE.ShapeGeometry(archShape(1.6, 3.0), 12);
  const windowFrameGeo = new THREE.ExtrudeGeometry(archFrame(1.6, 3.0, 0.14), { depth: 0.12, bevelEnabled: false, curveSegments: 12 });
  const mullionGeo = new THREE.BoxGeometry(0.05, 3.0, 0.05);
  const addArch = (geo, frameGeo, mat, x, y, z, rotY) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    m.position.z = 0.01;
    g.add(m);
    const f = new THREE.Mesh(frameGeo, gold);
    g.add(f);
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    root.add(g);
    return g;
  };
  for (let z = -10.6; z < H.zBack - 1; z += 3.2) {
    [-1, 1].forEach((side) => {
      const x = side * (H.halfW - 0.02);
      const rotY = -side * Math.PI / 2;
      if (z + 1.6 > H.zStageFront + 1) addArch(archDoorGeo, archFrameGeo, recess, x, 0.0, z + 1.6, rotY);
      addArch(nicheGeo, nicheFrameGeo, recess, x, H.balconyY + 1.4, z + 1.6, rotY);
      const w = addArch(windowGeo, windowFrameGeo, nightGlass, x, H.corniceY + 1.2, z + 1.6, rotY);
      const mull = new THREE.Mesh(mullionGeo, gold);
      mull.position.set(0, 1.5, 0.06);
      w.add(mull);
    });
  }

  // ---------- 楼座(两侧 + 后部)----------
  const balconyDepth = 2.1;
  const balconySlabMat = new THREE.MeshStandardMaterial({ color: 0xcfae6a, roughness: 0.6, metalness: 0.3 });
  const railY = H.balconyY + 0.5 + 0.76;
  const balusterGeo = balusterGeometry();
  const balusterPositions = [];
  [-1, 1].forEach((side) => {
    const len = H.zBack - H.zStageBack - balconyDepth;
    const zc = H.zStageBack + len / 2;
    const x = side * (H.halfW - balconyDepth / 2);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(balconyDepth, 0.5, len), balconySlabMat);
    slab.position.set(x, H.balconyY + 0.25, zc);
    root.add(slab);
    const fascia = plane(len, 0.5, friezeMat(len / 3));
    fascia.rotation.y = -side * Math.PI / 2;
    fascia.position.set(side * (H.halfW - balconyDepth) - side * 0.005, H.balconyY + 0.25, zc);
    root.add(fascia);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, len), gold);
    rail.position.set(side * (H.halfW - balconyDepth + 0.08), railY, zc);
    root.add(rail);
    for (let z = H.zStageBack + 0.1; z < H.zStageBack + len; z += 0.22) {
      balusterPositions.push([side * (H.halfW - balconyDepth + 0.08), H.balconyY + 0.5, z]);
    }
  });
  {
    const zc = H.zBack - balconyDepth / 2;
    const w = (H.halfW - balconyDepth) * 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(H.halfW * 2, 0.5, balconyDepth), balconySlabMat);
    slab.position.set(0, H.balconyY + 0.25, zc);
    root.add(slab);
    const fascia = plane(w, 0.5, friezeMat(w / 3));
    fascia.position.set(0, H.balconyY + 0.25, H.zBack - balconyDepth - 0.005);
    fascia.rotation.y = Math.PI;
    root.add(fascia);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.14), gold);
    rail.position.set(0, railY, H.zBack - balconyDepth + 0.08);
    root.add(rail);
    for (let x = -w / 2 + 0.1; x < w / 2; x += 0.22) balusterPositions.push([x, H.balconyY + 0.5, H.zBack - balconyDepth + 0.08]);
  }
  {
    const im = new THREE.InstancedMesh(balusterGeo, gold, balusterPositions.length);
    const m = new THREE.Matrix4();
    balusterPositions.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y, z);
      im.setMatrixAt(i, m);
    });
    root.add(im);
  }

  // ---------- 女像柱(上层,两侧各一排) ----------
  {
    const geo = caryatidGeometry();
    const positions = [];
    for (let z = -10.6; z < H.zBack - 1; z += 3.2) {
      [-1, 1].forEach((side) => positions.push([side * (H.halfW - 0.45), H.balconyY + 0.5 + 0.9 * 1.25, z, side]));
    }
    const im = new THREE.InstancedMesh(geo, gold, positions.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1.25, 1.25, 1.25);
    positions.forEach(([x, y, z, side], i) => {
      q.setFromEuler(new THREE.Euler(0, -side * Math.PI / 2, 0));
      m.compose(new THREE.Vector3(x, y, z), q, s);
      im.setMatrixAt(i, m);
    });
    root.add(im);
    // 女像柱背后的壁柱
    const pil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, H.corniceY - H.balconyY - 0.5, 1.0), goldDeep, positions.length);
    positions.forEach(([x, , z, side], i) => {
      m.makeTranslation(side * (H.halfW - 0.12), (H.corniceY + H.balconyY + 0.5) / 2, z);
      pil.setMatrixAt(i, m);
    });
    root.add(pil);
  }

  // ---------- 檐口(金色饰带 + 挑檐) ----------
  [-1, 1].forEach((side) => {
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, hallLen), [gold, gold, gold, goldDeep, gold, gold]);
    cornice.position.set(side * (H.halfW - 0.45), H.corniceY + 0.45, zMid);
    root.add(cornice);
    const f = plane(hallLen, 0.6, friezeMat(hallLen / 3));
    f.rotation.y = -side * Math.PI / 2;
    f.position.set(side * (H.halfW - 0.905), H.corniceY + 0.45, zMid);
    root.add(f);
  });
  [H.zStageBack, H.zBack].forEach((z, i) => {
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(H.halfW * 2, 0.9, 0.9), gold);
    cornice.position.set(0, H.corniceY + 0.45, z + (i ? -0.45 : 0.45));
    root.add(cornice);
  });

  // ---------- 天顶:金色藻井 + 油画 ----------
  {
    const ceil = plane(H.halfW * 2, hallLen, goldDeep);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H.height, zMid);
    root.add(ceil);
    const cols = [-6.2, 0, 6.2];
    const colW = [5.0, 6.6, 5.0];
    let seed = 1;
    for (let z = H.zStageBack + 3.2; z < H.zBack - 2; z += 5.4) {
      cols.forEach((x, ci) => {
        const tex = toTexture(ceilingPainting(seed++), { anisotropy: aniso });
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        const p = plane(colW[ci], 4.6, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
        p.rotation.x = Math.PI / 2;
        p.position.set(x, H.height - 0.35, z + 2.3);
        root.add(p);
      });
    }
    // 藻井金梁
    const beamZ = new THREE.BoxGeometry(0.5, 0.6, hallLen);
    [-3.2, 3.2, -9.0, 9.0].forEach((x) => {
      const b = new THREE.Mesh(beamZ, gold);
      b.position.set(x, H.height - 0.3, zMid);
      root.add(b);
    });
    const beamX = new THREE.BoxGeometry(H.halfW * 2, 0.6, 0.5);
    for (let z = H.zStageBack + 3.0; z < H.zBack; z += 5.4) {
      const b = new THREE.Mesh(beamX, gold);
      b.position.set(0, H.height - 0.3, z);
      root.add(b);
    }
    // 天顶与墙的弧形过渡(凹圆线脚)
    [-1, 1].forEach((side) => {
      const coveMat = goldDeep.clone();
      coveMat.side = THREE.DoubleSide;
      const cove = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, hallLen, 16, 1, true, side > 0 ? 0 : -Math.PI / 2, Math.PI / 2), coveMat);
      cove.rotation.x = -Math.PI / 2;
      cove.position.set(side * (H.halfW - 1.0), H.height - 1.0, zMid);
      root.add(cove);
    });
  }

  // ---------- 管风琴(舞台后墙) ----------
  {
    const organ = new THREE.Group();
    organ.position.set(0, 0, H.zStageBack + 0.6);
    const caseMat = new THREE.MeshStandardMaterial({ color: 0xe8d4a2, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(11.5, 9.5, 1.0), caseMat);
    body.position.set(0, 4.0 + 4.75, -0.2);
    organ.add(body);
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0xe6e7ea, metalness: 1.0, roughness: 0.16 });
    const pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
    const mouthGeo = new THREE.BoxGeometry(1, 1, 1);
    const pipeList = [];
    // 五组管面:中央塔、两侧平面、两端圆塔
    const fields = [
      { cx: 0, w: 2.6, n: 11, hMax: 6.4, hMin: 4.4, base: 5.0, r: 0.1, shape: "arch" },
      { cx: -2.85, w: 2.4, n: 12, hMax: 3.4, hMin: 4.6, base: 5.4, r: 0.075, shape: "ramp" },
      { cx: 2.85, w: 2.4, n: 12, hMax: 4.6, hMin: 3.4, base: 5.4, r: 0.075, shape: "ramp" },
      { cx: -5.0, w: 1.4, n: 7, hMax: 6.0, hMin: 4.8, base: 4.8, r: 0.1, shape: "arch" },
      { cx: 5.0, w: 1.4, n: 7, hMax: 6.0, hMin: 4.8, base: 4.8, r: 0.1, shape: "arch" },
    ];
    fields.forEach((f) => {
      for (let i = 0; i < f.n; i++) {
        const t = f.n === 1 ? 0.5 : i / (f.n - 1);
        const x = f.cx - f.w / 2 + t * f.w;
        const h = f.shape === "arch" ? f.hMin + (f.hMax - f.hMin) * (1 - Math.abs(t - 0.5) * 2) : f.hMax + (f.hMin - f.hMax) * t;
        pipeList.push({ x, h, base: f.base, r: f.r * (0.7 + 0.3 * (h / 6.4)) });
      }
      // 每组管面的金色框架与雕花顶冠
      const frame = new THREE.Mesh(new THREE.BoxGeometry(f.w + 0.5, 0.35, 0.5), gold);
      frame.position.set(f.cx, f.base - 0.2, 0.55);
      organ.add(frame);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(f.w + 0.6, 0.45, 0.55), gold);
      crown.position.set(f.cx, f.base + Math.max(f.hMax, f.hMin) + 0.5, 0.5);
      organ.add(crown);
      const urn = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), gold);
      urn.position.set(f.cx, f.base + Math.max(f.hMax, f.hMin) + 0.95, 0.5);
      organ.add(urn);
    });
    const pipes = new THREE.InstancedMesh(pipeGeo, pipeMat, pipeList.length);
    const mouths = new THREE.InstancedMesh(mouthGeo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }), pipeList.length);
    const m = new THREE.Matrix4();
    pipeList.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, p.base + p.h / 2, 0.55), new THREE.Quaternion(), new THREE.Vector3(p.r, p.h, p.r));
      pipes.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, p.base + 0.35, 0.55 + p.r * 0.92), new THREE.Quaternion(), new THREE.Vector3(p.r * 1.1, 0.16, 0.02));
      mouths.setMatrixAt(i, m);
    });
    organ.add(pipes, mouths);
    // 风琴两侧的金色立柱
    [-6.2, 6.2].forEach((x) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 9.0, 20), gold);
      col.position.set(x, 4.0 + 4.5, 0.5);
      organ.add(col);
    });
    root.add(organ);
  }

  // ---------- 观众席座椅(红丝绒 + 金色木框) ----------
  {
    const velvet = toTexture(velvetTexture(), { repeat: [2, 2], anisotropy: aniso });
    const cushionMat = new THREE.MeshStandardMaterial({ map: velvet, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xc89a45, metalness: 0.8, roughness: 0.35 });
    const seatPos = [];
    for (let z = 1.6; z < H.zBack - 3.2; z += 0.95) {
      for (let x = 0.9; x < H.halfW - 1.2; x += 0.56) {
        seatPos.push([x, 0, z], [-x, 0, z]);
      }
    }
    // 楼座一排
    for (let z = H.zStageFront + 0.5; z < H.zBack - 2.5; z += 0.6) {
      [-1, 1].forEach((s) => seatPos.push([s * (H.halfW - 1.3), H.balconyY + 0.5, z, s]));
    }
    const cushions = new THREE.InstancedMesh(chairGeometry(), cushionMat, seatPos.length);
    const frames = new THREE.InstancedMesh(chairFrameGeometry(), frameMat, seatPos.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    seatPos.forEach(([x, y, z, side], i) => {
      q.setFromEuler(new THREE.Euler(0, side ? side * Math.PI / 2 : 0, 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      cushions.setMatrixAt(i, m);
      frames.setMatrixAt(i, m);
    });
    cushions.receiveShadow = true;
    root.add(cushions, frames);
  }

  // ---------- 水晶吊灯 ----------
  const chandelierGroup = new THREE.Group();
  const bulbPositions = [];
  const crystalPositions = [];
  const chandelierSpots = [];
  {
    const r = rng(17);
    for (let z = 1.5; z < H.zBack - 2; z += 7.0) {
      [-4.3, 4.3].forEach((x) => chandelierSpots.push([x, 11.2, z]));
    }
    chandelierSpots.push([0, 12.2, -6.5]);
    chandelierSpots.forEach(([x, y, z]) => {
      const c = new THREE.Group();
      c.position.set(x, y, z);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, H.height - y, 6), gold);
      chain.position.y = (H.height - y) / 2;
      c.add(chain);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.6, 12), gold);
      c.add(stem);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gold);
      bowl.position.y = -0.85;
      c.add(bowl);
      [[1.05, -0.55, 14], [0.7, 0.05, 10], [0.4, 0.55, 6]].forEach(([rad, yy, n]) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.035, 8, 48), gold);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = yy;
        c.add(ring);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          bulbPositions.push(new THREE.Vector3(x + Math.cos(a) * rad, y + yy + 0.16, z + Math.sin(a) * rad));
          // 每个灯臂下挂一串水晶
          for (let k = 0; k < 3; k++) {
            const aa = a + (k - 1) * (Math.PI / n) * 0.6;
            crystalPositions.push(new THREE.Vector3(x + Math.cos(aa) * rad * 0.98, y + yy - 0.12 - k * 0.07 - r() * 0.05, z + Math.sin(aa) * rad * 0.98));
          }
        }
      });
      // 中心水晶瀑布
      for (let i = 0; i < 24; i++) {
        const a = r() * Math.PI * 2, rr = 0.15 + r() * 0.5;
        crystalPositions.push(new THREE.Vector3(x + Math.cos(a) * rr, y - 0.9 - r() * 0.7, z + Math.sin(a) * rr));
      }
      chandelierGroup.add(c);
    });
    const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7.5, 5.4, 3.0) });
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8), bulbMat, bulbPositions.length);
    const crystals = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.045, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.05, emissive: 0xffd9a0, emissiveIntensity: 0.6 }),
      crystalPositions.length
    );
    const m = new THREE.Matrix4();
    bulbPositions.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      bulbs.setMatrixAt(i, m);
    });
    crystalPositions.forEach((p, i) => {
      m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i, 0)), new THREE.Vector3(1, 1.8, 1));
      crystals.setMatrixAt(i, m);
    });
    chandelierGroup.add(bulbs, crystals);
    // 光晕
    const glowTex = toTexture(glowSprite(), { srgb: true });
    chandelierSpots.forEach(([x, y, z]) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd8a0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(x, y - 0.2, z);
      sp.scale.set(4.2, 4.2, 1);
      chandelierGroup.add(sp);
    });
    root.add(chandelierGroup);
  }

  // ---------- 灯光 ----------
  const lights = {};
  lights.hemi = new THREE.HemisphereLight(0xffe0b0, 0x4a2a10, 0.28);
  root.add(lights.hemi);
  lights.chandeliers = [];
  [[-4.3, 10.6, 8.5], [4.3, 10.6, 8.5], [-4.3, 10.6, 22.5], [4.3, 10.6, 22.5], [0, 11.5, -6.5]].forEach(([x, y, z]) => {
    const l = new THREE.PointLight(0xffc982, z < 0 ? 12 : 40, 34, 1.6);
    l.position.set(x, y, z);
    root.add(l);
    lights.chandeliers.push(l);
  });
  // 舞台主光:从前上方打向钢琴,投射阴影
  lights.key = new THREE.SpotLight(0xfff0dc, 130, 40, 0.3, 0.55, 1.4);
  lights.key.position.set(2.5, 13.5, 6);
  lights.key.target.position.set(0, 1.6, -4.8);
  lights.key.castShadow = true;
  lights.key.shadow.mapSize.set(2048, 2048);
  lights.key.shadow.bias = -0.0002;
  lights.key.shadow.normalBias = 0.02;
  lights.key.shadow.camera.near = 4;
  lights.key.shadow.camera.far = 30;
  root.add(lights.key, lights.key.target);
  // 轮廓光:从舞台后上方勾出钢琴漆面的高光
  lights.rim = new THREE.SpotLight(0xffd6a0, 70, 30, 0.42, 0.7, 1.4);
  lights.rim.position.set(3.5, 8.5, -11);
  lights.rim.target.position.set(1.0, 2.0, -4.9);
  root.add(lights.rim, lights.rim.target);
  // 演奏者侧补光(照亮琴键与谱架)
  lights.fill = new THREE.SpotLight(0xfff4e6, 8, 18, 0.5, 0.8, 1.5);
  lights.fill.position.set(-5.5, 6.5, -2.5);
  lights.fill.target.position.set(-1.0, 1.9, -4.8);
  root.add(lights.fill, lights.fill.target);

  const base = {
    hemi: lights.hemi.intensity,
    chand: lights.chandeliers.map((l) => l.intensity),
    key: lights.key.intensity,
    rim: lights.rim.intensity,
    fill: lights.fill.intensity,
  };
  let houseLevel = 1, houseTarget = 1;

  // 演奏时观众席灯光渐暗、舞台光增强
  function setHouseLights(level) {
    houseTarget = level;
  }

  function update(dt, t) {
    if (houseLevel !== houseTarget) {
      houseLevel += (houseTarget - houseLevel) * Math.min(1, dt * 1.6);
      if (Math.abs(houseTarget - houseLevel) < 0.002) houseLevel = houseTarget;
      lights.hemi.intensity = base.hemi * (0.35 + 0.65 * houseLevel);
      lights.chandeliers.forEach((l, i) => (l.intensity = base.chand[i] * (0.3 + 0.7 * houseLevel)));
      lights.key.intensity = base.key * (1.35 - 0.35 * houseLevel);
      lights.rim.intensity = base.rim * (1.25 - 0.25 * houseLevel);
    }
  }

  return { root, lights, update, setHouseLights, chandelierGroup };
}
