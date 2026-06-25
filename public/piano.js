// 钢琴键盘:用绝对定位的 div 生成,按 MIDI number 高亮。
// 默认范围 C2(36) ~ C6(84),覆盖大多数旋律谱。

const Piano = (function () {
  const SEMITONE_IN_OCTAVE = [0, 2, 4, 5, 7, 9, 11]; // 白键: C D E F G A B
  const BLACK_OFFSETS = { 1: true, 3: true, 6: true, 8: true, 10: true }; // 黑键半音
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  let lowMidi = 36; // C2
  let highMidi = 84; // C6
  const keyEls = {}; // midi -> element
  let onDownCb = null; // 自由演奏:按下回调
  let onUpCb = null; // 自由演奏:松开回调
  let activePointerMidi = null; // 当前鼠标/触摸按住的键

  function isBlack(midi) {
    return BLACK_OFFSETS[((midi % 12) + 12) % 12] === true;
  }

  function noteName(midi) {
    const octave = Math.floor(midi / 12) - 1;
    return NOTE_NAMES[midi % 12] + octave;
  }

  // 统计范围内的白键数,白键等宽布局,黑键叠在相邻白键之间
  function build(containerId, range) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if (range) {
      lowMidi = range.low;
      highMidi = range.high;
    }
    Object.keys(keyEls).forEach((k) => delete keyEls[k]);

    // 先数白键
    const whiteMidis = [];
    for (let m = lowMidi; m <= highMidi; m++) {
      if (!isBlack(m)) whiteMidis.push(m);
    }
    const whiteCount = whiteMidis.length;
    const whiteW = 100 / whiteCount; // 百分比宽度
    const blackW = whiteW * 0.62;
    const containerH = 160;
    const blackH = containerH * 0.62;

    // 白键索引映射,便于定位黑键
    const whiteIndex = {};
    whiteMidis.forEach((m, i) => (whiteIndex[m] = i));

    // 放白键
    whiteMidis.forEach((m, i) => {
      const el = document.createElement("div");
      el.className = "key-white";
      el.style.left = i * whiteW + "%";
      el.style.width = whiteW + "%";
      el.style.height = containerH + "px";
      el.dataset.midi = m;
      // 每个 C 标注音名
      if (m % 12 === 0) {
        const label = document.createElement("span");
        label.className = "key-label";
        label.textContent = noteName(m);
        el.appendChild(label);
      }
      container.appendChild(el);
      keyEls[m] = el;
    });

    // 放黑键:黑键位于其左侧白键的右边缘附近
    for (let m = lowMidi; m <= highMidi; m++) {
      if (!isBlack(m)) continue;
      const leftWhite = m - 1; // 黑键左边总是一个白键(C#在C右,D#在D右...)
      if (!(leftWhite in whiteIndex)) continue;
      const idx = whiteIndex[leftWhite];
      const el = document.createElement("div");
      el.className = "key-black";
      el.style.left = (idx + 1) * whiteW - blackW / 2 + "%";
      el.style.width = blackW + "%";
      el.style.height = blackH + "px";
      el.dataset.midi = m;
      container.appendChild(el);
      keyEls[m] = el;
    }

    attachInteraction(container);
  }

  // 自由演奏:鼠标/触摸点击键盘发声
  function attachInteraction(container) {
    const midiAt = (target) => {
      const el = target.closest && target.closest("[data-midi]");
      return el ? parseInt(el.dataset.midi, 10) : null;
    };
    const press = (midi) => {
      if (midi == null || midi === activePointerMidi) return;
      release();
      activePointerMidi = midi;
      highlight(midi, true);
      if (onDownCb) onDownCb(midi);
    };
    const release = () => {
      if (activePointerMidi == null) return;
      highlight(activePointerMidi, false);
      if (onUpCb) onUpCb(activePointerMidi);
      activePointerMidi = null;
    };

    container.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      press(midiAt(e.target));
    });
    // 按住拖动可滑奏
    container.addEventListener("pointermove", (e) => {
      if (activePointerMidi == null) return;
      press(midiAt(e.target));
    });
    container.addEventListener("pointerup", release);
    container.addEventListener("pointerleave", release);
    container.addEventListener("pointercancel", release);
  }

  // 注册自由演奏回调
  function setInteractive(onDown, onUp) {
    onDownCb = onDown;
    onUpCb = onUp;
  }

  function highlight(midi, on) {
    const el = keyEls[midi];
    if (el) el.classList.toggle("active", on);
  }

  function clearAll() {
    Object.values(keyEls).forEach((el) => el.classList.remove("active"));
  }

  // 根据一组音符自动扩展键盘范围,确保所有音都能显示
  function ensureRange(midis) {
    if (!midis.length) return;
    let lo = Math.min(...midis);
    let hi = Math.max(...midis);
    // 往两边留一点余量,并对齐到 C
    lo = Math.min(lowMidi, lo - 2);
    hi = Math.max(highMidi, hi + 2);
    while (lo % 12 !== 0) lo--; // 对齐到 C
    while (hi % 12 !== 11) hi++; // 对齐到 B,使最高也成整组
    return { low: lo, high: hi };
  }

  return { build, highlight, clearAll, noteName, ensureRange, isBlack, setInteractive };
})();
