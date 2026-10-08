# AI 工作流深化设计(Phase 1:五项工序深化)

日期:2026-10-08
状态:待评审
前置:`2026-10-07-flow-canvas-design.md`(全屏节点画布,已交付)——本文在其架构之上深化各工序,不改画布结构。

## 1. 背景与目标

漫剧工坊的产品核心是 **AI 工作流**。对标行业五段流水线(LLM 剧本拆解 → 角色一致性 → 图生视频/运镜 → 音频 → 后期),现有实现的骨架已通(参考图链路、i2v 运镜 prompt、ASS 字幕、edge-tts、ffmpeg 合成),但每段存在短板。本阶段(Phase 1)**只深化工序质量,不动架构**;引擎化(工序可配 provider + 运行监控)是 Phase 2,另立 spec。

**五项深化**:A 动态漫运镜、B BGM 上传与自动混音、C 情绪标定与韵律配音、D 一致性人工质检回路、E 后期强化(转场 + 字幕样式)。

## 2. 现状基线(实现所依赖的代码事实)

- 免费动态漫引擎:`lib/compose.js` `kenburns(panel, dur, dest)` 使用**固定**居中推近表达式 `zoompan=z='min(1.14,1+0.12*on/<frames>)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=<frames>:s=<W>x<H>:fps=<FPS>`;`shot.camera` 字段(分镜 JSON 产出,枚举见下)在动态漫链路**被忽略**。
- 付费 i2v 链路:`lib/storyboard.js:113` 视频提示词已拼 `${shot.camera}镜头运动`,无需改动。
- camera 枚举:`lib/storyboard.js:42`——**固定/缓推/拉远/摇镜/特写**。
- 配音:`lib/tts.js` 经项目 `.venv` 调 edge-tts,`edge_tts.Communicate(text, voice, rate=argv[3])` **只传 rate**;缓存 hash 未含情绪维度;`speakerVoices` 按说话人分音色。
- 字幕:`lib/compose.js:40` 生成 ASS 交 libass 渲染(规避 ffmpeg drawtext tofu 缺陷),Style 参数当前写死。
- 上传通道:**server.js 无任何上传路由**(角色设定图由服务端生成,用户不上传文件)——BGM 上传需新增端点。
- 镜头字段白名单:`server.js:235` patch 通道已含 `camera`,**不含 emotion**。
- 角色一致性:角色 `refUrl` 已作为 refs 传入生图 API(`lib/ark.js:56`),生成结果无质检回路。
- 存放约束:`data/projects/`(媒体)与 `data/settings.json`(明文密钥)均已 gitignore,**永不入库**。

## 3. 深化 A:动态漫运镜(镜头语言接入免费引擎)

### 3.1 新模块 `lib/camera.js`(纯函数,可单测)

```js
/* camera: '固定'|'缓推'|'拉远'|'摇镜'|'特写'|其他 → zoompan 滤镜表达式
   返回 null 表示不加 zoompan(固定 = 静止画面) */
function cameraExpr(camera, frames, W, H) {
  if (camera === "固定") return null;
  if (camera === "拉远")
    return `zoompan=z='max(1,1.14-0.12*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${FPS}`;
  if (camera === "摇镜")
    return `zoompan=z='1.15':x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${FPS}`;
  if (camera === "特写")
    return `zoompan=z='min(1.3,1+0.28*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${FPS}`;
  /* 缓推与缺省(旧数据无 camera)保持现行行为 */
  return `zoompan=z='min(1.14,1+0.12*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${FPS}`;
}
```

- `FPS`/`W`/`H` 常量来源与 `compose.js` 一致(由调用方传入,`camera.js` 不 import compose,保持无依赖可测)。
- **缺省 = 缓推**(与现行 kenburns 行为一致,旧项目重新合成时无感)。

### 3.2 `lib/compose.js` 接线

- `kenburns(panel, dur, dest)` 增加 `camera` 参数,内部改调 `cameraExpr`;返回 null 时跳过 zoompan(纯 scale+crop)。
- per-shot 片段装配处把 `shot.camera` 传入(参数沿调用链透传,方案细节由实现计划定)。
- 付费 i2v 链路零改动。

### 3.3 UI:镜头面板运镜选择

`renderShotCard` 的 `row1` 标签区改为可编辑:`<select data-change="shot" data-idx data-field="camera">` 五个枚举项(沿用 600ms 防抖;`server.js` patch 白名单已含 camera)。位于画面描述 textarea 上方,不新增折叠区。

## 4. 深化 B:BGM 上传与自动混音

### 4.1 服务端(零依赖,raw body 流式)

| 端点                                 | 行为                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/projects/:id/bgm?ext=mp3` | 读原始 body 流式落盘 `data/projects/<id>/media/bgm.<ext>`;ext 白名单 `mp3/wav/m4a/ogg`;大小上限 **30MB**(超限 413);成功返回 `{ok:true,bgm:"/media/<id>/bgm.<ext>"}` |
| `DELETE /api/projects/:id/bgm`       | 删除文件,返回 `{ok:true}`                                                                                                                                           |
| GET 项目                             | 项目 JSON 新增字段 `bgm`(文件 URL 或 null)、`bgmVolume`(0-100,默认 25)                                                                                              |

