const fs = require("node:fs");
const path = require("node:path");

const outPath = path.join(__dirname, "..", "public", "samples", "mozartian-sunlit-allegro.musicxml");
const DIVISIONS = 8;

function esc(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function pitchXml(pitch) {
  if (!pitch || pitch.rest) return "<rest/>";
  const alter = pitch.alter ? `<alter>${pitch.alter}</alter>` : "";
  return `<pitch><step>${pitch.step}</step>${alter}<octave>${pitch.octave}</octave></pitch>`;
}

function typeFor(duration) {
  return {
    2: "16th",
    4: "eighth",
    6: "eighth",
    8: "quarter",
    12: "quarter",
    16: "half",
    24: "half",
    32: "whole",
  }[duration] || "quarter";
}

function note(pitch, duration, staff, voice = staff) {
  const dot = duration === 6 || duration === 12 || duration === 24 ? "<dot/>" : "";
  return [
    "      <note>",
    `        ${pitchXml(pitch)}`,
    `        <duration>${duration}</duration>`,
    `        <voice>${voice}</voice>`,
    `        <type>${typeFor(duration)}</type>${dot}`,
    `        <staff>${staff}</staff>`,
    "      </note>",
  ].join("\n");
}

function chordNote(pitch, duration, staff, voice = staff) {
  return [
    "      <note>",
    "        <chord/>",
    `        ${pitchXml(pitch)}`,
    `        <duration>${duration}</duration>`,
    `        <voice>${voice}</voice>`,
    `        <type>${typeFor(duration)}</type>`,
    `        <staff>${staff}</staff>`,
    "      </note>",
  ].join("\n");
}

function backup(duration = 32) {
  return `      <backup><duration>${duration}</duration></backup>`;
}

const P = {
  C3: { step: "C", octave: 3 },
  D3: { step: "D", octave: 3 },
  E3: { step: "E", octave: 3 },
  F3: { step: "F", octave: 3 },
  Fs3: { step: "F", alter: 1, octave: 3 },
  G2: { step: "G", octave: 2 },
  G3: { step: "G", octave: 3 },
  A2: { step: "A", octave: 2 },
  A3: { step: "A", octave: 3 },
  B2: { step: "B", octave: 2 },
  B3: { step: "B", octave: 3 },
  C4: { step: "C", octave: 4 },
  Cs4: { step: "C", alter: 1, octave: 4 },
  D4: { step: "D", octave: 4 },
  Ds4: { step: "D", alter: 1, octave: 4 },
  E4: { step: "E", octave: 4 },
  F4: { step: "F", octave: 4 },
  Fs4: { step: "F", alter: 1, octave: 4 },
  G4: { step: "G", octave: 4 },
  Gs4: { step: "G", alter: 1, octave: 4 },
  A4: { step: "A", octave: 4 },
  B4: { step: "B", octave: 4 },
  C5: { step: "C", octave: 5 },
  Cs5: { step: "C", alter: 1, octave: 5 },
  D5: { step: "D", octave: 5 },
  E5: { step: "E", octave: 5 },
  F5: { step: "F", octave: 5 },
  Fs5: { step: "F", alter: 1, octave: 5 },
  G5: { step: "G", octave: 5 },
  A5: { step: "A", octave: 5 },
  B5: { step: "B", octave: 5 },
  C6: { step: "C", octave: 6 },
};

const chords = {
  C: [P.C3, P.G3, P.E3, P.G3, P.C3, P.G3, P.E3, P.G3],
  G: [P.G2, P.D4, P.B3, P.D4, P.G2, P.D4, P.B3, P.D4],
  G7: [P.G2, P.F4, P.B3, P.F4, P.G2, P.D4, P.B3, P.D4],
  F: [P.F3, P.C4, P.A3, P.C4, P.F3, P.C4, P.A3, P.C4],
  Dm: [P.D3, P.A3, P.F3, P.A3, P.D3, P.A3, P.F3, P.A3],
  Am: [P.A2, P.E3, P.C3, P.E3, P.A2, P.E3, P.C3, P.E3],
  E7: [P.E3, P.D4, P.Gs3 || P.G3, P.D4, P.E3, P.B3, P.Gs3 || P.G3, P.B3],
  D: [P.D3, P.A3, P.Fs3, P.A3, P.D3, P.A3, P.Fs3, P.A3],
};
P.Gs3 = { step: "G", alter: 1, octave: 3 };
chords.E7 = [P.E3, P.D4, P.Gs3, P.D4, P.E3, P.B3, P.Gs3, P.B3];

function leftAlberti(name) {
  return chords[name].map((p) => note(p, 4, 2, 2)).join("\n");
}

function leftCadence(root, third, fifth) {
  return [
    note(root, 8, 2, 2),
    chordNote(third, 8, 2, 2),
    chordNote(fifth, 8, 2, 2),
    note(root, 8, 2, 2),
    chordNote(third, 8, 2, 2),
    chordNote(fifth, 8, 2, 2),
    note(root, 16, 2, 2),
    chordNote(third, 16, 2, 2),
    chordNote(fifth, 16, 2, 2),
  ].join("\n");
}

const themes = {
  a1: [[P.E4, 4], [P.G4, 4], [P.C5, 8], [P.B4, 4], [P.A4, 4], [P.G4, 8]],
  a2: [[P.F4, 4], [P.A4, 4], [P.D5, 8], [P.C5, 4], [P.B4, 4], [P.G4, 8]],
  a3: [[P.E4, 4], [P.G4, 4], [P.C5, 4], [P.E5, 4], [P.D5, 4], [P.B4, 4], [P.G4, 8]],
  a4: [[P.C5, 8], [P.E5, 8], [P.G5, 8], [P.E5, 4], [P.D5, 4]],
  b1: [[P.D5, 4], [P.E5, 4], [P.Fs5, 4], [P.G5, 4], [P.A5, 4], [P.G5, 4], [P.Fs5, 4], [P.E5, 4]],
  b2: [[P.D5, 8], [P.B4, 4], [P.G4, 4], [P.A4, 8], [P.Fs4, 4], [P.D4, 4]],
  b3: [[P.G4, 4], [P.B4, 4], [P.D5, 4], [P.G5, 4], [P.Fs5, 4], [P.E5, 4], [P.D5, 8]],
  c1: [[P.A4, 4], [P.C5, 4], [P.E5, 8], [P.D5, 4], [P.C5, 4], [P.B4, 8]],
  c2: [[P.Gs4, 4], [P.B4, 4], [P.E5, 8], [P.D5, 4], [P.C5, 4], [P.B4, 8]],
  f1: [[P.C5, 4], [P.A4, 4], [P.F4, 8], [P.G4, 4], [P.A4, 4], [P.C5, 8]],
  cadC: [[P.G4, 4], [P.E5, 4], [P.D5, 4], [P.B4, 4], [P.C5, 16]],
  cadG: [[P.A4, 4], [P.Fs5, 4], [P.E5, 4], [P.C5, 4], [P.B4, 16]],
  final: [[P.C5, 4], [P.E5, 4], [P.G5, 4], [P.C6, 4], [P.G5, 4], [P.E5, 4], [P.C5, 8]],
};

function rightTheme(name) {
  return themes[name].map(([p, d]) => note(p, d, 1, 1)).join("\n");
}

function rightRun(notes) {
  return notes.map((p) => note(p, 2, 1, 1)).join("\n");
}

function rightBroken(notes) {
  const seq = [];
  for (let i = 0; i < 4; i += 1) seq.push(...notes);
  return seq.slice(0, 16).map((p) => note(p, 2, 1, 1)).join("\n");
}

const measures = [
  ["C", "a1"], ["G7", "a2"], ["C", "a3"], ["G7", "cadC"],
  ["C", "a1"], ["F", "a2"], ["G7", "a3"], ["C", "a4"],
  ["G", "b1"], ["D", "b2"], ["G", "b3"], ["D", "cadG"],
  ["G", "b1"], ["C", "a3"], ["D", "b2"], ["G", "cadG"],
  ["Am", "c1"], ["E7", "c2"], ["Am", "c1"], ["Dm", "f1"],
  ["G7", "cadC"], ["C", "a1"], ["F", "a2"], ["G7", "cadC"],
  ["C", "runCUp"], ["F", "runFDown"], ["G7", "brokenG"], ["C", "cadC"],
  ["Am", "runAm"], ["Dm", "runDm"], ["G7", "brokenG"], ["C", "a4"],
  ["C", "a1"], ["G7", "a2"], ["C", "a3"], ["G7", "cadC"],
  ["F", "f1"], ["C", "a1"], ["Dm", "runDm"], ["G7", "cadC"],
  ["G", "b1"], ["D", "b2"], ["G", "b3"], ["D", "cadG"],
  ["G7", "brokenG"], ["C", "a3"], ["F", "f1"], ["G7", "cadC"],
  ["Am", "c1"], ["E7", "c2"], ["Am", "runAm"], ["F", "f1"],
  ["Dm", "runDm"], ["G7", "brokenG"], ["C", "a1"], ["G7", "cadC"],
  ["C", "a3"], ["F", "a2"], ["Dm", "f1"], ["G7", "brokenG"],
  ["C", "a4"], ["G7", "cadC"], ["C", "final"], ["C", "finalChord"],
];

const runs = {
  runCUp: [P.C5, P.D5, P.E5, P.F5, P.G5, P.A5, P.B5, P.C6, P.B5, P.A5, P.G5, P.F5, P.E5, P.D5, P.C5, P.B4],
  runFDown: [P.C6, P.A5, P.F5, P.E5, P.D5, P.C5, P.A4, P.F4, P.G4, P.A4, P.B4, P.C5, P.D5, P.E5, P.F5, P.A5],
  runAm: [P.A4, P.B4, P.C5, P.D5, P.E5, P.C5, P.A4, P.E4, P.A4, P.C5, P.E5, P.A5, P.G5, P.E5, P.C5, P.A4],
  runDm: [P.D5, P.E5, P.F5, P.G5, P.A5, P.F5, P.D5, P.A4, P.D5, P.F5, P.A5, P.C6, P.B5, P.A5, P.G5, P.F5],
  brokenG: [P.G4, P.B4, P.D5, P.F5],
};

function rightMaterial(name) {
  if (name === "finalChord") {
    return [
      note(P.C5, 32, 1, 1),
      chordNote(P.E5, 32, 1, 1),
      chordNote(P.G5, 32, 1, 1),
      chordNote(P.C6, 32, 1, 1),
    ].join("\n");
  }
  if (runs[name]) return name === "brokenG" ? rightBroken(runs[name]) : rightRun(runs[name]);
  return rightTheme(name);
}

function keyChange(index) {
  if (index === 9 || index === 41) return "        <key><fifths>1</fifths></key>";
  if (index === 17 || index === 49) return "        <key><fifths>0</fifths></key>";
  return "";
}

function measureXml([left, right], index) {
  const number = index + 1;
  const attrs = number === 1 || keyChange(number)
    ? [
        "      <attributes>",
        number === 1 ? `        <divisions>${DIVISIONS}</divisions>` : "",
        number === 1 ? "        <key><fifths>0</fifths></key>" : keyChange(number),
        number === 1 ? "        <time><beats>4</beats><beat-type>4</beat-type></time>" : "",
        number === 1 ? "        <staves>2</staves>" : "",
        number === 1 ? "        <clef number=\"1\"><sign>G</sign><line>2</line></clef>" : "",
        number === 1 ? "        <clef number=\"2\"><sign>F</sign><line>4</line></clef>" : "",
        "      </attributes>",
      ].filter(Boolean).join("\n")
    : "";
  const tempo = number === 1
    ? [
        "      <direction placement=\"above\">",
        "        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>144</per-minute></metronome></direction-type>",
        "        <sound tempo=\"144\"/>",
        "      </direction>",
      ].join("\n")
    : "";
  const rightXml = rightMaterial(right);
  const leftXml = right === "finalChord" ? leftCadence(P.C3, P.E3, P.G3) : leftAlberti(left);
  const end = number === measures.length
    ? "      <barline location=\"right\"><bar-style>light-heavy</bar-style></barline>"
    : "";

  return [
    `    <measure number="${number}">`,
    attrs,
    tempo,
    rightXml,
    backup(),
    leftXml,
    end,
    "    </measure>",
  ].filter(Boolean).join("\n");
}

const body = measures.map(measureXml).join("\n");
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Mozartian Sunlit Allegro</work-title></work>
  <identification>
    <creator type="composer">Codex, original classical-style study</creator>
    <rights>Original MusicXML sample for local playback testing.</rights>
    <encoding><software>Codex MusicXML Writer</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
${body}
  </part>
</score-partwise>
`;

fs.writeFileSync(outPath, xml, "utf8");
console.log(`Wrote ${esc(outPath)} (${measures.length} measures)`);
