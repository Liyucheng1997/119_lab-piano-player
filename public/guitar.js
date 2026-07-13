// 吉他演奏页:alphaTab 加载 Guitar Pro 谱(gp3/gp4/gp5/gpx/gp)→ 六线谱渲染 + 合成器播放 + 光标跟随。

(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const playBtn = $("playBtn");
  const stopBtn = $("stopBtn");
  const fileInput = $("fileInput");
  const imageInput = $("imageInput");
  const downloadGpBtn = $("downloadGpBtn");
  const sampleSelect = $("sampleSelect");
  const loadSampleBtn = $("loadSampleBtn");
  const tempoSlider = $("tempoSlider");
  const tempoVal = $("tempoVal");
  const trackSelect = $("trackSelect");
  const metronomeToggle = $("metronomeToggle");
  const countInToggle = $("countInToggle");
  const loopToggle = $("loopToggle");
  const progressFill = $("progressFill");
  const progressBar = document.querySelector(".progress-bar");
  const timeLabel = $("timeLabel");
  const tabWrap = $("tabWrap");

  const CDN = "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist/";

  function setStatus(text) {
    statusEl.textContent = text;
  }

  if (typeof alphaTab === "undefined") {
    setStatus("alphaTab 库加载失败,请检查网络后刷新页面。");
    return;
  }

  // ---------- 内置示例(alphaTex 文本谱,无需外部文件) ----------
  const SAMPLE_TWINKLE = `
\\title "小星星 Twinkle Twinkle"
\\subtitle "吉他独奏示例"
\\tempo 92
.
\\track "Acoustic Guitar" { instrument 25 }
:4 1.2 1.2 3.1 3.1 | 5.1 5.1 :2 3.1 | :4 1.1 1.1 0.1 0.1 | 3.2 3.2 :2 1.2 |
:4 3.1 3.1 1.1 1.1 | 0.1 0.1 :2 3.2 | :4 3.1 3.1 1.1 1.1 | 0.1 0.1 :2 3.2 |
:4 1.2 1.2 3.1 3.1 | 5.1 5.1 :2 3.1 | :4 1.1 1.1 0.1 0.1 | 3.2 3.2 :2 1.2
`;

  const SAMPLE_ARPEGGIO = `
\\title "分解和弦练习 Am-F-C-G"
\\subtitle "吉他指弹示例"
\\tempo 84
.
\\track "Acoustic Guitar" { instrument 25 }
:8 0.5 2.3 1.2 2.3 2.4 2.3 1.2 2.3 | 3.4 2.3 1.2 2.3 3.4 2.3 1.2 2.3 |
3.5 0.3 1.2 0.3 2.4 0.3 1.2 0.3 | 3.6 0.3 0.2 0.3 0.4 0.3 0.2 0.3 |
0.5 2.3 1.2 2.3 2.4 2.3 1.2 2.3 | 3.4 2.3 1.2 2.3 3.4 2.3 1.2 2.3 |
3.5 0.3 1.2 0.3 2.4 0.3 1.2 0.3 | :1 (3.5 2.4 0.3 1.2 0.1)
`;

  const builtinSamples = [
    { title: "小星星 Twinkle(示例 · Guitar Pro 文件)", type: "url", url: "samples/twinkle-guitar.gp" },
    { title: "分解和弦练习 Am-F-C-G(示例 · Guitar Pro 文件)", type: "url", url: "samples/arpeggio-am-f-c-g.gp" },
    { title: "小星星 Twinkle(内置文本谱)", type: "tex", tex: SAMPLE_TWINKLE },
    { title: "分解和弦练习(内置文本谱)", type: "tex", tex: SAMPLE_ARPEGGIO },
  ];

  builtinSamples.forEach((s, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = s.title;
    sampleSelect.appendChild(opt);
  });

  // ---------- alphaTab 初始化 ----------
  const api = new alphaTab.AlphaTabApi($("alphaTab"), {
    core: {
      fontDirectory: CDN + "font/",
      logLevel: alphaTab.LogLevel.Warning,
      // 关闭懒加载:懒加载依赖 IntersectionObserver,在部分内嵌浏览器里不触发,
      // 且常见吉他谱体量不大,直接整谱渲染更稳。
      enableLazyLoading: false,
    },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableUserInteraction: true, // 点击谱面任意位置可跳转
      soundFont: CDN + "soundfont/sonivox.sf2",
      scrollElement: tabWrap,
      scrollOffsetY: -16,
    },
  });

  let playerReady = false;
  let scoreLoaded = false;
  let endTick = 0; // 最近一次进度事件里的总 tick,用于进度条点击定位
  let soundFontProgress = 0;

  function updatePlayButtons() {
    playBtn.disabled = !(playerReady && scoreLoaded);
    stopBtn.disabled = !(playerReady && scoreLoaded);
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------- 事件 ----------
  // 非懒加载模式下 alphaTab 只追加渲染块,重新渲染前手动清空,避免新旧谱面叠加
  api.renderStarted.on(() => {
    const surface = document.querySelector("#alphaTab .at-surface");
    if (surface) surface.innerHTML = "";
  });

  api.error.on((err) => {
    console.error("alphaTab error:", err);
    setStatus("加载或渲染出错:" + (err && err.message ? err.message : String(err)));
  });

  api.soundFontLoad.on((e) => {
    if (e.total > 0) {
      const p = Math.floor((e.loaded / e.total) * 100);
      if (p !== soundFontProgress) {
        soundFontProgress = p;
        if (!playerReady) setStatus(`正在加载吉他音色库… ${p}%`);
      }
    }
  });

  api.playerReady.on(() => {
    playerReady = true;
    updatePlayButtons();
    if (scoreLoaded) setStatus("音色库就绪,可以开始演奏。");
  });

  api.scoreLoaded.on((score) => {
    scoreLoaded = true;
    endTick = 0;
    downloadGpBtn.disabled = false;
    const title = score.title || "未命名乐谱";
    const artist = score.artist ? ` · ${score.artist}` : "";
    setStatus(
      playerReady
        ? `已加载《${title}》${artist},共 ${score.tracks.length} 条音轨,可以开始演奏。`
        : `已加载《${title}》${artist},正在准备音色库…`
    );

    // 音轨选择(多音轨时显示)
    trackSelect.innerHTML = "";
    if (score.tracks.length > 1) {
      const all = document.createElement("option");
      all.value = "-1";
      all.textContent = `全部音轨(${score.tracks.length})`;
      trackSelect.appendChild(all);
      score.tracks.forEach((t, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `音轨 ${i + 1}:${t.name || "未命名"}`;
        trackSelect.appendChild(opt);
      });
      trackSelect.hidden = false;
      trackSelect.value = "0"; // 默认只显示第一条,谱面更清爽
      api.renderTracks([score.tracks[0]]);
    } else {
      trackSelect.hidden = true;
    }
    updatePlayButtons();
  });

  trackSelect.addEventListener("change", () => {
    if (!api.score) return;
    const v = parseInt(trackSelect.value, 10);
    if (v === -1) api.renderTracks(api.score.tracks);
    else api.renderTracks([api.score.tracks[v]]);
  });

  api.playerStateChanged.on((e) => {
    const playing = e.state === alphaTab.synth.PlayerState.Playing;
    playBtn.textContent = playing ? "⏸ 暂停" : "▶ 演奏";
  });

  api.playerPositionChanged.on((e) => {
    endTick = e.endTick;
    const pct = e.endTime > 0 ? (e.currentTime / e.endTime) * 100 : 0;
    progressFill.style.width = pct.toFixed(2) + "%";
    timeLabel.textContent = `${fmtTime(e.currentTime)} / ${fmtTime(e.endTime)}`;
  });

  api.playerFinished.on(() => {
    if (!api.isLooping) {
      progressFill.style.width = "0%";
      playBtn.textContent = "▶ 演奏";
    }
  });

  // ---------- 控件 ----------
  playBtn.addEventListener("click", () => api.playPause());
  stopBtn.addEventListener("click", () => {
    api.stop();
    progressFill.style.width = "0%";
  });

  tempoSlider.addEventListener("input", () => {
    const v = parseInt(tempoSlider.value, 10);
    tempoVal.textContent = String(v);
    api.playbackSpeed = v / 100;
  });

  metronomeToggle.addEventListener("change", () => {
    api.metronomeVolume = metronomeToggle.checked ? 1 : 0;
  });
  countInToggle.addEventListener("change", () => {
    api.countInVolume = countInToggle.checked ? 1 : 0;
  });
  loopToggle.addEventListener("change", () => {
    api.isLooping = loopToggle.checked;
  });

  // 点击进度条跳转
  progressBar.addEventListener("click", (ev) => {
    if (!scoreLoaded || !endTick) return;
    const rect = progressBar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    api.tickPosition = Math.floor(frac * endTick);
  });

  // ---------- 加载乐谱 ----------
  function resetForNewScore(label) {
    scoreLoaded = false;
    updatePlayButtons();
    downloadGpBtn.disabled = true;
    progressFill.style.width = "0%";
    timeLabel.textContent = "0:00 / 0:00";
    setStatus(`正在加载 ${label} …`);
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    resetForNewScore(file.name);
    try {
      const buf = await file.arrayBuffer();
      api.load(new Uint8Array(buf)); // alphaTab 自动识别 gp3/gp4/gp5/gpx/gp/musicxml 等格式
    } catch (err) {
      console.error(err);
      setStatus("读取文件失败:" + err.message);
    }
    fileInput.value = "";
  });

  // ---------- 图片识谱(AI) ----------
  // 多张图片 = 同一首歌的多页,按文件名里的数字自然排序(如 xx1.jpg, xx2.jpg)
  function naturalSort(a, b) {
    return a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
      reader.readAsDataURL(file);
    });
  }

  function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`;
  }

  async function pollRecognizeJob(jobId) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const resp = await fetch(`/api/recognize-guitar/status?id=${encodeURIComponent(jobId)}`);
      if (!resp.ok) throw new Error(`查询识谱进度失败 HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.status === "done") return data.alphaTex;
      if (data.status === "error") throw new Error(data.error || "识谱失败");
      setStatus(`AI 识谱中(已用 ${fmtElapsed(data.elapsedMs)},视页数约 2~15 分钟):${data.message || "处理中…"}`);
    }
  }

  let recognizing = false;
  imageInput.addEventListener("change", async () => {
    const files = Array.from(imageInput.files || []);
    imageInput.value = "";
    if (!files.length || recognizing) return;
    recognizing = true;
    try {
      files.sort(naturalSort);
      // 曲名取公共前缀去掉数字后缀,如 乌兰巴托的夜1.jpg → 乌兰巴托的夜
      const name = files[0].name.replace(/\.[^.]+$/, "").replace(/[\s\-_]*\d+$/, "");
      setStatus(`正在上传 ${files.length} 张图片(${files.map((f) => f.name).join("、")})…`);

      const images = [];
      for (const f of files) {
        images.push({ name: f.name, mime: f.type || "image/jpeg", data: await fileToDataURL(f) });
      }
      const resp = await fetch("/api/recognize-guitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, images }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();

      let alphaTex;
      if (data.cached) {
        alphaTex = data.alphaTex;
        setStatus("命中识谱缓存,直接加载。");
      } else {
        setStatus("图片已上传,AI 识谱中(视页数约 2~15 分钟,请勿关闭页面)…");
        alphaTex = await pollRecognizeJob(data.jobId);
      }
      resetForNewScore(`《${name}》识谱结果`);
      api.tex(alphaTex);
    } catch (err) {
      console.error(err);
      setStatus(`图片识谱失败:${err.message}`);
    } finally {
      recognizing = false;
    }
  });

  // ---------- 下载当前乐谱为 .gp ----------
  downloadGpBtn.addEventListener("click", () => {
    if (!api.score) return;
    try {
      const exporter = new alphaTab.exporter.Gp7Exporter();
      const data = exporter.export(api.score, api.settings);
      const blob = new Blob([data], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${api.score.title || "乐谱"}.gp`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error(err);
      setStatus(`导出 .gp 失败:${err.message}`);
    }
  });

  loadSampleBtn.addEventListener("click", async () => {
    const sample = builtinSamples[parseInt(sampleSelect.value, 10)];
    if (!sample) return;
    resetForNewScore(sample.title);
    try {
      if (sample.type === "tex") {
        api.tex(sample.tex);
      } else {
        const resp = await fetch(sample.url);
        if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        api.load(new Uint8Array(buf));
      }
    } catch (err) {
      console.error(err);
      setStatus(`示例加载失败:${err.message}`);
    }
  });
})();
