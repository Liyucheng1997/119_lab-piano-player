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

  let osmd = null;
  let sampler = null;
  let samplerReady = false;
  let parsed = null; // { notes, totalDuration, tempo }
  let scheduledIds = [];
  let rafId = null;
  let tempoScale = 1.0; // 速度倍率
  let cursorTimes = []; // 每个光标步对应的时间(秒,原速),用于同步五线谱光标
  let cursorPositions = []; // 每步的屏幕位置 {x, y, time, index},用于点击定位
  let lineGap = 0; // 行距(相邻系统五线谱顶部之差)
  let cursorIndex = 0; // 当前光标已推进到第几步
  let curLineTop = null; // 当前行的纵向位置
  let prevLineTop = 0; // 上一行的纵向位置(用于把当前行定位到第二行)

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

  // 初始化 OSMD
  function initOSMD() {
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmdContainer", {
      autoResize: true,
      drawTitle: true,
      backend: "svg",
      followCursor: false, // 不用 OSMD 默认滚动(会滚动整页),改为手动在乐谱视窗内滚动
    });
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

  // 加载并渲染一个 MusicXML 文本
  async function loadMusicXML(xmlText, label) {
    stopPlayback();
    try {
      setStatus("正在渲染乐谱…");
      await osmd.load(xmlText);
      osmd.render();
    } catch (e) {
      setStatus("乐谱渲染失败:" + e.message, true);
      return;
    }
    try {
      parsed = MusicXMLParser.parse(xmlText);
    } catch (e) {
      setStatus("音符解析失败:" + e.message, true);
      return;
    }
    if (!parsed.notes.length) {
      setStatus("没有解析到任何音符。", true);
      return;
    }
    // 根据音域调整键盘范围
    const midis = parsed.notes.map((n) => n.midi);
    Piano.build("piano", Piano.ensureRange(midis));

    // 预扫描五线谱光标时间轴
    buildCursorTimeline();

    initSampler();
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = false;
    updateProgress(0);
    setStatus(
      `已加载「${label}」:${parsed.notes.length} 个音符,时长约 ${fmtTime(parsed.totalDuration)},原速 ${Math.round(parsed.tempo)} BPM。点击乐谱上任一音符可从该处开始演奏。`
    );
  }

  // 预扫描 OSMD 光标,记录每一步的音乐时间(秒,原速)。
  // 光标按时间戳逐"列"推进(含休止符),与音频用同一速度换算即可对齐。
  function buildCursorTimeline() {
    cursorTimes = [];
    cursorPositions = [];
    const cursor = osmd.cursor;
    if (!cursor) return;
    cursor.reset();
    cursor.show(); // 先显示,这样下面能读到光标元素的位置
    const wholeNoteSec = 240 / (parsed.tempo || 100); // 全音符秒数 = 4 拍 × 60/BPM
    const lineTops = new Set(); // 各行(乐谱系统)的纵向位置,用于测行距
    let guard = 0;
    while (!cursor.iterator.EndReached && guard < 100000) {
      const ts = cursor.iterator.currentTimeStamp.RealValue; // 距开头的全音符数
      const time = ts * wholeNoteSec;
      cursorTimes.push(time);
      const img = cursor.cursorElement;
      if (img && img.style.top) {
        const y = parseFloat(img.style.top);
        const x = parseFloat(img.style.left) || 0;
        lineTops.add(y);
        cursorPositions.push({ x, y, time, index: guard });
      }
      cursor.next();
      guard++;
    }
    cursor.reset();
    cursor.show();
    cursorIndex = 0;
    resetCursorScroll();
    // 按实测行距把乐谱视窗设成"正好两行"
    fitViewportToTwoLines([...lineTops].sort((a, b) => a - b));
    document.querySelector(".score-wrap").scrollTop = 0; // 加载时显示标题+第一行
  }

  // 根据相邻两行的间距,把视窗高度设为正好容纳两行(上一行 + 当前行),
  // 避免第三行的和弦/音符冒出来。不同谱子行距不同,故动态计算。
  function fitViewportToTwoLines(tops) {
    const wrap = document.querySelector(".score-wrap");
    if (tops.length >= 2) {
      const gap = tops[1] - tops[0]; // 行距(相邻系统五线谱顶部之差)
      lineGap = gap;
      // 1.8×行距:完整显示当前行,同时把第三行(及其上方的和弦字母)切在窗口外
      wrap.style.height = Math.round(1.8 * gap) + "px";
    } else {
      lineGap = 0;
      wrap.style.height = ""; // 只有一行:用 CSS 默认高度
    }
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
      cursorIndex = 0;
      resetCursorScroll();
      document.querySelector(".score-wrap").scrollTop = 0;
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

  // 让当前行落在视窗第二行:把"上一行"对齐到视窗顶部,当前行自然下移一行。
  // 这样当前行上方有刚弹过的一行作参照,也不会被顶部边缘遮挡和弦/标记。
  function scrollCursorIntoView() {
    const wrap = document.querySelector(".score-wrap");
    const img = osmd.cursor && osmd.cursor.cursorElement;
    if (!wrap || !img) return;
    const top = parseFloat(img.style.top) || 0;
    if (top !== curLineTop) {
      // 换行了:记录上一行位置(首行时没有上一行,就用自身)
      prevLineTop = curLineTop == null ? top : curLineTop;
      curLineTop = top;
    }
    wrap.scrollTop = Math.max(0, prevLineTop - 28); // 上一行贴顶(留出和弦行),当前行成为第二行
  }

  // 重置行跟踪状态(加载/重新播放/停止时调用)
  function resetCursorScroll() {
    curLineTop = null;
    prevLineTop = 0;
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

  $("labelToggle").addEventListener("change", (e) => {
    Piano.setShowLabels(e.target.checked);
  });

  $("osmdContainer").addEventListener("click", onScoreClick);

  $("loadSampleBtn").addEventListener("click", async () => {
    const url = $("sampleSelect").value;
    try {
      setStatus("正在加载样例…");
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      const label = $("sampleSelect").selectedOptions[0].textContent;
      await loadMusicXML(text, label);
    } catch (e) {
      setStatus("加载样例失败:" + e.message, true);
    }
  });

  // .mxl 是 ZIP:解压并取出真正的 MusicXML 文本
  function decodeMxl(arrayBuffer) {
    if (typeof fflate === "undefined") {
      throw new Error("解压库未加载,无法读取 .mxl");
    }
    const files = fflate.unzipSync(new Uint8Array(arrayBuffer));
    const decoder = new TextDecoder("utf-8");

    // 优先按 META-INF/container.xml 里指定的 rootfile 定位
    let target = null;
    if (files["META-INF/container.xml"]) {
      const containerXml = decoder.decode(files["META-INF/container.xml"]);
      const doc = new DOMParser().parseFromString(containerXml, "application/xml");
      const rootfile = doc.getElementsByTagName("rootfile")[0];
      const fullPath = rootfile && rootfile.getAttribute("full-path");
      if (fullPath && files[fullPath]) target = fullPath;
    }
    // 兜底:找第一个非 META-INF 的 .xml/.musicxml
    if (!target) {
      target = Object.keys(files).find(
        (n) => !n.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(n)
      );
    }
    if (!target) throw new Error(".mxl 内未找到 MusicXML 文件");
    return decoder.decode(files[target]);
  }

  $("fileInput").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      let text;
      if (file.name.toLowerCase().endsWith(".mxl")) {
        setStatus("正在解压 .mxl …");
        text = decodeMxl(await file.arrayBuffer());
      } else {
        text = await file.text();
      }
      await loadMusicXML(text, file.name);
    } catch (e) {
      setStatus("读取文件失败:" + e.message, true);
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
  initOSMD();
  Piano.build("piano");
  initSampler(); // 提前加载音色,使自由演奏开箱即用
  setStatus("已就绪。可直接用鼠标点击键盘弹奏,或「加载样例」试听经典曲目。");
})();