- `PUT /api/projects/:id` 字段白名单增加 `bgmVolume`。
- 文件落在 `data/projects/<id>/`(已 gitignore,不入库)。

### 4.2 混音(`lib/compose.js`,构造抽纯函数)

```js
/* 返回 ffmpeg filter_complex 片段;hasBgm/hasVoice 组合覆盖全部行为
   dur: 成片秒数(用于 BGM 截断与尾部淡出) */
function buildAudioFilter(opts) /* {hasBgm, hasVoice, vol, dur} */
```

- `hasBgm && hasVoice`:语音轨 split 一路作 sidechain 源 → `[bgm]volume=<vol>,aformat` → `sidechaincompress=threshold=0.03:ratio=6:attack=120:release=500`(有台词自动压低、静默段恢复)→ 与语音 amix。
- `hasBgm && !hasVoice`:`volume=<vol>` + `afade=t=out:st=<dur-2>:d=2` 单轨输出。
- `!hasBgm`:**与现行完全一致**(透传语音轨)。
- BGM 输入:`-stream_loop -1 -i bgm` 循环至成片长。
- 参数超出零依赖能力或 ffmpeg 版本差异导致 sidechaincompress 不可用时,降级为静态 `volume=<vol*0.5>` amix(实现计划中定验证方式)。

### 4.3 UI:film 节点面板 BGM 区

- 上传:`<input type="file" accept="audio/*">` + 上传按钮(`fetch` 带 raw body);显示当前文件名/大小。
- 音量:range 滑杆(0-100),change 即 `PUT bgmVolume`(防抖)。
- 操作:试听(复用现有 preview 弹层,`data-kind="video"` 可播音频)、移除(确认框,现有统一 confirm)。

## 5. 深化 C:情绪标定与韵律配音

### 5.1 数据契约

- 分镜 JSON schema(`lib/storyboard.js` prompt)`shots[]` 增加 `emotion` 字段,枚举:**平静/严肃/激动/低沉/惊讶/悲伤**;prompt 明示"为每句台词标注情绪;缺省 平静"。
- 解析容错:非法/缺失值一律回落 `平静`。
- `server.js:235` patch 白名单增加 `emotion`(镜头面板可改)。

### 5.2 韵律映射(`lib/tts.js`,纯函数可单测)

```js
/* edge-tts 无原生情绪 style,用 rate/pitch/volume 三参近似: */
function emotionProsody(emotion) {
  const M = {
    平静: ["+0%", "+0Hz", "+0%"],
    严肃: ["-8%", "-10Hz", "+0%"],
    激动: ["+10%", "+15Hz", "+10%"],
    低沉: ["-12%", "-20Hz", "-5%"],
    惊讶: ["+8%", "+25Hz", "+10%"],
    悲伤: ["-15%", "-8Hz", "-10%"],
  };
  return M[emotion] || M["平静"];
}
```

- `tts.js` 的 edge-tts 调用扩展为 `Communicate(text, voice, rate=<r>, pitch=<p>, volume=<v>)`(argv 追加,顺序固定)。
- **缓存 hash 纳入 emotion**:改情绪即自动重合成;旧缓存自然失效,不迁移。
- 披露:此为韵律近似,非情绪克隆;免费身份不变。

### 5.3 UI

`renderShotCard` 台词 textarea 旁加 `<select data-change="shot" data-idx data-field="emotion">` 六枚举(默认 平静)。

