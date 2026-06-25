# 🎹 钢琴演奏 · 乐谱播放器

上传钢琴谱图片 →(Audiveris OMR 识别)→ 虚拟钢琴自动演奏 + 实时按键高亮。

## 当前进度

**第一版(已完成):前端播放器**
- 加载 MusicXML(样例「小星星」或自己上传 `.musicxml/.xml`)
- OpenSheetMusicDisplay 渲染五线谱
- Tone.js + Salamander 真实钢琴音色自动演奏
- SVG 钢琴键盘随演奏实时高亮按键
- 播放 / 暂停 / 停止、速度调节(40%~160%)、进度条

**下一步:接入 Audiveris(图片识别)** — 见下方。

## 运行

```bash
node server.js
# 打开 http://localhost:5173
```

零依赖,只需 Node。第三方库(Tone.js / OSMD)和钢琴音色走 CDN,需联网。

## 目录结构

```
public/
  index.html           # 页面
  style.css            # 样式
  piano.js             # SVG 钢琴键盘(按 MIDI number 高亮)
  musicxml-parser.js   # MusicXML → 音符序列(start/duration/midi)
  app.js               # OSMD 渲染 + Tone.js 调度 + 高亮主逻辑
  samples/twinkle.musicxml
server.js              # 零依赖静态服务器
```

## 下一步:接入 Audiveris

1. 装 Audiveris(Windows 安装包自带 JRE):https://github.com/Audiveris/audiveris/releases
2. 在 `server.js` 加上传接口 `POST /api/recognize`:
   - 接收图片 → 存临时文件
   - 调用 CLI:`audiveris -batch -export -output <dir> <image>`
   - 产物是 `.mxl`(压缩 MusicXML),用 unzip 取出里面的 `.xml`
   - 返回 MusicXML 文本给前端
3. 前端把「上传图片」的返回结果喂给现有的 `loadMusicXML()` 即可复用整套播放逻辑。

> 注意:Audiveris 对清晰的印刷谱效果较好,复杂谱/手写谱会有错音,产品应设计成「识别 + 可人工修正」。
