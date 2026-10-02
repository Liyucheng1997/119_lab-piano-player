// 主逻辑:加载 MusicXML → OSMD 渲染 + 解析音符 → Tone.js 调度演奏 + 琴键联动。
// 键盘优先使用 3D 音乐厅里的三角钢琴(window.HallPiano),WebGL 不可用时回退到 2D 键盘(Piano)。

(function () {
  const $ = (id) => document.getElementById(id);
  const Keyboard = window.HallPiano || Piano;
  const Hall = window.ConcertHall || null;
  if (!window.HallPiano) document.body.classList.add("no-webgl");

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
  const scoreSearch = $("scoreSearch");
  const libraryCount = $("libraryCount");
  const fullScoreBtn = $("fullScoreBtn");
  const shelfGrid = $("shelfGrid");
  const shelfMore = $("shelfMore");
  const seriesTabs = $("seriesTabs");

  const PREVIEW_MEASURE_LIMIT = 48;
  const SHELF_PAGE = 60;

  let osmd = null;
  let scoreRenderable = false; // OSMD 排版成功才有谱面光标;失败时仍可纯音频演奏
  let sampler = null;
  let samplerReady = false;
  let hallReverb = null;
  let parsed = null; // { notes, totalDuration, tempo }
  let velocities = null; // 每个音符的力度(和弦里突出旋律最高音)
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
  let currentSource = null; // 当前乐谱的来源(卡片信息)
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
    { title: "阳光快板 Mozartian Sunlit Allegro", authors: "原创 · 莫扎特风格", url: "samples/mozartian-sunlit-allegro.musicxml", type: "musicxml" },
    { title: "晴朗小步 Sunny Steps", authors: "原创", url: "samples/sunny-steps.musicxml", type: "musicxml" },
    { title: "小星星 Twinkle", authors: "W. A. Mozart", url: "samples/twinkle.musicxml", type: "musicxml" },
    { title: "欢乐颂 Ode to Joy", authors: "L. v. Beethoven", url: "samples/ode-to-joy.musicxml", type: "musicxml" },
    { title: "致爱丽丝 Für Elise", authors: "L. v. Beethoven", url: "samples/fur-elise.musicxml", type: "musicxml" },
    { title: "生日快乐 Happy Birthday", authors: "M. & P. Hill", url: "samples/happy-birthday.musicxml", type: "musicxml" },
    { title: "铃儿响叮当 Jingle Bells", authors: "J. Pierpont", url: "samples/jingle-bells.musicxml", type: "musicxml" },
  ];

  const librarySeries = [
    { id: "builtin", label: "示例曲目", works: builtinSamples, loaded: true },
    { id: "musetrainer", label: "MuseTrainer 钢琴曲库", manifestUrl: "musetrainer/manifest.json", works: [], loaded: false },
    { id: "openewld", label: "OpenEWLD 旋律曲库", manifestUrl: "openewld/manifest.json", works: [], loaded: false },
  ];
  let activeSeriesId = "builtin";
  let shelfLimit = SHELF_PAGE;

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#ff9a8a" : "";
  }

  function fmtTime(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function setNowPlaying(title, sub) {
    $("npTitle").textContent = title;
    $("npSub").textContent = sub;
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
    if (!osmd || !parsed || !scoreRenderable) return;
    const wasPlaying = Tone.Transport.state === "started";
    if (wasPlaying) stopPlayback();
    applyScoreZoom();
    osmd.render();
    buildCursorTimeline({ autoFit: options.autoFit !== false });
    scrollCursorIntoView();
    updateProgress(0);
  }

  // ================= 乐谱柜(纸质乐谱卡片) =================
  function matchesScore(item, query) {
    if (!query) return true;
    const haystack = [item.title, item.authors, item.metric, item.tonality, item.genres, item.styles]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(query);
  }

  function activeSeries() {
    return librarySeries.find((s) => s.id === activeSeriesId) || librarySeries[0];
  }

  function renderSeriesTabs() {
    seriesTabs.innerHTML = "";
    librarySeries.forEach((series) => {
      const b = document.createElement("button");
      const suffix = series.loaded ? ` · ${series.works.length}` : series.failed ? " · 未导入" : " · 载入中";
      b.textContent = series.label + suffix;
      b.className = series.id === activeSeriesId ? "active" : "";
      b.addEventListener("click", () => {
        activeSeriesId = series.id;
        shelfLimit = SHELF_PAGE;
        scoreSearch.value = "";
        renderShelf();
      });
      seriesTabs.appendChild(b);
    });
  }

  function hashTilt(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 100) / 100 - 0.5) * 3.2;
  }

  function makeCard(item, series) {
    const card = document.createElement("button");
    card.className = "sheet-card";
    card.style.setProperty("--tilt", hashTilt(item.url).toFixed(2) + "deg");
    card.title = "放上谱架并自动演奏:" + item.title;
    if (currentSource && currentSource.url === item.url) card.classList.add("playing");
    const meta = [item.metric, item.tonality].filter(Boolean).join(" · ");
    card.innerHTML = `
      <span class="sheet-series"></span>
      <span class="sheet-clef">𝄞</span>
      <span class="sheet-title"></span>
      <span class="sheet-composer"></span>
      <span class="sheet-staff"></span>
      <span class="sheet-meta"></span>
      <span class="sheet-play">▶ 放上谱架演奏</span>`;
    card.querySelector(".sheet-series").textContent = series.id === "builtin" ? "Edition" : series.id === "musetrainer" ? "Klavier" : "Melodie";
    card.querySelector(".sheet-title").textContent = item.title;
    card.querySelector(".sheet-composer").textContent = item.authors || "佚名 · Anonymous";
    card.querySelector(".sheet-meta").textContent = meta;
    card.addEventListener("click", () => {
      // 先在用户手势里解锁音频,再异步加载乐谱
      Tone.start();
      card.classList.add("flying");
      setTimeout(() => closeShelf(), 260);
      loadSource({ url: item.url, type: item.type, label: item.title, authors: item.authors, seriesLabel: series.label }, { autoplay: true });
    });
    return card;
  }

  function renderShelf() {
    renderSeriesTabs();
    const series = activeSeries();
    const query = scoreSearch.value.trim().toLocaleLowerCase();
    shelfGrid.innerHTML = "";
    if (!series.loaded) {
      const empty = document.createElement("div");
      empty.className = "shelf-empty";
      empty.textContent = series.failed ? "该曲库尚未导入。" : "正在从档案室取出乐谱…";
      shelfGrid.appendChild(empty);
      libraryCount.textContent = series.label;
      shelfMore.hidden = true;
      return;
    }
    const filtered = series.works.filter((item) => matchesScore(item, query));
    const frag = document.createDocumentFragment();
    filtered.slice(0, shelfLimit).forEach((item) => frag.appendChild(makeCard(item, series)));
    shelfGrid.appendChild(frag);
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "shelf-empty";
      empty.textContent = query ? "没有找到匹配的乐谱。" : "这个柜格是空的。";
      shelfGrid.appendChild(empty);
    }
    shelfMore.hidden = filtered.length <= shelfLimit;
    shelfMore.textContent = `翻出更多乐谱…(还有 ${Math.max(0, filtered.length - shelfLimit)} 份)`;
    libraryCount.textContent =
      `${series.label} · 共 ${series.works.length} 份` + (query ? ` · 匹配 ${filtered.length} 份` : "") + " · 点击卡片即放上谱架自动演奏";
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
    renderShelf();
  }

  function openShelf() {
    document.body.classList.add("shelf-open");
    $("shelf").setAttribute("aria-hidden", "false");
    renderShelf();
    setTimeout(() => scoreSearch.focus({ preventScroll: true }), 300);
  }
  function closeShelf() {
    document.body.classList.remove("shelf-open");
    $("shelf").setAttribute("aria-hidden", "true");
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

  async function loadSource(source, { autoplay = false } = {}) {
    const sequence = ++loadSequence;
    fullScoreBtn.hidden = true;
    stopPlayback();
    setNowPlaying(source.label, "正在把乐谱放上谱架…");
    try {
      setStatus("正在后台解析乐谱…");
      const payload = await fetchScorePayload(source);
      const score = await prepareMusicXML(payload);
      if (sequence !== loadSequence) return;
      currentSource = source;
      const ok = await loadMusicXML({ ...score, label: source.label, renderedXmlText: score.xmlText });
      if (!ok || sequence !== loadSequence) return;
      if (autoplay) {
        if (!samplerReady) {
          setStatus("等待钢琴音色加载完成…");
          await Tone.loaded();
        }
        if (sequence === loadSequence) play();
      }
    } catch (e) {
      if (sequence === loadSequence) {
        setStatus("加载乐谱失败:" + e.message, true);
        setNowPlaying("尚未选曲", "乐谱加载失败,请换一份试试");
      }
    }
  }

  // ================= OSMD + 音色 =================
  function initOSMD() {
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmdContainer", {
      autoResize: true,
      drawTitle: true,
      drawingParameters: "compacttight",
      backend: "svg",
      followCursor: false, // 不用 OSMD 默认滚动(会滚动整页),改为手动在乐谱视窗内滚动
      cursorsOptions: [{ type: 0, color: "#c8902f", alpha: 0.55, follow: false }],
    });
    applyScoreZoom();
  }

  // 钢琴音色:Salamander 三角钢琴采样(覆盖 A0..C8 全部 88 键),经过金色大厅混响
  function initSampler() {
    if (sampler) return;
    setStatus("正在加载钢琴音色…");
    hallReverb = new Tone.Reverb({ decay: 2.6, preDelay: 0.022, wet: 0.28 });
    const warmth = new Tone.EQ3({ low: 1.5, mid: 0, high: -1.2, lowFrequency: 220, highFrequency: 4200 });
    const limiter = new Tone.Limiter(-1.5);
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
      release: 1.2,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => {
        samplerReady = true;
        if (!parsed) setStatus("钢琴音色就绪。打开「乐谱柜」选一首,或直接点击琴键弹奏。");
      },
    });
    sampler.chain(warmth, hallReverb, limiter, Tone.Destination);
  }

  // 力度:同一时刻的和弦里,最高音(通常是旋律)更响,低音和内声部稍收,并加入极轻微的人性化浮动
  function computeVelocities(notes) {
    const vel = new Float32Array(notes.length);
    let i = 0;
    while (i < notes.length) {
      let j = i;
      let top = i;
      while (j < notes.length && notes[j].start - notes[i].start < 0.012) {
        if (notes[j].midi > notes[top].midi) top = j;
        j++;
      }
      const n = j - i;
      for (let k = i; k < j; k++) {
        let v = 0.6 - Math.min(0.14, (n - 1) * 0.03);
        if (k === top) v += 0.16;
        if (notes[k].midi < 48) v -= 0.05;
        v += (Math.random() - 0.5) * 0.05;
        vel[k] = Math.max(0.28, Math.min(0.92, v));
      }
      i = j;
    }
    return vel;
  }

  function yieldToBrowser() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  // 渲染已在 Worker 中解析过的 MusicXML。大谱默认只排版前 48 小节，避免 SVG 节点爆炸。
  async function loadMusicXML(score) {
    stopPlayback();
    let renderError = null;
    try {
      setStatus(score.isPreview ? "正在渲染乐谱预览…" : "正在渲染乐谱…");
      await yieldToBrowser();
      await osmd.load(score.renderedXmlText);
      applyScoreZoom();
      osmd.render();
      scoreRenderable = true;
    } catch (e) {
      // 个别 MusicXML 超出 OSMD 的排版能力:谱面不显示,但音符已由 Worker 解析,照样可以演奏
      renderError = e;
      scoreRenderable = false;
      $("osmdContainer").innerHTML = '<div class="score-fallback">这份乐谱的谱面暂时无法排版,但钢琴仍会完整演奏。</div>';
      cursorTimes = [];
      cursorPositions = [];
      scoreSystems = [];
      document.querySelector(".score-wrap").style.height = "";
      if (Hall) Hall.setScore({ title: score.label, subtitle: "谱面无法排版 · 仅演奏" });
    }
    parsed = score.parsed;
    currentScore = score;
    if (!parsed.notes.length) {
      setStatus("没有解析到任何音符。", true);
      return false;
    }
    velocities = computeVelocities(parsed.notes);
    const midis = parsed.notes.map((n) => n.midi);
    Keyboard.build("piano", Keyboard.ensureRange(midis));

    if (scoreRenderable) {
      buildCursorTimeline({ autoFit: true });
      buildPaperScore(score.renderedXmlText);
    }

    initSampler();
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = false;
    updateProgress(0);
    fullScoreBtn.hidden = !score.isPreview;
    fullScoreBtn.disabled = false;
    const src = currentSource || {};
    const subParts = [src.authors, src.seriesLabel, `${Math.round(parsed.tempo)} BPM`, fmtTime(parsed.totalDuration)].filter(Boolean);
    setNowPlaying(score.label, subParts.join(" · "));
    renderShelf();
    const previewHint = score.isPreview
      ? `为保持流畅，当前仅显示前 ${PREVIEW_MEASURE_LIMIT}/${score.measureCount} 小节；可按「渲染完整乐谱」。`
      : "";
    setStatus(
      `已加载「${score.label}」:${parsed.notes.length} 个音符,时长约 ${fmtTime(parsed.totalDuration)},原速 ${Math.round(parsed.tempo)} BPM。${previewHint}` +
        (renderError ? "(谱面排版失败,仅演奏)" : "")
    );
    return true;
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
      buildPaperScore(currentScore.fullXmlText);
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
    const sortedSystems = [...systemsByTop.values()].sort((a, b) => a.top - b.top);
    const pendingAutoFit = fitViewportToSystems(sortedSystems, { autoFit: options.autoFit !== false });
    if (pendingAutoFit) return;
    scrollCursorIntoView();
    requestAnimationFrame(scrollCursorIntoView);
  }

  // ================= 3D 谱架上的纸质乐谱 =================
  // 屏幕上的谱面很宽,直接裁到纸上字会太小。这里用一个隐藏的 OSMD 实例按"印刷页宽"重新排版,
  // 光标步与主谱面一一对应(同一份 XML、同样的迭代顺序),演奏时按步号把金色光标放到纸上。
  let paperOsmd = null;
  let paperHost = null;
  let paperSteps = []; // 光标步 -> { sys, x }
  let paperToken = 0;

  function ensurePaperOsmd() {
    if (paperOsmd) return paperOsmd;
    paperHost = document.createElement("div");
    paperHost.style.cssText = "position:absolute;left:-20000px;top:0;width:680px;visibility:hidden;pointer-events:none;";
    document.body.appendChild(paperHost);
    paperOsmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(paperHost, {
      autoResize: false,
      backend: "svg",
      drawingParameters: "compacttight",
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      followCursor: false,
    });
    return paperOsmd;
  }

  async function buildPaperScore(xmlText) {
    if (!Hall) return;
    const token = ++paperToken;
    paperSteps = [];
    const src = currentSource || {};
    const meta = { title: currentScore ? currentScore.label : "", subtitle: src.authors || src.seriesLabel || "" };
    try {
      const po = ensurePaperOsmd();
      await yieldToBrowser();
      await po.load(xmlText);
      if (token !== paperToken) return;
      po.zoom = 1.0;
      po.render();
      const cursor = po.cursor;
      cursor.reset();
      cursor.show();
      const systems = [];
      const steps = [];
      let guard = 0;
      while (!cursor.iterator.EndReached && guard < 100000) {
        const img = cursor.cursorElement;
        const y = parseFloat(img.style.top) || 0;
        const x = parseFloat(img.style.left) || 0;
        const h = parseFloat(img.style.height) || 100;
        let si = systems.length - 1;
        if (si < 0 || Math.abs(systems[si].top - y) > 2) {
          si = systems.findIndex((sys) => Math.abs(sys.top - y) <= 2);
          if (si < 0) {
            systems.push({ top: y, bottom: y + h });
            si = systems.length - 1;
          }
        }
        systems[si].bottom = Math.max(systems[si].bottom, y + h);
        steps.push({ sys: si, x });
        cursor.next();
        guard++;
      }
      const img = cursor.cursorElement;
      cursor.reset();
      cursor.hide();
      const svg = paperHost.querySelector("svg");
      if (!svg || !systems.length) throw new Error("谱架排版为空");
      const parent = (img && img.offsetParent) || paperHost;
      const pr = parent.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      paperSteps = steps;
      await Hall.setScore({
        svgEl: svg,
        systems,
        offsetX: sr.left - pr.left - parent.clientLeft + parent.scrollLeft,
        offsetY: sr.top - pr.top - parent.clientTop + parent.scrollTop,
        ...meta,
      });
      if (token === paperToken) syncPaperCursor();
    } catch (e) {
      console.warn("谱架纸张排版失败:", e);
      if (token === paperToken) Hall.setScore(meta);
    }
  }

  function syncPaperCursor() {
    if (!Hall || !paperSteps.length) return;
    const step = paperSteps[Math.min(cursorIndex, paperSteps.length - 1)];
    Hall.setCursor(step.sys, step.x);
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
    const targetHeight = Math.min(maxViewportHeight, Math.max(300, maxSystemHeight + 104));
    wrap.style.height = Math.round(targetHeight) + "px";
    return false;
  }

  // ================= 演奏调度 =================
  // 每个音符:声音与琴键在同一个音频时钟上触发 —— 按下哪个键就发哪个音,时值结束琴键回弹。
  function schedule() {
    clearSchedule();
    const scale = tempoScale; // 当前速度倍率(数值越大越快)
    parsed.notes.forEach((n, i) => {
      const start = n.start / scale;
      const dur = Math.max(0.05, n.duration / scale);
      const vel = velocities ? velocities[i] : 0.7;
      const id = Tone.Transport.schedule((time) => {
        if (samplerReady) {
          sampler.triggerAttackRelease(n.name, dur, time, vel);
        }
        Tone.Draw.schedule(() => {
          Keyboard.highlight(n.midi, true);
          Keyboard.flashLabel(n.midi);
        }, time);
        Tone.Draw.schedule(() => Keyboard.highlight(n.midi, false), time + dur);
      }, start);
      scheduledIds.push(id);
    });
    // 五线谱光标不在这里调度:改由 loopProgress 根据音频时钟自校正推进(见下)。

    const endId = Tone.Transport.schedule((time) => {
      Tone.Draw.schedule(() => stopPlayback(true), time);
    }, parsed.totalDuration / scale + 0.6);
    scheduledIds.push(endId);
  }

  function clearSchedule() {
    scheduledIds.forEach((id) => Tone.Transport.clear(id));
    scheduledIds = [];
    Tone.Draw.cancel(0); // 丢弃尚未执行的琴键动画,避免停止后有键卡在按下状态
  }

  // 演奏中鼠标静止 3 秒,隐藏控制条与机位按钮,只留下舞台画面
  const stageEl = $("stage3d");
  let idleTimer = null;
  function wakeStage() {
    stageEl.classList.remove("idle");
    clearTimeout(idleTimer);
    if (Tone.Transport.state === "started") idleTimer = setTimeout(() => stageEl.classList.add("idle"), 3000);
  }
  ["pointermove", "pointerdown", "wheel"].forEach((t) => stageEl.addEventListener(t, wakeStage, { passive: true }));

  function setPlayingUI(on) {
    playBtn.disabled = on;
    pauseBtn.disabled = !on;
    if (Hall) Hall.setPerformance(on);
    wakeStage();
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
      Keyboard.clearAll();
      if (scoreRenderable && osmd.cursor) {
        osmd.cursor.reset(); // 光标回到第一个音并显示
        osmd.cursor.show();
        cursorIndex = 0;
        resetCursorScroll();
        scrollCursorIntoView();
      }
      schedule();
      Tone.Transport.start("+0.08");
    }
    setPlayingUI(true);
    setStatus("演奏中…  金色大厅灯光已调暗");
    loopProgress();
  }

  // 把光标定位到第 index 步(用于点击跳转)
  function moveCursorTo(index) {
    if (!scoreRenderable || !osmd.cursor) return;
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
    if (!parsed || !scoreRenderable || !cursorTimes.length) return;
    index = Math.max(0, Math.min(index, cursorTimes.length - 1));
    await Tone.start();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Keyboard.clearAll();
    moveCursorTo(index);
    schedule();
    const offset = cursorTimes[index] / tempoScale; // 起始位置(秒,已按速度换算)
    Tone.Transport.start(undefined, offset); // 第二个参数=从该时间点开始,之前的音符跳过
    setPlayingUI(true);
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
    Tone.Draw.cancel(0);
    setPlayingUI(false);
    Keyboard.clearAll();
    setStatus("已暂停。");
    cancelAnimationFrame(rafId);
  }

  function stopPlayback(finished) {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    clearSchedule();
    Keyboard.clearAll();
    if (scoreRenderable && osmd && osmd.cursor) {
      osmd.cursor.reset(); // 光标回到开头
      osmd.cursor.show();
      cursorIndex = 0;
      resetCursorScroll();
      scrollCursorIntoView();
    }
    cancelAnimationFrame(rafId);
    setPlayingUI(false);
    playBtn.disabled = parsed ? false : true;
    updateProgress(0);
    if (parsed) setStatus(finished === true ? "演奏结束 —— Bravo! 👏" : "已停止。");
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

  function currentSystemIndexForTop(top) {
    let best = -1;
    scoreSystems.forEach((system, i) => {
      if (best < 0 || Math.abs(system.top - top) < Math.abs(scoreSystems[best].top - top)) best = i;
    });
    return best;
  }

  // 让当前演奏系统完整进入视窗,并同步 3D 谱架上的金色光标。
  function scrollCursorIntoView() {
    const wrap = document.querySelector(".score-wrap");
    const img = scoreRenderable && osmd && osmd.cursor && osmd.cursor.cursorElement;
    if (!wrap || !img) return;
    const top = parseFloat(img.style.top) || 0;
    if (top !== curLineTop) curLineTop = top;
    const idx = currentSystemIndexForTop(top);
    const system = scoreSystems[idx];
    const targetTop = system ? system.top : top;
    wrap.scrollTop = Math.max(0, targetTop - 36);
    syncPaperCursor();
  }

  // 重置行跟踪状态(加载/重新播放/停止时调用)
  function resetCursorScroll() {
    curLineTop = null;
  }

  // 根据当前播放时间,把五线谱光标推进到正确位置(自校正:tab 切回也能对上)
  function syncCursor(elapsed) {
    if (!scoreRenderable || !osmd.cursor || !cursorTimes.length) return;
    const scale = tempoScale;
    let advanced = false;
    while (cursorIndex < cursorTimes.length - 1 && cursorTimes[cursorIndex + 1] / scale <= elapsed) {
      if (osmd.cursor.iterator.EndReached) break;
      osmd.cursor.next();
      cursorIndex++;
      advanced = true;
    }
    if (advanced) scrollCursorIntoView();
  }

  function loopProgress() {
    cancelAnimationFrame(rafId);
    const tick = () => {
      const elapsed = Math.max(0, Tone.Transport.seconds);
      updateProgress(elapsed);
      syncCursor(elapsed);
      if (Tone.Transport.state === "started") {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  // ================= 自由演奏(鼠标 / 触摸 / 电脑键盘 + 延音踏板) =================
  const heldNotes = new Set();
  const sustainedNotes = new Set();
  let pedalDown = false;

  function noteOn(midi, velocity = 0.72) {
    Tone.start();
    if (!samplerReady) return;
    const name = MusicXMLParser.midiName(midi);
    if (heldNotes.has(midi) || sustainedNotes.has(midi)) sampler.triggerRelease(name);
    sampler.triggerAttack(name, undefined, velocity);
    heldNotes.add(midi);
    sustainedNotes.delete(midi);
  }
  function noteOff(midi) {
    heldNotes.delete(midi);
    if (!samplerReady) return;
    if (pedalDown) sustainedNotes.add(midi);
    else sampler.triggerRelease(MusicXMLParser.midiName(midi));
  }
  function setPedal(on) {
    if (pedalDown === on) return;
    pedalDown = on;
    $("pedalIndicator").classList.toggle("on", on);
    if (Keyboard.setSustain) Keyboard.setSustain(on);
    if (!on && samplerReady) {
      sustainedNotes.forEach((m) => {
        if (!heldNotes.has(m)) sampler.triggerRelease(MusicXMLParser.midiName(m));
      });
      sustainedNotes.clear();
    }
  }

  Keyboard.setInteractive(
    (midi) => noteOn(midi),
    (midi) => noteOff(midi)
  );

  // 电脑键盘:两排琴键,覆盖约两个半八度
  const KEYMAP = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
    Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
  };
  let octaveShift = 0;
  const keyDownMidi = new Map(); // code -> midi
  const typingTarget = (e) => {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  };
  window.addEventListener("keydown", (e) => {
    if (typingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      setPedal(true);
      return;
    }
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      octaveShift = Math.max(-3, Math.min(3, octaveShift + (e.code === "ArrowRight" ? 1 : -1)));
      setStatus(`电脑键盘音区:${MusicXMLParser.midiName(48 + octaveShift * 12)} 起`);
      e.preventDefault();
      return;
    }
    if (e.code === "Escape") closeShelf();
    if (!(e.code in KEYMAP) || e.repeat || keyDownMidi.has(e.code)) return;
    const midi = 48 + octaveShift * 12 + KEYMAP[e.code];
    if (midi < 21 || midi > 108) return;
    keyDownMidi.set(e.code, midi);
    Keyboard.highlight(midi, true);
    Keyboard.flashLabel(midi);
    noteOn(midi, 0.75);
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      setPedal(false);
      return;
    }
    const midi = keyDownMidi.get(e.code);
    if (midi == null) return;
    keyDownMidi.delete(e.code);
    Keyboard.highlight(midi, false);
    noteOff(midi);
  });
  window.addEventListener("blur", () => {
    keyDownMidi.forEach((midi) => {
      Keyboard.highlight(midi, false);
      noteOff(midi);
    });
    keyDownMidi.clear();
    setPedal(false);
  });

  // ================= 事件绑定 =================
  playBtn.addEventListener("click", play);
  pauseBtn.addEventListener("click", pause);
  stopBtn.addEventListener("click", () => stopPlayback());

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
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (!parsed || window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => rerenderScoreLayout({ autoFit: true }), 180);
  });

  $("labelToggle").addEventListener("change", (e) => Keyboard.setShowLabels(e.target.checked));
  $("glowToggle").addEventListener("change", (e) => Keyboard.setGlow && Keyboard.setGlow(e.target.checked));
  $("reverbToggle").addEventListener("change", (e) => {
    if (hallReverb) hallReverb.wet.rampTo(e.target.checked ? 0.28 : 0, 0.3);
  });
  $("orbitToggle").addEventListener("change", (e) => Hall && Hall.setAutoOrbit(e.target.checked));

  $("osmdContainer").addEventListener("click", onScoreClick);
  fullScoreBtn.addEventListener("click", renderFullScore);

  $("openShelfBtn").addEventListener("click", openShelf);
  $("closeShelfBtn").addEventListener("click", closeShelf);
  $("shelfBackdrop").addEventListener("click", closeShelf);
  scoreSearch.addEventListener("input", () => {
    shelfLimit = SHELF_PAGE;
    renderShelf();
  });
  shelfMore.addEventListener("click", () => {
    shelfLimit += SHELF_PAGE;
    renderShelf();
  });

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
      currentSource = { url: "upload:" + file.name, label: file.name, seriesLabel: "本地上传" };
      await loadMusicXML({ ...score, label: file.name.replace(/\.(musicxml|xml|mxl)$/i, ""), renderedXmlText: score.xmlText });
    } catch (e) {
      if (sequence === loadSequence) setStatus("读取文件失败:" + e.message, true);
    }
    ev.target.value = "";
  });

  // 机位按钮
  if (Hall) {
    const dock = $("cameraDock");
    Object.entries(Hall.presets).forEach(([key, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.preset = key;
      if (key === Hall.preset) b.classList.add("active");
      b.addEventListener("click", () => {
        Hall.flyTo(key);
        dock.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      });
      dock.appendChild(b);
    });
  }

  // 启动
  renderShelf();
  librarySeries.forEach((series) => loadSeriesManifest(series));
  initOSMD();
  Keyboard.build("piano");
  initSampler(); // 提前加载音色,使自由演奏开箱即用
  setStatus("已就绪。打开「乐谱柜」挑选乐谱,或直接点击 3D 琴键 / 用电脑键盘弹奏。");
})();
