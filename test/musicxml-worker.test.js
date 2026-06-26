const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const workerPath = path.join(__dirname, "..", "public", "musicxml-worker.js");
const workerSource = fs.readFileSync(workerPath, "utf8");

function runWorker(data) {
  const messages = [];
  const context = {
    TextDecoder,
    Uint8Array,
    self: { postMessage: (message) => messages.push(message) },
  };
  vm.runInNewContext(workerSource, context, { filename: workerPath });
  assert.equal(context.DOMParser, undefined, "测试环境必须不提供 DOMParser");
  context.self.onmessage({ data });
  assert.equal(messages.length, 1);
  return messages[0];
}

test("纯 MusicXML 在没有 DOMParser 的 Worker 环境中可解析", () => {
  const xmlText = fs.readFileSync(path.join(__dirname, "..", "public", "samples", "twinkle.musicxml"), "utf8");
  const result = runWorker({ id: 1, xmlText, previewMeasureLimit: 48 });

  assert.equal(result.ok, true);
  assert.ok(result.parsed.notes.length > 0);
  assert.ok(result.parsed.totalDuration > 0);
});

test("大谱预览只保留指定数量的小节", () => {
  const measures = Array.from({ length: 50 }, (_, index) => `
    <measure number="${index + 1}">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>`).join("");
  const xmlText = `<score-partwise version="3.1"><part id="P1">${measures}</part></score-partwise>`;
  const result = runWorker({ id: 2, xmlText, previewMeasureLimit: 48 });

  assert.equal(result.ok, true);
  assert.equal(result.isPreview, true);
  assert.equal(result.measureCount, 50);
  assert.equal((result.xmlText.match(/<measure\b/g) || []).length, 48);
  assert.equal(result.parsed.notes.length, 50, "播放数据应保留完整乐谱");
});
