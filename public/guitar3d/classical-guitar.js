// 古典吉他(650 mm 弦长)程序化建模。
// 局部坐标:y 沿琴颈向上(琴身底部 y=0,琴枕 y≈0.815),x 横向(正面看,一弦在右 +x、六弦在左 -x),z 指向面板正面。
// 每根弦都是独立网格:发声时在"按弦品位 → 下弦枕"这段长度上做驻波振动(顶点着色器),按弦处亮起金色指位点。

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { rng } from "../hall/textures.js";

export const SCALE = 0.65; // 有效弦长
export const FRETS = 19;
const BODY_LEN = 0.49;
const NUT_Y = BODY_LEN + SCALE / 2; // 第 12 品正好在琴颈与琴身交界
const SADDLE_Y = NUT_Y - SCALE;
const BODY_DEPTH = 0.095;
const FB_T = 0.006; // 指板厚
const SOUNDHOLE = { y: 0.345, r: 0.043 };
export const fretY = (n) => NUT_Y - SCALE * (1 - Math.pow(2, -n / 12));
const FB_END_Y = fretY(FRETS) - 0.008;
const NUT_SPAN = 0.043; // 一弦到六弦的间距(琴枕处)
const SADDLE_SPAN = 0.058;
const stringX = (s, y) => {
  const t = (y - SADDLE_Y) / SCALE; // 0 下弦枕 → 1 琴枕
  const span = SADDLE_SPAN + (NUT_SPAN - SADDLE_SPAN) * t;
  return span * (0.5 - s / 5); // s=0 一弦在 +x
};
const stringZ = (y) => {
  const t = (y - SADDLE_Y) / SCALE;
  return 0.0145 + (0.0078 - 0.0145) * t;
};
const fbHalfWidth = (y) => {
  const t = (NUT_Y - y) / (NUT_Y - FB_END_Y);
  return 0.026 + (0.0325 - 0.026) * t;
};

