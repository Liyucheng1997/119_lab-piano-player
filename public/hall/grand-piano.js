// 音乐会三角钢琴(按 2.74 m 九尺音乐会大琴的真实尺寸程序化建模)。
// 局部坐标:x = 演奏者右手方向,y = 向上,z = 指向演奏者;琴键前沿在 z = 0,琴尾在 z ≈ -2.74。
// 88 个琴键各自独立建模(A0..C8 = MIDI 21..108),每个键都有自己的支点、下沉动画和制音器。

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { spruceTexture, nameboardTexture, toTexture } from "./textures.js";

export const LOW_MIDI = 21;
export const HIGH_MIDI = 108;
const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlackMidi = (m) => BLACK.has(((m % 12) + 12) % 12);

// ---- 关键尺寸(米) ----
const WHITE_W = 0.02355; // 白键宽(含缝)
const WHITE_COUNT = 52;
const KB_HALF = (WHITE_W * WHITE_COUNT) / 2; // 键盘半宽 ≈ 0.612
const CASE_HALF = 0.785; // 琴身半宽(总宽 1.57)
const CASE_LEN = 2.58; // 琴身(不含键盘)深度
const RIM_FRONT = 0.16; // 琴身前沿 z = -0.16
const RIM_T = 0.05; // 侧板厚
const Y_FLOOR_CASE = 0.64; // 琴身底面
const Y_RIM_TOP = 1.0; // 侧板顶面
const Y_KEY_TOP = 0.74; // 白键表面
const Y_SOUNDBOARD = 0.79;
const Y_PLATE = 0.85;
const Y_STRING = 0.888;
const KEY_PIVOT_Z = -0.5; // 琴键杠杆支点(藏在琴身里)
const KEY_DIP = 0.0105; // 白键前沿按下深度 ≈ 10 mm
const LID_ANGLE = 0.6; // 大盖撑开角度(约 34°)

// 形状坐标 (u, v):u = x,v = 从琴身前沿往后的深度。转到局部坐标。
const toLocal = (u, v, y = 0) => new THREE.Vector3(u, y, -(RIM_FRONT + v));

// 琴身外轮廓:平直的低音侧 + S 形弯曲的高音侧 + 圆润琴尾
function outlinePath() {
  const p = new THREE.Path();
  p.moveTo(CASE_HALF, 0);
  p.lineTo(CASE_HALF, 0.42);
  p.bezierCurveTo(CASE_HALF, 1.0, 0.31, 1.12, 0.16, 1.86);
  p.bezierCurveTo(0.02, 2.44, -0.34, CASE_LEN + 0.02, -0.6, CASE_LEN);
  p.quadraticCurveTo(-CASE_HALF, CASE_LEN - 0.02, -CASE_HALF, CASE_LEN - 0.24);
  p.lineTo(-CASE_HALF, 0);
  return p;
}

// 沿折线计算外法线(折线从右前角出发绕到左前角,内部在行进方向左侧)
function polyNormals(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return new THREE.Vector2(dy / len, -dx / len);
  });
}

function dedupe(pts) {
  const out = [];
  pts.forEach((p) => {
    if (!out.length || out[out.length - 1].distanceTo(p) > 1e-4) out.push(p);
  });
  return out;
}

