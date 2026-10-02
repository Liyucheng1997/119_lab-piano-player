// 构建吉他曲库:把 Mutopia Project(公有领域 / CC 授权)的古典吉他乐谱 MIDI 转成可弹奏的六线谱(.gp)。
//
//   node tools/build_guitar_library.js
//
// 流程:MIDI(由 LilyPond 刻谱源生成,音高/节奏准确)→ 量化成拍点 → 动态规划自动分配弦与品位
//       (控制把位跨度、换把距离、避免切断仍在延音的低音)→ 生成 alphaTex → alphaTab 导入校验
//       → 回放比对每个音都与原 MIDI 一致 → 导出 Guitar Pro 7 文件 + manifest.json。
// 源文件下载到 data/guitar-sources/(见 PIECES 里的 url),输出到 public/guitar/library/。

"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const alphaTab = require("@coderline/alphatab");
const { parseMidi } = require("./lib/midi");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "data", "guitar-sources");
const OUT_DIR = path.join(ROOT, "public", "guitar", "library");
const MUTOPIA = "https://www.mutopiaproject.org/ftp/";

const TUNINGS = {
  standard: { names: ["E4", "B3", "G3", "D3", "A2", "E2"], midi: [64, 59, 55, 50, 45, 40], label: "标准调弦" },
  dropD: { names: ["E4", "B3", "G3", "D3", "A2", "D2"], midi: [64, 59, 55, 50, 45, 38], label: "Drop D(六弦降 D)" },
  openG: { names: ["D4", "B3", "G3", "D3", "G2", "D2"], midi: [62, 59, 55, 50, 43, 38], label: "开放 G 调弦" },
};

