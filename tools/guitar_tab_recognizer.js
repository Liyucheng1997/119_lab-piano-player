// 吉他谱图片识别:调用 claude CLI 无头模式读图 → 生成 alphaTex → 本地校验(可选重试)。
// 被 server.js 的 /api/recognize-guitar 使用。识别走用户已登录的 Claude 订阅,无需 API key。

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLAUDE_MAX_MS = 30 * 60 * 1000; // 单次识别绝对上限 30 分钟
const CLAUDE_STALL_MS = 5 * 60 * 1000; // 连续 5 分钟没有任何输出事件才判定卡死
const CLAUDE_MODEL = process.env.GUITAR_OCR_MODEL || "sonnet"; // 默认用较快的 sonnet,可用环境变量换 opus 等
const MAX_ATTEMPTS = 2; // 校验失败后带错误信息重试 1 次

// ---------- alphaTex 校验(依赖 devDependency @coderline/alphatab,缺失则跳过) ----------
let alphaTab = null;
try {
  alphaTab = require("@coderline/alphatab");
} catch {
  console.warn("[识谱] 未安装 @coderline/alphatab,跳过 alphaTex 语法校验(npm install 可启用)");
}

function validateAlphaTex(tex) {
  if (!alphaTab) return { ok: true };
  try {
    const settings = new alphaTab.Settings();
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(tex, settings);
    const score = importer.readScore();
    const bars = score.masterBars.length;
    if (bars < 2) return { ok: false, error: `解析成功但只有 ${bars} 个小节,疑似输出不完整` };
    return { ok: true, bars, tracks: score.tracks.length };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ---------- 识谱提示词(单页,只做"读谱"输出紧凑 JSON,转谱由本地代码完成) ----------
function buildPagePrompt(imagePath, pageNo, totalPages, songName, previousError) {
  const retrySection = previousError
    ? `\n\n【重要:上一次输出无法解析(${previousError}),请严格按格式重新输出完整 JSON】`
    : "";

  return `你是吉他谱读谱员。用 Read 工具读取这张吉他弹唱谱图片(第 ${pageNo}/${totalPages} 页${songName ? `,曲名参考: ${songName}` : ""}):
${imagePath}

谱面结构(中文弹唱谱,每行系统从上到下): 和弦名+和弦图 → 六线谱TAB(节奏型,不用转写) → 简谱数字(主旋律) → 歌词。

请逐小节读出内容,输出一个 JSON 对象(只输出 JSON,不要任何解释、不要 markdown 围栏):

{
  "title": "曲名",          // 仅第1页页首有;没有则填 ""
  "artist": "演唱者",       // 没有则填 ""
  "tempo": 72,              // 页首标注的速度;没标就按歌曲风格估一个 60~100 的值
  "timeSig": "4/4",         // 拍号
  "capo": 3,                // "变调夹第三品"→3;没写变调夹→0
  "pattern": "picking",     // 伴奏以分解和弦为主填 "picking",以扫弦为主填 "strum"
  "bars": [                 // 本页的每一个小节,按谱面顺序,一个不落
    { "chord": "Am", "melody": "3_ 5_ 6 6 1'_ 2'_ 6_ 6_", "lyric": "穿 过 旷 野 的 风 你 慢" },
    { "chord": "G",  "melody": "5 3 - 0", "lyric": "些 走" }
  ]
}

melody 字段是该小节的简谱,规则:
- 每个音一个 token,用空格分隔;数字 1~7,休止用 0。
- 数字上方的高八度点 → 数字后加 ' (如 1');下方低八度点 → 加 , (如 5,)。
- 一条下划线(八分音符)→ 加 _ (如 3_);两条下划线(十六分)→ 加 __ 。
- 数字后的附点 → 加 . (如 2._ 表示附点八分)。
- 数字后的每条横线"—"(延长一拍)→ 单独写一个 - token (如 "5 - -" 是 5 延续三拍)。
- 纯伴奏小节(前奏/间奏,简谱行是 0 或空)→ melody 填 "0 0 0 0"(按拍数),lyric 填 ""。

其他规则:
- chord: 该小节上方标注的和弦名(如 Am、Fmaj7、C);小节内换和弦只取第一个;没标就填 ""(沿用前一小节)。
- lyric: 该小节歌词,字与字之间用空格;没有歌词填 ""。
- 每小节 melody 的总拍数应等于拍号拍数(4/4 是 4 拍),对不上宁可少写音也不要编造。
- bars 必须覆盖本页全部小节,禁止省略。${retrySection}`;
}

// ---------- 输出清洗:提取 JSON ----------
function extractJson(raw) {
  if (!raw) throw new Error("空输出");
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("输出中找不到 JSON 对象");
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- 调用 claude CLI(stream-json 流式,可观测进度 + 卡死检测) ----------
function runClaude(prompt, cwd, attempt, onLog) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", CLAUDE_MODEL,
      "--allowedTools", "Read",
      "--max-turns", "60",
    ];
    const child = spawn("claude", args, { cwd, env: { ...process.env }, windowsHide: true });

    const streamLog = fs.createWriteStream(path.join(cwd, `stream-${attempt}.jsonl`));
    let buffer = "";
    let stderr = "";
    let finalResult = null;
    let assistantText = ""; // 兜底:result 事件缺失时用累计的助手文本
    let lastActivity = Date.now();
    let outputChars = 0;
    const startedAt = Date.now();
    let settled = false;

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      streamLog.end();
      if (err) reject(err);
      else resolve(value);
    }

    const watchdog = setInterval(() => {
      const now = Date.now();
      if (now - startedAt > CLAUDE_MAX_MS) {
        child.kill();
        finish(new Error(`识别超过 ${CLAUDE_MAX_MS / 60000} 分钟上限,已中止(谱页较多时可分批上传)`));
      } else if (now - lastActivity > CLAUDE_STALL_MS) {
        child.kill();
        finish(new Error(`模型连续 ${CLAUDE_STALL_MS / 60000} 分钟无响应,已中止(可能是网络或用量限制,稍后重试)`));
      }
    }, 15000);

    function handleLine(line) {
      if (!line.trim()) return;
      streamLog.write(line + "\n");
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        return;
      }
      if (evt.type === "system" && evt.subtype === "init") {
        onLog(`模型已启动(${evt.model || CLAUDE_MODEL}),开始读谱…`);
      } else if (evt.type === "assistant" && evt.message && Array.isArray(evt.message.content)) {
        for (const block of evt.message.content) {
          if (block.type === "tool_use" && block.name === "Read") {
            const file = block.input && block.input.file_path ? path.basename(block.input.file_path) : "";
            onLog(`正在阅读谱面 ${file}…`);
          } else if (block.type === "text" && block.text) {
            assistantText = block.text; // 保留最后一条完整助手文本
          }
        }
      } else if (evt.type === "stream_event" && evt.event) {
        if (evt.event.type === "content_block_delta") {
          outputChars += (evt.event.delta && (evt.event.delta.text || evt.event.delta.thinking) || "").length;
          if (outputChars > 60000) {
            child.kill();
            finish(new Error("模型输出异常膨胀,已中止"));
            return;
          }
          if (outputChars > 0 && outputChars % 2000 < 80) {
            onLog(`转写中(约${outputChars}字符)`);
          }
        }
      } else if (evt.type === "result") {
        if (evt.subtype === "success" && typeof evt.result === "string") {
          finalResult = evt.result;
        } else if (evt.is_error) {
          finalResult = null;
          stderr += `result 事件报错: ${evt.result || evt.subtype}\n`;
        }
      }
    }

    child.stdout.on("data", (d) => {
      lastActivity = Date.now();
      buffer += d.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    child.stderr.on("data", (d) => {
      lastActivity = Date.now();
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      finish(new Error(`无法启动 claude CLI: ${err.message}(请确认已安装 Claude Code 并登录)`));
    });
    child.on("close", (code) => {
      if (buffer) handleLine(buffer);
      fs.writeFileSync(path.join(cwd, `stderr-${attempt}.txt`), stderr);
      onLog(`claude 退出码 ${code}`);
      const text = finalResult !== null ? finalResult : assistantText;
      if (!text || !text.trim()) {
        finish(new Error(`claude 未产生识别结果(退出码 ${code}): ${stderr.slice(0, 300)}`));
      } else {
        finish(null, text);
      }
    });

    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}

// ---------- 单页识别(含解析失败重试) ----------
async function recognizePage(imagePath, pageNo, totalPages, songName, jobDir, onPageLog) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPagePrompt(imagePath, pageNo, totalPages, songName, lastError);
    fs.writeFileSync(path.join(jobDir, `prompt-p${pageNo}-${attempt}.txt`), prompt);
    const raw = await runClaude(prompt, jobDir, `p${pageNo}-${attempt}`, onPageLog);
    fs.writeFileSync(path.join(jobDir, `output-p${pageNo}-${attempt}.txt`), raw);
    try {
      const json = extractJson(raw);
      if (!Array.isArray(json.bars) || !json.bars.length) throw new Error("bars 为空");
      return json;
    } catch (e) {
      lastError = e.message;
      onPageLog(`第 ${pageNo} 页输出解析失败(${e.message}),重试…`);
    }
  }
  throw new Error(`第 ${pageNo} 页识别失败: ${lastError}`);
}

