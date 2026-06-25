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

    initSampler();
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = false;
    updateProgress(0);
    setStatus(
      `已加载「${label}」:${parsed.notes.length} 个音符,时长约 ${fmtTime(parsed.totalDuration)},原速 ${Math.round(parsed.tempo)} BPM。`
    );
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
        // 高亮:用 Tone.Draw 对齐到音频时钟
        Tone.Draw.schedule(() => Piano.highlight(n.midi, true), time);
        Tone.Draw.schedule(() => Piano.highlight(n.midi, false), time + dur);
      }, start);
      scheduledIds.push(id);
    });
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
      schedule();
      Tone.Transport.start();
    }
    playBtn.disabled = true;
    pauseBtn.disabled = false;
    setStatus("演奏中…");
    loopProgress();
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

  function loopProgress() {
    const tick = () => {
      const elapsed = Tone.Transport.seconds;
      updateProgress(elapsed);
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

  $("fileInput").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".mxl")) {
      setStatus(".mxl 是压缩格式,当前版本请先解压成 .musicxml/.xml 再上传(后端接入 Audiveris 后会自动处理)。", true);
      return;
    }
    const text = await file.text();
    await loadMusicXML(text, file.name);
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