// 曲目表:精选旋律优美、流传最广的古典吉他独奏曲
const PIECES = [
  { id: "spanish-romance", path: "Anonymous/spanish-romance/spanish-romance", title: "爱的罗曼史", original: "Romance (Spanish Romance)", composer: "Anonymous", composerZh: "佚名(西班牙传统)", license: "CC BY-SA 2.5", level: "入门" },
  { id: "adelita", path: "TarregaF/adelita/adelita", title: "阿德丽塔", original: "Adelita", composer: "Francisco Tárrega", composerZh: "塔雷加", license: "CC BY-SA 2.5", level: "进阶" },
  { id: "recuerdos", path: "TarregaF/recuerdos/recuerdos", title: "阿尔罕布拉宫的回忆", original: "Recuerdos de la Alhambra", composer: "Francisco Tárrega", composerZh: "塔雷加", license: "CC BY-SA 3.0", level: "演奏级", noLy: true },
  { id: "capricho-arabe", path: "TarregaF/capricho-arabe/capricho-arabe", title: "阿拉伯风格随想曲", original: "Capricho Árabe", composer: "Francisco Tárrega", composerZh: "塔雷加", license: "CC BY-SA 4.0", level: "演奏级" },
  { id: "claro-de-luna", path: "TarregaF/claro-de-luna/claro-de-luna", title: "月光(《月光奏鸣曲》第一乐章)", original: "Claro de Luna", composer: "L. v. Beethoven · arr. F. Tárrega", composerZh: "贝多芬 / 塔雷加 改编", license: "Public Domain", level: "进阶" },
  { id: "faure-sicilienne", path: "FaureG/O78/faure-sicilienne-guitare-doigtee/faure-sicilienne-guitare-doigtee", title: "西西里舞曲", original: "Sicilienne, Op. 78", composer: "Gabriel Fauré", composerZh: "福雷", license: "Public Domain", level: "进阶" },
  { id: "sor-op35-22", path: "SorF/O35/sorf_op35_no22/sorf_op35_no22", title: "b 小调练习曲 Op.35 No.22", original: "Study in B minor, Op. 35 No. 22", composer: "Fernando Sor", composerZh: "索尔", license: "CC BY-SA 3.0", level: "进阶" },
  { id: "sor-op5-5", path: "SorF/O5/sor-op5-5/sor-op5-5", title: "广板行板 Op.5 No.5", original: "Andante Largo, Op. 5 No. 5", composer: "Fernando Sor", composerZh: "索尔", license: "CC BY-SA 2.5", level: "进阶" },
  { id: "sor-op35-6", path: "SorF/O35/sorf_op35_no6/sorf_op35_no6", title: "练习曲 Op.35 No.6", original: "Study, Op. 35 No. 6", composer: "Fernando Sor", composerZh: "索尔", license: "CC BY-SA 3.0", level: "入门" },
  { id: "bach-bourree", path: "BachJS/BWV1006a/bwv-1006a_6g/bwv-1006a_6g", title: "布列舞曲 BWV 1006a", original: "Bourrée, BWV 1006a", composer: "J. S. Bach", composerZh: "巴赫", license: "CC BY-SA 3.0", level: "进阶" , tempo: 112 },
  { id: "bach-gavotte", path: "BachJS/BWV1006a/bwv-1006a_3g/bwv-1006a_3g", title: "回旋加沃特 BWV 1006a", original: "Gavotte en Rondeau, BWV 1006a", composer: "J. S. Bach", composerZh: "巴赫", license: "CC BY-SA 3.0", level: "进阶" , tempo: 126 },
  { id: "bach-loure", path: "BachJS/BWV1006a/bwv-1006a_2g/bwv-1006a_2g", title: "卢尔舞曲 BWV 1006a", original: "Loure, BWV 1006a", composer: "J. S. Bach", composerZh: "巴赫", license: "CC BY-SA 3.0", level: "进阶" , tempo: 84 },
  { id: "bach-preludio-1006a", path: "BachJS/BWV1006a/bwv-1006a_1g/bwv-1006a_1g", title: "前奏曲 BWV 1006a", original: "Preludio, BWV 1006a", composer: "J. S. Bach", composerZh: "巴赫", license: "CC BY-SA 3.0", level: "演奏级" , tempo: 104 },
  { id: "bach-prelude-997", path: "BachJS/BWV997/Bach_Preludio_BWV997/Bach_Preludio_BWV997", title: "前奏曲 BWV 997", original: "Prelude, BWV 997", composer: "J. S. Bach", composerZh: "巴赫", license: "Public Domain", level: "进阶" },
  { id: "bach-menuet-g", path: "BachJS/BWVAnh114/anna-magdalena-04-guitar-tab/anna-magdalena-04-guitar-tab", title: "G 大调小步舞曲", original: "Menuet in G, BWV Anh. 114", composer: "J. S. Bach (attr.)", composerZh: "巴赫", license: "Public Domain", level: "入门" },
  { id: "stille-nacht", path: "GruberFX/stille-nacht/stille-nacht", title: "平安夜", original: "Stille Nacht", composer: "Franz Xaver Gruber", composerZh: "格鲁伯", license: "CC BY-SA 2.0", level: "入门" , tempo: 80 },
  { id: "spanish-fandango", path: "WorrallH/SpanishFandango1882/SpanishFandango1882", title: "西班牙方丹戈", original: "Spanish Fandango", composer: "Henry Worrall", composerZh: "沃拉尔", license: "Public Domain", level: "入门", tuning: "openG" },
  { id: "carcassi-op60-7", path: "CarcassiM/O60/carcassi-op60-07/carcassi-op60-07", title: "卡尔卡西练习曲 Op.60 No.7", original: "Étude, Op. 60 No. 7", composer: "Matteo Carcassi", composerZh: "卡尔卡西", license: "Public Domain", level: "进阶" },
  { id: "mertz-etude", path: "MertzJK/mertz_etude/mertz_etude", title: "a 小调练习曲", original: "Etude in A minor", composer: "Johann Kaspar Mertz", composerZh: "梅尔茨", license: "Public Domain", level: "入门" },
  { id: "aguado-study", path: "AguadoD/aminor-study/aminor-study", title: "a 小调练习曲", original: "Study in A minor", composer: "Dionisio Aguado", composerZh: "阿瓜多", license: "CC BY-SA 3.0", level: "入门" },
  { id: "brahms-waltz-3", path: "BrahmsJ/O39/brahms-vals3/brahms-vals3", title: "圆舞曲 Op.39 No.3", original: "Waltz, Op. 39 No. 3", composer: "Johannes Brahms", composerZh: "勃拉姆斯", license: "Public Domain", level: "入门" },
  { id: "carulli-waltz", path: "CarulliF/guitar-skole-no-01/guitar-skole-no-01", title: "圆舞曲 Op.241 No.1", original: "Waltz, Op. 241 No. 1", composer: "Ferdinando Carulli", composerZh: "卡鲁里", license: "CC BY 4.0", level: "入门", noLy: true },
  { id: "sanz-preludio", path: "SanzG/sanz-1/sanz-1", title: "前奏曲", original: "Preludio", composer: "Gaspar Sanz", composerZh: "桑斯", license: "Public Domain", level: "入门" },
  { id: "galilei-saltarello", path: "GalileiV/saltarello/saltarello", title: "萨尔塔雷洛舞曲", original: "Saltarello", composer: "Vincenzo Galilei", composerZh: "伽利雷", license: "Public Domain", level: "入门" },
];

