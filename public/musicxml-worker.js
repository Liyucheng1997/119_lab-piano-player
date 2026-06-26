// MusicXML 解压、播放数据解析与预览截取都在 Worker 中执行。
// 某些浏览器的 Worker 没有 DOMParser，因此这里刻意只使用字符串扫描。

const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PART_RE = /<part\b[^>]*>[\s\S]*?<\/part\s*>/gi;
const MEASURE_RE = /<measure\b[^>]*>[\s\S]*?<\/measure\s*>/gi;

function midiName(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

function tagText(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*</${tag}\\s*>`, "i").exec(xml);
  return match ? match[1].trim() : null;
}

function hasTag(xml, tag) {
  return new RegExp(`<${tag}\\b`, "i").test(xml);
}

function soundTempo(xml) {
  const match = /<sound\b[^>]*\btempo\s*=\s*["']([^"']+)["'][^>]*>/i.exec(xml);
  return match ? Number.parseFloat(match[1]) : null;
}

function parseNotes(xmlText) {
  if (!/<score-(?:partwise|timewise)\b/i.test(xmlText)) {
    throw new Error("MusicXML 解析失败:不是合法的 MusicXML");
  }
  const parts = xmlText.match(PART_RE) || [];
  if (!parts.length) throw new Error("未找到 <part>,可能不是 MusicXML");

  let divisions = 1;
  let tempo = soundTempo(xmlText) || 100;
  const notes = [];

  for (const part of parts) {
    const measures = part.match(MEASURE_RE) || [];
    let curTick = 0;
    let prevNoteStartTick = 0;
    const tieOpen = {};

    for (const measure of measures) {
      const div = tagText(measure, "divisions");
      if (div) divisions = Number.parseInt(div, 10) || divisions;
      const measureTempo = soundTempo(measure);
      if (measureTempo) tempo = measureTempo || tempo;
      const secPerTick = 60 / tempo / divisions;

      const events = measure.match(/<note\b[^>]*>[\s\S]*?<\/note\s*>|<backup\b[^>]*>[\s\S]*?<\/backup\s*>|<forward\b[^>]*>[\s\S]*?<\/forward\s*>/gi) || [];
      for (const event of events) {
        const type = /^<\s*([^\s/>]+)/i.exec(event)?.[1].toLowerCase();
        if (type === "backup") {
          curTick -= Number.parseInt(tagText(event, "duration") || "0", 10);
          continue;
        }
        if (type === "forward") {
          curTick += Number.parseInt(tagText(event, "duration") || "0", 10);
          continue;
        }
        if (type !== "note") continue;

        const durTick = Number.parseInt(tagText(event, "duration") || "0", 10);
        const isChord = hasTag(event, "chord");
        const isRest = hasTag(event, "rest");
        const startTick = isChord ? prevNoteStartTick : curTick;
        if (!isChord) prevNoteStartTick = curTick;

        if (!isRest) {
          const pitchMatch = /<pitch\b[^>]*>([\s\S]*?)<\/pitch\s*>/i.exec(event);
          if (pitchMatch) {
            const pitch = pitchMatch[1];
            const step = tagText(pitch, "step");
            const octave = Number.parseInt(tagText(pitch, "octave"), 10);
            const alter = Number.parseInt(tagText(pitch, "alter") || "0", 10);
            if (step in STEP_SEMITONE && Number.isFinite(octave)) {
              const midi = (octave + 1) * 12 + STEP_SEMITONE[step] + alter;
              const ties = [...event.matchAll(/<tie\b[^>]*\btype\s*=\s*["']([^"']+)["'][^>]*>/gi)];
              const tieStart = ties.some((tie) => tie[1] === "start");
              const tieStop = ties.some((tie) => tie[1] === "stop");
              if (tieStop && tieOpen[midi]) {
                tieOpen[midi].duration += durTick * secPerTick;
                if (!tieStart) delete tieOpen[midi];
              } else {
                const note = {
                  midi,
                  name: midiName(midi),
                  start: startTick * secPerTick,
                  duration: durTick * secPerTick,
                };
                notes.push(note);
                if (tieStart) tieOpen[midi] = note;
              }
            }
          }
        }
        if (!isChord) curTick += durTick;
      }
    }
  }
  notes.sort((a, b) => a.start - b.start);
  return {
    notes,
    totalDuration: notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0),
    tempo,
  };
}

function decodeMxl(arrayBuffer) {
  if (typeof fflate === "undefined") {
    importScripts("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js");
  }
  const files = fflate.unzipSync(new Uint8Array(arrayBuffer));
  const decoder = new TextDecoder("utf-8");
  let target = null;

  if (files["META-INF/container.xml"]) {
    const containerXml = decoder.decode(files["META-INF/container.xml"]);
    const rootfile = /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["'][^>]*>/i.exec(containerXml);
    if (rootfile && files[rootfile[1]]) target = rootfile[1];
  }
  if (!target) {
    target = Object.keys(files).find(
      (name) => !name.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(name)
    );
  }
  if (!target) throw new Error(".mxl 内未找到 MusicXML 文件");
  return decoder.decode(files[target]);
}

function createPreview(xmlText, maxMeasures) {
  const parts = xmlText.match(PART_RE) || [];
  const measureCount = parts.reduce(
    (max, part) => Math.max(max, (part.match(MEASURE_RE) || []).length),
    0
  );
  if (measureCount <= maxMeasures) return { xmlText, measureCount, isPreview: false };

  return {
    xmlText: xmlText.replace(PART_RE, (part) => {
      let index = 0;
      return part.replace(MEASURE_RE, (measure) => (++index <= maxMeasures ? measure : ""));
    }),
    measureCount,
    isPreview: true,
  };
}

self.onmessage = ({ data }) => {
  const { id, xmlText, mxlBuffer, previewMeasureLimit } = data;
  try {
    const fullXmlText = mxlBuffer ? decodeMxl(mxlBuffer) : xmlText;
    if (!fullXmlText) throw new Error("未读取到 MusicXML 内容");
    const parsed = parseNotes(fullXmlText);
    const preview = createPreview(fullXmlText, previewMeasureLimit);
    self.postMessage({ id, ok: true, fullXmlText, parsed, ...preview });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || String(error) });
  }
};