function canvasTex(w, h, draw, { srgb = true, anisotropy = 8 } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

// 琴身轮廓(右半边贝塞尔,再镜像)
function bodyOutline() {
  const half = new THREE.CurvePath();
  const B = (a, b, c, d) => half.add(new THREE.CubicBezierCurve(new THREE.Vector2(...a), new THREE.Vector2(...b), new THREE.Vector2(...c), new THREE.Vector2(...d)));
  B([0, 0], [0.1, 0], [0.183, 0.035], [0.183, 0.13]);
  B([0.183, 0.13], [0.183, 0.215], [0.118, 0.235], [0.118, 0.29]);
  B([0.118, 0.29], [0.118, 0.33], [0.142, 0.35], [0.142, 0.405]);
  B([0.142, 0.405], [0.142, 0.47], [0.075, 0.49], [0.0, 0.49]);
  const right = half.getSpacedPoints(120); // 底部中点 → 沿右侧 → 顶部中点
  // 逆时针:右侧自下而上,再把右侧镜像、倒序,沿左侧自上而下回到起点
  const left = right.slice(1, -1).reverse().map((p) => new THREE.Vector2(-p.x, p.y));
  return [...right, ...left];
}

export function createClassicalGuitar({ renderer } = {}) {
  const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  const group = new THREE.Group();
  group.name = "ClassicalGuitar";

  // ---------- 材质 ----------
  const W = 0.4, H = BODY_LEN;
  const topTex = canvasTex(1024, Math.round((1024 * H) / W), (ctx, w, h) => {
    const r = rng(23);
    ctx.fillStyle = "#e7c48a";
    ctx.fillRect(0, 0, w, h);
    // 云杉竖纹(拼板对称)
    for (let x = 0; x < w / 2; x += 2 + r() * 4) {
      const a = 0.12 + r() * 0.22;
      ctx.strokeStyle = `rgba(150,100,45,${a})`;
      ctx.lineWidth = 0.6 + r() * 1.2;
      [w / 2 - x, w / 2 + x].forEach((xx) => {
        ctx.beginPath();
        ctx.moveTo(xx, 0);
        ctx.lineTo(xx + (r() - 0.5) * 3, h);
        ctx.stroke();
      });
    }
    const toPx = (x, y) => [((x + W / 2) / W) * w, h - (y / H) * h];
    // 音孔花环(马赛克同心环)
    const [cx, cy] = toPx(0, SOUNDHOLE.y);
    const R = (SOUNDHOLE.r / W) * w;
    const rings = [
      [1.0, 1.06, "#2b1a0e"], [1.06, 1.1, "#f1e3c2"], [1.1, 1.14, "#1d120a"],
      [1.14, 1.34, null], [1.34, 1.38, "#1d120a"], [1.38, 1.42, "#f1e3c2"], [1.42, 1.47, "#2b1a0e"],
    ];
    rings.forEach(([a, b, col]) => {
      if (col) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, R * b, 0, Math.PI * 2);
        ctx.arc(cx, cy, R * a, 0, Math.PI * 2, true);
        ctx.fill();
      } else {
        // 马赛克:细小的彩色方块组成的花纹带
        const n = 180;
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < 6; k++) {
            const ang = (i / n) * Math.PI * 2;
            const rr = R * (a + ((b - a) * (k + 0.5)) / 6);
            const pat = (i + k * 3) % 12;
            ctx.fillStyle = ["#7a2a1a", "#d7b46a", "#1f5a3a", "#f3e7c8", "#2a160c", "#b8803a"][(pat + k) % 6];
            ctx.save();
            ctx.translate(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
            ctx.rotate(ang);
            ctx.fillRect(-R * 0.018, -R * 0.016, R * 0.036, R * 0.032);
            ctx.restore();
          }
        }
      }
    });
    // 琴码下方的面板略深(多年演奏的痕迹)
    const [bx, by] = toPx(0, SADDLE_Y - 0.01);
    const g = ctx.createRadialGradient(bx, by, 10, bx, by, w * 0.35);
    g.addColorStop(0, "rgba(120,70,20,0.18)");
    g.addColorStop(1, "rgba(120,70,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { anisotropy: aniso });
  topTex.wrapS = topTex.wrapT = THREE.ClampToEdgeWrapping;

  const rosewoodTex = canvasTex(512, 1024, (ctx, w, h) => {
    const r = rng(5);
    ctx.fillStyle = "#4a2414";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = r() * w;
      ctx.strokeStyle = r() > 0.5 ? `rgba(20,6,2,${0.2 + r() * 0.4})` : `rgba(140,70,35,${0.15 + r() * 0.25})`;
      ctx.lineWidth = 0.6 + r() * 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= h; y += 64) ctx.lineTo(x + Math.sin(y * 0.01 + i) * 6 + (r() - 0.5) * 3, y);
      ctx.stroke();
    }
  }, { anisotropy: aniso });
  rosewoodTex.wrapS = rosewoodTex.wrapT = THREE.RepeatWrapping;

  const topMat = new THREE.MeshPhysicalMaterial({ map: topTex, roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  const rosewood = new THREE.MeshPhysicalMaterial({ map: rosewoodTex, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.1 });
  const rosewoodSide = rosewood.clone();
  rosewoodSide.side = THREE.DoubleSide;
  const cedarNeck = new THREE.MeshPhysicalMaterial({ color: 0x9c5b2c, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const ebony = new THREE.MeshStandardMaterial({ color: 0x1b120c, roughness: 0.5 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe9e0cb, roughness: 0.6 });
  const nickel = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, metalness: 1, roughness: 0.28 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xcaa25a, metalness: 1, roughness: 0.3 });
  const binding = new THREE.MeshStandardMaterial({ color: 0xead9b2, roughness: 0.4 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x2a170b, roughness: 0.9, side: THREE.DoubleSide });

  // ---------- 琴身 ----------
  const outline = bodyOutline();
  const shape = new THREE.Shape(outline);
  // 侧板:拉伸后只保留侧面(两端盖子透明),面板/背板单独做
  {
    const g = new THREE.ExtrudeGeometry(shape, { depth: BODY_DEPTH, bevelEnabled: false, curveSegments: 1, steps: 1 });
    g.translate(0, 0, -BODY_DEPTH);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const sides = new THREE.Mesh(g, [hidden, rosewoodSide]);
    sides.castShadow = true;
    group.add(sides);
  }
  const uvByBounds = (geo) => {
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, pos.getY(i) / H);
    uv.needsUpdate = true;
    return geo;
  };
  // 面板(带音孔)
  {
    const topShape = new THREE.Shape(outline);
    const hole = new THREE.Path();
    hole.absarc(0, SOUNDHOLE.y, SOUNDHOLE.r, 0, Math.PI * 2, true);
    topShape.holes.push(hole);
    const top = new THREE.Mesh(uvByBounds(new THREE.ShapeGeometry(topShape, 48)), topMat);
    top.receiveShadow = true;
    group.add(top);
    // 背板(外侧)与琴箱内部的暗色(透过音孔能看到)
    const back = new THREE.Mesh(uvByBounds(new THREE.ShapeGeometry(shape, 24)), rosewood);
    back.rotation.y = Math.PI;
    back.position.z = -BODY_DEPTH;
    back.castShadow = true;
    group.add(back);
    const inner = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), interior);
    inner.position.z = -BODY_DEPTH + 0.002;
    group.add(inner);
    // 音孔边缘(面板厚度)
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(SOUNDHOLE.r, SOUNDHOLE.r, 0.003, 48, 1, true), interior);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, SOUNDHOLE.y, -0.0015);
    group.add(rim);
  }
  // 包边(面板与背板边缘的浅色木线)
  [0, -BODY_DEPTH].forEach((z) => {
    const pts = outline.map((p) => new THREE.Vector3(p.x, p.y, z));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 400, 0.0018, 6, true), binding);
    group.add(tube);
  });

  // ---------- 琴码 ----------
  {
    const bridge = new THREE.Mesh(new RoundedBoxGeometry(0.185, 0.03, 0.009, 3, 0.003), rosewood);
    bridge.position.set(0, SADDLE_Y - 0.008, 0.0045);
    bridge.castShadow = true;
    group.add(bridge);
    const wings = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.022, 0.004, 3, 0.0018), rosewood);
    wings.position.set(0, SADDLE_Y - 0.01, 0.002);
    group.add(wings);
    const saddle = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.003, 0.009, 2, 0.001), bone);
    saddle.position.set(0, SADDLE_Y, 0.0105);
    group.add(saddle);
    const tieBlock = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.008, 0.0035, 2, 0.001), bone);
    tieBlock.position.set(0, SADDLE_Y - 0.019, 0.0095);
    group.add(tieBlock);
  }

  // ---------- 琴颈 + 指板 + 品丝 ----------
  {
    const neckLen = NUT_Y - BODY_LEN + 0.01;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.026 / 0.031, 1, neckLen, 32, 1, false, Math.PI / 2, Math.PI), cedarNeck);
    neck.scale.set(0.031, 1, 0.021);
    neck.position.set(0, BODY_LEN + neckLen / 2 - 0.005, 0);
    neck.castShadow = true;
    group.add(neck);
    // 琴跟(接琴身)
    const heel = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.07, BODY_DEPTH * 0.8, 4, 0.02), cedarNeck);
    heel.position.set(0, BODY_LEN - 0.005, -BODY_DEPTH * 0.4);
    group.add(heel);

    const fbShape = new THREE.Shape([
      new THREE.Vector2(-fbHalfWidth(FB_END_Y), FB_END_Y),
      new THREE.Vector2(fbHalfWidth(FB_END_Y), FB_END_Y),
      new THREE.Vector2(fbHalfWidth(NUT_Y), NUT_Y),
      new THREE.Vector2(-fbHalfWidth(NUT_Y), NUT_Y),
    ]);
    const fb = new THREE.Mesh(new THREE.ExtrudeGeometry(fbShape, { depth: FB_T, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1 }), ebony);
    fb.castShadow = true;
    group.add(fb);
    for (let n = 1; n <= FRETS; n++) {
      const y = fretY(n);
      const fret = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, fbHalfWidth(y) * 2, 8), nickel);
      fret.rotation.z = Math.PI / 2;
      fret.position.set(0, y, FB_T);
      group.add(fret);
    }
    // 侧面品位点(古典吉他正面无镶嵌)
    [5, 7, 9, 12].forEach((n) => {
      const y = (fretY(n) + fretY(n - 1)) / 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 8, 6), bone);
      dot.position.set(-fbHalfWidth(y) - 0.0004, y, FB_T * 0.5);
      group.add(dot);
    });
    const nut = new THREE.Mesh(new RoundedBoxGeometry(0.053, 0.005, 0.0045, 2, 0.001), bone);
    nut.position.set(0, NUT_Y + 0.0025, FB_T + 0.0015);
    group.add(nut);
  }

  // ---------- 琴头(开槽式,向后倾 12°) ----------
  const head = new THREE.Group();
  head.position.set(0, NUT_Y + 0.005, 0.002);
  head.rotation.x = -0.21;
  {
    const hs = new THREE.Shape();
    hs.moveTo(-0.027, 0);
    hs.lineTo(0.027, 0);
    hs.lineTo(0.037, 0.03);
    hs.lineTo(0.037, 0.17);
    hs.quadraticCurveTo(0.037, 0.19, 0.02, 0.188);
    hs.quadraticCurveTo(0, 0.2, -0.02, 0.188);
    hs.quadraticCurveTo(-0.037, 0.19, -0.037, 0.17);
    hs.lineTo(-0.037, 0.03);
    hs.closePath();
    [-1, 1].forEach((side) => {
      const slot = new THREE.Path();
      const x0 = side * 0.0125;
      slot.moveTo(x0 - 0.0065, 0.04);
      slot.lineTo(x0 - 0.0065, 0.155);
      slot.absarc(x0, 0.155, 0.0065, Math.PI, 0, true);
      slot.lineTo(x0 + 0.0065, 0.04);
      slot.absarc(x0, 0.04, 0.0065, 0, Math.PI, true);
      hs.holes.push(slot);
    });
    const headGeo = new THREE.ExtrudeGeometry(hs, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 2, curveSegments: 16 });
    headGeo.translate(0, 0, -0.018);
    const headMesh = new THREE.Mesh(headGeo, [rosewood, cedarNeck]);
    headMesh.castShadow = true;
    head.add(headMesh);
    // 弦轴滚筒 + 侧面黄铜卷弦器 + 珍珠旋钮
    [0.065, 0.1, 0.135].forEach((y) => {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.074, 12), bone);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, y, -0.009);
      head.add(roller);
      [-1, 1].forEach((side) => {
        const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 20), bone);
        knob.rotation.z = Math.PI / 2;
        knob.position.set(side * 0.058, y, -0.009);
        head.add(knob);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.02, 8), brass);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.set(side * 0.046, y, -0.009);
        head.add(shaft);
      });
    });
    [-1, 1].forEach((side) => {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.12, 0.012), brass);
      plate.position.set(side * 0.0378, 0.1, -0.009);
      head.add(plate);
    });
  }
  group.add(head);

  // ---------- 琴弦 ----------
  const strings = [];
  const radii = [0.00036, 0.00041, 0.0005, 0.00045, 0.00053, 0.00062].map((r) => r * 1.35);
  const nylonMat = () => new THREE.MeshPhysicalMaterial({ color: 0xf1ead8, roughness: 0.3, clearcoat: 0.6, emissive: 0xffb34a, emissiveIntensity: 0 });
  const woundMat = () => new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 1, roughness: 0.32, emissive: 0xffb34a, emissiveIntensity: 0 });
  for (let s = 0; s < 6; s++) {
    const a = new THREE.Vector3(stringX(s, SADDLE_Y), SADDLE_Y, stringZ(SADDLE_Y));
    const b = new THREE.Vector3(stringX(s, NUT_Y), NUT_Y, stringZ(NUT_Y));
    const len = a.distanceTo(b);
    const mat = s < 3 ? nylonMat() : woundMat();
    const uniforms = { uAmp: { value: 0 }, uTime: { value: 0 }, uFretU: { value: 1 }, uOmega: { value: 0 }, uLen: { value: len } };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uAmp; uniform float uTime; uniform float uFretU; uniform float uOmega; uniform float uLen;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float u = position.y / uLen + 0.5;          // 0 = 下弦枕, 1 = 琴枕
           float seg = clamp(u / uFretU, 0.0, 1.0);
           float shape = u < uFretU ? sin(3.14159265 * seg) : 0.0;
           transformed.x += uAmp * shape * sin(uTime * uOmega + u * 2.0);`
        );
    };
    const geo = new THREE.CylinderGeometry(radii[s], radii[s], len, 6, 64, true);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    mesh.frustumCulled = false;
    group.add(mesh);
    // 弦枕到琴头滚筒、下弦枕到系弦块的两段(静止)
    const roller = new THREE.Vector3(s < 3 ? 0.0125 : -0.0125, 0, 0);
    const rollerLocal = new THREE.Vector3(roller.x + (s % 3 - 1) * 0.004, [0.135, 0.1, 0.065][s % 3], -0.009 + 0.0035);
    head.updateMatrix();
    const rollerWorld = rollerLocal.clone().applyMatrix4(head.matrix);
    const segMat = s < 3 ? new THREE.MeshPhysicalMaterial({ color: 0xf1ead8, roughness: 0.3 }) : new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 1, roughness: 0.32 });
    const addSeg = (p, q) => {
      const d = new THREE.Vector3().subVectors(q, p);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(radii[s], radii[s], d.length(), 6), segMat);
      m.position.copy(p).add(q).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      group.add(m);
    };
    addSeg(b, rollerWorld);
    addSeg(a, new THREE.Vector3(stringX(s, SADDLE_Y) * 0.95, SADDLE_Y - 0.019, 0.0105));
    // 指位点(按弦处发金光)
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.0034, 16, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.15, 0.28), transparent: true, opacity: 0, depthWrite: false })
    );
    dot.renderOrder = 3;
    group.add(dot);
    // 拾取用的隐形长条(比弦粗得多,方便点中)
    const hitGeo = new THREE.BoxGeometry(0.0078, len + 0.02, 0.012);
    const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(mesh.position);
    hit.quaternion.copy(mesh.quaternion);
    hit.userData.string = s;
    group.add(hit);
    strings.push({ s, mesh, mat, uniforms, dot, hit, amp: 0, glow: 0, fret: 0, freq: 0, decay: 1.6, dotTarget: 0, a, b, len });
  }

  // ---------- 动画 ----------
  let time = 0;
  let glowEnabled = true;
  function update(dt) {
    time += dt;
    strings.forEach((st) => {
      st.amp *= Math.exp(-dt / st.decay);
      if (st.amp < 0.00002) st.amp = 0;
      st.uniforms.uAmp.value = st.amp;
      st.uniforms.uTime.value = time;
      st.glow = Math.max(0, st.glow - dt * 1.1);
      st.mat.emissiveIntensity = glowEnabled ? Math.min(1, st.glow) * 0.9 : 0;
      const o = st.dot.material.opacity;
      const target = glowEnabled ? st.dotTarget : 0;
      st.dot.material.opacity = o + (target - o) * Math.min(1, dt * (target > o ? 30 : 6));
      st.dot.visible = st.dot.material.opacity > 0.01;
    });
  }

  // 拨弦:弦从按弦处到下弦枕振动,指位点亮起
  function pluck(s, fret, { velocity = 0.7, duration = 1.5 } = {}) {
    const st = strings[s];
    if (!st) return;
    st.fret = fret;
    st.uniforms.uFretU.value = fret > 0 ? (fretY(fret) - SADDLE_Y) / SCALE : 1;
    st.amp = 0.0011 + velocity * 0.0016;
    st.uniforms.uOmega.value = 140 + s * 12 + fret * 6; // 视觉上的抖动频率(真实频率太高,人眼只看到模糊的包络)
    st.decay = Math.min(2.2, Math.max(0.5, duration * 0.8));
    st.glow = 1;
    if (fret > 0) {
      const y = fretY(fret) + (fretY(fret - 1) - fretY(fret)) * 0.3;
      st.dot.position.set(stringX(s, y), y, stringZ(y) + 0.0016);
      st.dotTarget = 1;
    } else st.dotTarget = 0;
  }
  function release(s) {
    const st = strings[s];
    if (!st) return;
    st.dotTarget = 0;
  }
  function damp(s) {
    const st = strings[s];
    if (!st) return;
    st.decay = 0.08;
    st.dotTarget = 0;
  }
  function dampAll() {
    strings.forEach((_, i) => damp(i));
  }

  // 点中弦的位置 → 品位(琴身上方 = 空弦 / 当前和弦)
  function fretAtLocalY(y) {
    if (y > NUT_Y) return 1;
    if (y < FB_END_Y) return -1; // 琴身区域
    for (let n = 1; n <= FRETS; n++) if (y >= fretY(n)) return n;
    return FRETS;
  }
  function notePosition(s, fret, target = new THREE.Vector3()) {
    const y = fret > 0 ? fretY(fret) + (fretY(fret - 1) - fretY(fret)) * 0.3 : SOUNDHOLE.y;
    target.set(stringX(s, y), y, stringZ(y) + 0.012);
    return group.localToWorld(target);
  }

  return {
    group,
    strings,
    hitMeshes: strings.map((s) => s.hit),
    update,
    pluck,
    release,
    damp,
    dampAll,
    fretAtLocalY,
    notePosition,
    setGlow(v) {
      glowEnabled = !!v;
    },
    dims: { NUT_Y, SADDLE_Y, BODY_LEN, SOUNDHOLE, BODY_DEPTH },
  };
}
