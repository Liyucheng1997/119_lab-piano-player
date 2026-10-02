// 谱架上的纸质乐谱:把 OSMD 渲染出来的五线谱 SVG 按"系统(行)"裁切,排进左右两页旧纸上,
// 演奏到右页末行后自动翻页(带翻页动画),当前演奏位置用一条金色细线标出。

import * as THREE from "three";
import { paperBase } from "./textures.js";

const PAGE_W = 1024;
const PAGE_H = 1448;
const MARGIN_X = 70;
const TOP_Y = 120;
const BOTTOM_Y = PAGE_H - 90;

export function createScorePaper({ renderer, width = 0.6 }) {
  const w = width / 2; // 每页宽(米)
  const h = (w * PAGE_H) / PAGE_W;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * 2;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  const snap = document.createElement("canvas");
  snap.width = canvas.width;
  snap.height = canvas.height;
  const sctx = snap.getContext("2d");

  const base = [paperBase(PAGE_W, PAGE_H, 31), paperBase(PAGE_W, PAGE_H, 57)];

  const mkTex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  };
  const tex = mkTex(canvas);
  const snapTex = mkTex(snap);

  // 纸张略带自发光:模拟舞台光打在谱纸上的明亮感,保证远看也能读清
  const paperMat = (map) =>
    new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.32, roughness: 0.92, metalness: 0 });
  const bend = (x) => 0.006 * Math.sin(Math.PI * Math.min(1, Math.abs(x) / w)) + 0.004 * (Math.abs(x) / w);

  // 页面几何:u 只取纹理的一半,并做出纸张自然的弧度。kind: left | right | back(翻页背面,初始朝 -z)
  function pageGeometry(kind) {
    const g = new THREE.PlaneGeometry(w, h, 24, 1);
    g.translate(kind === "left" ? -w / 2 : w / 2, 0, 0);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      uv.setX(i, kind === "left" ? u * 0.5 : kind === "right" ? 0.5 + u * 0.5 : (1 - u) * 0.5);
      pos.setZ(i, bend(pos.getX(i)));
    }
    if (kind === "back") g.index.array.reverse();
    g.computeVertexNormals();
    return g;
  }

  const group = new THREE.Group();
  const leftHinge = new THREE.Group();
  const rightHinge = new THREE.Group();
  leftHinge.rotation.y = 0.07;
  rightHinge.rotation.y = -0.07;
  const leftMat = paperMat(tex);
  const rightMat = paperMat(tex);
  const leftPage = new THREE.Mesh(pageGeometry("left"), leftMat);
  const rightPage = new THREE.Mesh(pageGeometry("right"), rightMat);
  leftPage.receiveShadow = rightPage.receiveShadow = true;
  leftHinge.add(leftPage);
  rightHinge.add(rightPage);
  group.add(leftHinge, rightHinge);

  // 翻页:正面 = 旧右页,背面 = 新左页
  const flip = new THREE.Group();
  flip.rotation.y = -0.07;
  const flipFront = new THREE.Mesh(pageGeometry("right"), paperMat(snapTex));
  const flipBack = new THREE.Mesh(pageGeometry("back"), paperMat(tex));
  flipFront.position.z = flipBack.position.z = 0.0015;
  flip.add(flipFront, flipBack);
  flip.visible = false;
  group.add(flip);
  let flipT = -1;

  // 当前位置光标 + 当前行底色
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.05, 0.35), transparent: true, opacity: 0.9, depthWrite: false })
  );
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.13, depthWrite: false })
  );
  marker.visible = band.visible = false;
  marker.renderOrder = band.renderOrder = 2;

  // ---------- 排版 ----------
  let img = null;
  let score = null; // { systems, width, title, subtitle }
  let layout = []; // [{ index, page, dx, dy, scale, sx, sy, sw, sh }]
  let spreadStart = 0;
  let spreadNo = 0;
  let spreadStarts = [0]; // 每个跨页的第一行
  let currentSystem = -1;
  let loadToken = 0;
  let cover = null; // 无谱面时封面上显示的曲名

  function cropFor(i) {
    const s = score.systems[i];
    const prev = score.systems[i - 1];
    const next = score.systems[i + 1];
    const hgt = s.bottom - s.top;
    const pad = hgt * 0.22;
    const top = Math.max(prev ? (prev.bottom + s.top) / 2 : 0, s.top - pad);
    const bottom = Math.min(next ? (s.bottom + next.top) / 2 : score.height, s.bottom + pad);
    return { sy: top, sh: Math.max(10, bottom - top) };
  }

  function computeLayout(start) {
    const out = [];
    if (!score) return out;
    const scale = (PAGE_W - MARGIN_X * 2) / score.width;
    let page = 0;
    let y = TOP_Y + (start === 0 ? 120 : 30);
    for (let i = start; i < score.systems.length; i++) {
      const { sy, sh } = cropFor(i);
      const dh = sh * scale;
      if (y + dh > BOTTOM_Y) {
        if (page === 1) break;
        page = 1;
        y = TOP_Y;
        if (y + dh > BOTTOM_Y) break;
      }
      out.push({ index: i, page, dx: MARGIN_X, dy: y, scale, sx: 0, sy, sw: score.width, sh });
      y += dh + 22;
    }
    if (!out.length && start < score.systems.length) {
      const { sy, sh } = cropFor(start);
      const scale2 = Math.min(scale, (BOTTOM_Y - TOP_Y) / sh);
      out.push({ index: start, page: 0, dx: MARGIN_X, dy: TOP_Y, scale: scale2, sx: 0, sy, sw: score.width, sh });
    }
    return out;
  }

  function drawStaves(c, x, y, wdt, n) {
    c.strokeStyle = "rgba(40,30,20,0.55)";
    c.lineWidth = 1.4;
    for (let s = 0; s < n; s++) {
      for (let l = 0; l < 5; l++) {
        const yy = y + s * 110 + l * 12;
        c.beginPath();
        c.moveTo(x, yy);
        c.lineTo(x + wdt, yy);
        c.stroke();
      }
    }
  }

  function drawOrnament(c, cx, y, wdt) {
    c.strokeStyle = "rgba(120,80,30,0.6)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx - wdt / 2, y);
    c.lineTo(cx - 14, y);
    c.moveTo(cx + 14, y);
    c.lineTo(cx + wdt / 2, y);
    c.stroke();
    c.fillStyle = "rgba(120,80,30,0.7)";
    c.beginPath();
    c.moveTo(cx, y - 7);
    c.lineTo(cx + 8, y);
    c.lineTo(cx, y + 7);
    c.lineTo(cx - 8, y);
    c.closePath();
    c.fill();
  }

  function paintPages() {
    ctx.drawImage(base[0], 0, 0);
    ctx.drawImage(base[1], PAGE_W, 0);
    // 书脊阴影
    const spine = ctx.createLinearGradient(PAGE_W - 60, 0, PAGE_W + 60, 0);
    spine.addColorStop(0, "rgba(80,50,20,0)");
    spine.addColorStop(0.5, "rgba(80,50,20,0.28)");
    spine.addColorStop(1, "rgba(80,50,20,0)");
    ctx.fillStyle = spine;
    ctx.fillRect(PAGE_W - 60, 0, 120, PAGE_H);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (!score || !img) {
      // 空白封面页
      ctx.fillStyle = "#3b2a17";
      ctx.font = "italic 600 64px 'Cormorant Garamond', 'Noto Serif SC', Georgia, serif";
      ctx.fillText(cover ? cover.title : "Goldener Saal", PAGE_W / 2, 330, PAGE_W - 140);
      ctx.font = "34px 'Noto Serif SC', 'Songti SC', serif";
      ctx.fillText(cover ? cover.subtitle || "" : "金色大厅 · 音乐会", PAGE_W / 2, 400, PAGE_W - 140);
      drawOrnament(ctx, PAGE_W / 2, 450, 420);
      ctx.font = "28px 'Noto Serif SC', 'Songti SC', serif";
      ctx.fillStyle = "#6b5233";
      const lines = cover ? cover.lines : ["请从「乐谱柜」挑选一份乐谱", "放上谱架后将自动演奏"];
      lines.forEach((line, i) => ctx.fillText(line, PAGE_W / 2, 560 + i * 46, PAGE_W - 140));
      ctx.font = "200px serif";
      ctx.fillStyle = "rgba(90,60,30,0.18)";
      ctx.fillText("𝄞", PAGE_W / 2, 1050);
      drawStaves(ctx, PAGE_W + MARGIN_X, 170, PAGE_W - MARGIN_X * 2, 10);
      return;
    }

    if (spreadStart === 0) {
      ctx.fillStyle = "#2a1d10";
      ctx.font = "italic 600 54px 'Cormorant Garamond', 'Noto Serif SC', Georgia, serif";
      ctx.fillText(score.title, PAGE_W / 2, 132, PAGE_W - 140);
      if (score.subtitle) {
        ctx.font = "26px 'Cormorant Garamond', 'Noto Serif SC', Georgia, serif";
        ctx.fillStyle = "#5c4528";
        ctx.fillText(score.subtitle, PAGE_W / 2, 176, PAGE_W - 140);
      }
      drawOrnament(ctx, PAGE_W / 2, 206, 360);
    } else {
      ctx.font = "italic 22px 'Cormorant Garamond', Georgia, serif";
      ctx.fillStyle = "#6b5233";
      ctx.fillText(score.title, PAGE_W / 2, 84, PAGE_W - 200);
    }
    // 乐谱内容(正片叠底,黑色线条像印在纸上)
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    layout.forEach((e) => {
      const ox = e.page * PAGE_W;
      ctx.drawImage(img, e.sx, e.sy, e.sw, e.sh, ox + e.dx, e.dy, e.sw * e.scale, e.sh * e.scale);
    });
    ctx.restore();
    // 页码
    ctx.font = "22px Georgia, serif";
    ctx.fillStyle = "#6b5233";
    ctx.fillText(String(spreadNo * 2 + 1), PAGE_W / 2, PAGE_H - 46);
    ctx.fillText(String(spreadNo * 2 + 2), PAGE_W + PAGE_W / 2, PAGE_H - 46);
  }

  function redraw() {
    paintPages();
    tex.needsUpdate = true;
  }

  function startFlip(forward) {
    sctx.drawImage(canvas, 0, 0);
    snapTex.needsUpdate = true;
    if (!forward) return false;
    flip.visible = true;
    flipT = 0;
    leftMat.map = leftMat.emissiveMap = snapTex; // 翻过一半之前左页保持旧内容
    leftMat.needsUpdate = true;
    return true;
  }

  function showSpread(no, animate) {
    if (animate) startFlip(true);
    spreadNo = no;
    spreadStart = spreadStarts[no] || 0;
    layout = computeLayout(spreadStart);
    redraw();
  }

  function computeSpreadStarts() {
    spreadStarts = [];
    let start = 0;
    while (score && start < score.systems.length && spreadStarts.length < 500) {
      spreadStarts.push(start);
      const l = computeLayout(start);
      start = l.length ? l[l.length - 1].index + 1 : start + 1;
    }
    if (!spreadStarts.length) spreadStarts = [0];
  }

  function spreadOf(systemIndex) {
    let j = 0;
    while (j + 1 < spreadStarts.length && spreadStarts[j + 1] <= systemIndex) j++;
    return j;
  }

  function placeMarker(svgX) {
    const e = layout.find((l) => l.index === currentSystem);
    if (!e) {
      marker.visible = band.visible = false;
      return;
    }
    const hinge = e.page === 0 ? leftHinge : rightHinge;
    if (marker.parent !== hinge) {
      hinge.add(marker);
      hinge.add(band);
    }
    const s = score.systems[e.index];
    const toPageX = (px) => (e.page === 0 ? -w + (px / PAGE_W) * w : (px / PAGE_W) * w);
    const toPageY = (py) => h / 2 - (py / PAGE_H) * h;
    const yTop = toPageY(e.dy + (s.top - e.sy) * e.scale);
    const yBot = toPageY(e.dy + (s.bottom - e.sy) * e.scale);
    const px = e.dx + svgX * e.scale;
    const x = toPageX(px);
    marker.scale.set(0.0022, Math.abs(yTop - yBot) + 0.01, 1);
    marker.position.set(x, (yTop + yBot) / 2, bend(x) + 0.0012);
    const x0 = toPageX(e.dx), x1 = toPageX(e.dx + e.sw * e.scale);
    band.scale.set(Math.abs(x1 - x0), Math.abs(yTop - yBot) + 0.012, 1);
    band.position.set((x0 + x1) / 2, (yTop + yBot) / 2, bend((x0 + x1) / 2) + 0.0018);
    marker.visible = true;
    band.visible = true;
  }

  // ---------- 对外接口 ----------
  async function setScore({ svgEl, systems, offsetX = 0, offsetY = 0, title, subtitle, coverLines }) {
    const token = ++loadToken;
    currentSystem = -1;
    marker.visible = band.visible = false;
    if (!svgEl || !systems || !systems.length) {
      cover = title ? { title, subtitle, lines: coverLines || ["谱面无法排版", "钢琴仍会完整演奏"] } : null;
      score = null;
      img = null;
      spreadStarts = [0];
      showSpread(0, false);
      return;
    }
    const width = parseFloat(svgEl.getAttribute("width")) || svgEl.getBoundingClientRect().width;
    const height = parseFloat(svgEl.getAttribute("height")) || svgEl.getBoundingClientRect().height;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", width);
    clone.setAttribute("height", height);
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve) => {
      image.onload = resolve;
      image.onerror = resolve;
      image.src = url;
    });
    if (token !== loadToken) return;
    URL.revokeObjectURL(url);
    if (!image.naturalWidth) {
      score = null;
      img = null;
      redraw();
      return;
    }
    img = image;
    cover = null;
    score = {
      width,
      height,
      title: title || "",
      subtitle: subtitle || "",
      systems: systems.map((s) => ({ top: s.top - offsetY, bottom: s.bottom - offsetY })),
      offsetX,
      offsetY,
    };
    computeSpreadStarts();
    showSpread(0, false);
  }

  function setCursor(systemIndex, x) {
    if (!score) return;
    if (systemIndex < 0) {
      marker.visible = band.visible = false;
      return;
    }
    currentSystem = systemIndex;
    const no = spreadOf(systemIndex);
    if (no !== spreadNo) showSpread(no, no === spreadNo + 1);
    placeMarker((x || 0) - score.offsetX);
  }

  function update(dt) {
    if (flipT < 0) return;
    flipT = Math.min(1, flipT + dt / 0.9);
    const e = flipT < 0.5 ? 2 * flipT * flipT : 1 - Math.pow(-2 * flipT + 2, 2) / 2;
    flip.rotation.y = -0.07 - e * (Math.PI - 0.14);
    flip.position.z = Math.sin(e * Math.PI) * 0.03;
    if (flipT >= 0.5 && leftMat.map !== tex) {
      leftMat.map = leftMat.emissiveMap = tex;
      leftMat.needsUpdate = true;
    }
    if (flipT >= 1) {
      flip.visible = false;
      flipT = -1;
    }
  }

  redraw();
  return { group, setScore, setCursor, update, size: { w: width, h } };
}