// 用外/内两条折线拉出带厚度的侧板(外墙、内墙、顶面、底面、两端封口),法线手工给定以保证漆面反射平滑
function buildRimGeometry(outer, inner, normals) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  const pushStrip = (ptsA, yA, ptsB, yB, nFn, uScale) => {
    let dist = 0;
    for (let i = 0; i < ptsA.length; i++) {
      if (i > 0) dist += ptsA[i].distanceTo(ptsA[i - 1]);
      const a = toLocal(ptsA[i].x, ptsA[i].y, yA);
      const b = toLocal(ptsB[i].x, ptsB[i].y, yB);
      const n = nFn(i);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      nor.push(n.x, n.y, n.z, n.x, n.y, n.z);
      uv.push(dist * uScale, 0, dist * uScale, 1);
    }
    for (let i = 0; i < ptsA.length - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    base += ptsA.length * 2;
  };
  const out3 = (i) => new THREE.Vector3(normals[i].x, 0, -normals[i].y);
  const in3 = (i) => out3(i).negate();
  const up = () => new THREE.Vector3(0, 1, 0);
  const down = () => new THREE.Vector3(0, -1, 0);
  // 外墙:底 → 顶
  pushStrip(outer, Y_FLOOR_CASE, outer, Y_RIM_TOP, out3, 1);
  // 内墙:顶 → 底(反向绕序)
  pushStrip(inner, Y_RIM_TOP, inner, Y_SOUNDBOARD - 0.02, in3, 1);
  // 顶面:外 → 内
  pushStrip(outer, Y_RIM_TOP, inner, Y_RIM_TOP, up, 1);
  // 底面:内 → 外
  pushStrip(inner, Y_FLOOR_CASE, outer, Y_FLOOR_CASE, down, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function cylinderBetween(a, b, radius, material, radialSegments = 10) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, radialSegments);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

export function createGrandPiano({ renderer } = {}) {
  const group = new THREE.Group();
  group.name = "ConcertGrand";
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;

  // ---------- 材质 ----------
  const lacquer = new THREE.MeshPhysicalMaterial({
    color: 0x040404,
    roughness: 0.16,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 0.6,
  });
  const lacquerInner = lacquer.clone();
  lacquerInner.roughness = 0.2;
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1.0, roughness: 0.22 });
  const plateGold = new THREE.MeshPhysicalMaterial({
    color: 0xb88a3c, metalness: 0.75, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.25,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd7d9dc, metalness: 1.0, roughness: 0.3 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xc27a43, metalness: 1.0, roughness: 0.4 });
  const felt = new THREE.MeshStandardMaterial({ color: 0x1d1a1a, roughness: 0.95 });
  const feltRed = new THREE.MeshStandardMaterial({ color: 0x7a1420, roughness: 0.95 });
  const damperWood = new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 0.55 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.5, metalness: 0.0 });

  const spruceTex = toTexture(spruceTexture(), { repeat: [1.2, 1.2], anisotropy: maxAniso });
  const soundboardMat = new THREE.MeshStandardMaterial({ map: spruceTex, roughness: 0.55 });

  // ---------- 琴身轮廓 ----------
  const outerPts = dedupe(outlinePath().getSpacedPoints(260));
  const normals = polyNormals(outerPts);
  const innerPts = outerPts.map((p, i) => p.clone().addScaledVector(normals[i], -RIM_T));
  // 内轮廓的前端两点要回到 v=0,与前沿对齐
  innerPts[0].y = 0;
  innerPts[innerPts.length - 1].y = 0;

  const rim = new THREE.Mesh(buildRimGeometry(outerPts, innerPts, normals), lacquer);
  rim.castShadow = true;
  rim.receiveShadow = true;
  group.add(rim);
  // 侧板前端封口
  [-1, 1].forEach((side) => {
    const cap = new THREE.Mesh(new RoundedBoxGeometry(RIM_T + 0.004, Y_RIM_TOP - Y_FLOOR_CASE, 0.03, 3, 0.008), lacquer);
    cap.position.set(side * (CASE_HALF - RIM_T / 2), (Y_RIM_TOP + Y_FLOOR_CASE) / 2, -RIM_FRONT - 0.012);
    group.add(cap);
  });

  // 侧板顶部的一圈细金线(高级感细节)
  {
    const linePts = outerPts.map((p, i) => {
      const q = p.clone().addScaledVector(normals[i], 0.0015);
      return toLocal(q.x, q.y, Y_RIM_TOP - 0.035);
    });
    const curve = new THREE.CatmullRomCurve3(linePts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.0016, 6, false), brass);
    group.add(tube);
  }

  // 琴身底板
  {
    const shape = new THREE.Shape(outerPts);
    const g = new THREE.ShapeGeometry(shape, 1);
    g.rotateX(Math.PI / 2); // 法线朝下
    g.translate(0, Y_FLOOR_CASE, -RIM_FRONT);
    // rotateX(+90°) 把 (u, v) 映射到 (u, 0, v),需要把 v 翻到 -z
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -RIM_FRONT - (pos.getZ(i) + RIM_FRONT));
    const bottom = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.55, side: THREE.DoubleSide }));
    group.add(bottom);
  }

  // 云杉音板
  const innerClosed = innerPts.slice();
  {
    const shape = new THREE.Shape(innerClosed);
    const g = new THREE.ShapeGeometry(shape, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, Y_SOUNDBOARD, -RIM_FRONT);
    const board = new THREE.Mesh(g, soundboardMat);
    board.receiveShadow = true;
    group.add(board);
    // 音板肋木(从音板下面透出来的斜向梁,简化为音板上的细棱)
    // 琴码:弯曲的长木条,弦从这里经过
  }

  // ---------- 铸铁骨架(金色) ----------
  const plateInset = innerPts.map((p, i) => p.clone().addScaledVector(normals[i], -0.02));
  plateInset[0].y = 0.02;
  plateInset[plateInset.length - 1].y = 0.02;
  {
    const shape = new THREE.Shape(plateInset);
    const holes = [
      [-0.5, 0.78, 0.1, 0.22],
      [-0.2, 0.82, 0.1, 0.24],
      [0.13, 0.74, 0.1, 0.19],
      [-0.47, 1.52, 0.12, 0.3],
      [-0.15, 1.58, 0.085, 0.24],
      [-0.42, 2.12, 0.11, 0.17],
    ];
    holes.forEach(([cx, cy, rx, ry]) => {
      const h = new THREE.Path();
      h.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, true);
      shape.holes.push(h);
    });
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 40,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, Y_PLATE, -RIM_FRONT);
    const plate = new THREE.Mesh(g, plateGold);
    plate.castShadow = true;
    plate.receiveShadow = true;
    group.add(plate);

    // 骨架上的装饰圆螺栓
    const boltGeo = new THREE.SphereGeometry(0.009, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const boltPos = [[-0.62, 0.45], [-0.05, 0.42], [0.42, 0.45], [-0.62, 1.2], [-0.3, 1.2], [0.05, 1.18], [-0.62, 1.95], [-0.25, 1.95], [-0.62, 2.35]];
    boltPos.forEach(([u, v]) => {
      const b = new THREE.Mesh(boltGeo, brass);
      b.position.copy(toLocal(u, v, Y_PLATE + 0.028));
      group.add(b);
    });
  }

  // ---------- 琴弦、弦轴、琴码 ----------
  const stringXFront = (k) => -0.6 + 1.24 * (k / 87);
  const vEndFor = (x) => {
    let v = 0.4;
    while (v < CASE_LEN && pointInPoly(x, v + 0.07, plateInset)) v += 0.01;
    return v - 0.03;
  };
  const strings = [];
  for (let k = 0; k < 88; k++) {
    const n = k < 8 ? 1 : k < 28 ? 2 : 3;
    const bass = k < 20;
    for (let s = 0; s < n; s++) {
      const off = (s - (n - 1) / 2) * 0.0034;
      const xf = stringXFront(k) + off;
      let a, b;
      if (bass) {
        // 低音弦交叉排布:从左前方斜跨到琴尾,位置更高
        const t = k / 19;
        a = toLocal(-0.44 + t * 0.5 + off, 0.2, Y_STRING + 0.012);
        const xe = -0.7 + t * 0.32 + off;
        b = toLocal(xe, vEndFor(xe) - 0.02, Y_STRING + 0.012);
      } else {
        a = toLocal(xf, 0.18, Y_STRING);
        b = toLocal(xf, vEndFor(xf), Y_STRING);
      }
      strings.push({ a, b, wound: k < 30, r: k < 30 ? 0.0016 - k * 0.00002 : 0.00055 });
    }
  }
  {
    const unit = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    const wound = strings.filter((s) => s.wound);
    const plain = strings.filter((s) => !s.wound);
    const make = (list, mat) => {
      const im = new THREE.InstancedMesh(unit, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      const yAxis = new THREE.Vector3(0, 1, 0);
      list.forEach((s, i) => {
        const dir = new THREE.Vector3().subVectors(s.b, s.a);
        const len = dir.length();
        q.setFromUnitVectors(yAxis, dir.normalize());
        sc.set(s.r, len, s.r);
        m.compose(new THREE.Vector3().addVectors(s.a, s.b).multiplyScalar(0.5), q, sc);
        im.setMatrixAt(i, m);
      });
      return im;
    };
    group.add(make(wound, copper));
    group.add(make(plain, steel));

    // 弦轴(调音钉)两排交错
    const pinGeo = new THREE.CylinderGeometry(0.0032, 0.0032, 0.03, 8);
    const pins = new THREE.InstancedMesh(pinGeo, steel, strings.length);
    const m = new THREE.Matrix4();
    strings.forEach((s, i) => {
      const row = i % 2;
      const x = s.a.x;
      m.makeTranslation(x, Y_PLATE + 0.04, -(RIM_FRONT + 0.06 + row * 0.035));
      pins.setMatrixAt(i, m);
    });
    group.add(pins);

    // 琴码(沿弦尾端的弯曲木条)
    const bridgePts = [];
    for (let k = 20; k < 88; k += 4) {
      const x = stringXFront(k);
      bridgePts.push(toLocal(x, vEndFor(x) - 0.09, Y_SOUNDBOARD + 0.035));
    }
    const bridge = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bridgePts), 120, 0.012, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.5 })
    );
    group.add(bridge);

    // 弦尾端的红色止音毡
    const feltCurve = [];
    for (let k = 20; k < 88; k += 3) {
      const x = stringXFront(k);
      feltCurve.push(toLocal(x, vEndFor(x) + 0.008, Y_STRING + 0.002));
    }
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(feltCurve), 120, 0.006, 6, false), feltRed));
  }

  // ---------- 制音器(每个键一个,按键或踩延音踏板时抬起) ----------
  const DAMPER_COUNT = 69; // A0..F6 有制音器,最高的一段没有(与真琴一致)
  const damperWoodGeo = new RoundedBoxGeometry(0.0105, 0.034, 0.04, 2, 0.002);
  const damperFeltGeo = new THREE.BoxGeometry(0.0105, 0.01, 0.04);
  const dampersWood = new THREE.InstancedMesh(damperWoodGeo, damperWood, DAMPER_COUNT);
  const dampersFelt = new THREE.InstancedMesh(damperFeltGeo, felt, DAMPER_COUNT);
  dampersWood.castShadow = true;
  const damperBase = [];
  for (let k = 0; k < DAMPER_COUNT; k++) {
    const bass = k < 20;
    const x = bass ? -0.44 + (k / 19) * 0.5 : stringXFront(k);
    const p = toLocal(x, bass ? 0.32 : 0.3, (bass ? Y_STRING + 0.012 : Y_STRING) + 0.002);
    damperBase.push(p);
  }
  group.add(dampersWood, dampersFelt);
  // 制音器导轨
  {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.008, 0.012), damperWood);
    rail.position.copy(toLocal(0.02, 0.345, Y_STRING + 0.022));
    group.add(rail);
  }

  // ---------- 键盘区:键床、键口挡板、两侧扶手 ----------
  {
    const keybed = new THREE.Mesh(new THREE.BoxGeometry(CASE_HALF * 2, 0.06, RIM_FRONT + 0.012), lacquer);
    keybed.position.set(0, Y_FLOOR_CASE + 0.03, -(RIM_FRONT - 0.012) / 2);
    keybed.castShadow = true;
    group.add(keybed);

    const keyslip = new THREE.Mesh(new RoundedBoxGeometry(KB_HALF * 2 + 0.004, 0.034, 0.014, 2, 0.003), lacquer);
    keyslip.position.set(0, 0.696, 0.007);
    group.add(keyslip);

    const cheekW = CASE_HALF - KB_HALF - 0.002;
    [-1, 1].forEach((side) => {
      const cheek = new THREE.Mesh(new RoundedBoxGeometry(cheekW, 0.17, RIM_FRONT + 0.014, 4, 0.014), lacquer);
      cheek.position.set(side * (KB_HALF + 0.002 + cheekW / 2), Y_FLOOR_CASE + 0.085, -(RIM_FRONT - 0.014) / 2);
      cheek.castShadow = true;
      group.add(cheek);
    });

    // 键盘后方的毛毡条
    const feltStrip = new THREE.Mesh(new THREE.BoxGeometry(KB_HALF * 2, 0.006, 0.01), feltRed);
    feltStrip.position.set(0, Y_KEY_TOP + 0.004, -0.152);
    group.add(feltStrip);

    // 铭牌(琴键后方竖板,金色烫字)
    const nbTex = toTexture(nameboardTexture(), { anisotropy: maxAniso });
    nbTex.wrapS = nbTex.wrapT = THREE.ClampToEdgeWrapping;
    const nameboard = new THREE.Mesh(
      new THREE.PlaneGeometry(KB_HALF * 2, 0.056),
      new THREE.MeshPhysicalMaterial({ map: nbTex, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })
    );
    nameboard.position.set(0, Y_KEY_TOP + 0.034, -0.157);
    group.add(nameboard);

    // 翻开后的键盘盖(顶部斜面)
    const fallboard = new THREE.Mesh(new RoundedBoxGeometry(KB_HALF * 2 + 0.01, 0.026, 0.07, 3, 0.008), lacquer);
    fallboard.position.set(0, Y_KEY_TOP + 0.074, -0.192);
    fallboard.rotation.x = -0.18;
    fallboard.castShadow = true;
    group.add(fallboard);

    // 键盘区上方的前横板(盖住弦轴前端的木条)
    const frontRail = new THREE.Mesh(new THREE.BoxGeometry(KB_HALF * 2 + 0.02, 0.09, 0.035), lacquerInner);
    frontRail.position.set(0, Y_KEY_TOP + 0.045, -0.225);
    group.add(frontRail);
  }

  // ---------- 88 个琴键 ----------
  const keys = new Map(); // midi -> key 对象
  const keyMeshes = [];
  const ivory = new THREE.MeshPhysicalMaterial({
    color: 0xe6dfcd, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.25,
  });
  const ebony = new THREE.MeshPhysicalMaterial({ color: 0x0a0909, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const glowColor = new THREE.Color(0xffa62e);

  const whiteKeyGeo = new RoundedBoxGeometry(WHITE_W - 0.0012, 0.022, 0.155 + 0.05, 2, 0.0018);
  // 黑键:梯形截面(顶窄底宽)沿 z 拉伸
  const blackKeyGeo = (() => {
    const s = new THREE.Shape();
    const wb = 0.0136, wt = 0.0106, h = 0.021;
    s.moveTo(-wb / 2, 0);
    s.lineTo(wb / 2, 0);
    s.lineTo(wt / 2, h);
    s.lineTo(-wt / 2, h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.095, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0008, bevelSegments: 2 });
    g.translate(0, 0, -0.095); // 前端在 z = 0,向后延伸
    return g;
  })();
  const BLACK_SHIFT = { 1: -0.1, 3: 0.1, 6: -0.13, 8: 0, 10: 0.13 };

  let whiteIdx = 0;
  const whiteIndexOf = {};
  for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) {
    if (!isBlackMidi(m)) whiteIndexOf[m] = whiteIdx++;
  }
  for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) {
    const black = isBlackMidi(m);
    const pivot = new THREE.Group();
    pivot.position.set(0, Y_KEY_TOP - 0.02, KEY_PIVOT_Z);
    const mat = (black ? ebony : ivory).clone();
    mat.emissive = glowColor.clone();
    mat.emissiveIntensity = 0;
    let mesh, x;
    if (!black) {
      x = -KB_HALF + (whiteIndexOf[m] + 0.5) * WHITE_W;
      mesh = new THREE.Mesh(whiteKeyGeo, mat);
      mesh.position.set(x, 0.009, -(0.155 + 0.05) / 2 - KEY_PIVOT_Z + 0.0);
    } else {
      const left = whiteIndexOf[m - 1];
      x = -KB_HALF + (left + 1) * WHITE_W + (BLACK_SHIFT[m % 12] || 0) * WHITE_W;
      mesh = new THREE.Mesh(blackKeyGeo, mat);
      mesh.position.set(x, 0.011, -0.052 - KEY_PIVOT_Z);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.midi = m;
    pivot.add(mesh);
    group.add(pivot);
    keyMeshes.push(mesh);
    const frontDist = black ? 0.052 - KEY_PIVOT_Z : -KEY_PIVOT_Z;
    keys.set(m, {
      midi: m, black, pivot, mesh, mat, x,
      maxAngle: KEY_DIP / frontDist * (black ? 1.1 : 1),
      value: 0, // 0 = 抬起 1 = 按到底
      target: 0,
      count: 0, // 同时按住的次数(重复音时避免提前抬键)
      glow: 0,
    });
  }

  // ---------- 大盖(撑开约 34°,铰链在低音侧) ----------
  const lidPivot = new THREE.Group();
  lidPivot.position.set(-CASE_HALF, Y_RIM_TOP + 0.002, 0);
  lidPivot.rotation.z = LID_ANGLE;
  {
    const lidPts = outerPts.filter((p) => p.y > 0.225);
    lidPts.unshift(new THREE.Vector2(CASE_HALF, 0.22));
    lidPts.push(new THREE.Vector2(-CASE_HALF, 0.22));
    const shape = new THREE.Shape(lidPts);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 60,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(CASE_HALF, 0, -RIM_FRONT);
    const lid = new THREE.Mesh(g, lacquer);
    lid.castShadow = true;
    lidPivot.add(lid);
    // 前翻盖折叠在大盖上
    const flapShape = new THREE.Shape([
      new THREE.Vector2(-CASE_HALF + 0.004, 0.0),
      new THREE.Vector2(CASE_HALF - 0.004, 0.0),
      new THREE.Vector2(CASE_HALF - 0.004, 0.2),
      new THREE.Vector2(-CASE_HALF + 0.004, 0.2),
    ]);
    const fg = new THREE.ExtrudeGeometry(flapShape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
    fg.rotateX(-Math.PI / 2);
    fg.translate(CASE_HALF, 0.026, -RIM_FRONT - 0.24);
    lidPivot.add(new THREE.Mesh(fg, lacquer));
    // 铰链
    [0.45, 1.3, 2.1].forEach((v) => {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 12), brass);
      h.rotation.x = Math.PI / 2;
      h.position.set(-0.004, 0.0, -(RIM_FRONT + v));
      lidPivot.add(h);
    });
  }
  group.add(lidPivot);

  // 顶杆:从侧板顶部撑到大盖下方
  {
    const v = 1.22;
    let best = outerPts[0];
    outerPts.forEach((p) => {
      if (p.x > 0 && Math.abs(p.y - v) < Math.abs(best.y - v)) best = p;
    });
    const baseX = best.x - 0.06;
    const base = toLocal(baseX, v, Y_RIM_TOP);
    const xRel = baseX + CASE_HALF - 0.1;
    const top = new THREE.Vector3(-CASE_HALF + xRel * Math.cos(LID_ANGLE), Y_RIM_TOP + xRel * Math.sin(LID_ANGLE) - 0.004, base.z);
    const stick = cylinderBetween(base, top, 0.011, lacquer, 14);
    stick.castShadow = true;
    group.add(stick);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), brass);
    cup.position.copy(base);
    group.add(cup);
  }

  // ---------- 谱架 ----------
  const desk = new THREE.Group();
  desk.position.set(0, Y_RIM_TOP - 0.02, -0.4);
  desk.rotation.x = -0.24;
  {
    const board = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.3, 0.014, 3, 0.006), lacquer);
    board.position.set(0, 0.16, -0.008);
    board.castShadow = true;
    desk.add(board);
    const ledge = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.022, 0.05, 3, 0.006), lacquer);
    ledge.position.set(0, 0.012, 0.02);
    desk.add(ledge);
    // 谱架镂空花纹(用金色细条表现)
    for (let i = -4; i <= 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.22, 0.002), brass);
      bar.position.set(i * 0.09, 0.17, 0.0005);
      desk.add(bar);
    }
  }
  group.add(desk);

  // ---------- 琴腿(车削造型 + 黄铜脚轮) ----------
  {
    const prof = [
      [0.0, 0.0], [0.03, 0.0], [0.036, 0.03], [0.042, 0.06], [0.05, 0.07], [0.046, 0.1],
      [0.042, 0.25], [0.048, 0.4], [0.056, 0.5], [0.07, 0.53], [0.074, 0.56], [0.064, 0.58],
      [0.08, 0.6], [0.08, Y_FLOOR_CASE - 0.04], [0.0, Y_FLOOR_CASE - 0.04],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const legGeo = new THREE.LatheGeometry(prof, 40);
    const legPos = [toLocal(-0.66, 0.08), toLocal(0.66, 0.08), toLocal(-0.42, 2.08)];
    legPos.forEach((p) => {
      const leg = new THREE.Mesh(legGeo, lacquer);
      leg.position.set(p.x, 0.04, p.z);
      leg.castShadow = true;
      group.add(leg);
      const block = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.05, 0.17, 3, 0.01), lacquer);
      block.position.set(p.x, Y_FLOOR_CASE - 0.025, p.z);
      group.add(block);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 20), brass);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(p.x, 0.03, p.z);
      group.add(wheel);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 8, 24), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, 0.075, p.z);
      group.add(ring);
    });
  }

  // ---------- 踏板琴箱(Lyre)+ 三个黄铜踏板 ----------
  const pedals = [];
  {
    const lyre = new THREE.Group();
    lyre.position.set(0, 0, -0.32);
    const sideShape = new THREE.Shape();
    sideShape.moveTo(0, 0.12);
    sideShape.bezierCurveTo(0.06, 0.25, -0.04, 0.42, 0.03, 0.6);
    sideShape.lineTo(0.0, 0.6);
    sideShape.bezierCurveTo(-0.07, 0.42, 0.03, 0.25, -0.03, 0.12);
    sideShape.closePath();
    const sideGeo = new THREE.ExtrudeGeometry(sideShape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2 });
    sideGeo.translate(0, 0, -0.0175);
    [-1, 1].forEach((side) => {
      const s = new THREE.Mesh(sideGeo, lacquer);
      s.position.x = side * 0.1;
      s.rotation.y = Math.PI / 2;
      s.castShadow = true;
      lyre.add(s);
    });
    // 黄铜竖杆
    [-0.035, 0, 0.035].forEach((x) => {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.42, 8), brass);
      rod.position.set(x, 0.38, 0);
      lyre.add(rod);
    });
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.07, 0.13, 3, 0.012), lacquer);
    box.position.set(0, 0.085, 0.0);
    box.castShadow = true;
    lyre.add(box);
    const topRail = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.04, 0.09, 3, 0.01), lacquer);
    topRail.position.set(0, Y_FLOOR_CASE - 0.02, 0);
    lyre.add(topRail);
    // 斜撑杆
    lyre.add(cylinderBetween(new THREE.Vector3(0, 0.1, -0.06), new THREE.Vector3(0, Y_FLOOR_CASE, -0.55), 0.012, lacquer));
    const pedalGeo = new RoundedBoxGeometry(0.032, 0.012, 0.15, 3, 0.005);
    pedalGeo.translate(0, 0, 0.075);
    [-0.06, 0, 0.06].forEach((x, i) => {
      const pv = new THREE.Group();
      pv.position.set(x, 0.075, 0.03);
      const pedal = new THREE.Mesh(pedalGeo, brass);
      pedal.castShadow = true;
      pv.add(pedal);
      lyre.add(pv);
      pedals.push({ pivot: pv, value: 0, target: 0, name: ["una corda", "sostenuto", "sustain"][i] });
    });
    group.add(lyre);
  }

  // ---------- 琴凳 ----------
  {
    const bench = new THREE.Group();
    bench.position.set(0, 0, 0.62);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.075, 0.34, 4, 0.03), leather);
    seat.position.y = 0.5;
    seat.castShadow = true;
    bench.add(seat);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.07, 0.3, 3, 0.01), lacquer);
    frame.position.y = 0.44;
    bench.add(frame);
    [[-0.25, -0.12], [0.25, -0.12], [-0.25, 0.12], [0.25, 0.12]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.42, 16), lacquer);
      leg.position.set(x, 0.21, z);
      leg.castShadow = true;
      bench.add(leg);
    });
    [-1, 1].forEach((s) => {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 20), brass);
      knob.rotation.z = Math.PI / 2;
      knob.position.set(s * 0.3, 0.44, 0);
      bench.add(knob);
    });
    group.add(bench);
  }

  group.traverse((o) => {
    if (o.isMesh && o.castShadow === false && o !== rim) o.receiveShadow = true;
  });

  // ---------- 动画 ----------
  const tmpM = new THREE.Matrix4();
  let sustainValue = 0;
  let sustainTarget = 0;
  let glowEnabled = true;
  const damperValues = new Float32Array(DAMPER_COUNT);

  function writeDampers() {
    for (let k = 0; k < DAMPER_COUNT; k++) {
      const key = keys.get(LOW_MIDI + k);
      const lift = Math.max(key.value, sustainValue);
      damperValues[k] = lift;
      const p = damperBase[k];
      const y = p.y + lift * 0.016;
      tmpM.makeTranslation(p.x, y + 0.005 + 0.017 + 0.005, p.z);
      dampersWood.setMatrixAt(k, tmpM);
      tmpM.makeTranslation(p.x, y + 0.005, p.z);
      dampersFelt.setMatrixAt(k, tmpM);
    }
    dampersWood.instanceMatrix.needsUpdate = true;
    dampersFelt.instanceMatrix.needsUpdate = true;
  }
  writeDampers();

  function update(dt) {
    let dampersDirty = false;
    keys.forEach((k) => {
      const goal = k.count > 0 ? 1 : 0;
      k.target = goal;
      if (k.value !== goal) {
        // 按下快、回弹稍慢,接近真琴键的手感
        const rate = goal > k.value ? 55 : 22;
        k.value += (goal - k.value) * Math.min(1, dt * rate);
        if (Math.abs(goal - k.value) < 0.002) k.value = goal;
        k.pivot.rotation.x = k.value * k.maxAngle;
        dampersDirty = true;
      }
      const glowGoal = glowEnabled && k.count > 0 ? 1 : 0;
      if (k.glow !== glowGoal) {
        k.glow += (glowGoal - k.glow) * Math.min(1, dt * (glowGoal ? 30 : 8));
        if (Math.abs(glowGoal - k.glow) < 0.004) k.glow = glowGoal;
        k.mat.emissiveIntensity = k.glow * (k.black ? 0.7 : 0.34);
      }
    });
    if (sustainValue !== sustainTarget) {
      sustainValue += (sustainTarget - sustainValue) * Math.min(1, dt * 14);
      if (Math.abs(sustainTarget - sustainValue) < 0.002) sustainValue = sustainTarget;
      dampersDirty = true;
    }
    pedals.forEach((p) => {
      if (p.value !== p.target) {
        p.value += (p.target - p.value) * Math.min(1, dt * 16);
        if (Math.abs(p.target - p.value) < 0.002) p.value = p.target;
        p.pivot.rotation.x = p.value * 0.09;
      }
    });
    if (dampersDirty) writeDampers();
  }

  function press(midi) {
    const k = keys.get(midi);
    if (!k) return;
    // 同音反复:先让琴键弹起一点再按下,看得出"再敲一次"
    if (k.count > 0) k.value = Math.min(k.value, 0.45);
    k.count++;
  }
  function release(midi) {
    const k = keys.get(midi);
    if (!k) return;
    k.count = Math.max(0, k.count - 1);
  }
  function releaseAll() {
    keys.forEach((k) => (k.count = 0));
  }
  function setSustain(on) {
    sustainTarget = on ? 1 : 0;
    pedals[2].target = on ? 1 : 0;
  }
  function setGlow(on) {
    glowEnabled = !!on;
  }
  function keyTopWorld(midi, target = new THREE.Vector3()) {
    const k = keys.get(midi);
    if (!k) return null;
    k.mesh.getWorldPosition(target);
    return target;
  }

  return {
    group, keys, keyMeshes, desk, update, press, release, releaseAll, setSustain, setGlow, keyTopWorld,
    deskPaperAnchor: { y: 0.02, z: 0.004 }, // 谱纸放在谱架托条上方
  };
}

