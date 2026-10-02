# 🎵 乐器演奏 · 乐谱播放器(钢琴 + 吉他)

在 Three.js 还原的维也纳金色大厅里,让一台 88 键音乐会三角钢琴和一把古典吉他自动演奏:琴键、琴弦与声音逐音联动,纸质乐谱放上谱架即开演。在线体验:https://liyucheng1997.github.io/119_lab-piano-player/

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

**吉他 · 金色大厅古典吉他独奏会(1.5)**
- 吉他页改为与钢琴同一座 3D 金色大厅(共用 `public/hall/stage.js`):舞台中央一把斜靠在琴架上的古典吉他,旁边是演奏椅、脚踏和谱架
- 古典吉他程序化建模(`public/guitar3d/classical-guitar.js`):650 mm 弦长、真实品位间距的 19 个品丝、云杉面板 + 马赛克音孔花环、玫瑰木背侧板与包边、带系弦块的琴码、开槽式琴头与滚筒弦轴、尼龙/缠弦
- 发声与画面一一对应:哪根弦发声,哪根弦从"按弦品位 → 下弦枕"这段振动并泛金光,按弦处亮起金色指位点,上方浮出音名
- **声音重做**:不再用 alphaTab 自带的通用 MIDI 音色,改为真实吉他录音采样(尼龙弦古典吉他 / 钢弦民谣吉他可切换,`public/guitar/samples/`,来自 tonejs-instruments,CC BY 3.0);同一根弦的新音会截断旧音、其余音自然延音,和弦按弦序错开几毫秒、旋律最高音略突出,再加大厅混响
- alphaTab 改用"外部媒体"模式:只负责六线谱渲染与光标,光标跟着我们的音频时钟走;点击谱面跳转、暂停、停止都正确同步
- **曲库重做**:「琴谱柜」里 24 首古典吉他名曲——爱的罗曼史、阿尔罕布拉宫的回忆、阿德丽塔、阿拉伯风格随想曲、月光(塔雷加改编)、福雷西西里舞曲、巴赫布列舞曲/回旋加沃特/前奏曲、索尔 b 小调练习曲、平安夜等,按入门/进阶/演奏级分类,点卡片即放上谱架自动演奏
  - 来源:Mutopia Project 的刻谱源(公有领域 / CC 授权),`tools/build_guitar_library.js` 把 MIDI 自动编配成六线谱(动态规划分配弦与品位:控制把位跨度与换把距离、低音优先空弦、不切断仍在延音的低音),自动处理弱起小节、八度记谱、Drop D / 开放 G 调弦,并逐音回放比对——24 首全部 0 缺失
  - 转换后的曲谱沿用原授权(多为 CC BY-SA),出处与授权写在 `public/guitar/library/manifest.json`
- 自由弹奏:点 3D 琴弦拨弦(指板上点哪品弹哪品,音孔附近按当前和弦)、按住拖过琴弦扫弦;和弦面板 + 键盘(1~9 选和弦、A~H 拨弦、空格扫弦、J 回扫)
- 仍可上传 Guitar Pro / MusicXML、导出 .gp;图片 AI 识谱入口只在本地服务器下显示

**钢琴 · 维也纳金色大厅 3D 音乐会(1.4)**
- 钢琴页整体升级为 Three.js 实时 3D 场景(全部程序化建模,无外部模型/贴图):
  - 金色大厅:鞋盒形大厅、舞台与合唱阶梯、金色管风琴、两侧及后部楼座与栏杆、女像柱、拱门/壁龛/高窗、天顶油画藻井、11 盏水晶吊灯、近千把红丝绒座椅
  - 九尺音乐会三角钢琴:S 形琴身侧板、铸铁金色骨架、230 根琴弦(低音铜缠弦交叉排布)、弦轴、琴码、制音器、撑开的大盖与顶杆、谱架、车削琴腿与黄铜脚轮、踏板琴箱与三个踏板、琴凳
  - **88 键逐键建模(A0–C8)**,每个键都有独立支点:演奏到哪个音,哪个键下沉、微微发光、对应制音器抬起;同音反复会看到琴键"再敲一次"
- 声音与琴键一一对应:同一个音频时钟同时触发采样与琴键动画;Salamander 采样覆盖 88 键,加金色大厅混响(可关)、和弦内突出旋律最高音的力度处理
- 纸质乐谱:
  - 「乐谱柜」抽屉里每份乐谱都是一张旧纸乐谱卡片,点击即"放上谱架"并自动演奏
  - 3D 谱架上是一本摊开的乐谱:用隐藏的 OSMD 按印刷页宽重新排版,左右两页旧纸,金色光标跟随演奏,翻到下一跨页时有翻页动画
  - 下方的五线谱区也改为纸张质感
- 机位:观众席 / 舞台近景 / 演奏者视角 / 谱架特写 / 琴键特写 / 琴腹·制音器 / 楼座俯瞰,可拖动环绕、滚轮缩放、可开"镜头漫游";演奏时观众席灯光渐暗、控制条静止 3 秒自动隐藏
- 自由演奏:点击 3D 琴键(可拖动滑奏)或电脑键盘(Z~/ 与 Q~] 两排、←→ 移八度、按住空格 = 延音踏板,3D 踏板同步踩下)
- OSMD 无法排版的个别乐谱现在仍可纯音频演奏;WebGL 不可用时自动回退到原 2D 键盘
- 代码:`public/hall/`(`main.js` 渲染与交互、`hall-scene.js` 大厅、`grand-piano.js` 钢琴、`score-paper.js` 谱架纸张、`textures.js` 程序化贴图),样式 `public/concert.css`

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
