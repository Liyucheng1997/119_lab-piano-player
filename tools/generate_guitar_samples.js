// 生成吉他示例谱:把 alphaTex 文本谱导出为 Guitar Pro (.gp) 文件,放到 public/samples/。
// 用法:node tools/generate_guitar_samples.js

const fs = require("fs");
const path = require("path");
const alphaTab = require("@coderline/alphatab");

const OUT_DIR = path.join(__dirname, "..", "public", "samples");

const samples = [
  {
    file: "twinkle-guitar.gp",
    tex: `
\\title "小星星 Twinkle Twinkle"
\\subtitle "吉他独奏示例"
\\tempo 92
.
\\track "Acoustic Guitar" { instrument 25 }
:4 1.2 1.2 3.1 3.1 | 5.1 5.1 :2 3.1 | :4 1.1 1.1 0.1 0.1 | 3.2 3.2 :2 1.2 |
:4 3.1 3.1 1.1 1.1 | 0.1 0.1 :2 3.2 | :4 3.1 3.1 1.1 1.1 | 0.1 0.1 :2 3.2 |
:4 1.2 1.2 3.1 3.1 | 5.1 5.1 :2 3.1 | :4 1.1 1.1 0.1 0.1 | 3.2 3.2 :2 1.2
`,
  },
  {
    file: "arpeggio-am-f-c-g.gp",
    tex: `
\\title "分解和弦练习 Am-F-C-G"
\\subtitle "吉他指弹示例"
\\tempo 84
.
\\track "Acoustic Guitar" { instrument 25 }
:8 0.5 2.3 1.2 2.3 2.4 2.3 1.2 2.3 | 3.4 2.3 1.2 2.3 3.4 2.3 1.2 2.3 |
3.5 0.3 1.2 0.3 2.4 0.3 1.2 0.3 | 3.6 0.3 0.2 0.3 0.4 0.3 0.2 0.3 |
0.5 2.3 1.2 2.3 2.4 2.3 1.2 2.3 | 3.4 2.3 1.2 2.3 3.4 2.3 1.2 2.3 |
3.5 0.3 1.2 0.3 2.4 0.3 1.2 0.3 | :1 (3.5 2.4 0.3 1.2 0.1)
`,
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const sample of samples) {
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(sample.tex, settings);
  const score = importer.readScore();

  const exporter = new alphaTab.exporter.Gp7Exporter();
  const data = exporter.export(score, settings);

  const outPath = path.join(OUT_DIR, sample.file);
  fs.writeFileSync(outPath, Buffer.from(data));
  console.log(
    `✔ ${sample.file}  《${score.title}》 ${score.tracks.length} 轨, ${score.masterBars.length} 小节, ${data.length} 字节`
  );
}

// 回读校验:确认导出的 .gp 文件能被 alphaTab 正常解析
for (const sample of samples) {
  const bytes = fs.readFileSync(path.join(OUT_DIR, sample.file));
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(bytes),
    new alphaTab.Settings()
  );
  console.log(`✔ 回读成功 ${sample.file}: 《${score.title}》`);
}
