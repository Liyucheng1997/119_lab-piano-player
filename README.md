# 🎹 钢琴演奏 · 乐谱播放器

上传钢琴谱图片 →(Audiveris OMR 识别)→ 虚拟钢琴自动演奏 + 实时按键高亮。

## 当前进度

**前端播放器(已完成)**
- 加载 MusicXML(内置 5 首经典样例,或上传 `.musicxml` / `.xml` / `.mxl`,`.mxl` 自动解压)
- 已嵌入 OpenEWLD 示例曲库(502 首 `.mxl`),可在网页里搜索并直接加载
- 已嵌入 MuseTrainer 曲库(69 首 `.mxl`)
- 乐谱选择改为两级:先选择系列,再在该系列里搜索和选择曲目
- 鼠标点击/拖动键盘自由演奏
- OpenSheetMusicDisplay 渲染五线谱
- Tone.js + Salamander 真实钢琴音色自动演奏
- SVG 钢琴键盘随演奏实时高亮按键
- 敲键时键上方漂浮音名(如 E2),可一键开关
- 五线谱光标实时跟随当前音符(随音频时钟自校正)
- 乐谱滚动对照:按当前演奏系统自适应视窗高度,适配双手谱和多谱表/歌词谱
- 点击乐谱任一音符,从该处开始演奏
- 播放 / 暂停 / 停止、速度调节(40%~160%)、进度条
- 多谱表乐谱自适应视窗:按当前演奏系统聚焦滚动,超高系统会自动缩放,并支持手动谱面缩放(45%~120%)
- 大谱优化:解压与音符解析在 Web Worker 执行;超过 48 小节时先渲染预览，完整 SVG 排版按需触发，避免页面加载时卡死

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
  openewld/             # OpenEWLD 静态示例曲库 + manifest.json + OpenEWLD.db
  musetrainer/          # MuseTrainer 静态示例曲库 + manifest.json
server.js              # 零依赖静态服务器
tools/import_openewld.py # 从本地 OpenEWLD 仓库重新生成 public/openewld
tools/import_musetrainer.py # 从本地 MuseTrainer 仓库重新生成 public/musetrainer
```

## 示例曲库

当前页面有三个系列:

- 示例系列:项目自带 5 首短曲
- OpenEWLD:从本地 OpenEWLD 导入 502 首
- MuseTrainer:从 `git@github.com:musetrainer/library.git` 克隆并导入 69 首

当前已从以下本地库导入外部曲库:

```text
E:\音乐收藏库\04_乐器音乐\钢琴曲乐谱\OpenEWLD
E:\音乐收藏库\04_乐器音乐\钢琴曲乐谱\library
```

重新导入或更新曲库:

```bash
python tools/import_openewld.py "E:\音乐收藏库\04_乐器音乐\钢琴曲乐谱\OpenEWLD" --public-root public
python tools/import_musetrainer.py "E:\音乐收藏库\04_乐器音乐\钢琴曲乐谱\library" --public-root public
```

导入结果会分别写入 `public/openewld/manifest.json` 和 `public/musetrainer/manifest.json`,网页启动后会自动读取这些清单。OpenEWLD 的原始 SQLite 数据库也保留在 `public/openewld/OpenEWLD.db`,但浏览器播放使用的是静态 JSON 清单和 `.mxl` 文件。

## 下一步:接入 Audiveris

1. 装 Audiveris(Windows 安装包自带 JRE):https://github.com/Audiveris/audiveris/releases
2. 在 `server.js` 加上传接口 `POST /api/recognize`:
   - 接收图片 → 存临时文件
   - 调用 CLI:`audiveris -batch -export -output <dir> <image>`
   - 产物是 `.mxl`(压缩 MusicXML),用 unzip 取出里面的 `.xml`
   - 返回 MusicXML 文本给前端
3. 前端把「上传图片」的返回结果交给现有的后台解析和乐谱渲染流程即可复用整套播放逻辑。

> 注意:Audiveris 对清晰的印刷谱效果较好,复杂谱/手写谱会有错音,产品应设计成「识别 + 可人工修正」。
