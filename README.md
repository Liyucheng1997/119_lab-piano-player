# 🎵 乐器演奏 · 乐谱播放器(钢琴 + 吉他)

首页选择乐器后进入对应播放器:

- **🎹 钢琴**:上传钢琴谱图片 →(Audiveris OMR 识别)→ 虚拟钢琴自动演奏 + 实时按键高亮。
- **🎸 吉他**:加载 Guitar Pro 吉他谱(`.gp3` / `.gp4` / `.gp5` / `.gpx` / `.gp`),alphaTab 渲染六线谱并用内置合成器演奏。

## 当前进度

**吉他谱图片 AI 识谱(可选功能,按需使用)**
- 吉他页「📷 图片识谱(AI)」:上传吉他谱照片(JPG/PNG,可多选,多页谱按文件名 1、2 数字排序合并为一首)
- 架构:AI 只负责"读谱"——各页**并行**调用本机 Claude Code CLI 无头模式(`claude -p`,走订阅无需 API key),从中文弹唱谱(和弦图 + 六线谱 TAB + 简谱 + 歌词)读出每小节的和弦名/简谱/歌词,输出紧凑 JSON;乐谱转换全部由本地确定性代码完成(`tools/jianpu_expander.js`:简谱→吉他品位、时值展开、小节校齐、按和弦生成分解/扫弦伴奏、\capo)
- 保障:流式进度显示、卡死检测(5 分钟无响应中止)、输出膨胀保护、解析失败重试、按图片哈希缓存(`data/guitar-ocr-cache/`,二次加载秒回);完成后可「下载 .gp」导出
- ⚠️ 注意:每次识别会消耗 Claude 订阅额度,且耗时以分钟计;不点「图片识谱」按钮则无任何开销
- 限制:AI 识谱是近似转写(和弦与旋律较准,伴奏为按谱面推断的编配),复杂谱可能有错音

**吉他播放器(已完成)**
- 上传 Guitar Pro 谱(gp3 / gp4 / gp5 / gpx / gp,也兼容 MusicXML / CapXML),alphaTab 自动识别格式
- 六线谱 + 五线谱渲染,播放光标实时跟随,点击谱面任意位置跳转播放
- 内置合成器(SONiVOX SoundFont)演奏,支持多音轨(可选择显示某一音轨,播放为全部音轨)
- 播放 / 暂停 / 停止、速度调节(40%~160%)、进度条点击跳转
- 节拍器、前置数拍、循环播放开关
- 自带 2 首示例(`.gp` 文件由 `tools/generate_guitar_samples.js` 从 alphaTex 生成)+ 2 首内置文本谱

**钢琴前端播放器(已完成)**
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

运行时零依赖,只需 Node。第三方库(Tone.js / OSMD / alphaTab)、钢琴音色和吉他 SoundFont 走 CDN,需联网。(`@coderline/alphatab` 仅作为 devDependency 用于生成吉他示例谱。)

## 目录结构

```
public/
  index.html           # 首页:选择乐器(钢琴 / 吉他)
  piano.html           # 钢琴播放器页面
  guitar.html          # 吉他播放器页面
  style.css            # 样式(共用)
  piano.js             # SVG 钢琴键盘(按 MIDI number 高亮)
  musicxml-parser.js   # MusicXML → 音符序列(start/duration/midi)
  app.js               # 钢琴:OSMD 渲染 + Tone.js 调度 + 高亮主逻辑
  guitar.js            # 吉他:alphaTab 加载/渲染/播放主逻辑
  samples/twinkle.musicxml
  samples/*.gp          # 吉他示例谱(Guitar Pro 格式)
  openewld/             # OpenEWLD 静态示例曲库 + manifest.json + OpenEWLD.db
  musetrainer/          # MuseTrainer 静态示例曲库 + manifest.json
server.js              # 静态服务器 + /api/recognize-guitar 图片识谱接口
tools/guitar_tab_recognizer.js # 调 claude CLI 读图→alphaTex,校验+重试
data/guitar-ocr-cache/  # 识谱结果缓存(按图片哈希,gitignore)
tools/import_openewld.py # 从本地 OpenEWLD 仓库重新生成 public/openewld
tools/import_musetrainer.py # 从本地 MuseTrainer 仓库重新生成 public/musetrainer
tools/generate_guitar_samples.js # alphaTex → .gp 吉他示例谱(node 运行,需 npm install)
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