const MAX_FRET = 19;
const GRID = 16; // 量化网格:384 分辨率下的 1/24 四分音符(兼容三连音与 32 分音符)

// ---------- 下载 ----------
function download(url, file) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(download(res.headers.location, file));
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          fs.writeFileSync(file, Buffer.concat(chunks));
          resolve();
        });
      })
      .on("error", reject);
  });
}

async function ensureSource(piece) {
  fs.mkdirSync(SRC_DIR, { recursive: true });
  const base = path.basename(piece.path);
  const mid = path.join(SRC_DIR, base + ".mid");
  const ly = path.join(SRC_DIR, base + ".ly");
  if (!fs.existsSync(mid)) await download(MUTOPIA + piece.path + ".mid", mid);
  if (!piece.noLy && !fs.existsSync(ly)) await download(MUTOPIA + piece.path + ".ly", ly).catch(() => {});
  return { mid, ly: fs.existsSync(ly) ? fs.readFileSync(ly, "utf8") : "" };
}

// ---------- 时值 ----------
// 384 分辨率下可用的单个时值:[tick, alphaTex 时值, 附点, 三连音]
const DUR_PLAIN = [
  [2304, 1, true], [1536, 1, false], [1152, 2, true], [768, 2, false], [576, 4, true], [384, 4, false],
  [288, 8, true], [192, 8, false], [144, 16, true], [96, 16, false], [48, 32, false],
];
const DUR_TRIPLET = [[512, 2], [256, 4], [128, 8], [64, 16], [32, 32], [16, 64]];

function decompose(len, div) {
  const k = 384 / div;
  const L = Math.round(len * k);
  const out = [];
  let rest = L;
  const usePlain = L % 48 === 0;
  let guard = 0;
  while (rest > 0 && guard++ < 64) {
    let pick = null;
    if (usePlain || rest % 48 === 0) {
      for (const [t, d, dot] of DUR_PLAIN) if (t <= rest) { pick = { t, d, dot, tup: false }; break; }
    }
    if (!pick) {
      for (const [t, d] of DUR_TRIPLET) if (t <= rest && (rest - t) % 16 === 0) { pick = { t, d, dot: false, tup: true }; break; }
    }
    if (!pick) pick = { t: rest, d: 64, dot: false, tup: true };
    out.push(pick);
    rest -= pick.t;
  }
  return out;
}