// ---------- 主入口 ----------
// images: [{ name, mime, buffer }],按页码顺序。各页并行识别 → 合并 → 本地展开成 alphaTex。
async function recognizeGuitarTab(images, songName, onProgress) {
  const log = (msg) => {
    console.log(`[识谱] ${msg}`);
    if (onProgress) onProgress(msg);
  };

  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "guitar-ocr-"));
  const imagePaths = images.map((img, i) => {
    const ext = img.mime === "image/png" ? ".png" : ".jpg";
    const p = path.join(jobDir, `page-${String(i + 1).padStart(2, "0")}${ext}`);
    fs.writeFileSync(p, img.buffer);
    return p;
  });
  const total = imagePaths.length;
  log(`已接收 ${total} 页图片,${total} 页并行识别中…`);

  // 每页维护一条状态,汇总成一行进度
  const pageStatus = imagePaths.map((_, i) => `第${i + 1}页:等待`);
  const reportAll = () => log(pageStatus.join(" | "));

  const pageResults = await Promise.all(
    imagePaths.map((p, i) =>
      recognizePage(p, i + 1, total, songName, jobDir, (msg) => {
        pageStatus[i] = `第${i + 1}页:${msg.replace(/^正在/, "")}`;
        reportAll();
      }).then((json) => {
        pageStatus[i] = `第${i + 1}页:完成(${json.bars.length}小节)`;
        reportAll();
        return json;
      })
    )
  );

  // 合并:元数据取第一个非空值,bars 按页序拼接
  const merged = { bars: [] };
  for (const page of pageResults) {
    for (const key of ["title", "artist", "tempo", "timeSig", "capo", "pattern"]) {
      if (merged[key] === undefined || merged[key] === "" || merged[key] === 0) {
        if (page[key] !== undefined && page[key] !== "") merged[key] = page[key];
      }
    }
    merged.bars.push(...page.bars);
  }
  if (!merged.title && songName) merged.title = songName;
  fs.writeFileSync(path.join(jobDir, "merged.json"), JSON.stringify(merged, null, 2));

  // 本地确定性展开 → alphaTex → 校验
  const { songJsonToAlphaTex } = require("./jianpu_expander");
  const tex = songJsonToAlphaTex(merged);
  fs.writeFileSync(path.join(jobDir, "result.alphatex"), tex);
  const check = validateAlphaTex(tex);
  if (!check.ok) {
    // 展开器输出理论上总是合法;若失败属于程序 bug,保留现场
    throw new Error(`展开结果校验失败(请反馈,现场在 ${jobDir}): ${check.error}`);
  }
  log(`识别完成:${merged.bars.length} 小节(任务目录 ${jobDir})`);
  return tex;
}

// ---------- 缓存 key ----------
function imagesHash(images) {
  const h = crypto.createHash("sha256");
  images.forEach((img) => h.update(img.buffer));
  return h.digest("hex").slice(0, 24);
}

module.exports = { recognizeGuitarTab, imagesHash };
