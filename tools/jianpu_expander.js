// 简谱 JSON → alphaTex 展开器(确定性,无 AI)。
// AI 识谱只负责"读出"每小节的和弦名/简谱数字/歌词,本文件负责全部乐谱机械转换:
// 简谱音级→吉他品位、时值展开、小节校齐、按和弦生成分解/扫弦伴奏、歌词对齐。

// ---------- 简谱音级 → MIDI(按 C 调指法记谱) ----------
const DEGREE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
// 标准调弦各弦空弦音高(记谱音,capo 由 alphaTab \capo 处理)
const STRINGS = [
  { str: 1, open: 64 }, // E4
  { str: 2, open: 59 }, // B3
  { str: 3, open: 55 }, // G3
  { str: 4, open: 50 }, // D3
  { str: 5, open: 45 }, // A2
  { str: 6, open: 40 }, // E2
];

function midiToFretString(midi) {
  // 旋律优先落在高音弦、低把位
  for (const s of STRINGS) {
    const fret = midi - s.open;
    if (fret >= 0 && fret <= 12) return { fret, str: s.str };
  }
  for (const s of STRINGS) {
    const fret = midi - s.open;
    if (fret >= 0 && fret <= 20) return { fret, str: s.str };
  }
  return null; // 太低,超出吉他音域
}

// ---------- 旋律 token 解析 ----------
// token 语法: 数字0-7 + 八度记号('升/,降,可叠) + 时值(_八分 __十六分) + 附点(.)
// "-" 单独成 token,给前一个音延长一拍;"0" 为休止。
const TOKEN_RE = /^([0-7])([',]*)(_{0,2})(\.)?$/;

function parseMelodyTokens(melody) {
  const notes = []; // { degree(0=rest), octave, quarters }
  const tokens = String(melody || "").trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok === "-") {
      if (notes.length) notes[notes.length - 1].quarters += 1;
      continue;
    }
    const m = tok.match(TOKEN_RE);
    if (!m) continue; // 忽略无法解析的 token
    const degree = parseInt(m[1], 10);
    let octave = 0;
    for (const ch of m[2]) octave += ch === "'" ? 1 : -1;
    let quarters = m[3] === "__" ? 0.25 : m[3] === "_" ? 0.5 : 1;
    if (m[4]) quarters *= 1.5;
    notes.push({ degree, octave, quarters });
  }
  return notes;
}

// ---------- 时值(四分音符数) → alphaTex 时值段 ----------
// 返回时值分段数组,首段为本音,后续段用延音线连接
const DUR_PIECES = [
  { q: 6, tex: ":1{d}" },
  { q: 4, tex: ":1" },
  { q: 3, tex: ":2{d}" },
  { q: 2, tex: ":2" },
  { q: 1.5, tex: ":4{d}" },
  { q: 1, tex: ":4" },
  { q: 0.75, tex: ":8{d}" },
  { q: 0.5, tex: ":8" },
  { q: 0.375, tex: ":16{d}" },
  { q: 0.25, tex: ":16" },
  { q: 0.125, tex: ":32" },
];

function splitDuration(quarters) {
  const pieces = [];
  let left = Math.round(quarters * 32) / 32;
  while (left > 0.01) {
    const piece = DUR_PIECES.find((p) => p.q <= left + 0.001);
    if (!piece) break;
    pieces.push(piece);
    left = Math.round((left - piece.q) * 32) / 32;
  }
  return pieces.length ? pieces : [DUR_PIECES.find((p) => p.q === 0.25)];
}