function durText(p) {
  const eff = [];
  if (p.dot) eff.push("d");
  if (p.tup) eff.push("tu 3");
  return "." + p.d + (eff.length ? "{" + eff.join(" ") + "}" : "");
}

// ---------- 指法分配(动态规划) ----------
function candidatesFor(pitches, tuning) {
  // pitches 降序;弦序 0 = 一弦(最高)。音高越高的音放在越细的弦上(弦号单调递增)。
  const res = [];
  const n = pitches.length;
  const cur = new Array(n);
  (function rec(i, minString) {
    if (res.length > 400) return;
    if (i === n) {
      res.push(cur.slice());
      return;
    }
    for (let s = minString; s < tuning.length; s++) {
      const f = pitches[i] - tuning[s];
      if (f < 0 || f > MAX_FRET) continue;
      cur[i] = { s, f };
      rec(i + 1, s + 1);
    }
  })(0, 0);
  return res;
}

function localCost(cand) {
  const fretted = cand.filter((x) => x.f > 0).map((x) => x.f);
  let cost = 0;
  if (fretted.length) {
    const lo = Math.min(...fretted), hi = Math.max(...fretted);
    const span = hi - lo;
    if (span > 4) cost += 40 * (span - 4);
    if (span > 5) cost += 1000;
    cost += 0.12 * lo + 0.04 * fretted.reduce((a, b) => a + b, 0);
    if (hi > 12) cost += 0.4 * (hi - 12);
  }
  cost -= 0.35 * (cand.length - fretted.length); // 空弦好弹也好听
  const bass = cand[cand.length - 1];
  if (bass && bass.f === 0 && cand.length > 1) cost -= 0.6; // 低音优先用空弦(吉他手的习惯)
  if (cand.length && cand[0].s > 2) cost += 1.2; // 旋律(最高音)尽量在高音弦
  return cost;
}

function handPos(cand, prev) {
  const fretted = cand.filter((x) => x.f > 0).map((x) => x.f);
  return fretted.length ? Math.min(...fretted) : prev;
}

function assignFingering(groups, tuning) {
  // groups: [{ tick, pitches:[desc], ends:[] }]
  let states = [{ cost: 0, pos: 1, busy: new Array(tuning.length).fill(null), back: null, cand: [] }];
  const history = [];
  for (const g of groups) {
    let pitches = g.pitches.slice();
    let cands = candidatesFor(pitches, tuning);
    // 和弦弹不下:优先舍弃内声部
    while (!cands.length && pitches.length > 1) {
      pitches.splice(Math.floor(pitches.length / 2), 1);
      cands = candidatesFor(pitches, tuning);
    }
    g.used = pitches;
    if (!cands.length) {
      history.push(states);
      g.dropped = true;
      continue;
    }
    cands = cands.map((c) => ({ c, lc: localCost(c) })).sort((a, b) => a.lc - b.lc).slice(0, 48);
    const next = [];
    for (const { c, lc } of cands) {
      let best = null;
      for (const st of states) {
        let cost = st.cost + lc;
        const pos = handPos(c, st.pos);
        cost += 0.35 * Math.abs(pos - st.pos);
        // 切断仍在延音的音(例如长低音)要付出代价
        for (const x of c) {
          const b = st.busy[x.s];
          if (b && b.end > g.tick + GRID && b.pitch !== pitches[c.indexOf(x)]) cost += 3;
        }
        if (!best || cost < best.cost) best = { cost, st, pos };
      }
      const busy = best.st.busy.slice();
      c.forEach((x, i) => (busy[x.s] = { end: g.ends[g.pitches.indexOf(pitches[i])] ?? g.tick, pitch: pitches[i] }));
      next.push({ cost: best.cost, pos: best.pos, busy, back: best.st, cand: c, group: g });
    }
    history.push(next);
    states = next;
  }
  // 回溯
  let st = states.reduce((a, b) => (a.cost <= b.cost ? a : b));
  while (st && st.group) {
    st.group.assign = st.cand;
    st = st.back;
  }
}

