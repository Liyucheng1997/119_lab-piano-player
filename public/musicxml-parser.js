// 把 MusicXML(已解包的 XML 文本)解析成可播放的音符序列。
// 输出: { notes: [{midi, start, duration, name}], totalDuration, tempo }
// start/duration 单位为秒。支持: divisions、tempo、多声部 voice、<chord>、<rest>、
// 多个 measure、step/octave/alter。tie(连音线)做了简单合并。

const MusicXMLParser = (function () {
  const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function pitchToMidi(step, octave, alter) {
    return (octave + 1) * 12 + STEP_SEMITONE[step] + (alter || 0);
  }

  function midiName(midi) {
    const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  function text(node, tag) {
    const el = node.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : null;
  }

  // .mxl 是压缩包,这里只处理已解包的纯 XML 文本
  function parse(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const parseErr = doc.getElementsByTagName("parsererror")[0];
    if (parseErr) throw new Error("MusicXML 解析失败:不是合法的 XML");

    const parts = doc.getElementsByTagName("part");
    if (!parts.length) throw new Error("未找到 <part>,可能不是 MusicXML");

    let divisions = 1; // 每四分音符的 tick 数
    let tempo = 100; // BPM,默认值
    const notes = [];

    // 先扫一遍找 tempo(可能在 <sound tempo> 或 <metronome>)
    const soundTempo = doc.querySelector("sound[tempo]");
    if (soundTempo) tempo = parseFloat(soundTempo.getAttribute("tempo")) || tempo;

    // 遍历所有 part(多个乐器/手),时间各自从 0 累计
    for (const part of parts) {
      const measures = part.getElementsByTagName("measure");
      let curTick = 0; // 当前 part 内的 tick 位置
      let prevNoteStartTick = 0; // 上一个音符的起始 tick(供和弦同起用)
      const tieOpen = {}; // midi -> 正在延续的音符对象,用于 tie 合并

      for (const measure of measures) {
        // divisions 可能在任意 measure 的 <attributes> 中更新
        const div = text(measure, "divisions");
        if (div) divisions = parseInt(div, 10) || divisions;
        const mTempo = measure.querySelector("sound[tempo]");
        if (mTempo) tempo = parseFloat(mTempo.getAttribute("tempo")) || tempo;

        const secPerTick = 60 / tempo / divisions;

        // 逐个子元素处理,以正确响应 backup/forward
        for (const child of Array.from(measure.children)) {
          const tag = child.tagName;

          if (tag === "backup") {
            curTick -= parseInt(text(child, "duration") || "0", 10);
            continue;
          }
          if (tag === "forward") {
            curTick += parseInt(text(child, "duration") || "0", 10);
            continue;
          }
          if (tag !== "note") continue;

          const note = child;
          const durTick = parseInt(text(note, "duration") || "0", 10);
          const isChord = note.getElementsByTagName("chord").length > 0;
          const isRest = note.getElementsByTagName("rest").length > 0;

          // 和弦音与前一个音符同时开始;否则从当前指针开始
          const startTick = isChord ? prevNoteStartTick : curTick;
          if (!isChord) prevNoteStartTick = curTick;

          if (!isRest) {
            const pitch = note.getElementsByTagName("pitch")[0];
            if (pitch) {
              const step = text(pitch, "step");
              const octave = parseInt(text(pitch, "octave"), 10);
              const alter = parseInt(text(pitch, "alter") || "0", 10);
              const midi = pitchToMidi(step, octave, alter);

              const tieEls = note.getElementsByTagName("tie");
              let tieStart = false, tieStop = false;
              for (const t of tieEls) {
                const ty = t.getAttribute("type");
                if (ty === "start") tieStart = true;
                if (ty === "stop") tieStop = true;
              }

              if (tieStop && tieOpen[midi]) {
                // 延续:把时值加到已有音符上
                tieOpen[midi].duration += durTick * secPerTick;
                if (!tieStart) delete tieOpen[midi];
              } else {
                const obj = {
                  midi,
                  name: midiName(midi),
                  start: startTick * secPerTick,
                  duration: durTick * secPerTick,
                };
                notes.push(obj);
                if (tieStart) tieOpen[midi] = obj;
              }
            }
          }

          // 非和弦音才推进时间
          if (!isChord) curTick += durTick;
        }
      }
    }

    notes.sort((a, b) => a.start - b.start);
    const totalDuration = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
    return { notes, totalDuration, tempo };
  }

  return { parse, midiName };
})();
