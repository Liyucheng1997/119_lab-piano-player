// 程序化贴图:全部用 Canvas 现场绘制,不依赖任何外部图片。
// 金色大厅的墙面金饰、天顶油画、镶木地板、红丝绒座椅、云杉音板、纸张都在这里生成。

import * as THREE from "three";

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

export function toTexture(canvas, { repeat = [1, 1], srgb = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 在整张画布上叠加细颗粒噪声
function grain(ctx, w, h, amount, seed) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- 镶木地板(观众席) ----------
export function parquetTexture({ dark = false } = {}) {
  const [c, ctx] = makeCanvas(1024, 1024);
  const r = rng(dark ? 77 : 11);
  const base = dark ? [62, 38, 22] : [128, 82, 46];
  const plankW = 1024 / 8;
  for (let col = 0; col < 8; col++) {
    let y = -r() * 300;
    while (y < 1024) {
      const len = 220 + r() * 260;
      const k = 0.82 + r() * 0.3;
      ctx.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
      ctx.fillRect(col * plankW, y, plankW, len);
      // 木纹
      for (let g = 0; g < 14; g++) {
        const gx = col * plankW + r() * plankW;
        ctx.strokeStyle = `rgba(${dark ? 20 : 60},${dark ? 10 : 32},${dark ? 5 : 14},${0.08 + r() * 0.14})`;
        ctx.lineWidth = 0.6 + r() * 1.6;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.bezierCurveTo(gx + (r() - 0.5) * 18, y + len * 0.33, gx + (r() - 0.5) * 18, y + len * 0.66, gx + (r() - 0.5) * 10, y + len);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(20,10,4,0.55)";
      ctx.fillRect(col * plankW, y, plankW, 2);
      y += len;
    }
    ctx.fillStyle = "rgba(20,10,4,0.6)";
    ctx.fillRect(col * plankW, 0, 2, 1024);
  }
  grain(ctx, 1024, 1024, 14, 5);
  return c;
}

// ---------- 墙面:奶油色底 + 金色画框 + 卷草纹(同时输出金属度/粗糙度贴图) ----------
export function ornamentWall() {
  const W = 512, H = 1024;
  const [c, ctx] = makeCanvas(W, H);
  const [m, mctx] = makeCanvas(W, H); // G=粗糙度 B=金属度

  ctx.fillStyle = "#c79a4a";
  ctx.fillRect(0, 0, W, H);
  mctx.fillStyle = "rgb(0,110,200)"; // 底层也是鎏金
  mctx.fillRect(0, 0, W, H);

  // 内嵌奶油色面板
  const panels = [
    [40, 40, W - 80, 380],
    [40, 470, W - 80, 510],
  ];
  const r = rng(3);
  panels.forEach(([x, y, w, h]) => {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#ead7a6");
    g.addColorStop(1, "#d9bf86");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    mctx.fillStyle = "rgb(0,215,30)";
    mctx.fillRect(x, y, w, h);
    // 浮雕画框
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 1 ? "#f3d27a" : "#8a6224";
      ctx.lineWidth = i === 1 ? 6 : 3;
      ctx.strokeRect(x + i * 6, y + i * 6, w - i * 12, h - i * 12);
      mctx.strokeStyle = "rgb(0,70,255)";
      mctx.lineWidth = i === 1 ? 6 : 3;
      mctx.strokeRect(x + i * 6, y + i * 6, w - i * 12, h - i * 12);
    }
    // 锦缎暗纹:细小的菱形花格,只比底色深一点
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 20, y + 20, w - 40, h - 40);
    ctx.clip();
    for (let gy = y + 30; gy < y + h; gy += 34) {
      for (let gx = x + 30 + ((gy / 34) % 2) * 17; gx < x + w; gx += 34) {
        ctx.fillStyle = "rgba(160,118,52,0.22)";
        ctx.beginPath();
        ctx.moveTo(gx, gy - 7);
        ctx.lineTo(gx + 5, gy);
        ctx.lineTo(gx, gy + 7);
        ctx.lineTo(gx - 5, gy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    // 中央椭圆徽章:金色细框 + 四片叶饰
    const cx = x + w / 2, cy = y + h / 2;
    const rx = Math.min(70, w * 0.2), ry = Math.min(95, h * 0.22);
    ctx.fillStyle = "rgba(236,214,160,0.9)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    [[5, "#8a6224"], [2.5, "#f3d27a"]].forEach(([lw, col]) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    mctx.strokeStyle = "rgb(0,70,255)";
    mctx.lineWidth = 6;
    mctx.beginPath();
    mctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    mctx.stroke();
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      const leaf = ctx.createLinearGradient(0, 0, 0, -ry * 0.75);
      leaf.addColorStop(0, "#c9963c");
      leaf.addColorStop(1, "#f4d68a");
      ctx.fillStyle = leaf;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.quadraticCurveTo(14, -ry * 0.4, 0, -ry * 0.72);
      ctx.quadraticCurveTo(-14, -ry * 0.4, 0, -6);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "#e7bd5c";
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    // 四角扇形花饰
    [[x + 22, y + 22, 0], [x + w - 22, y + 22, Math.PI / 2], [x + w - 22, y + h - 22, Math.PI], [x + 22, y + h - 22, -Math.PI / 2]].forEach(([px, py, rot]) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.strokeStyle = "#b8862f";
      ctx.lineWidth = 2;
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, k * 9, 0, Math.PI / 2);
        ctx.stroke();
      }
      ctx.fillStyle = "#e4b955";
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  });
  grain(ctx, W, H, 10, 9);
  return { map: c, mr: m };
}

// ---------- 鎏金饰带(檐口、楼座栏板) ----------
export function goldFrieze() {
  const [c, ctx] = makeCanvas(1024, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#f3cf72");
  g.addColorStop(0.18, "#a87a2c");
  g.addColorStop(0.5, "#d9a94a");
  g.addColorStop(0.82, "#8b6122");
  g.addColorStop(1, "#f0c76a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 128);
  // 重复的棕榈叶/卵箭饰
  for (let x = 0; x < 1024; x += 64) {
    ctx.fillStyle = "#6e4a17";
    ctx.beginPath();
    ctx.ellipse(x + 32, 64, 18, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6d683";
    ctx.beginPath();
    ctx.ellipse(x + 32, 62, 12, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#7a531b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 28);
    ctx.lineTo(x, 100);
    ctx.stroke();
  }
  grain(ctx, 1024, 128, 12, 21);
  return c;
}

// ---------- 天顶油画(云层 + 暖光 + 朦胧人物) ----------
export function ceilingPainting(seed = 1) {
  const W = 512, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const r = rng(seed * 97 + 13);
  const g = ctx.createRadialGradient(W * (0.3 + r() * 0.4), H * (0.3 + r() * 0.4), 20, W / 2, H / 2, W * 0.8);
  g.addColorStop(0, "#f7e2b0");
  g.addColorStop(0.45, "#a9b6b8");
  g.addColorStop(1, "#5a6a73");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 云团
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 90;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const warm = r() > 0.5;
    cg.addColorStop(0, warm ? "rgba(255,236,200,0.55)" : "rgba(235,232,225,0.45)");
    cg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // 古典人物剪影(神话场景的朦胧轮廓)
  for (let i = 0; i < 4; i++) {
    const x = 80 + r() * (W - 160), y = 120 + r() * (H - 220);
    const s = 0.6 + r() * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((r() - 0.5) * 1.2);
    ctx.scale(s, s);
    const tone = ["rgba(186,120,92,0.55)", "rgba(120,80,110,0.5)", "rgba(210,170,130,0.55)", "rgba(90,110,140,0.5)"][i % 4];
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(0, -46, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-16, -30);
    ctx.quadraticCurveTo(-34, 30, -24, 70);
    ctx.lineTo(28, 70);
    ctx.quadraticCurveTo(30, 20, 16, -30);
    ctx.closePath();
    ctx.fill();
    // 飘带
    ctx.strokeStyle = "rgba(214,90,70,0.45)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-20, -10);
    ctx.bezierCurveTo(-70, -30, -60, 40, -110, 20);
    ctx.stroke();
    ctx.restore();
  }
  grain(ctx, W, H, 18, seed);
  // 画框
  ctx.strokeStyle = "#6b4716";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, W - 10, H - 10);
  ctx.strokeStyle = "#f2c968";
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  return c;
}

// ---------- 红丝绒 ----------
export function velvetTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = "#7a1018";
  ctx.fillRect(0, 0, 256, 256);
  const r = rng(41);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(${r() > 0.5 ? "170,40,50" : "40,0,6"},${0.08 + r() * 0.1})`;
    ctx.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3);
  }
  grain(ctx, 256, 256, 16, 4);
  return c;
}

// ---------- 云杉音板 ----------
export function spruceTexture() {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = "#d9b77a";
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(8);
  for (let x = 0; x < 512; x += 2 + r() * 5) {
    ctx.strokeStyle = `rgba(150,100,45,${0.18 + r() * 0.3})`;
    ctx.lineWidth = 0.6 + r() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (r() - 0.5) * 6, 512);
    ctx.stroke();
  }
  // 音板拼条的接缝
  for (let x = 0; x < 512; x += 64) {
    ctx.fillStyle = "rgba(120,80,35,0.25)";
    ctx.fillRect(x, 0, 1.5, 512);
  }
  grain(ctx, 512, 512, 10, 6);
  return c;
}

// ---------- 铭牌(金色烫字) ----------
export function nameboardTexture() {
  const [c, ctx] = makeCanvas(1024, 96);
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, 1024, 96);
  const g = ctx.createLinearGradient(0, 20, 0, 80);
  g.addColorStop(0, "#fff0b8");
  g.addColorStop(0.5, "#d4a443");
  g.addColorStop(1, "#8f6421");
  ctx.fillStyle = g;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic 600 50px 'Cormorant Garamond', 'Playfair Display', Georgia, serif";
  ctx.fillText("Aurelius  ·  Wien", 512, 44);
  ctx.font = "500 14px Georgia, serif";
  ctx.fillText("CONCERT GRAND  ·  MODELL 280", 512, 82);
  return c;
}

// ---------- 纸张底纹(乐谱纸) ----------
export function paperBase(w, h, seed = 7) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = "#f2e8cf";
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  // 纤维
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = r() * w, y = r() * h;
    ctx.strokeStyle = `rgba(150,120,70,${0.04 + r() * 0.06})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30);
    ctx.stroke();
  }
  // 旧纸斑点
  for (let i = 0; i < 22; i++) {
    const x = r() * w, y = r() * h, rad = 4 + r() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(170,120,60,0.10)");
    g.addColorStop(1, "rgba(170,120,60,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // 边缘泛黄
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(150,105,45,0.32)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 9, seed + 1);
  return c;
}

// ---------- 光晕精灵(吊灯灯泡、烛光) ----------
export function glowSprite() {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,250,230,1)");
  g.addColorStop(0.2, "rgba(255,220,150,0.8)");
  g.addColorStop(0.5, "rgba(255,180,90,0.18)");
  g.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}