## 6. 深化 D:一致性人工质检回路(零成本形态)

- 预览弹层升级:点击镜头分镜图(`data-act="preview" data-kind="img"`)时,若镜头可确定出场角色(shot.speaker + 所在场景 cast),弹层右侧并排显示对应角色设定图(`characters[].refUrl` 已有);无匹配角色时不显示侧栏。
- 质检动作 = 人工比对 + 既有 ↻ 单镜重roll,不新增后端。
- **明确不做**:AI 人脸/画面比对(按量计费);Phase 2 可作为可选质检工序节点。

## 7. 深化 E:后期强化

### 7.1 转场(项目级设置,`p.transition`)

| 值           | 行为                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `fade`(默认) | 每段视频+音频首尾各 0.12s 淡入淡出(`fade`/`afade` per-segment,不用 xfade 链式偏移——拼接偏移易错) |
| `none`       | 现行为(硬切)                                                                                     |
| `black`      | 段间插入 0.25s 黑场片段(video+静音音频,concat 队列追加)                                          |

### 7.2 字幕样式(ASS Style 参数化)

- 项目字段 `p.subSize`:`小/中/大` → ASS Fontsize 26/34/42(默认 中);描边 Outline 2、阴影 Shadow 1、MarginV 固定下方 1/3。
- film 面板"合成设置"区:转场 select + 字幕字号 select(`data-change="project"` 或显式保存,实现计划定),即时 `PUT`。

## 8. 数据与兼容

- 旧项目:`shots[].emotion` 缺失 → 平静;`shots[].camera` 缺失 → 缓推(= 现行为);无 BGM → 混音透传;`transition/subSize/bgmVolume` 缺省即上表默认值。**全部零迁移。**
- 新字段(bgm/bgmVolume/transition/subSize/emotion/camera)全部走既有项目 PUT 白名单 / shot patch 白名单 / 600ms 防抖通道。
- `data/projects/<id>/media/bgm.*` 属媒体目录,经 `/media/:id/` 静态服务,已 gitignore 不入库。

## 9. 错误处理

- BGM 上传:类型不符 415、超限 413、磁盘失败 500(沿用现有错误 toast 形态)。
- ffmpeg 合成任一步失败:沿用现有 per-stage error 落库 + 镜头/成片面板红标,不中断可重试。
- `cameraExpr` 对未知 camera 值回落缓推;`emotionProsody` 未知值回落平静(与 §5.1 容错一致)。
- edge-tts 扩参失败(pitch/volume 参数老版本 edge-tts 不识别)→ 捕获后以仅 rate 重试一次。

## 10. 测试策略(零依赖 `node --test`,测试与实现同步)

| 单测对象           | 用例要点                                               |
| ------------------ | ------------------------------------------------------ |
| `cameraExpr`       | 五枚举各自表达式;`固定`→null;未知值→缓推;frames=1 边界 |
| `emotionProsody`   | 六枚举映射;未知值→平静元组                             |
| `buildAudioFilter` | 四组合(hasBgm×hasVoice);vol=0/100;dur 淡出参数正确     |
| ASS Style 构造     | 三档字号;默认中                                        |
| `storyboard.js`    | schema 含 emotion;解析容错(缺失/非法→平静)             |
| 既有 10 项         | 全程保持 PASS                                          |

集成冒烟(手动 QA,本机有 ffmpeg):摇镜 1 段、特写 1 段、BGM ducking 混音 1 次、转场 fade/black 各 1 次——录入手动 QA 清单。

## 11. 明确不做(本阶段)

AI 音乐生成、AI 人脸比对、对口型、队列框架/微服务/新 npm 依赖;Phase 2 引擎化(工序 provider 注册表——`lib/` 中 ark/aliyun/tts 已是雏形——运行队列、断点重试、成本面板)另行 spec。

## 12. 全局约束(沿承上一 spec,仍然全部生效)

- 零依赖:Node 标准库 + 原生 JS/CSS,无 npm install、无构建、经典 `<script>` 全局。
- 服务端口 8787;单测命令裸 `node --test`(Node v22 对 `node --test tests/` 形式中断)。
- `data/settings.json` 含明文 API Key、`data/projects/` 为用户媒体:仅本机使用,**永不提交仓库/外传**。
- UI 文案中文;生成噪声防护:所有写文件操作后必须 Read/grep 回读验证。
