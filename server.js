// 静态服务器 + 吉他谱图片 AI 识别接口:node server.js,然后访问 http://localhost:5173
// 静态部分零依赖;/api/recognize-guitar 需要本机安装并登录 Claude Code CLI。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { recognizeGuitarTab, imagesHash } = require("./tools/guitar_tab_recognizer");

const PORT = process.env.PORT || 5173;
const ROOT = path.join(__dirname, "public");
const OCR_CACHE_DIR = path.join(__dirname, "data", "guitar-ocr-cache");
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024; // 多页高清照片上限 60MB

// 识谱任务表:jobId → { status: running|done|error, message, alphaTex, error, startedAt }
const ocrJobs = new Map();
let ocrJobSeq = 0;
let ocrQueue = Promise.resolve(); // 串行执行,避免多个 claude 进程并发抢占

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error("上传体积超过限制"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

// POST /api/recognize-guitar  { name, images: [{name, mime, data(base64)}] }
async function handleRecognizeGuitar(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  const list = Array.isArray(body.images) ? body.images : [];
  if (!list.length) return sendJson(res, 400, { error: "缺少图片" });

  let images;
  try {
    images = list.map((img, i) => {
      const base64 = String(img.data || "").replace(/^data:[^,]*,/, "");
      const buffer = Buffer.from(base64, "base64");
      if (!buffer.length) throw new Error(`第 ${i + 1} 张图片数据为空`);
      return { name: img.name || `page-${i + 1}`, mime: img.mime || "image/jpeg", buffer };
    });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  // 命中缓存直接返回
  const hash = imagesHash(images);
  const cacheFile = path.join(OCR_CACHE_DIR, `${hash}.alphatex`);
  if (fs.existsSync(cacheFile)) {
    return sendJson(res, 200, { cached: true, alphaTex: fs.readFileSync(cacheFile, "utf8") });
  }

  const jobId = `job-${Date.now()}-${++ocrJobSeq}`;
  const job = { status: "running", message: "已加入识谱队列…", startedAt: Date.now() };
  ocrJobs.set(jobId, job);

  ocrQueue = ocrQueue
    .then(() =>
      recognizeGuitarTab(images, body.name || "", (msg) => {
        job.message = msg;
      })
    )
    .then((alphaTex) => {
      fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, alphaTex, "utf8");
      job.status = "done";
      job.alphaTex = alphaTex;
    })
    .catch((err) => {
      job.status = "error";
      job.error = err.message;
      console.error("[识谱] 失败:", err.message);
    });

  sendJson(res, 200, { jobId });
}

// GET /api/recognize-guitar/status?id=xxx
function handleRecognizeStatus(req, res, urlObj) {
  const id = urlObj.searchParams.get("id");
  const job = ocrJobs.get(id);
  if (!job) return sendJson(res, 404, { error: "任务不存在" });
  sendJson(res, 200, {
    status: job.status,
    message: job.message,
    elapsedMs: Date.now() - job.startedAt,
    alphaTex: job.status === "done" ? job.alphaTex : undefined,
    error: job.error,
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".musicxml": "application/vnd.recordare.musicxml+xml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".mxl": "application/vnd.recordare.musicxml",
  ".mxl_": "application/vnd.recordare.musicxml",
  ".gp": "application/octet-stream",
  ".gp3": "application/octet-stream",
  ".gp4": "application/octet-stream",
  ".gp5": "application/octet-stream",
  ".gpx": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);

  // ---------- API ----------
  if (req.method === "POST" && urlObj.pathname === "/api/recognize-guitar") {
    return handleRecognizeGuitar(req, res);
  }
  if (req.method === "GET" && urlObj.pathname === "/api/recognize-guitar/status") {
    return handleRecognizeStatus(req, res, urlObj);
  }

  // ---------- 静态文件 ----------
  let urlPath = decodeURIComponent(urlObj.pathname);
  if (urlPath === "/") urlPath = "/index.html";

  // 防目录穿越
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found: " + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🎹 钢琴演奏 Demo 运行中: http://localhost:${PORT}`);
});