// ---------- 和弦名 → 按法 ----------
const CHORD_SHAPES = {
  C: [[3, 5], [2, 4], [0, 3], [1, 2], [0, 1]],
  C7: [[3, 5], [2, 4], [3, 3], [1, 2], [0, 1]],
  Cmaj7: [[3, 5], [2, 4], [0, 3], [0, 2], [0, 1]],
  D: [[0, 4], [2, 3], [3, 2], [2, 1]],
  Dm: [[0, 4], [2, 3], [3, 2], [1, 1]],
  D7: [[0, 4], [2, 3], [1, 2], [2, 1]],
  Dm7: [[0, 4], [2, 3], [1, 2], [1, 1]],
  Dsus4: [[0, 4], [2, 3], [3, 2], [3, 1]],
  E: [[0, 6], [2, 5], [2, 4], [1, 3], [0, 2], [0, 1]],
  Em: [[0, 6], [2, 5], [2, 4], [0, 3], [0, 2], [0, 1]],
  E7: [[0, 6], [2, 5], [0, 4], [1, 3], [0, 2], [0, 1]],
  Em7: [[0, 6], [2, 5], [2, 4], [0, 3], [3, 2], [0, 1]],
  F: [[1, 6], [3, 5], [3, 4], [2, 3], [1, 2], [1, 1]],
  Fmaj7: [[3, 4], [2, 3], [1, 2], [0, 1]],
  G: [[3, 6], [2, 5], [0, 4], [0, 3], [0, 2], [3, 1]],
  G7: [[3, 6], [2, 5], [0, 4], [0, 3], [0, 2], [1, 1]],
  Gsus4: [[3, 6], [3, 5], [0, 4], [0, 3], [1, 2], [3, 1]],
  A: [[0, 5], [2, 4], [2, 3], [2, 2], [0, 1]],
  Am: [[0, 5], [2, 4], [2, 3], [1, 2], [0, 1]],
  A7: [[0, 5], [2, 4], [0, 3], [2, 2], [0, 1]],
  Am7: [[0, 5], [2, 4], [0, 3], [1, 2], [0, 1]],
  Asus4: [[0, 5], [2, 4], [2, 3], [3, 2], [0, 1]],
  B7: [[2, 5], [1, 4], [2, 3], [0, 2], [2, 1]],
  Bm: [[2, 5], [4, 4], [4, 3], [3, 2], [2, 1]],
};

const ROOT_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function chordShape(name) {
  if (!name) return null;
  const clean = String(name).trim();
  if (CHORD_SHAPES[clean]) return CHORD_SHAPES[clean];
  // 兜底:未知和弦用 E 型横按推算(只区分大小调)
  const m = clean.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return null;
  let semi = ROOT_SEMITONES[m[1]];
  if (m[2] === "#") semi += 1;
  if (m[2] === "b") semi -= 1;
  const f = ((semi - 4) % 12 + 12) % 12; // E 型根音品位
  const minor = /^m(?!aj)/.test(m[3]);
  if (f === 0) return minor ? CHORD_SHAPES.Em : CHORD_SHAPES.E;
  return minor
    ? [[f, 6], [f + 2, 5], [f + 2, 4], [f, 3], [f, 2], [f, 1]]
    : [[f, 6], [f + 2, 5], [f + 2, 4], [f + 1, 3], [f, 2], [f, 1]];
}

function noteTex(fret, str) {
  return `${fret}.${str}`;
}

// ---------- 伴奏小节生成 ----------
function accompanimentBar(chordName, beatsPerBar, pattern) {
  const shape = chordShape(chordName);
  if (!shape) return `:1 r`;
  const sorted = [...shape].sort((a, b) => b[1] - a[1]); // 低音弦在前
  const bass = sorted[0];
  const bass2 = sorted.length > 1 ? sorted[1] : sorted[0];
  const highs = sorted.slice(-3); // 高音区三个音 [低,中,高]
  const m1 = highs[0], m2 = highs[1], m3 = highs[2];

  if (pattern === "strum") {
    // 扫弦: 每拍一个和弦,2、4 拍拆成两个八分
    const chord = `(${sorted.map(([f, s]) => noteTex(f, s)).join(" ")})`;
    const parts = [];
    for (let b = 0; b < beatsPerBar; b++) {
      if (b % 2 === 0) parts.push(`:4 ${chord}`);
      else parts.push(`:8 ${chord} ${chord}`);
    }
    return parts.join(" ");
  }

  // 默认分解(picking): 每拍两个八分,循环 低音-m1-m2-m1-次低音-m1-m3-m1
  const cycle = [bass, m1, m2, m1, bass2, m1, m3, m1];
  const notes = [];
  for (let i = 0; i < beatsPerBar * 2; i++) {
    const [f, s] = cycle[i % cycle.length];
    notes.push(noteTex(f, s));
  }
  return `:8 ${notes.join(" ")}`;
}

