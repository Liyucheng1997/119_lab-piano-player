// 吉他页:alphaTab 负责六线谱渲染与光标,声音由真实吉他采样(Tone.js)演奏。
// alphaTab 运行在"外部媒体"模式:我们的音频时钟就是"媒体",每帧把当前时间告诉 alphaTab,光标随之移动;
// 点击谱面、播放/暂停也经由 alphaTab 回调到这里的引擎。
//
// 拟真要点:每根弦同一时刻只有一个音 —— 同弦的新音会截断旧音(真吉他就是这样),
// 其余音自然延音;和弦内按弦序有毫秒级的先后(拨弦/扫弦的质感),旋律最高音略突出。

(function () {
  const $ = (id) => document.getElementById(id);
  const Hall = window.ConcertHall || null;
  const G3 = window.HallGuitar || null;
  if (!G3) document.body.classList.add("no-webgl");

  const statusEl = $("status");
  const playBtn = $("playBtn");
  const pauseBtn = $("pauseBtn");
  const stopBtn = $("stopBtn");
  const progressFill = $("progressFill");
  const progressBar = $("progressBar");
  const timeLabel = $("timeLabel");
  const tempoSlider = $("tempoSlider");
  const tempoVal = $("tempoVal");
  const trackSelect = $("trackSelect");
  const downloadGpBtn = $("downloadGpBtn");
  const tabWrap = $("tabWrap");
  const shelfGrid = $("shelfGrid");
  const scoreSearch = $("scoreSearch");

  const setStatus = (t, err) => {
    statusEl.textContent = t;
    statusEl.style.color = err ? "#ff9a8a" : "";
  };
  const fmt = (sec) => {
    sec = Math.max(0, sec);
    return Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
  };
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
  const STANDARD = [64, 59, 55, 50, 45, 40]; // 一弦 → 六弦

  if (typeof alphaTab === "undefined" || typeof Tone === "undefined") {
    setStatus("alphaTab / Tone.js 加载失败,请检查网络后刷新页面。", true);
    return;
  }

  // ================= 音色(真实吉他采样) =================
  const VOICES = {
    nylon: {
      label: "尼龙弦古典吉他",
      dir: "guitar/samples/nylon/",
      files: "A2 A3 A4 A5 As5 B1 B2 B3 B4 Cs3 Cs4 Cs5 D2 D3 D5 Ds4 E2 E3 E4 E5 Fs2 Fs3 Fs4 Fs5 G3 G5 Gs2 Gs4 Gs5",
      release: 0.45,
      eq: { low: 0.5, mid: 0, high: -1 },
    },
    steel: {
      label: "钢弦民谣吉他",
      dir: "guitar/samples/steel/",
      files: "A2 A3 A4 As2 As3 As4 B2 B3 B4 C3 C4 C5 Cs3 Cs4 Cs5 D2 D3 D4 D5 Ds2 Ds3 Ds4 E2 E3 E4 F2 F3 F4 Fs2 Fs3 Fs4 G2 G3 G4 Gs2 Gs3 Gs4",
      release: 0.35,
      eq: { low: -1, mid: 0, high: 0.5 },
    },
  };
  let voiceKey = "nylon";
  let sampler = null;
  let samplerReady = false;
  const eq = new Tone.EQ3({ low: 0.5, mid: 0, high: -1, lowFrequency: 180, highFrequency: 3800 });
  const reverb = new Tone.Reverb({ decay: 2.3, preDelay: 0.02, wet: 0.22 });
  const comp = new Tone.Compressor({ threshold: -20, ratio: 2.5, attack: 0.01, release: 0.2 });
  const limiter = new Tone.Limiter(-1.5);
  eq.chain(comp, reverb, limiter, Tone.Destination);

  function loadVoice(key) {
    const v = VOICES[key];
    voiceKey = key;
    samplerReady = false;
    const urls = {};
    v.files.split(" ").forEach((f) => (urls[f.replace("s", "#")] = f + ".mp3"));
    const next = new Tone.Sampler({
      urls,
      baseUrl: v.dir,
      release: v.release,
      onload: () => {
        if (sampler && sampler !== next) sampler.dispose();
        sampler = next;
        samplerReady = true;
        eq.low.value = v.eq.low;
        eq.mid.value = v.eq.mid;
        eq.high.value = v.eq.high;
        setStatus(`${v.label}音色就绪。${score ? "点击 ▶ 开始演奏。" : "打开「琴谱柜」挑一首曲子,或直接拨动 3D 琴弦。"}`);
      },
      onerror: (e) => setStatus("吉他音色加载失败:" + e, true),
    }).connect(eq);
    setStatus(`正在加载${v.label}音色…`);
  }

  // ================= alphaTab =================
  const CDN = "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist/";
  const api = new alphaTab.AlphaTabApi($("alphaTab"), {
    core: { fontDirectory: CDN + "font/", logLevel: alphaTab.LogLevel.Warning, enableLazyLoading: false },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
      resources: {
        mainGlyphColor: "#2a1d10",
        secondaryGlyphColor: "rgba(42,29,16,0.55)",
        staffLineColor: "#6b5233",
        barSeparatorColor: "#4a3620",
        scoreInfoColor: "#2a1d10",
      },
    },
    player: {
      playerMode: alphaTab.PlayerMode.EnabledExternalMedia,
      enableCursor: true,
      enableUserInteraction: true, // 点击谱面跳转
      scrollElement: tabWrap,
      scrollOffsetY: -24,
    },
  });
  // 非懒加载模式下重新渲染前手动清空,避免新旧谱面叠加
  api.renderStarted.on(() => {
    const surface = document.querySelector("#alphaTab .at-surface");
    if (surface) surface.innerHTML = "";
  });
  api.error.on((err) => {
    console.error("alphaTab error:", err);
    setStatus("加载或渲染出错:" + (err && err.message ? err.message : String(err)), true);
  });

  // ================= 演奏引擎 =================
  let score = null;
  let events = []; // { t, dur, midi, s, fret, vel }
  let totalSec = 0;
  let speed = 1;
  let scheduled = [];
  let playing = false;
  let rafId = 0;
  let currentMeta = null;
  let externalOutput = null;

  // 用 alphaTab 自己的 MIDI 生成器展开反复、连音线、扫弦等,再把每个音对回谱面上的弦和品
  function extractEvents(sc) {
    const raw = [];
    const tempos = [];
    const handler = {
      addTimeSignature() {}, addRest() {}, addControlChange() {}, addProgramChange() {}, addNoteBend() {}, addBend() {}, finishTrack() {}, addTickShift() {},
      addTempo(tick, bpm) {
        tempos.push({ tick, bpm });
      },
      addNote(track, start, length, key, velocity) {
        raw.push({ track, start, length, key, velocity });
      },
    };
    const gen = new alphaTab.midi.MidiFileGenerator(sc, api.settings, handler);
    gen.generate();
    tempos.sort((a, b) => a.tick - b.tick);
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: sc.tempo || 120 });
    // tick → 秒
    const segs = [];
    let acc = 0;
    tempos.forEach((tp, i) => {
      segs.push({ tick: tp.tick, sec: acc, bpm: tp.bpm });
      const next = tempos[i + 1];
      if (next) acc += ((next.tick - tp.tick) / 960) * (60 / tp.bpm);
    });
    const toSec = (tick) => {
      let k = 0;
      while (k + 1 < segs.length && segs[k + 1].tick <= tick) k++;
      return segs[k].sec + ((tick - segs[k].tick) / 960) * (60 / segs[k].bpm);
    };
    const out = [];
    const hints = new Map();
    raw.sort((a, b) => a.start - b.start);
    for (const n of raw) {
      const track = sc.tracks[n.track];
      if (!track) continue;
      const staff = track.staves[0];
      if (staff.isPercussion) continue;
      const tuning = staff.tuning && staff.tuning.length ? staff.tuning : STANDARD;
      let s = -1, fret = 0;
      const r = gen.tickLookup.findBeat(new Set([n.track]), n.start, hints.get(n.track) || null);
      if (r) {
        hints.set(n.track, r);
        const note = r.beat.notes.find((x) => x.realValue === n.key);
        if (note && note.string > 0) {
          s = tuning.length - note.string;
          fret = note.fret;
        }
      }
      if (s < 0) {
        // 找不到对应的谱面音符(装饰音等):按调弦选一根能弹到的弦
        let best = null;
        tuning.forEach((open, i) => {
          const f = n.key - open;
          if (f >= 0 && f <= 24 && (!best || f < best.f)) best = { s: i, f };
        });
        s = best ? best.s : 0;
        fret = best ? best.f : 0;
      }
      const t = toSec(n.start);
      const len = toSec(n.start + n.length) - t;
      out.push({ t, len, midi: n.key, s: Math.min(5, s), fret, vel: n.velocity / 127, track: n.track, stringCount: tuning.length });
    }
    out.sort((a, b) => a.t - b.t || b.s - a.s);
    // 同一时刻的一组音:旋律最高音更响、低音稍收,并按弦序错开几毫秒
    let i = 0;
    while (i < out.length) {
      let j = i;
      while (j < out.length && out[j].t - out[i].t < 0.004) j++;
      const grp = out.slice(i, j);
      const top = grp.reduce((a, b) => (b.midi > a.midi ? b : a), grp[0]);
      const low = grp.reduce((a, b) => (b.midi < a.midi ? b : a), grp[0]);
      const step = grp.length >= 4 ? 0.011 : 0.005;
      grp.sort((a, b) => b.s - a.s).forEach((e, k) => {
        e.t += k * step;
        let v = 0.32 + e.vel * 0.55;
        if (grp.length > 1 && e === top) v *= 1.1;
        if (grp.length > 1 && e === low) v *= 0.93;
        e.vel = Math.max(0.15, Math.min(1, v * (0.96 + Math.random() * 0.08)));
      });
      i = j;
    }
    out.sort((a, b) => a.t - b.t);
    // 同弦截断:每根弦的音一直响到下一次拨同一根弦(最多多响 2.2 秒的自然余音)
    const lastOn = new Map();
    out.forEach((e) => {
      e.end = e.t + e.len + 2.2;
      const key = e.track + ":" + e.s;
      const prev = lastOn.get(key);
      if (prev) {
        prev.end = Math.min(prev.end, e.t);
        prev.next = e;
      }
      lastOn.set(key, e);
    });
    out.forEach((e) => (e.dur = Math.max(0.06, e.end - e.t)));
    return out;
  }

  function clearSchedule() {
    scheduled.forEach((id) => Tone.Transport.clear(id));
    scheduled = [];
    Tone.Draw.cancel(0);
  }

  function schedule(fromSec) {
    clearSchedule();
    for (const e of events) {
      if (e.t < fromSec - 0.001) continue;
      const id = Tone.Transport.schedule((time) => {
        if (samplerReady) sampler.triggerAttackRelease(noteName(e.midi), e.dur / speed, time, e.vel);
        if (G3) {
          Tone.Draw.schedule(() => {
            G3.pluck(e.s, e.fret, { velocity: e.vel, duration: Math.min(2.5, e.dur) });
            G3.flashNote(e.s, e.fret, e.midi);
          }, time);
          Tone.Draw.schedule(() => {
            if (!e.next || e.next.t > e.end + 0.01) G3.release(e.s);
          }, time + e.dur / speed);
        }
      }, e.t / speed);
      scheduled.push(id);
    }
    const endId = Tone.Transport.schedule((time) => {
      Tone.Draw.schedule(() => finish(), time);
    }, totalSec / speed + 0.4);
    scheduled.push(endId);
  }

  function positionSec() {
    return Math.max(0, Tone.Transport.seconds) * speed;
  }

  function tick() {
    const sec = positionSec();
    if (externalOutput) externalOutput.updatePosition(sec * 1000);
    updateProgress(sec);
    if (playing) rafId = requestAnimationFrame(tick);
  }

  function updateProgress(sec) {
    const pct = totalSec > 0 ? Math.min(100, (sec / totalSec) * 100) : 0;
    progressFill.style.width = pct + "%";
    timeLabel.textContent = `${fmt(sec / speed)} / ${fmt(totalSec / speed)}`;
  }

  async function enginePlay() {
    if (!score) return;
    await Tone.start();
    if (!samplerReady) {
      setStatus("等待吉他音色加载完成…");
      await Tone.loaded();
    }
    if (!playing) {
      const from = pendingSeek != null ? pendingSeek : pausedAt;
      pendingSeek = null;
      Tone.Transport.stop();
      Tone.Transport.cancel();
      schedule(from);
      Tone.Transport.start("+0.06", from / speed);
      playing = true;
    }
    setPlayingUI(true);
    setStatus(`演奏中 · ${VOICES[voiceKey].label}`);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  let pausedAt = 0;
  let pendingSeek = null;
  function enginePause() {
    if (playing) pausedAt = positionSec();
    playing = false;
    // 用 stop 而不是 pause:跳转时可能还有一个"稍后开始"排在时间线上,stop 会一并取消
    Tone.Transport.stop();
    Tone.Transport.cancel();
    clearSchedule();
    if (samplerReady) sampler.releaseAll(Tone.now() + 0.05);
    if (G3) G3.dampAll();
    setPlayingUI(false);
    cancelAnimationFrame(rafId);
  }
  function engineSeek(sec) {
    sec = Math.max(0, Math.min(totalSec, sec));
    // alphaTab 暂停/同步时会把我们刚报告的位置原样回传,差距很小就不必重排(否则会打断正在响的音)
    if (playing && Math.abs(sec - positionSec()) < 0.3) return;
    if (playing) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
      if (samplerReady) sampler.releaseAll();
      if (G3) G3.dampAll();
      schedule(sec);
      Tone.Transport.start("+0.04", sec / speed);
    } else {
      pausedAt = sec;
      pendingSeek = sec;
      if (externalOutput) externalOutput.updatePosition(sec * 1000);
      updateProgress(sec);
    }
  }
  function finish() {
    if ($("loopToggle").checked) {
      engineSeek(0);
      return;
    }
    api.stop();
    playing = false;
    pausedAt = 0;
    Tone.Transport.stop();
    clearSchedule();
    setPlayingUI(false);
    updateProgress(0);
    if (externalOutput) externalOutput.updatePosition(0);
    setStatus("演奏结束 —— ¡Olé! 👏");
  }

  // alphaTab 外部媒体接口:alphaTab 的播放/暂停/跳转都会回调到这里
  const mediaHandler = {
    get backingTrackDuration() {
      return totalSec * 1000;
    },
    playbackRate: 1,
    masterVolume: 1,
    seekTo(ms) {
      engineSeek(ms / 1000);
    },
    play() {
      enginePlay();
    },
    pause() {
      enginePause();
    },
  };
  api.playerReady.on(() => {
    externalOutput = api.player && api.player.output;
    if (externalOutput) externalOutput.handler = mediaHandler;
    updateButtons();
  });

  function setPlayingUI(on) {
    playBtn.disabled = on || !score;
    pauseBtn.disabled = !on;
    stopBtn.disabled = !score;
    if (Hall) Hall.setPerformance(on);
    wakeStage();
  }
  function updateButtons() {
    playBtn.disabled = !score || playing;
    stopBtn.disabled = !score;
  }

  api.scoreLoaded.on((sc) => {
    enginePause();
    score = sc;
    try {
      events = extractEvents(sc);
    } catch (e) {
      console.error(e);
      events = [];
      setStatus("解析乐谱音符失败:" + e.message, true);
    }
    totalSec = events.reduce((m, e) => Math.max(m, e.t + Math.min(e.len, 4)), 0);
    pausedAt = 0;
    pendingSeek = 0;
    updateProgress(0);
    downloadGpBtn.disabled = false;
    const title = (currentMeta && currentMeta.title) || sc.title || "未命名乐谱";
    const sub = currentMeta
      ? [currentMeta.composerZh || currentMeta.composer, currentMeta.original, currentMeta.tuning, fmt(totalSec)].filter(Boolean).join(" · ")
      : [sc.artist, `${sc.tracks.length} 条音轨`, fmt(totalSec)].filter(Boolean).join(" · ");
    $("npTitle").textContent = title;
    $("npSub").textContent = sub;
    if (G3) G3.setTitle(title, currentMeta ? currentMeta.original : sc.artist || "");
    // 多音轨:默认只显示第一条,谱面更清爽(演奏为全部音轨)
    trackSelect.innerHTML = "";
    if (sc.tracks.length > 1) {
      const all = document.createElement("option");
      all.value = "-1";
      all.textContent = `全部音轨(${sc.tracks.length})`;
      trackSelect.appendChild(all);
      sc.tracks.forEach((t, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `音轨 ${i + 1}:${t.name || "未命名"}`;
        trackSelect.appendChild(opt);
      });
      trackSelect.hidden = false;
      trackSelect.value = "0";
      api.renderTracks([sc.tracks[0]]);
    } else trackSelect.hidden = true;
    updateButtons();
    setStatus(`已加载《${title}》:${events.length} 个音,约 ${fmt(totalSec)}。${autoplayNext ? "" : "点击 ▶ 开始演奏。"}`);
    renderShelf();
    if (autoplayNext) {
      autoplayNext = false;
      setTimeout(() => api.play(), 250);
    }
  });

  trackSelect.addEventListener("change", () => {
    if (!api.score) return;
    const v = parseInt(trackSelect.value, 10);
    api.renderTracks(v === -1 ? api.score.tracks : [api.score.tracks[v]]);
  });

  // ================= 曲库(琴谱柜) =================
  let library = [];
  let levelFilter = "全部";
  let autoplayNext = false;
  const LEVELS = ["全部", "入门", "进阶", "演奏级"];

  function renderShelf() {
    const tabs = $("levelTabs");
    tabs.innerHTML = "";
    LEVELS.forEach((lv) => {
      const b = document.createElement("button");
      const n = lv === "全部" ? library.length : library.filter((w) => w.level === lv).length;
      b.textContent = `${lv} · ${n}`;
      b.className = lv === levelFilter ? "active" : "";
      b.addEventListener("click", () => {
        levelFilter = lv;
        renderShelf();
      });
      tabs.appendChild(b);
    });
    const q = scoreSearch.value.trim().toLocaleLowerCase();
    const list = library.filter(
      (w) =>
        (levelFilter === "全部" || w.level === levelFilter) &&
        (!q || [w.title, w.original, w.composer, w.composerZh].join(" ").toLocaleLowerCase().includes(q))
    );
    shelfGrid.innerHTML = "";
    list.forEach((w) => {
      const card = document.createElement("button");
      card.className = "sheet-card" + (currentMeta && currentMeta.id === w.id ? " playing" : "");
      let h = 0;
      for (const ch of w.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
      card.style.setProperty("--tilt", (((Math.abs(h) % 100) / 100 - 0.5) * 3.2).toFixed(2) + "deg");
      card.title = `放上谱架并自动演奏:${w.title}`;
      card.innerHTML = `
        <span class="sheet-series"></span>
        <span class="sheet-clef guitar-clef">𝄞</span>
        <span class="sheet-title"></span>
        <span class="sheet-composer"></span>
        <span class="sheet-staff tab-staff"></span>
        <span class="sheet-meta"></span>
        <span class="sheet-play">▶ 放上谱架演奏</span>`;
      card.querySelector(".sheet-series").textContent = "Guitarra · " + w.level;
      card.querySelector(".sheet-title").textContent = w.title;
      card.querySelector(".sheet-composer").textContent = `${w.composerZh} · ${w.original}`;
      card.querySelector(".sheet-meta").textContent = `${fmt(w.durationSec)} · ${w.tuning}`;
      card.addEventListener("click", () => {
        Tone.start();
        card.classList.add("flying");
        setTimeout(closeShelf, 260);
        loadLibraryPiece(w, true);
      });
      shelfGrid.appendChild(card);
    });
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "shelf-empty";
      empty.textContent = library.length ? "没有找到匹配的曲子。" : "正在从档案室取出琴谱…";
      shelfGrid.appendChild(empty);
    }
    $("libraryCount").textContent = `${library.length} 首古典吉他名曲 · 点击卡片即放上谱架自动演奏`;
  }

  async function loadLibraryPiece(w, autoplay) {
    enginePause();
    currentMeta = w;
    autoplayNext = !!autoplay;
    $("npTitle").textContent = w.title;
    $("npSub").textContent = "正在把琴谱放上谱架…";
    setStatus(`正在加载《${w.title}》…`);
    try {
      const res = await fetch(w.url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      api.load(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      setStatus("加载失败:" + e.message, true);
    }
  }

  function openShelf() {
    document.body.classList.add("shelf-open");
    renderShelf();
  }
  function closeShelf() {
    document.body.classList.remove("shelf-open");
  }

  // ================= 自由弹奏 =================
  const CHORDS = [
    ["C", [0, 1, 0, 2, 3, null]],
    ["G", [3, 0, 0, 0, 2, 3]],
    ["Am", [0, 1, 2, 2, 0, null]],
    ["Em", [0, 0, 0, 2, 2, 0]],
    ["D", [2, 3, 2, 0, null, null]],
    ["F", [1, 1, 2, 3, 3, 1]],
    ["E", [0, 0, 1, 2, 2, 0]],
    ["Dm", [1, 3, 2, 0, null, null]],
    ["B7", [2, 0, 2, 1, 2, null]],
    ["空弦", [0, 0, 0, 0, 0, 0]],
  ];
  let chord = CHORDS[0][1];
  const freeVoice = new Array(6).fill(null);
  function pluckFree(s, fret, vel = 0.75) {
    Tone.start();
    if (fret == null) return;
    const midi = STANDARD[s] + fret;
    if (samplerReady) {
      const now = Tone.now();
      if (freeVoice[s] != null) sampler.triggerRelease(noteName(freeVoice[s]), now);
      sampler.triggerAttack(noteName(midi), now + 0.002, vel);
      freeVoice[s] = midi;
    }
    if (G3) {
      G3.pluck(s, fret, { velocity: vel, duration: 2.6 });
      G3.flashNote(s, fret, midi);
    }
  }
  function strum(down) {
    const order = down ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
    order
      .filter((s) => chord[s] != null)
      .forEach((s, k) => setTimeout(() => pluckFree(s, chord[s], down ? 0.7 - k * 0.02 : 0.6), k * (down ? 14 : 11)));
  }
  function selectChord(i) {
    chord = CHORDS[i][1];
    if (G3) G3.setChord(chord);
    document.querySelectorAll("#chordButtons button").forEach((b, k) => b.classList.toggle("active", k === i));
  }
  CHORDS.forEach(([name], i) => {
    const b = document.createElement("button");
    b.textContent = name;
    b.title = `和弦 ${name}(键 ${i + 1 <= 9 ? i + 1 : ""})`;
    b.addEventListener("click", () => {
      selectChord(i);
      strum(true);
    });
    $("chordButtons").appendChild(b);
  });
  selectChord(0);
  if (G3) G3.setInteractive((s, fret) => pluckFree(s, fret));
  $("strumDownBtn").addEventListener("click", () => strum(true));
  $("strumUpBtn").addEventListener("click", () => strum(false));
  const PICK_KEYS = { KeyA: 5, KeyS: 4, KeyD: 3, KeyF: 2, KeyG: 1, KeyH: 0 };
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === "Escape") closeShelf();
    if (e.code === "Space") {
      e.preventDefault();
      strum(true);
    } else if (e.code === "KeyJ") strum(false);
    else if (e.code in PICK_KEYS) pluckFree(PICK_KEYS[e.code], chord[PICK_KEYS[e.code]]);
    else if (/^Digit[1-9]$/.test(e.code)) {
      const i = parseInt(e.code.slice(5), 10) - 1;
      if (CHORDS[i]) selectChord(i);
    }
  });

  // ================= 控件 =================
  playBtn.addEventListener("click", () => {
    Tone.start();
    api.play();
  });
  // 暂停前先把精确位置告诉 alphaTab:它暂停时会按自己记录的位置回调 seekTo
  pauseBtn.addEventListener("click", () => {
    if (externalOutput && playing) externalOutput.updatePosition(positionSec() * 1000);
    api.pause();
  });
  stopBtn.addEventListener("click", () => {
    api.stop();
    enginePause();
    pausedAt = 0;
    pendingSeek = 0;
    updateProgress(0);
    if (externalOutput) externalOutput.updatePosition(0);
    setStatus("已停止。");
  });
  tempoSlider.addEventListener("input", () => {
    const sec = playing ? positionSec() : pausedAt;
    speed = parseInt(tempoSlider.value, 10) / 100;
    tempoVal.textContent = tempoSlider.value;
    if (playing) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
      schedule(sec);
      Tone.Transport.start("+0.04", sec / speed);
    } else updateProgress(sec);
  });
  progressBar.addEventListener("click", (ev) => {
    if (!score) return;
    const r = progressBar.getBoundingClientRect();
    const sec = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * totalSec;
    engineSeek(sec);
    if (externalOutput) externalOutput.updatePosition(sec * 1000);
  });
  $("voiceSelect").addEventListener("change", (e) => loadVoice(e.target.value));
  $("labelToggle").addEventListener("change", (e) => G3 && G3.setShowLabels(e.target.checked));
  $("glowToggle").addEventListener("change", (e) => G3 && G3.setGlow(e.target.checked));
  $("reverbToggle").addEventListener("change", (e) => reverb.wet.rampTo(e.target.checked ? 0.22 : 0, 0.3));
  $("orbitToggle").addEventListener("change", (e) => Hall && Hall.setAutoOrbit(e.target.checked));
  $("openShelfBtn").addEventListener("click", openShelf);
  $("closeShelfBtn").addEventListener("click", closeShelf);
  $("shelfBackdrop").addEventListener("click", closeShelf);
  scoreSearch.addEventListener("input", renderShelf);

  // 演奏中鼠标静止 3 秒,隐藏控制条与机位按钮
  const stageEl = $("stage3d");
  let idleTimer = null;
  function wakeStage() {
    stageEl.classList.remove("idle");
    clearTimeout(idleTimer);
    if (playing) idleTimer = setTimeout(() => stageEl.classList.add("idle"), 3000);
  }
  ["pointermove", "pointerdown", "wheel"].forEach((t) => stageEl.addEventListener(t, wakeStage, { passive: true }));

  if (Hall) {
    const dock = $("cameraDock");
    Object.entries(Hall.presets).forEach(([key, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (key === Hall.preset) b.classList.add("active");
      b.addEventListener("click", () => {
        Hall.flyTo(key);
        dock.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      });
      dock.appendChild(b);
    });
  }

  // 上传 Guitar Pro / MusicXML
  $("fileInput").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    enginePause();
    currentMeta = null;
    setStatus(`正在加载 ${file.name} …`);
    try {
      api.load(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      setStatus("读取文件失败:" + e.message, true);
    }
    ev.target.value = "";
  });

  // 导出当前乐谱为 .gp
  downloadGpBtn.addEventListener("click", () => {
    if (!api.score) return;
    try {
      const data = new alphaTab.exporter.Gp7Exporter().export(api.score, api.settings);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
      a.download = `${(currentMeta && currentMeta.title) || api.score.title || "乐谱"}.gp`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setStatus("导出 .gp 失败:" + e.message, true);
    }
  });

  // ================= 图片识谱(仅本地服务器可用) =================
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  $("aiLabel").hidden = !isLocal;
  if (isLocal) {
    const naturalSort = (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
    const toDataURL = (f) =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error(`读取 ${f.name} 失败`));
        r.readAsDataURL(f);
      });
    async function poll(jobId) {
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        const resp = await fetch(`/api/recognize-guitar/status?id=${encodeURIComponent(jobId)}`);
        if (!resp.ok) throw new Error(`查询识谱进度失败 HTTP ${resp.status}`);
        const d = await resp.json();
        if (d.status === "done") return d.alphaTex;
        if (d.status === "error") throw new Error(d.error || "识谱失败");
        setStatus(`AI 识谱中(已用 ${Math.round(d.elapsedMs / 1000)} 秒):${d.message || "处理中…"}`);
      }
    }
    let busy = false;
    $("imageInput").addEventListener("change", async (ev) => {
      const files = Array.from(ev.target.files || []);
      ev.target.value = "";
      if (!files.length || busy) return;
      busy = true;
      try {
        files.sort(naturalSort);
        const name = files[0].name.replace(/\.[^.]+$/, "").replace(/[\s\-_]*\d+$/, "");
        const images = [];
        for (const f of files) images.push({ name: f.name, mime: f.type || "image/jpeg", data: await toDataURL(f) });
        setStatus(`正在上传 ${files.length} 张图片…`);
        const resp = await fetch("/api/recognize-guitar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, images }) });
        if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
        const d = await resp.json();
        const tex = d.cached ? d.alphaTex : await poll(d.jobId);
        currentMeta = null;
        api.tex(tex);
      } catch (e) {
        setStatus("图片识谱失败:" + e.message, true);
      } finally {
        busy = false;
      }
    });
  }

  // ================= 启动 =================
  loadVoice("nylon");
  fetch("guitar/library/manifest.json")
    .then((r) => r.json())
    .then((m) => {
      library = m.works || [];
      renderShelf();
    })
    .catch(() => setStatus("曲库清单加载失败。", true));
})();
