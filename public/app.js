// 主逻辑:加载 MusicXML → OSMD 渲染 + 解析音符 → Tone.js 调度演奏 + 钢琴键盘高亮。

(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const playBtn = $("playBtn");
  const pauseBtn = $("pauseBtn");
  const stopBtn = $("stopBtn");
  const progressFill = $("progressFill");
  const timeLabel = $("timeLabel");
  const tempoSlider = $("tempoSlider");
  const tempoVal = $("tempoVal");
  const scoreZoomSlider = $("scoreZoomSlider");
  const scoreZoomVal = $("scoreZoomVal");
  const seriesSelect = $("seriesSelect");
  const scoreSearch = $("scoreSearch");
  const sampleSelect = $("sampleSelect");
  const libraryCount = $("libraryCount");
  const fullScoreBtn = $("fullScoreBtn");

  const PREVIEW_MEASURE_LIMIT = 48;

  let osmd = null;
  let sampler = null;
  let samplerReady = false;
  let parsed = null; // { notes, totalDuration, tempo }
  let scheduledIds = [];
  let rafId = null;
  let tempoScale = 1.0; // 速度倍率
  let scoreZoom = 0.9; // 乐谱缩放倍率,双手谱默认略缩小以显示完整系统
  let cursorTimes = []; // 每个光标步对应的时间(秒,原速),用于同步五线谱光标
  let cursorPositions = []; // 每步的屏幕位置 {x, y, time, index},用于点击定位
  let scoreSystems = []; // 每个乐谱系统的位置 {top, bottom, height}
  let cursorIndex = 0; // 当前光标已推进到第几步
  let curLineTop = null; // 当前系统的纵向位置
  let currentScore = null; // { fullXmlText, parsed, label, isPreview }
  let loadSequence = 0;
  let workerRequestId = 0;
  const pendingWorkerRequests = new Map();
  let musicWorker = null;

  function ensureMusicWorker() {
    if (musicWorker) return musicWorker;
    musicWorker = new Worker("musicxml-worker.js");
    musicWorker.onmessage = ({ data }) => {
      const request = pendingWorkerRequests.get(data.id);
      if (!request) return;
      pendingWorkerRequests.delete(data.id);
      if (data.ok) request.resolve(data);
      else request.reject(new Error(data.error));
    };
    musicWorker.onerror = (event) => {
      const error = new Error(event.message || "后台乐谱解析器启动失败");
      pendingWorkerRequests.forEach(({ reject }) => reject(error));
      pendingWorkerRequests.clear();
      musicWorker.terminate();
      musicWorker = null;
    };
    return musicWorker;
  }

  function prepareMusicXML(payload) {
    const id = ++workerRequestId;
    return new Promise((resolve, reject) => {
      pendingWorkerRequests.set(id, { resolve, reject });
      const message = { id, previewMeasureLimit: PREVIEW_MEASURE_LIMIT, ...payload };
      const worker = ensureMusicWorker();
      if (payload.mxlBuffer) worker.postMessage(message, [payload.mxlBuffer]);
      else worker.postMessage(message);
    });
  }

  const builtinSamples = [
    { title: "小星星 Twinkle", url: "samples/twinkle.musicxml", type: "musicxml" },
    { title: "欢乐颂 Ode to Joy", url: "samples/ode-to-joy.musicxml", type: "musicxml" },
    { title: "致爱丽丝 Fur Elise", url: "samples/fur-elise.musicxml", type: "musicxml" },
    { title: "生日快乐 Happy Birthday", url: "samples/happy-birthday.musicxml", type: "musicxml" },
    { title: "铃儿响叮当 Jingle Bells", url: "samples/jingle-bells.musicxml", type: "musicxml" },
  ];

  const librarySeries = [
    { id: "builtin", label: "示例系列", works: builtinSamples, loaded: true },
    { id: "openewld", label: "OpenEWLD", manifestUrl: "openewld/manifest.json", works: [], loaded: false },
    { id: "musetrainer", label: "MuseTrainer", manifestUrl: "musetrainer/manifest.json", works: [], loaded: false },
  ];

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#ff8585" : "var(--muted)";
  }

  function fmtTime(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function applyScoreZoom() {
    scoreZoom = parseInt(scoreZoomSlider.value, 10) / 100;
    scoreZoomVal.textContent = scoreZoomSlider.value;
    if (!osmd) return;
    // OSMD 使用 Zoom/zoom 缩放内部 SVG,这样光标位置、点击定位和滚动仍在同一坐标系里。
    osmd.Zoom = scoreZoom;
    osmd.zoom = scoreZoom;
  }

  function rerenderScoreLayout(options = {}) {
    if (!osmd || !parsed) return;
    const wasPlaying = Tone.Transport.state === "started";
    if (wasPlaying) stopPlayback();
    applyScoreZoom();
    osmd.render();
    buildCursorTimeline({ autoFit: options.autoFit !== false });
    scrollCursorIntoView();
    updateProgress(0);
  }

  function optionText(item) {
    const author = item.authors ? " - " + item.authors : "";
    const meta = [item.metric, item.tonality].filter(Boolean).join(", ");
    return item.title + author + (meta ? " (" + meta + ")" : "");
  }

  function matchesScore(item, query) {
    if (!query) return true;
    const haystack = [
      item.title,
      item.authors,
      item.metric,
      item.tonality,
      item.genres,
      item.styles,
    ].join(" ").toLocaleLowerCase();
    return haystack.includes(query);
  }

  function appendOption(group, item) {
    const opt = document.createElement("option");
    opt.value = item.url;
    opt.textContent = optionText(item);
    opt.dataset.type = item.type;
    opt.dataset.label = item.title;
    group.appendChild(opt);
  }

  function currentSeries() {
    return librarySeries.find((series) => series.id === seriesSelect.value) || librarySeries[0];
  }

  function renderSeriesOptions() {
    const previous = seriesSelect.value || librarySeries[0].id;
    seriesSelect.innerHTML = "";
    librarySeries.forEach((series) => {
      const opt = document.createElement("option");
      opt.value = series.id;
      const suffix = series.loaded
        ? " (" + series.works.length + " 首)"
        : series.failed
          ? " (未导入)"
          : " (载入中)";
      opt.textContent = series.label + suffix;
      seriesSelect.appendChild(opt);
    });
    const previousOption = Array.from(seriesSelect.options).find((opt) => opt.value === previous);
    if (previousOption) previousOption.selected = true;
  }

  function renderSampleOptions() {
    renderSeriesOptions();
    const series = currentSeries();
    const previous = sampleSelect.value;
    const query = scoreSearch.value.trim().toLocaleLowerCase();
    sampleSelect.innerHTML = "";

    if (!series.loaded) {
      const empty = document.createElement("option");
      empty.disabled = true;
      empty.textContent = series.failed ? "该系列未导入" : "正在载入该系列…";
      sampleSelect.appendChild(empty);
      libraryCount.textContent = series.label + (series.failed ? " 未导入" : " 载入中");
      return;
    }

    const filtered = series.works.filter((item) => matchesScore(item, query));
    filtered.forEach((item) => appendOption(sampleSelect, item));
    if (!filtered.length) {
      const empty = document.createElement("option");
      empty.disabled = true;
      empty.textContent = query ? "没有匹配的乐谱" : "该系列没有乐谱";
      sampleSelect.appendChild(empty);
    }

    const previousOption = Array.from(sampleSelect.options).find((opt) => opt.value === previous);
    if (previousOption) previousOption.selected = true;
    libraryCount.textContent =
      series.label + " " + series.works.length + " 首" + (query ? " / 匹配 " + filtered.length + " 首" : "");
  }

  async function loadSeriesManifest(series) {
    if (!series.manifestUrl || series.loaded) return;
    try {
      const res = await fetch(series.manifestUrl);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const manifest = await res.json();
      series.works = (manifest.works || []).map((item) => ({ ...item, type: item.type || "mxl" }));
      series.loaded = true;
    } catch (e) {
      series.failed = true;
      console.warn(series.label + " manifest load failed:", e);
    }
    renderSampleOptions();
  }

  function loadLibrarySeries() {
    librarySeries.forEach((series) => loadSeriesManifest(series));
  }

  function selectedScoreSource() {
    const opt = sampleSelect.selectedOptions[0];
    if (!opt || opt.disabled) return null;
    return {
      url: opt.value,
      type: opt.dataset.type || "",
      label: opt.dataset.label || opt.textContent,
    };
  }

  async function fetchScorePayload(source) {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const isMxl = source.type === "mxl" || /\.(mxl|mxl_)($|[?#])/i.test(source.url);
    if (isMxl) {
      return { mxlBuffer: await res.arrayBuffer() };
    }
    return { xmlText: await res.text() };
  }

  // 初始化 OSMD
  function initOSMD() {
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmdContainer", {
      autoResize: true,
      drawTitle: true,
      drawingParameters: "compacttight",
      backend: "svg",
      followCursor: false, // 不用 OSMD 默认滚动(会滚动整页),改为手动在乐谱视窗内滚动
    });
    applyScoreZoom();
  }

  // 懒加载钢琴采样器(Salamander 真实钢琴音色,走 Tone.js 官方 CDN)
  function initSampler() {
    if (sampler) return;
    setStatus("正在加载钢琴音色…");
    sampler = new Tone.Sampler({
      urls: {
        A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
        A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
        A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
        A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
        A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
        A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
        A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
        A7: "A7.mp3", C8: "C8.mp3",
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => {
        samplerReady = true;
        setStatus("钢琴音色就绪。点击「演奏」开始。");
      },
    }).toDestination();
  }

  function yieldToBrowser() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  // 渲染已在 Worker 中解析过的 MusicXML。大谱默认只排版前 48 小节，避免 SVG 节点爆炸。
  async function loadMusicXML(score) {
    stopPlayback();
    try {
      setStatus(score.isPreview ? "正在渲染乐谱预览…" : "正在渲染乐谱…");
      await yieldToBrowser();
      await osmd.load(score.renderedXmlText);
      applyScoreZoom();
      osmd.render();
    } catch (e) {
      setStatus("乐谱渲染失败:" + e.message, true);
      return;
    }
    parsed = score.parsed;
    currentScore = score;
    if (!parsed.notes.length) {
      setStatus("没有解析到任何音符。", true);
      return;
    }
    // 根据音域调整键盘范围
    const midis = parsed.notes.map((n) => n.midi);
    Piano.build("piano", Piano.ensureRange(midis));

    // 预扫描五线谱光标时间轴
    buildCursorTimeline({ autoFit: true });

    initSampler();
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = false;
    updateProgress(0);
    fullScoreBtn.hidden = !score.isPreview;
    fullScoreBtn.disabled = false;
    const previewHint = score.isPreview
      ? `为保持流畅，当前仅显示前 ${PREVIEW_MEASURE_LIMIT}/${score.measureCount} 小节；可按「渲染完整乐谱」。`
      : "";
    setStatus(
      `已加载「${score.label}」:${parsed.notes.length} 个音符,时长约 ${fmtTime(parsed.totalDuration)},原速 ${Math.round(parsed.tempo)} BPM。${previewHint}`
    );
  }

  async function renderFullScore() {
    if (!currentScore || !currentScore.isPreview) return;
    fullScoreBtn.disabled = true;
    stopPlayback();
    try {
      setStatus("正在渲染完整乐谱…");
      await yieldToBrowser();
      await osmd.load(currentScore.fullXmlText);
      applyScoreZoom();
      osmd.render();
      currentScore = { ...currentScore, isPreview: false, renderedXmlText: currentScore.fullXmlText };
      buildCursorTimeline({ autoFit: true });
      fullScoreBtn.hidden = true;
      setStatus(`已显示完整乐谱（${currentScore.measureCount} 小节）。`);
    } catch (e) {
      fullScoreBtn.disabled = false;
      setStatus("完整乐谱渲染失败:" + e.message, true);
    }
  }

  // 预扫描 OSMD 光标,记录每一步的音乐时间(秒,原速)。
  // 光标按时间戳逐"列"推进(含休止符),与音频用同一速度换算即可对齐。
  function buildCursorTimeline(options = {}) {
    cursorTimes = [];
    cursorPositions = [];
    scoreSystems = [];
    const cursor = osmd.cursor;
    if (!cursor) return;
    cursor.reset();
    cursor.show(); // 先显示,这样下面能读到光标元素的位置
    const wholeNoteSec = 240 / (parsed.tempo || 100); // 全音符秒数 = 4 拍 × 60/BPM
    const systemsByTop = new Map(); // 各乐谱系统的纵向范围,双手谱会比单手谱高很多
    let guard = 0;
    while (!cursor.iterator.EndReached && guard < 100000) {
      const ts = cursor.iterator.currentTimeStamp.RealValue; // 距开头的全音符数
      const time = ts * wholeNoteSec;
      cursorTimes.push(time);
      const img = cursor.cursorElement;
      if (img && img.style.top) {
        const y = parseFloat(img.style.top);
        const x = parseFloat(img.style.left) || 0;
        const height = parseFloat(img.style.height) || img.getBoundingClientRect().height || 120;
        const key = String(Math.round(y));
        const existing = systemsByTop.get(key);
        if (existing) {
          existing.top = Math.min(existing.top, y);
          existing.bottom = Math.max(existing.bottom, y + height);
          existing.height = Math.max(existing.height, height);
        } else {
          systemsByTop.set(key, { top: y, bottom: y + height, height });
        }
        cursorPositions.push({ x, y, time, index: guard, systemTop: y });
      }
      cursor.next();
      guard++;
    }
    cursor.reset();
    cursor.show();
    cursorIndex = 0;
    resetCursorScroll();
    const pendingAutoFit = fitViewportToSystems(
      [...systemsByTop.values()].sort((a, b) => a.top - b.top),
      { autoFit: options.autoFit !== false }
    );
    if (pendingAutoFit) return;
    scrollCursorIntoView();
    requestAnimationFrame(scrollCursorIntoView);
  }

  function fitViewportToSystems(systems, options = {}) {
    const wrap = document.querySelector(".score-wrap");
    if (!systems.length) {
      wrap.style.height = "";
      return false;
    }
    scoreSystems = systems.map((system, index) => {
      const next = systems[index + 1];
      const measuredHeight = Math.max(120, system.bottom - system.top, system.height);
      const availableHeight = next ? Math.max(measuredHeight, next.top - system.top) : measuredHeight;
      const height = Math.max(measuredHeight, Math.min(availableHeight, measuredHeight + 90));
      return { top: system.top, bottom: system.top + height, height };
    });
    const maxSystemHeight = Math.max(...scoreSystems.map((system) => system.height));
    const maxViewportHeight = Math.max(360, Math.min(820, window.innerHeight * 0.78));
    const currentZoomPercent = parseInt(scoreZoomSlider.value, 10);
    const minZoomPercent = parseInt(scoreZoomSlider.min, 10);
    const maxContentHeight = Math.max(220, maxViewportHeight - 72);
    if (options.autoFit && maxSystemHeight > maxContentHeight && currentZoomPercent > minZoomPercent) {
      const fittedPercent = Math.max(
        minZoomPercent,
        Math.floor(currentZoomPercent * (maxContentHeight / maxSystemHeight) * 0.96)
      );
      if (fittedPercent < currentZoomPercent) {
        scoreZoomSlider.value = String(fittedPercent);
        scoreZoomVal.textContent = String(fittedPercent);
        requestAnimationFrame(() => rerenderScoreLayout({ autoFit: true }));
        return true;
      }
    }
    const targetHeight = Math.min(maxViewportHeight, Math.max(300, maxSystemHeight + 72));
    wrap.style.height = Math.round(targetHeight) + "px";
    return false;
  }

  // 把解析出的音符排进 Tone.Transport
  function schedule() {
    clearSchedule();
    const scale = tempoScale; // 当前速度倍率(数值越大越快)
    parsed.notes.forEach((n) => {
      const start = n.start / scale;
      const dur = Math.max(0.05, n.duration / scale);
      const id = Tone.Transport.schedule((time) => {
        if (samplerReady) {
          sampler.triggerAttackRelease(n.name, dur, time);
        }
        // 高亮 + 漂浮音名:用 Tone.Draw 对齐到音频时钟
        Tone.Draw.schedule(() => {
          Piano.highlight(n.midi, true);
          Piano.flashLabel(n.midi);
        }, time);
        Tone.Draw.schedule(() => Piano.highlight(n.midi, false), time + dur);
      }, start);
      scheduledIds.push(id);
    });
    // 五线谱光标不在这里调度:改由 loopProgress 根据音频时钟自校正推进(见下)。

    // 结束点
    const endId = Tone.Transport.schedule(() => stopPlayback(), parsed.totalDuration / scale + 0.3);
    scheduledIds.push(endId);
  }

  function clearSchedule() {
    scheduledIds.forEach((id) => Tone.Transport.clear(id));
    scheduledIds = [];
  }

  async function play() {
    if (!parsed) return;
    await Tone.start(); // 解锁音频上下文(需用户手势)
    if (Tone.Transport.state === "paused") {
      Tone.Transport.start();
    } else {
      Tone.Transport.stop();
      Tone.Transport.cancel();
      Tone.Transport.position = 0;
      if (osmd.cursor) {
        osmd.cursor.reset(); // 光标回到第一个音并显示
        osmd.cursor.show();
        cursorIndex = 0;
        resetCursorScroll();
        scrollCursorIntoView();
      }
      schedule();
      Tone.Transport.start();
    }
    playBtn.disabled = true;
    pauseBtn.disabled = false;
    setStatus("演奏中…");
    loopProgress();
  }

  // 把光标定位到第 index 步(用于点击跳转)
  function moveCursorTo(index) {
    if (!osmd.cursor) return;
    osmd.cursor.reset();
    for (let i = 0; i < index && !osmd.cursor.iterator.EndReached; i++) {
      osmd.cursor.next();
    }
    cursorIndex = index;
    resetCursorScroll();
    scrollCursorIntoView();
  }

  // 从第 index 个音符开始演奏
  async function seekAndPlay(index) {
    if (!parsed || !cursorTimes.length) return;
    index = Math.max(0, Math.min(index, cursorTimes.length - 1));
    await Tone.start();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    moveCursorTo(index);
    schedule();
    const offset = cursorTimes[index] / tempoScale; // 起始位置(秒,已按速度换算)
    Tone.Transport.start(undefined, offset); // 第二个参数=从该时间点开始,之前的音符跳过
    playBtn.disabled = true;
    pauseBtn.disabled = false;
    setStatus("从所选位置开始演奏…");
    loopProgress();
  }

  // 点击乐谱:找到离点击点最近的音符,从那里开始播放
  function onScoreClick(e) {
    if (!cursorPositions.length) return;
    const container = $("osmdContainer");
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = null;
    let bestScore = Infinity;
    for (const p of cursorPositions) {
      // 行优先:纵向差距权重更高,确保选中点击的那一行
      const score = Math.abs(y - p.y) * 4 + Math.abs(x - p.x);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) seekAndPlay(best.index);
  }

  function pause() {
    Tone.Transport.pause();
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    setStatus("已暂停。");
    cancelAnimationFrame(rafId);
  }

  function stopPlayback() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    clearSchedule();
    Piano.clearAll();
    if (osmd && osmd.cursor) {
      osmd.cursor.reset(); // 光标回到开头
      osmd.cursor.show();
      cursorIndex = 0;
      resetCursorScroll();
      scrollCursorIntoView();
    }
    cancelAnimationFrame(rafId);
    playBtn.disabled = parsed ? false : true;
    pauseBtn.disabled = true;
    updateProgress(0);
    if (parsed) setStatus("已停止。");
  }

  function totalScaled() {
    return parsed ? parsed.totalDuration / tempoScale : 0;
  }

  function updateProgress(elapsed) {
    const total = totalScaled();
    const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
    progressFill.style.width = pct + "%";
    timeLabel.textContent = `${fmtTime(elapsed)} / ${fmtTime(total)}`;
  }

  function currentSystemForTop(top) {
    if (!scoreSystems.length) return null;
    return scoreSystems.reduce((best, system) => {
      if (!best) return system;
      return Math.abs(system.top - top) < Math.abs(best.top - top) ? system : best;
    }, null);
  }

  // 让当前演奏系统完整进入视窗。双手谱的一个系统包含上下两行五线谱。
  function scrollCursorIntoView() {
    const wrap = document.querySelector(".score-wrap");
    const img = osmd.cursor && osmd.cursor.cursorElement;
    if (!wrap || !img) return;
    const top = parseFloat(img.style.top) || 0;
    if (top !== curLineTop) {
      // 换系统了:记录当前位置,避免同一系统内重复平滑滚动
      curLineTop = top;
    }
    const system = currentSystemForTop(top);
    const targetTop = system ? system.top : top;
    wrap.scrollTop = Math.max(0, targetTop - 36);
  }

  // 重置行跟踪状态(加载/重新播放/停止时调用)
  function resetCursorScroll() {
    curLineTop = null;
  }

  // 根据当前播放时间,把五线谱光标推进到正确位置(自校正:tab 切回也能对上)
  function syncCursor(elapsed) {
    if (!osmd.cursor || !cursorTimes.length) return;
    const scale = tempoScale;
    let advanced = false;
    while (
      cursorIndex < cursorTimes.length - 1 &&
      cursorTimes[cursorIndex + 1] / scale <= elapsed
    ) {
      if (osmd.cursor.iterator.EndReached) break;
      osmd.cursor.next();
      cursorIndex++;
      advanced = true;
    }
    if (advanced) scrollCursorIntoView();
  }

  function loopProgress() {
    const tick = () => {
      const elapsed = Tone.Transport.seconds;
      updateProgress(elapsed);
      syncCursor(elapsed);
      if (Tone.Transport.state === "started") {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  // ---- 事件绑定 ----
  playBtn.addEventListener("click", play);
  pauseBtn.addEventListener("click", pause);
  stopBtn.addEventListener("click", stopPlayback);

  tempoSlider.addEventListener("input", () => {
    tempoScale = parseInt(tempoSlider.value, 10) / 100;
    tempoVal.textContent = tempoSlider.value;
    // 若正在播放,重新调度以应用新速度
    const wasPlaying = Tone.Transport.state === "started";
    if (wasPlaying) {
      stopPlayback();
    } else {
      updateProgress(0);
    }
  });

  scoreZoomSlider.addEventListener("input", () => {
    rerenderScoreLayout({ autoFit: false });
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!parsed) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => rerenderScoreLayout({ autoFit: true }), 180);
  });

  $("labelToggle").addEventListener("change", (e) => {
    Piano.setShowLabels(e.target.checked);
  });

  $("osmdContainer").addEventListener("click", onScoreClick);

  $("loadSampleBtn").addEventListener("click", async () => {
    const source = selectedScoreSource();
    if (!source) {
      setStatus("请先选择一个乐谱。", true);
      return;
    }
    const sequence = ++loadSequence;
    fullScoreBtn.hidden = true;
    try {
      setStatus("正在后台解析乐谱…");
      const payload = await fetchScorePayload(source);
      const score = await prepareMusicXML(payload);
      if (sequence !== loadSequence) return;
      await loadMusicXML({ ...score, label: source.label, renderedXmlText: score.xmlText });
    } catch (e) {
      if (sequence === loadSequence) setStatus("加载乐谱失败:" + e.message, true);
    }
  });

  fullScoreBtn.addEventListener("click", renderFullScore);

  seriesSelect.addEventListener("change", () => {
    scoreSearch.value = "";
    renderSampleOptions();
  });
  scoreSearch.addEventListener("input", renderSampleOptions);

  $("fileInput").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const sequence = ++loadSequence;
    fullScoreBtn.hidden = true;
    try {
      setStatus("正在后台解析乐谱…");
      let payload;
      if (file.name.toLowerCase().endsWith(".mxl")) {
        payload = { mxlBuffer: await file.arrayBuffer() };
      } else {
        payload = { xmlText: await file.text() };
      }
      const score = await prepareMusicXML(payload);
      if (sequence !== loadSequence) return;
      await loadMusicXML({ ...score, label: file.name, renderedXmlText: score.xmlText });
    } catch (e) {
      if (sequence === loadSequence) setStatus("读取文件失败:" + e.message, true);
    }
  });

  // ---- 自由演奏:点击键盘发声 ----
  Piano.setInteractive(
    async (midi) => {
      await Tone.start(); // 真实用户手势,解锁音频
      if (samplerReady) sampler.triggerAttack(MusicXMLParser.midiName(midi));
    },
    (midi) => {
      if (samplerReady) sampler.triggerRelease(MusicXMLParser.midiName(midi));
    }
  );

  // 启动
  renderSampleOptions();
  loadLibrarySeries();
  initOSMD();
  Piano.build("piano");
  initSampler(); // 提前加载音色,使自由演奏开箱即用
  setStatus("已就绪。先选择系列和乐谱,也可直接用鼠标点击键盘弹奏。");
})();