// ---------- 主流程 ----------
function parsePartial(ly, div) {
  const m = /\\partial\s+(\d+)(\.?)(?:\*(\d+))?/.exec(ly);
  if (!m) return 0;
  let len = (4 / parseInt(m[1], 10)) * div;
  if (m[2]) len *= 1.5;
  if (m[3]) len *= parseInt(m[3], 10);
  return Math.round(len);
}

function keyName(sf) {
  return ["cb", "gb", "db", "ab", "eb", "bb", "f", "c", "g", "d", "a", "e", "b", "f#", "c#"][sf + 7] || "c";
}

function texString(s) {
  return s.replace(/\\/g, "").replace(/"/g, "'");
}

async function buildPiece(piece) {
  const src = await ensureSource(piece);
  const midi = parseMidi(fs.readFileSync(src.mid));
  const div = midi.division;
  let notes = midi.notes.map((n) => ({ ...n }));
  // 吉他记谱比实际高八度:有的刻谱用了普通高音谱号,MIDI 会高出一个八度
  const lo = Math.min(...notes.map((n) => n.pitch));
  const hi = Math.max(...notes.map((n) => n.pitch));
  const tuningKey = piece.tuning || (lo - (lo >= 50 || hi > 86 ? 12 : 0) < 40 ? "dropD" : "standard");
  const tuning = TUNINGS[tuningKey];
  const shift = lo >= 50 || hi > 86 ? -12 : 0;
  notes.forEach((n) => (n.pitch += shift));

  // 弱起小节:在开头补休止,让小节线对齐
  const ts0 = midi.timeSigs[0] || { num: 4, den: 4 };
  const bar0 = Math.round(ts0.num * (4 / ts0.den) * div);
  const partial = parsePartial(src.ly, div);
  const pad = partial > 0 && partial < bar0 ? bar0 - partial : 0;
  const q = (t) => Math.round(t / GRID) * GRID;
  notes.forEach((n) => {
    n.start = q(n.start + pad);
    n.end = Math.max(n.start + GRID, q(n.end + pad));
  });
  const timeSigs = midi.timeSigs.map((t) => ({ ...t, tick: t.tick === 0 ? 0 : q(t.tick + pad) }));
  let tempos = midi.tempos.map((t) => ({ tick: t.tick === 0 ? 0 : q(t.tick + pad), bpm: 60e6 / t.usPerQuarter }));
  // 源文件没写速度时 LilyPond 默认 60,按常见演奏速度覆盖(其余速度变化按比例缩放)
  if (piece.tempo && tempos.length) {
    const k = piece.tempo / tempos[0].bpm;
    tempos = tempos.map((t) => ({ ...t, bpm: t.bpm * k }));
  }
  tempos = tempos.map((t) => ({ ...t, bpm: Math.round(t.bpm) }));

  // 同一拍点去重,合并成"拍点组"
  const byTick = new Map();
  for (const n of notes) {
    if (!byTick.has(n.start)) byTick.set(n.start, new Map());
    const m = byTick.get(n.start);
    if (!m.has(n.pitch) || m.get(n.pitch).end < n.end) m.set(n.pitch, n);
  }
  const groups = [...byTick.keys()]
    .sort((a, b) => a - b)
    .map((tick) => {
      const ns = [...byTick.get(tick).values()].sort((a, b) => b.pitch - a.pitch);
      return { tick, pitches: ns.map((n) => n.pitch), ends: ns.map((n) => n.end) };
    });
  // 超出吉他音域的音移八度
  groups.forEach((g) => {
    g.pitches = g.pitches.map((p) => {
      while (p < tuning.midi[tuning.midi.length - 1]) p += 12;
      while (p > tuning.midi[0] + MAX_FRET) p -= 12;
      return p;
    });
  });
  groups.forEach((g) => {
    const seen = new Set();
    const keep = [];
    g.pitches.forEach((p, i) => {
      if (!seen.has(p)) {
        seen.add(p);
        keep.push(i);
      }
    });
    g.pitches = keep.map((i) => g.pitches[i]);
    g.ends = keep.map((i) => g.ends[i]);
  });
  assignFingering(groups, tuning.midi);

  // 小节划分
  const endTick = Math.max(...notes.map((n) => n.end));
  const bars = [];
  let t = 0;
  let tsIdx = 0;
  let cur = ts0;
  while (t < endTick) {
    while (tsIdx < timeSigs.length && timeSigs[tsIdx].tick <= t) cur = timeSigs[tsIdx++];
    const len = Math.round(cur.num * (4 / cur.den) * div);
    bars.push({ start: t, end: t + len, ts: cur });
    t += len;
  }

  // 生成 alphaTex
  const meta = [
    `\\title "${texString(piece.title)}"`,
    `\\subtitle "${texString(piece.original)}"`,
    `\\artist "${texString(piece.composer)}"`,
    `\\copyright "${texString("Mutopia Project · " + piece.license)}"`,
    `\\tempo ${tempos.length ? tempos[0].bpm : 90}`,
    ".",
    `\\track "Classical Guitar"`,
    `\\staff {score tabs}`,
    `\\tuning ${tuning.names.join(" ")}`,
    `\\instrument 24`,
    ".",
  ];
  const ks = midi.keySigs[0] ? keyName(midi.keySigs[0].sf) : "c";
  const groupAt = new Map(groups.filter((g) => g.assign).map((g) => [g.tick, g]));
  const barTexts = [];
  let prevTs = null;
  let lastTempo = tempos.length ? tempos[0].bpm : 90;
  let lastNotes = []; // 上一个发声拍的音(用于延音连线)
  bars.forEach((bar, bi) => {
    const parts = [];
    if (bi === 0) parts.push(`\\ks ${ks}`);
    if (!prevTs || prevTs.num !== bar.ts.num || prevTs.den !== bar.ts.den) parts.push(`\\ts ${bar.ts.num} ${bar.ts.den}`);
    prevTs = bar.ts;
    const tc = tempos.filter((x) => x.tick >= bar.start && x.tick < bar.end).pop();
    if (tc && Math.abs(tc.bpm - lastTempo) >= 1 && bi > 0) {
      parts.push(`\\tempo ${tc.bpm}`);
      lastTempo = tc.bpm;
    }
    const onsets = [...groupAt.keys()].filter((k) => k >= bar.start && k < bar.end).sort((a, b) => a - b);
    const cuts = [bar.start, ...onsets.filter((k) => k > bar.start), bar.end];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const pieces = decompose(b - a, div);
      const g = groupAt.get(a);
      let pos = a;
      pieces.forEach((pc, k) => {
        let body;
        if (k === 0 && g) {
          const ns = g.assign.map((x) => `${x.f}.${x.s + 1}`);
          body = ns.length === 1 ? ns[0] : `(${ns.join(" ")})`;
          lastNotes = g.assign.map((x, j) => ({ ...x, end: g.ends[g.pitches.indexOf(g.used[j])] }));
        } else {
          // 没有新起音:上一拍里仍在发声的音用延音线连过来;都停了才写休止
          const held = lastNotes.filter((x) => x.end > pos);
          if (held.length) {
            const ns = held.map((x) => `-.${x.s + 1}`);
            body = ns.length === 1 ? ns[0] : `(${ns.join(" ")})`;
            lastNotes = held;
          } else {
            body = "r";
            lastNotes = [];
          }
        }
        parts.push(body + durText(pc));
        pos += Math.round((pc.t * div) / 384);
      });
    }
    barTexts.push(parts.join(" "));
  });
  const tex = meta.join("\n") + "\n" + barTexts.join(" |\n");
  if (process.env.DUMP_TEX) fs.writeFileSync(path.join(SRC_DIR, piece.id + ".tex"), tex);

  // 导入校验
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, settings);
  const score = importer.readScore();

  // 回放比对:alphaTab 生成的每个起音(拍点、音高)必须与源 MIDI 对齐
  const played = [];
  const tempoEv = [];
  const handler = {
    addTimeSignature() {}, addRest() {}, addControlChange() {}, addProgramChange() {}, addNoteBend() {}, addBend() {}, finishTrack() {}, addTickShift() {},
    addTempo(tick, bpm) { tempoEv.push({ tick, bpm }); },
    addNote(track, start, length, key) { played.push({ start, key }); },
  };
  new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
  const scale = 960 / div;
  const expected = [];
  groups.forEach((g) => (g.used || g.pitches).forEach((p) => g.assign && expected.push(`${g.tick * scale}:${p}`)));
  const got = new Set(played.map((p) => `${p.start}:${p.key}`));
  const missing = expected.filter((e) => !got.has(e));
  const sourceNotes = groups.reduce((s, g) => s + g.pitches.length, 0);
  const droppedNotes = sourceNotes - expected.length;

  const data = new alphaTab.exporter.Gp7Exporter().export(score, settings);
  fs.writeFileSync(path.join(OUT_DIR, piece.id + ".gp"), Buffer.from(data));

  // 时长
  let ms = 0;
  const lastTick = Math.max(...played.map((p) => p.start));
  const tl = tempoEv.length ? tempoEv : [{ tick: 0, bpm: 90 }];
  for (let i = 0; i < tl.length; i++) {
    const a = tl[i].tick, b = i + 1 < tl.length ? Math.min(tl[i + 1].tick, lastTick) : lastTick;
    if (b > a) ms += ((b - a) / 960) * (60000 / tl[i].bpm);
  }
  const allFrets = groups.filter((g) => g.assign).flatMap((g) => g.assign.map((x) => x.f));
  return {
    entry: {
      id: piece.id,
      title: piece.title,
      original: piece.original,
      composer: piece.composer,
      composerZh: piece.composerZh,
      level: piece.level,
      tuning: tuning.label,
      bars: bars.length,
      notes: played.length,
      durationSec: Math.round(ms / 1000),
      tempo: tempos.length ? tempos[0].bpm : 90,
      license: piece.license,
      source: `https://www.mutopiaproject.org/ftp/${piece.path}.ly`,
      url: `guitar/library/${piece.id}.gp`,
    },
    report: { missing: missing.length, dropped: droppedNotes, maxFret: Math.max(...allFrets), shift, pad },
  };
}

(async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const works = [];
  let failed = 0;
  for (const piece of PIECES) {
    try {
      const { entry, report } = await buildPiece(piece);
      works.push(entry);
      const ok = report.missing === 0;
      if (!ok) failed++;
      console.log(
        `${ok ? "✔" : "✘"} ${piece.id.padEnd(22)} ${String(entry.bars).padStart(3)} 小节 ${String(entry.notes).padStart(5)} 音 ${String(entry.durationSec).padStart(4)}s ${entry.tuning}` +
          ` | 最高 ${report.maxFret} 品 | 移八度 ${report.shift} | 弱起补 ${report.pad} | 舍弃 ${report.dropped} | 比对缺失 ${report.missing}`
      );
    } catch (e) {
      failed++;
      console.log(`✘ ${piece.id}: ${e.message}`);
    }
  }
  const manifest = {
    source: "Mutopia Project(公有领域 / Creative Commons 授权),由 tools/build_guitar_library.js 自动转换为六线谱",
    generatedAt: new Date().toISOString(),
    count: works.length,
    works,
  };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n共 ${works.length} 首,${failed} 首有问题。输出:${path.relative(ROOT, OUT_DIR)}`);
  process.exitCode = failed ? 1 : 0;
})();