// ---------- 旋律小节生成 ----------
function melodyBar(bar, beatsPerBar) {
  const notes = parseMelodyTokens(bar.melody);
  // 小节校齐:总时值与拍号不符时,补休止或按比例截断
  let total = notes.reduce((sum, n) => sum + n.quarters, 0);
  if (total < beatsPerBar - 0.01) {
    notes.push({ degree: 0, octave: 0, quarters: beatsPerBar - total });
  } else if (total > beatsPerBar + 0.01 && notes.length) {
    let excess = total - beatsPerBar;
    for (let i = notes.length - 1; i >= 0 && excess > 0.01; i--) {
      const cut = Math.min(excess, notes[i].quarters - 0.25);
      if (cut > 0) {
        notes[i].quarters -= cut;
        excess -= cut;
      }
      if (excess > 0.01 && notes[i].quarters <= 0.26) {
        excess -= notes[i].quarters;
        notes.splice(i, 1);
      }
    }
  }
  if (!notes.length) return { tex: `:1 r`, noteCount: 0 };

  const parts = [];
  let noteCount = 0;
  for (const n of notes) {
    if (n.degree === 0) {
      // 休止:拆成不带附点的基础时值,逐段休止
      for (const q of restPieces(n.quarters)) parts.push(`${REST_TEX[q]} r`);
      continue;
    }
    const midi = 60 + DEGREE_SEMITONES[n.degree] + n.octave * 12;
    const pos = midiToFretString(midi);
    const pieces = splitDuration(n.quarters);
    if (!pos) {
      for (const q of restPieces(n.quarters)) parts.push(`${REST_TEX[q]} r`);
      continue;
    }
    noteCount++;
    pieces.forEach((p, i) => {
      if (i === 0) parts.push(`${p.tex} ${noteTex(pos.fret, pos.str)}`);
      else parts.push(`${p.tex} -.${pos.str}`); // 后续段用延音线
    });
  }
  return { tex: parts.join(" "), noteCount };
}

// 休止时值拆分:只用不带附点的基础时值,更稳
const REST_TEX = { 4: ":1", 2: ":2", 1: ":4", 0.5: ":8", 0.25: ":16" };
function restPieces(quarters) {
  const out = [];
  let left = Math.round(quarters * 32) / 32;
  const basics = [4, 2, 1, 0.5, 0.25];
  while (left > 0.01) {
    const q = basics.find((b) => b <= left + 0.001) || 0.25;
    out.push(q);
    left = Math.round((left - q) * 32) / 32;
  }
  return out;
}

// ---------- 主入口 ----------
// song: { title, artist, tempo, timeSig, capo, pattern, bars: [{chord, melody, lyric}] }
function songJsonToAlphaTex(song) {
  const title = String(song.title || "识谱结果").replace(/"/g, "'");
  const artist = String(song.artist || "").replace(/"/g, "'");
  const tempo = Math.min(240, Math.max(40, parseInt(song.tempo, 10) || 75));
  const tsMatch = String(song.timeSig || "4/4").match(/^(\d+)\s*\/\s*(\d+)$/);
  const tsNum = tsMatch ? parseInt(tsMatch[1], 10) : 4;
  const tsDen = tsMatch ? parseInt(tsMatch[2], 10) : 4;
  const beatsPerBar = tsNum * (4 / tsDen); // 换算成四分音符数
  const capo = Math.min(9, Math.max(0, parseInt(song.capo, 10) || 0));
  const pattern = song.pattern === "strum" ? "strum" : "picking";
  const bars = Array.isArray(song.bars) ? song.bars : [];
  if (!bars.length) throw new Error("识谱结果没有小节数据");

  const capoTex = capo > 0 ? ` \\capo ${capo}` : "";
  const lines = [];
  lines.push(`\\title "${title}"`);
  if (artist) lines.push(`\\subtitle "${artist}"`);
  lines.push(`\\tempo ${tempo}`);
  lines.push(".");

  // 旋律轨
  lines.push(`\\track "旋律 Melody"`);
  lines.push(`\\staff {score tabs} \\instrument 25${capoTex}`);
  lines.push(`\\ts ${tsNum} ${tsDen}`);
  for (const bar of bars) {
    const { tex, noteCount } = melodyBar(bar, beatsPerBar);
    const lyric = String(bar.lyric || "").trim().replace(/"/g, "'");
    const prefix = lyric && noteCount > 0 ? `\\lyrics "${lyric}" ` : "";
    lines.push(`${prefix}${tex} |`);
  }

  // 伴奏轨
  lines.push(`\\track "伴奏 Guitar"`);
  lines.push(`\\staff {tabs} \\instrument 25${capoTex}`);
  lines.push(`\\ts ${tsNum} ${tsDen}`);
  let lastChord = null;
  for (const bar of bars) {
    const chord = bar.chord ? String(bar.chord).trim() : lastChord;
    if (bar.chord) lastChord = chord;
    lines.push(`${accompanimentBar(chord, beatsPerBar, pattern)} |`);
  }

  // 去掉最后一个小节线后多余空格
  return lines.join("\n");
}

module.exports = { songJsonToAlphaTex, parseMelodyTokens, chordShape };
