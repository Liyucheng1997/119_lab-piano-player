// 极简 Standard MIDI File 解析器(只取吉他谱转换需要的信息):音符、速度、拍号、调号。
"use strict";

function parseMidi(buf) {
  let p = 0;
  const u32 = () => (buf[p++] << 24) | (buf[p++] << 16) | (buf[p++] << 8) | buf[p++];
  const u16 = () => (buf[p++] << 8) | buf[p++];
  const vlq = () => {
    let v = 0, b;
    do {
      b = buf[p++];
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80);
    return v;
  };
  const tag = () => String.fromCharCode(buf[p++], buf[p++], buf[p++], buf[p++]);
  if (tag() !== "MThd") throw new Error("不是 MIDI 文件");
  const hlen = u32();
  const format = u16();
  const ntrks = u16();
  const division = u16();
  p = 8 + hlen;
  const notes = [];
  const tempos = [];
  const timeSigs = [];
  const keySigs = [];
  for (let t = 0; t < ntrks; t++) {
    if (tag() !== "MTrk") throw new Error("MIDI 轨道损坏");
    const len = u32();
    const end = p + len;
    let tick = 0;
    let status = 0;
    const open = new Map(); // key: ch*128+pitch -> [{start, vel}]
    while (p < end) {
      tick += vlq();
      let b = buf[p];
      if (b & 0x80) {
        status = b;
        p++;
      }
      const type = status & 0xf0;
      const ch = status & 0x0f;
      if (status === 0xff) {
        const mt = buf[p++];
        const ml = vlq();
        const data = buf.subarray(p, p + ml);
        p += ml;
        if (mt === 0x51) tempos.push({ tick, usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
        else if (mt === 0x58) timeSigs.push({ tick, num: data[0], den: 1 << data[1] });
        else if (mt === 0x59) keySigs.push({ tick, sf: data[0] > 127 ? data[0] - 256 : data[0], minor: data[1] === 1 });
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const l = vlq();
        p += l;
        continue;
      }
      if (type === 0x90 || type === 0x80) {
        const pitch = buf[p++];
        const vel = buf[p++];
        const k = ch * 128 + pitch;
        if (type === 0x90 && vel > 0) {
          if (!open.has(k)) open.set(k, []);
          open.get(k).push({ start: tick, vel });
        } else {
          const list = open.get(k);
          if (list && list.length) {
            const n = list.shift();
            notes.push({ track: t, ch, pitch, start: n.start, end: tick, vel: n.vel });
          }
        }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) p += 2;
      else if (type === 0xc0 || type === 0xd0) p += 1;
      else throw new Error("未知 MIDI 事件 0x" + status.toString(16));
    }
    p = end;
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  tempos.sort((a, b) => a.tick - b.tick);
  timeSigs.sort((a, b) => a.tick - b.tick);
  return { format, division, notes, tempos, timeSigs, keySigs };
}

module.exports = { parseMidi };
