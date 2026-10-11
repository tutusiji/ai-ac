# AI 工作流深化(Phase 1)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 spec 五项工序深化——A 动态漫运镜、B BGM 上传与自动混音、C 情绪标定与韵律配音、D 一致性人工质检回路、E 后期强化(转场+字幕字号),全部零迁移兼容旧项目。

**Architecture:** 纯逻辑全部下沉为 lib 可单测纯函数(`lib/camera.js` 运镜表达式、`tts.emotionProsody` 韵律映射、`compose.buildAudioFilter/fadeVf/fadeAf/kenburnsFilter` 滤镜构造、`storyboard.normalizeShot` 字段归一),ffmpeg 编排只在这些纯构造结果上拼 argv;`lib/pipeline.js` 做阶段接线(缓存 hash、转场/BGM/黑场),`server.js` 增 BGM 原始流上传/删除两个端点 + 白名单扩展,前端复用既有 600ms 防抖 `data-change` 通道与 `data-act` 分发器,不新增任何框架。

**Tech Stack:** Node 标准库(零 npm 依赖)/ 原生 JS+CSS / ffmpeg+ffprobe(本机)/ edge-tts(.venv)/ 裸 `node --test`。

**Spec:** `docs/superpowers/specs/2026-10-08-ai-workflow-deepening-design.md`(计划由此 spec 论证;冲突以 spec 为准,但本计划对 spec 伪代码的两处显式修正见 Global Constraints 末两条)

## Global Constraints

- 零依赖:Node 标准库 + 原生 JS/CSS;**无 npm install、无构建、经典 `<script>` 全局**。
- 测试命令是裸 `node --test`(**不是** `node --test tests/`,Node v22 下会中断)。
- 服务端口 8787;`data/settings.json` 含明文 API Key、`data/projects/` 为用户媒体:仅本机使用,**永不提交仓库/外传**(均已 gitignore)。
- UI 文案全部中文。
- 生成噪声防护:所有写文件操作(Write/Edit)后继续编辑同一文件前,先 grep/Read 回读确认(formatter 钩子会在写后重排引号/空格,旧行文会失效)。
- lib/ 与 server.js 代码用单引号、public/app.js 与 tests/ 用双引号——与各文件现状一致,(formatter 也会强制)。
- 每条 commit 信息末尾追加:`-m "Co-Authored-By: Claude Code <noreply@anthropic.com>"`。
- **测试策略边界(spec §10)**:纯函数(cameraExpr/emotionProsody/normalizeShot/滤镜与 ASS 构造/流式落盘)一律 TDD(先看失败);ffmpeg 实际执行、服务路由、浏览器 UI 走套件回归 + Task 8 手动 QA 冒烟(与 spec 测试策略表一致——这些表面在本仓库现状中即无单测)。
- **Ruling-1(对 spec §3.1 签名修正)**:`cameraExpr(camera, frames, W, H, fps)`——spec 伪代码引用了外部 FPS 却又要求"常量由调用方传入",故 fps 作第 5 参数,`camera.js` 不 import compose。
- **Ruling-2(对 spec §5.2 缓存 hash 范围)**:emotion 只纳入 **edge** 路径的 voiceHash;阿里 qwen3-tts 无情绪参数,hash 含 emotion 只会造成纯改情绪触发阿里无差别重合成。
- **Ruling-3(对 spec §7.2)**:ASS 三档字号为 **44/52/62**(基线=现行 writeAss 的 52);spec 已同步修正,Outline 3/Shadow 1/MarginV 215 沿用现行值。

## Review Focus

spec 隐含但各任务单测不覆盖、最易咬到使用者的五类输入(每行已挂到拥有该代码的任务):

1. **旧项目零迁移**:`project.json` 无 emotion/camera/transition/subSize/bgmVolume/bgm 任何新字段时,重新合成必须成功且行为=缺省(运镜=缓推、情绪=平静、转场=fade、字号=中、无 BGM 直通)。注意转场缺省 fade 对旧项目是**声明的行为变化**(旧片硬切→淡入淡出,spec §8 明示)。→ Task 1 `cameraExpr(undefined)===缓推`、Task 3 `normalizeShot({})→平静` 钉住纯面;projectView/合成链缺省在 Task 8 QA 用真实旧项目回读验证。
2. **BGM 上传边界**:非白名单扩展名→415;>30MB→413 且**不落半截文件**;同名换扩展名重传→旧文件清除。→ Task 6 `readRawTo` 超限/成功两测钉住流与清理;ext 白名单与换扩展清理在 Task 8 QA。
3. **老版本 edge-tts 不识别 pitch/volume** → 配音不得失败:自动降级仅 rate 重试一次。→ Task 2 实现重试;Task 8 QA 实跑配音验证(.venv 现装版本 + 人工确认异常分支日志)。
4. **ffmpeg 构建缺 sidechaincompress** → mixBgm 必须降级静态 amix 出片,而不是让合成阶段红标。→ Task 4 降级分支代码;Task 8 QA 冒烟主路径(降级路径代码审阅确认,不强行构造坏 ffmpeg)。
5. **超短/超长镜头的数值边界**:frames=1~2、duration=2.5s 下限时 zoompan 表达式无除零、fade/afade 的 st≥0、拉远 zoom 永不低于 1、BGM 循环 `-stream_loop -1` 短音乐长成片时 `amix duration=first` 正确截断。→ Task 1 frames=1 测试、Task 4 `fadeVf` 边界与 buildAudioFilter 淡出夹零测试钉住;整链在 Task 8 QA。

---

### Task 1: `lib/camera.js` — 运镜表达式纯函数

**Files:**

- Create: `lib/camera.js`
- Test: `tests/camera.test.js`

**Interfaces:**

- Consumes: 无。
- Produces: `cameraExpr(camera, frames, W, H, fps)` → zoompan 滤镜字符串(不含外层 scale)或 `null`(固定=静止)。`固定→null`;`拉远/摇镜/特写` 各自表达式;`缓推`/未知/缺省 → 现行 kenburns 表达式。Task 4 消费。

- [ ] **Step 1: 写失败测试** `tests/camera.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { cameraExpr } = require("../lib/camera");

test("固定 返回 null(不加 zoompan)", () => {
  assert.strictEqual(cameraExpr("固定", 50, 864, 1536, 25), null);
});

test("缓推 = 现行 kenburns 表达式", () => {
  assert.strictEqual(
    cameraExpr("缓推", 50, 864, 1536, 25),
    "zoompan=z='min(1.14,1+0.12*on/50)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=50:s=864x1536:fps=25",
  );
});

test("未知值与缺省回落缓推(旧数据兼容)", () => {
  assert.strictEqual(
    cameraExpr("环绕", 50, 864, 1536, 25),
    cameraExpr("缓推", 50, 864, 1536, 25),
  );
  assert.strictEqual(
    cameraExpr(undefined, 50, 864, 1536, 25),
    cameraExpr("缓推", 50, 864, 1536, 25),
  );
});

test("拉远 从 1.14 缩回,表达式夹 max(1,…)", () => {
  assert.match(
    cameraExpr("拉远", 50, 864, 1536, 25),
    /z='max\(1,1\.14-0\.12\*on\/50\)'/,
  );
});

test("摇镜 z=1.15 水平扫过", () => {
  const e = cameraExpr("摇镜", 50, 864, 1536, 25);
  assert.match(e, /z='1\.15'/);
  assert.match(e, /x='\(iw-iw\/zoom\)\*on\/50'/);
});

test("特写 最深推到 1.3", () => {
  assert.match(
    cameraExpr("特写", 50, 864, 1536, 25),
    /z='min\(1\.3,1\+0\.28\*on\/50\)'/,
  );
});

test("frames=1 边界无除零(d 分段与 on 分母正确)", () => {
  for (const c of ["固定", "缓推", "拉远", "摇镜", "特写", "x"]) {
    const e = cameraExpr(c, 1, 864, 1536, 25);
    if (e) {
      assert.ok(!e.includes("/0"), e);
      assert.match(e, /on\/1/);
    }
  }
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/camera.test.js` — Expected: FAIL `Cannot find module '../lib/camera'`
- [ ] **Step 3: 最小实现** `lib/camera.js`:

```js
"use strict";
// 运镜 → zoompan 滤镜表达式(spec §3.1):固定返回 null(静止画面),
// 缓推与未知值保持现行 kenburns 行为;W/H/fps 由调用方传入,本模块零依赖。
function cameraExpr(camera, frames, W, H, fps) {
  const tail = `:d=${frames}:s=${W}x${H}:fps=${fps}`;
  if (camera === "固定") return null;
  if (camera === "拉远")
    return `zoompan=z='max(1,1.14-0.12*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'${tail}`;
  if (camera === "摇镜")
    return `zoompan=z='1.15':x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2'${tail}`;
  if (camera === "特写")
    return `zoompan=z='min(1.3,1+0.28*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'${tail}`;
  return `zoompan=z='min(1.14,1+0.12*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'${tail}`;
}

module.exports = { cameraExpr };
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/camera.test.js` — Expected: PASS 7/7
- [ ] **Step 5: 全套件回归** — Run: `node --test` — Expected: 全部 PASS(既有 10 项 + 新 7 项)
- [ ] **Step 6: Commit**

```bash
git add lib/camera.js tests/camera.test.js
git commit -m "feat: 动态漫运镜 cameraExpr 纯函数(五枚举+缺省回落缓推)" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: `lib/tts.js` — 情绪韵律映射 + edge-tts 扩参与降级重试

**Files:**

- Modify: `lib/tts.js`(全文件 63 行;改动 VOICES 块之后、synthesize 整体重写、exports 行)
- Test: `tests/tts-emotion.test.js`

**Interfaces:**

- Consumes: 无(不依赖 Task 1)。
- Produces(Task 3/5 消费):
  - `EMOTIONS` = `['平静','严肃','激动','低沉','惊讶','悲伤']`(枚举唯一权威源,storyboard require 它)
  - `emotionProsody(emotion)` → `[rate, pitch, volume]` 字符串三元组,未知值回落平静
  - `synthesize(text, voice, dest, { rate?, pitch?, volume? })` — pitch/volume 缺省时不扩参(保持现行仅 rate 调用形态);扩参失败自动以仅 rate 重试一次

- [ ] **Step 1: 写失败测试** `tests/tts-emotion.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { EMOTIONS, emotionProsody } = require("../lib/tts");

test("情绪枚举恰为六项", () => {
  assert.deepStrictEqual(EMOTIONS, [
    "平静",
    "严肃",
    "激动",
    "低沉",
    "惊讶",
    "悲伤",
  ]);
});

test("六枚举各自映射(spec §5.2 表)", () => {
  assert.deepStrictEqual(emotionProsody("平静"), ["+0%", "+0Hz", "+0%"]);
  assert.deepStrictEqual(emotionProsody("严肃"), ["-8%", "-10Hz", "+0%"]);
  assert.deepStrictEqual(emotionProsody("激动"), ["+10%", "+15Hz", "+10%"]);
  assert.deepStrictEqual(emotionProsody("低沉"), ["-12%", "-20Hz", "-5%"]);
  assert.deepStrictEqual(emotionProsody("惊讶"), ["+8%", "+25Hz", "+10%"]);
  assert.deepStrictEqual(emotionProsody("悲伤"), ["-15%", "-8Hz", "-10%"]);
});

test("未知/缺省情绪回落平静元组", () => {
  assert.deepStrictEqual(emotionProsody("狂喜"), emotionProsody("平静"));
  assert.deepStrictEqual(emotionProsody(undefined), emotionProsody("平静"));
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/tts-emotion.test.js` — Expected: FAIL(`EMOTIONS`/`emotionProsody` 未导出,解构为 undefined)
- [ ] **Step 3: 实现** `lib/tts.js`,三处改动:

(a) 在 `const VOICES = {...};` 块结束(`};`)之后插入:

```js
// 情绪枚举(spec §5.1):storyboard prompt 与镜头面板共用本清单
const EMOTIONS = ["平静", "严肃", "激动", "低沉", "惊讶", "悲伤"];
// edge-tts 无原生情绪 style,用 rate/pitch/volume 三参近似(spec §5.2;披露:韵律近似,非情绪克隆)
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

(b) 将现有 `async function synthesize(text, voice, dest, { rate = '+8%' } = {}) { ... }` **整函数**(从 `async function synthesize` 到其闭合 `}`,即现 33-53 行)替换为:

```js
function synthOnce(text, voice, dest, opts) {
  const { rate = "+8%", pitch, volume } = opts;
  const full = pitch != null && volume != null;
  // pitch/volume 为 edge-tts 扩参(韵律近似);老版本不识别时由 synthesize 降级重试
  const script = [
    "import asyncio, sys",
    "import edge_tts",
    "async def main():",
    full
      ? "    c = edge_tts.Communicate(sys.argv[1], sys.argv[2], rate=sys.argv[3], pitch=sys.argv[4], volume=sys.argv[5])"
      : "    c = edge_tts.Communicate(sys.argv[1], sys.argv[2], rate=sys.argv[3])",
    `    await c.save(sys.argv[${full ? 6 : 4}])`,
    "asyncio.run(main())",
  ].join("\n");
  const argv = full
    ? [String(text), voice, rate, pitch, volume, dest]
    : [String(text), voice, rate, dest];
  return new Promise((resolve, reject) => {
    const p = spawn(VENV, ["-c", script, ...argv], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d.toString();
    });
    p.on("error", (e) =>
      reject(new Error("无法启动 .venv 中的 edge-tts:" + e.message)),
    );
    p.on("close", (code) => {
      if (code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 200)
        resolve();
      else reject(new Error("edge-tts 合成失败:" + err.slice(-300)));
    });
  });
}

// 带 pitch/volume 合成失败(如老版本 edge-tts 不识别扩参)→ 以仅 rate 重试一次(spec §9)
async function synthesize(text, voice, dest, opts = {}) {
  try {
    return await synthOnce(text, voice, dest, opts);
  } catch (e) {
    if (opts.pitch != null || opts.volume != null)
      return synthOnce(text, voice, dest, { rate: opts.rate });
    throw e;
  }
}
```

(c) exports 行改为:

```js
module.exports = {
  VOICES,
  EMOTIONS,
  emotionProsody,
  available,
  pickVoice,
  synthesize,
  probeDuration,
};
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/tts-emotion.test.js` — Expected: PASS 3/3
- [ ] **Step 5: 全套件回归** — Run: `node --test` — Expected: 全部 PASS(`synthesize` 旧调用方 `pipeline.js:296` 只传 3 参 → pitch/volume undefined → 不扩参,行为不变)
- [ ] **Step 6: Commit**

```bash
git add lib/tts.js tests/tts-emotion.test.js
git commit -m "feat: TTS 情绪韵律映射与 edge-tts pitch/volume 扩参(失败降级仅 rate 重试)" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: `lib/storyboard.js` — 分镜 prompt 纳入情绪 + 解析归一

**Files:**

- Modify: `lib/storyboard.js`(requires 区;extractJSON 之后;systemPrompt 两行;generate/sceneShots 两个 map 块;sceneShotsSystem 两行;fallbackStoryboard 一行;exports)
- Test: `tests/storyboard-emotion.test.js`

**Interfaces:**

- Consumes: Task 2 的 `EMOTIONS`(`require('./tts')`)。
- Produces(Task 5 消费数据契约):`shots[].emotion` ∈ 六枚举,缺失/非法一律归一为 `平静`;导出 `normalizeShot(s)` 供单测与两处解析复用。

- [ ] **Step 1: 写失败测试** `tests/storyboard-emotion.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const sb = require("../lib/storyboard");

test("systemPrompt 的 schema 与要求含 emotion 枚举", () => {
  const p = sb.systemPrompt("韩系条漫", 6);
  assert.match(
    p,
    /emotion 是台词情绪,只能取:平静\/严肃\/激动\/低沉\/惊讶\/悲伤;缺省 平静/,
  );
  assert.match(p, /"emotion":"平静"/);
});

test("sceneShotsSystem 含 emotion 指令", () => {
  const p = sb.sceneShotsSystem("韩系条漫", 5);
  assert.match(p, /emotion:平静\/严肃\/激动\/低沉\/惊讶\/悲伤\(缺省 平静\)/);
  assert.match(p, /"emotion":"平静"/);
});

test("normalizeShot:缺失/非法 emotion 回落平静,合法值保留", () => {
  assert.strictEqual(sb.normalizeShot({}).emotion, "平静");
  assert.strictEqual(sb.normalizeShot({ emotion: "狂喜" }).emotion, "平静");
  assert.strictEqual(sb.normalizeShot({ emotion: "悲伤" }).emotion, "悲伤");
});

test("normalizeShot 沿用既有字段规则(camera/duration/截断)", () => {
  assert.strictEqual(sb.normalizeShot({}).camera, "固定");
  assert.strictEqual(sb.normalizeShot({ duration: 99 }).duration, 6);
  assert.strictEqual(sb.normalizeShot({ duration: 1 }).duration, 3);
  assert.strictEqual(
    sb.normalizeShot({ visual: "x".repeat(200) }).visual.length,
    120,
  );
  assert.strictEqual(sb.normalizeShot({}).speaker, "旁白");
});

test("fallbackStoryboard 每镜带 emotion=平静(零迁移形态)", () => {
  const d = sb.fallbackStoryboard("一句。两句。", 4);
  assert.strictEqual(d.shots.length, 4);
  assert.ok(d.shots.every((s) => s.emotion === "平静"));
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/storyboard-emotion.test.js` — Expected: FAIL(systemPrompt 不含 emotion、`normalizeShot` 未导出)
- [ ] **Step 3: 实现** `lib/storyboard.js`,六处改动:

(a) requires 区(`const ark = require('./ark');` 之后)加:

```js
const { EMOTIONS } = require("./tts");
```

(b) `function extractJSON(text) {...}` 整函数之后、`fallbackStoryboard` 之前插入:

```js
// 分镜字段归一(spec §5.1 容错):emotion 非法/缺失回落 平静;duration 夹 3-6;visual/dialogue 截断
function normalizeShot(s) {
  return {
    visual: String(s.visual || "").slice(0, 120),
    dialogue: String(s.dialogue || "").slice(0, 60),
    speaker: s.speaker || "旁白",
    camera: s.camera || "固定",
    emotion: EMOTIONS.includes(s.emotion) ? s.emotion : "平静",
    duration: Math.min(6, Math.max(3, Number(s.duration) || 5)),
  };
}
```

(c) systemPrompt 内两处(现 40-42 行区):

- `- camera 用一个词:固定/缓推/拉远/摇镜/特写` 之后插入一行:

```
- emotion 是台词情绪,只能取:平静/严肃/激动/低沉/惊讶/悲伤;缺省 平静
```

- 只输出 JSON 的 schema 行中 `,"camera":"缓推","duration":5}` 改为 `,"camera":"缓推","emotion":"平静","duration":5}`(即 shots 元素变为 `{"idx":1,"scene":"场景","visual":"画面描述","dialogue":"台词","speaker":"角色名或旁白","camera":"缓推","emotion":"平静","duration":5}`)。

(d) `generate` 的解析 map 块(现 84-92 行)整体替换为:

```js
data.shots = data.shots.slice(0, 12).map((s, i) => ({
  ...normalizeShot(s),
  idx: i + 1,
  scene: s.scene || "",
}));
```

(e) `sceneShotsSystem` 内(现 163 行):

- `- speaker 只能是出场角色名或"旁白";camera:固定/缓推/拉远/摇镜/特写` 改为:

```
- speaker 只能是出场角色名或"旁白";camera:固定/缓推/拉远/摇镜/特写;emotion:平静/严肃/激动/低沉/惊讶/悲伤(缺省 平静)
```

- 其 schema 行 `{"characters":[{"name":"本场景出场角色","desc":"完整外观描述≤40字"}],"shots":[{"visual":"…","dialogue":"…","speaker":"…","camera":"缓推","duration":5}]}` 改为 `…,"camera":"缓推","emotion":"平静","duration":5}]}`。

(f) `sceneShots` 的解析 map 块(现 184-190 行)整体替换为:

```js
data.shots = data.shots.slice(0, 8).map((s) => normalizeShot(s));
```

(g) `fallbackStoryboard` 的 shots.push 对象(现 70 行)`speaker: '旁白', camera: cams[i % 4], duration: 5,` 改为:

```js
      speaker: '旁白', camera: cams[i % 4], emotion: '平静', duration: 5,
```

(h) `module.exports = {` 行的键列表中 `fallbackStoryboard,` 之后追加 `normalizeShot,`。

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/storyboard-emotion.test.js` — Expected: PASS 5/5
- [ ] **Step 5: 全套件回归** — Run: `node --test` — Expected: 全部 PASS
- [ ] **Step 6: Commit**

```bash
git add lib/storyboard.js tests/storyboard-emotion.test.js
git commit -m "feat: 分镜 prompt 与解析纳入情绪字段(非法/缺失回落平静)" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: `lib/compose.js` — 运镜接入、转场、字幕三档、BGM 混音构造

**Files:**

- Modify: `lib/compose.js`(151 行:requires;writeAss;kenburns;buildSegment;新增 blackSeg/buildAudioFilter/mixBgm/fade 构造器;exports)
- Test: `tests/compose-builders.test.js`

**Interfaces:**

- Consumes: Task 1 的 `cameraExpr`。
- Produces(Task 5 消费):
  - `kenburns(panel, dur, dest, camera, extraVf)` — camera 缺省=缓推;extraVf 追加到滤镜链尾(转场淡入淡出用)
  - `kenburnsFilter(camera, frames)` → 完整 -filter_complex 视频滤镜串;`固定` → `scale=864:1536`(无 zoompan)
  - `buildSegment(shot, files, dir, opts)` — `opts = { transition = 'none', subSize = '中' }`;transition='fade' 时视频/音频首尾 0.12s 淡入淡出
  - `writeAss(text, dur, dest, subSize)` — 小/中/大 → Fontsize 44/52/62,非法回落 52
  - `fadeVf(dur)` / `fadeAf(dur)` → 淡入淡出滤镜串
  - `blackSeg(dir)` → 0.25s 黑场+静音 mp4 路径
  - `buildAudioFilter({ hasVoice, vol, dur })` → `{ filter, mapAudio }`(纯构造;null 不返回——无 BGM 由调用方不调用表达)
  - `mixBgm(filmIn, bgmIn, { vol, hasVoice, dur, dest })` — concat 后整片混音;sidechaincompress 失败降级静态 volume amix

- [ ] **Step 1: 写失败测试** `tests/compose-builders.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const compose = require("../lib/compose");

test("kenburnsFilter:固定 无 zoompan,其余经 cameraExpr", () => {
  assert.strictEqual(compose.kenburnsFilter("固定", 50), "scale=864:1536");
  assert.strictEqual(
    compose.kenburnsFilter("缓推", 50),
    "scale=1728:3072,zoompan=z='min(1.14,1+0.12*on/50)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=50:s=864x1536:fps=25",
  );
  assert.match(compose.kenburnsFilter("摇镜", 50), /z='1\.15'/);
  assert.match(compose.kenburnsFilter("特写", 2), /on\/2/);
});

test("fadeVf/fadeAf:首尾各 0.12s", () => {
  assert.strictEqual(
    compose.fadeVf(5),
    "fade=t=in:st=0:d=0.12,fade=t=out:st=4.88:d=0.12",
  );
  assert.strictEqual(
    compose.fadeAf(5),
    "afade=t=in:st=0:d=0.12,afade=t=out:st=4.88:d=0.12",
  );
});

test("ASS 字幕三档字号:小44/中52/大62,非法回落52", () => {
  for (const [tier, want] of [
    ["小", 44],
    ["中", 52],
    ["大", 62],
    [undefined, 52],
    ["巨大", 52],
  ]) {
    const dest = path.join(
      os.tmpdir(),
      `mj_ass_${want}_${Math.random().toString(36).slice(2)}.ass`,
    );
    compose.writeAss("台词测试", 3, dest, tier);
    const ass = fs.readFileSync(dest, "utf8");
    assert.match(
      ass,
      new RegExp(`Style: Sub,Noto Sans CJK SC,${want},&H00FFFFFF`),
    );
    fs.rmSync(dest, { force: true });
  }
});

test("buildAudioFilter:有语音 → sidechaincompress ducking + amix", () => {
  const r = compose.buildAudioFilter({ hasVoice: true, vol: 0.25, dur: 30 });
  assert.match(
    r.filter,
    /sidechaincompress=threshold=0\.03:ratio=6:attack=120:release=500/,
  );
  assert.match(r.filter, /volume=0\.25/);
  assert.match(r.filter, /amix=inputs=2:duration=first/);
  assert.strictEqual(r.mapAudio, "[aout]");
});

test("buildAudioFilter:无语音 → 单轨 volume + 尾部 2s 淡出", () => {
  const r = compose.buildAudioFilter({ hasVoice: false, vol: 0.25, dur: 30 });
  assert.match(r.filter, /volume=0\.25,afade=t=out:st=28\.00:d=2/);
  assert.ok(!r.filter.includes("sidechaincompress"));
  assert.strictEqual(r.mapAudio, "[aout]");
});

test("buildAudioFilter:dur<2 时淡出起点夹 0", () => {
  const r = compose.buildAudioFilter({ hasVoice: false, vol: 0.5, dur: 1 });
  assert.match(r.filter, /afade=t=out:st=0\.00:d=2/);
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/compose-builders.test.js` — Expected: FAIL(`kenburnsFilter`/`fadeVf`/`fadeAf`/`writeAss` 未导出或签名不符)
- [ ] **Step 3: 实现** `lib/compose.js`,按序六处改动:

(a) requires 区(`const { findFont } = require('./util');` 之后)加:

```js
const { cameraExpr } = require("./camera");
```

(b) `writeAss` 函数:签名与 Style 行参数化(函数其余部分不动)。将现 49 行 `function writeAss(text, dur, dest) {` 改为:

```js
// 字幕字号三档(spec §7.2,修正基线):小/中/大 → 44/52/62;非法回落 52
const SUB_SIZES = { '小': 44, '中': 52, '大': 62 };
function writeAss(text, dur, dest, subSize) {
  const size = SUB_SIZES[subSize] || 52;
```

并将 Style 行(现 62 行)`Style: Sub,Noto Sans CJK SC,52,&H00FFFFFF,` 中写死的 `52` 改为 `${size}`(整行变为):

```
Style: Sub,Noto Sans CJK SC,${size},&H00FFFFFF,&H00FFFFFF,&H00101218,&H78000000,0,0,0,0,100,100,1,3,1,2,56,56,215,1
```

(c) 将 `kenburns` 函数(现 86-96 行,含其上注释行)整体替换为:

```js
// 分镜图 → 运镜动态片段(动画漫模式,零视频成本);camera 语义见 lib/camera.js
// 固定=静止缩放;extraVf 供转场淡入淡出追加到滤镜链尾
function kenburnsFilter(camera, frames) {
  const expr = cameraExpr(camera, frames, W, H, FPS);
  return expr ? `scale=${W * 2}:${H * 2},${expr}` : `scale=${W}:${H}`;
}
async function kenburns(panel, dur, dest, camera, extraVf = "") {
  const frames = Math.max(2, Math.round(dur * FPS));
  const extra = extraVf ? `,${extraVf}` : "";
  await run([
    "-loop",
    "1",
    "-i",
    panel,
    "-t",
    String(dur),
    "-filter_complex",
    kenburnsFilter(camera, frames) + extra,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    dest,
  ]);
  return dest;
}
```

(d) `buildSegment`:签名行(现 99 行)`async function buildSegment(shot, files, dir) {` 改为:

```js
// 单镜头片段:视频源(clip 或 kenburns)对齐时长 + 台词配音 + 字幕烧录
// opts.transition: 'fade' 首尾 0.12s 淡入淡出 | 'none' 硬切(black 由 stageFilm 段间插片表达)
async function buildSegment(shot, files, dir, opts = {}) {
  const { transition = 'none', subSize = '中' } = opts;
```

- 三处内部接线:
  - clip 分支(现 108-110 行)`-vf` 值的字符串末尾 `,setpts=PTS-STARTPTS` 之后追加 `${transition === 'fade' ? ',' + fadeVf(dur) : ''}`(整行变为):

```js
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},tpad=stop_mode=clone:stop_duration=${pad},trim=duration=${dur},setpts=PTS-STARTPTS${transition === 'fade' ? ',' + fadeVf(dur) : ''}`,
```

- kenburns 调用(现 112 行)`await kenburns(panel, dur, vonly);` 改为:

```js
await kenburns(
  panel,
  dur,
  vonly,
  shot.camera,
  transition === "fade" ? fadeVf(dur) : "",
);
```

- 字幕烧录(现 127 行)`writeAss(shot.dialogue, dur, assFile);` 改为:

```js
writeAss(shot.dialogue, dur, assFile, subSize);
```

- [ ] **Step 4: 插入转场/BGM 构造器**。`FADE_D`/`fadeVf`/`fadeAf` 三段插在 requires 区(`const { cameraExpr } = require('./camera');` 之后),因为 `FADE_D` 是 const、要保证定义先于 buildSegment 的可读顺序;`blackSeg`/`buildAudioFilter`/`mixBgm` 插在 `buildSegment` 之后、`concatSegments` 之前:

```js
// 转场淡入淡出(spec §7.1 fade):每段视频/音频首尾各 0.12s
const FADE_D = 0.12;
function fadeVf(dur) {
  return `fade=t=in:st=0:d=${FADE_D},fade=t=out:st=${Math.max(0, dur - FADE_D).toFixed(2)}:d=${FADE_D}`;
}
function fadeAf(dur) {
  return `afade=t=in:st=0:d=${FADE_D},afade=t=out:st=${Math.max(0, dur - FADE_D).toFixed(2)}:d=${FADE_D}`;
}

// 黑场过渡段(spec §7.1 black):0.25s 纯黑 + 静音,由 stageFilm 插在段间
async function blackSeg(dir, dur = 0.25) {
  const seg = path.join(dir, "seg_black.mp4");
  await run([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${W}x${H}:r=${FPS}:d=${dur}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-movflags",
    "+faststart",
    seg,
  ]);
  return seg;
}

/* BGM 混音 filter_complex 构造(spec §4.2),纯函数:
   hasVoice:语音轨 split 一路作 sidechain 源 → 有台词自动压低、静默段恢复;
   !hasVoice:单轨输出 + 尾部 2s 淡出。无 BGM 时调用方直接不调 mixBgm(透传,与现行一致)。 */
function buildAudioFilter({ hasVoice, vol, dur }) {
  const AF = "aformat=sample_rates=44100:channel_layouts=stereo";
  if (!hasVoice) {
    const st = Math.max(0, dur - 2).toFixed(2);
    return {
      filter: `[1:a]${AF},volume=${vol},afade=t=out:st=${st}:d=2[aout]`,
      mapAudio: "[aout]",
    };
  }
  return {
    filter:
      `[1:a]${AF},volume=${vol}[bgm];` +
      `[0:a]${AF},asplit=2[sc][mix];` +
      `[bgm][sc]sidechaincompress=threshold=0.03:ratio=6:attack=120:release=500[duck];` +
      `[mix][duck]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    mapAudio: "[aout]",
  };
}

// 成片级 BGM 混音:concat 之后一次性混(全片 BGM 连续,不按段重启)。
// sidechaincompress 等滤镜不可用导致失败 → 降级静态 volume(<vol*0.5>)amix(spec §4.2)。
async function mixBgm(filmIn, bgmIn, { vol, hasVoice, dur, dest }) {
  const built = buildAudioFilter({ hasVoice, vol, dur });
  try {
    await run([
      "-i",
      filmIn,
      "-stream_loop",
      "-1",
      "-i",
      bgmIn,
      "-filter_complex",
      built.filter,
      "-map",
      "0:v:0",
      "-map",
      built.mapAudio,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      dest,
    ]);
  } catch (e) {
    const AF = "aformat=sample_rates=44100:channel_layouts=stereo";
    await run([
      "-i",
      filmIn,
      "-stream_loop",
      "-1",
      "-i",
      bgmIn,
      "-filter_complex",
      `[1:a]${AF},volume=${(vol * 0.5).toFixed(3)}[a1];[0:a]${AF}[a0];[a0][a1]amix=inputs=2:duration=first:normalize=0[aout]`,
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      dest,
    ]);
  }
  return dest;
}
```

注意:`fadeVf`/`fadeAf`/`FADE_D` 定义需在 `buildSegment` 之前可用(函数声明有提升,`const FADE_D` 没有——**把这三个定义放在 `writeAss` 与 `kenburns` 之间**更稳妥,而非本块所示位置;以实际插入位置保证 `buildSegment` 执行路径在模块加载后运行即可,本文件所有调用都发生在运行期,置顶插在 requires 之后最简)。

- [ ] **Step 5: 音频分支的 fade 接线**(`buildSegment` 内,现 117-121 行)替换为:

```js
if (audio && fs.existsSync(audio)) {
  const af = `apad,atrim=0:${dur},aresample=44100${transition === "fade" ? "," + fadeAf(dur) : ""}`;
  await run(["-i", audio, "-af", af, "-c:a", "aac", "-b:a", "128k", aonly]);
} else {
  await run([
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-t",
    String(dur),
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    aonly,
  ]);
}
```

(anullsrc 静音分支无需 fade——无声可淡。)

- [ ] **Step 6: exports 行** 替换为:

```js
module.exports = {
  W,
  H,
  FPS,
  run,
  probeDuration,
  mockPanel,
  kenburns,
  kenburnsFilter,
  buildSegment,
  concatSegments,
  blackSeg,
  mixBgm,
  buildAudioFilter,
  fadeVf,
  fadeAf,
  writeAss,
  wrapText,
  SUB_SIZES,
};
```

- [ ] **Step 7: 跑测试确认通过** — Run: `node --test tests/compose-builders.test.js` — Expected: PASS 6/6
- [ ] **Step 8: 全套件回归 + 语法检查** — Run: `node --test && node --check lib/compose.js && node --check lib/pipeline.js` — Expected: 全部 PASS、无输出
- [ ] **Step 9: Commit**

```bash
git add lib/compose.js tests/compose-builders.test.js
git commit -m "feat: 合成引擎——运镜接入/转场淡入淡出/字幕三档/BGM 混音构造与降级" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: `lib/pipeline.js` — 情绪配音缓存、转场/字号/BGM/黑场接线

**Files:**

- Modify: `lib/pipeline.js`(stageVoice 两处 hash + synthesize 调用;stageFilm 头部与尾部)

**Interfaces:**

- Consumes: Task 2 `tts.emotionProsody`;Task 3 `shots[].emotion`;Task 4 `buildSegment(…, opts)`/`blackSeg`/`mixBgm`。
- Produces: 运行行为——改情绪自动重合成(edge);合成消费 `project.transition/subSize/bgm/bgmVolume`,缺省 fade/中/无 BGM。

- [ ] **Step 1: stageVoice 情绪接线**。现 279-290 行块:

```js
      let voice;
      const dest = path.join(mediaDir(project), `voice_${sh.idx}.mp3`);
      { // 台词/音色/引擎均未变化 → 跳过重合成
        const probeVoice = useAliyunTts ? `qwen3-tts:${aliVoice(sh.speaker)}` : tts.pickVoice(sh.speaker, settings.speakerVoices[sh.speaker]);
        const probeHash = crypto.createHash('md5').update(`${sh.dialogue}|${probeVoice}|${useAliyunTts ? 'ali:' + settings.aliyunTtsModel : 'edge'}`).digest('hex').slice(0, 10);
```

替换为:

```js
      let voice;
      const dest = path.join(mediaDir(project), `voice_${sh.idx}.mp3`);
      const emotion = sh.emotion || '平静';
      // emotion 只参与 edge 缓存键(Ruling-2):阿里 qwen3-tts 无情绪参数,计入只会造成无效重合成
      const emoTag = useAliyunTts ? '' : `|${emotion}`;
      { // 台词/音色/情绪/引擎均未变化 → 跳过重合成
        const probeVoice = useAliyunTts ? `qwen3-tts:${aliVoice(sh.speaker)}` : tts.pickVoice(sh.speaker, settings.speakerVoices[sh.speaker]);
        const probeHash = crypto.createHash('md5').update(`${sh.dialogue}|${probeVoice}|${useAliyunTts ? 'ali:' + settings.aliyunTtsModel : 'edge'}${emoTag}`).digest('hex').slice(0, 10);
```

现 296 行 `await tts.synthesize(sh.dialogue, voice, dest);` 替换为:

```js
const [rate, pitch, volume] = tts.emotionProsody(emotion);
await tts.synthesize(sh.dialogue, voice, dest, { rate, pitch, volume });
```

现 299 行落库 hash(`${sh.dialogue}|${voice}|${useAliyunTts ? … }`).digest … 一行中 `` 'edge'}` ` 之后、`` ` `` 闭合之前插入 `${emoTag}`(与 probeHash 同构;整行变为):

```js
sh.voiceHash = crypto
  .createHash("md5")
  .update(
    `${sh.dialogue}|${voice}|${useAliyunTts ? "ali:" + settings.aliyunTtsModel : "edge"}${emoTag}`,
  )
  .digest("hex")
  .slice(0, 10);
```

- [ ] **Step 2: stageFilm 接线**。现 319-320 行:

```js
const dir = mediaDir(project);
const segs = [];
```

替换为:

```js
const dir = mediaDir(project);
const transition = project.transition || "fade"; // spec §7.1:缺省 fade(旧项目为声明行为变化)
const subSize = project.subSize || "中"; // spec §7.2:缺省 中
const segs = [];
```

现 332-338 行 `const { seg } = await compose.buildSegment(sh, {…}, dir);` 的结尾 `, dir);` 改为传 opts(对象字面量不动):

```js
const { seg } = await compose.buildSegment(
  sh,
  {
    clip: clipAbs,
    panel: panelAbs,
    audio: abs(project, sh.audio),
    audioDur: sh.audioDur || 0,
    clipDur,
  },
  dir,
  { transition, subSize },
);
```

现 343-347 行:

```js
const film = path.join(dir, "film.mp4");
await compose.concatSegments(segs, film);
project.film = "media/film.mp4";
const dur = await compose.probeDuration(film);
```

替换为:

```js
const film = path.join(dir, "film.mp4");
// black 转场:段间插 0.25s 黑场(fade 已在 buildSegment 内逐段处理)
let finalSegs = segs;
if (transition === "black") {
  const black = await compose.blackSeg(dir);
  finalSegs = [];
  segs.forEach((s, i) => {
    if (i) finalSegs.push(black);
    finalSegs.push(s);
  });
}
await compose.concatSegments(finalSegs, film);
project.film = "media/film.mp4";
// BGM 混音(spec §4.2):concat 后整片混;vol=0 视为无 BGM(透传,不多耗一次转码)
const bgmAbs = abs(project, project.bgm);
if (bgmAbs && fs.existsSync(bgmAbs)) {
  const vol =
    Math.min(
      100,
      Math.max(0, Number(project.bgmVolume == null ? 25 : project.bgmVolume)),
    ) / 100;
  if (vol > 0) {
    const dur0 = await compose.probeDuration(film);
    const mixed = path.join(dir, "film_bgm.mp4");
    await compose.mixBgm(film, bgmAbs, {
      vol,
      hasVoice: shots.some((s) => s.audio),
      dur: dur0,
      dest: mixed,
    });
    fs.rmSync(film, { force: true });
    fs.renameSync(mixed, film);
    log(project, `BGM 混音完成(音量 ${Math.round(vol * 100)}%)`);
  }
}
const dur = await compose.probeDuration(film);
```

- [ ] **Step 3: 验证** — Run: `node --test && node --check lib/pipeline.js` — Expected: 全部 PASS(pipeline 无独立单测面,由 Task 4/2/3 的纯函数测试 + Task 8 冒烟覆盖;此处保证零回归与语法正确)
- [ ] **Step 4: 冒烟(本机 ffmpeg 直接跑一条最小链)** — Run:

```bash
node -e "
const compose = require('./lib/compose');
(async () => {
  await compose.mockPanel('测试镜头摇镜', 1, '/tmp/mj_qa_p1.jpg');
  await compose.mockPanel('测试镜头特写', 2, '/tmp/mj_qa_p2.jpg');
  await compose.kenburns('/tmp/mj_qa_p1.jpg', 2.5, '/tmp/mj_qa_yao.mp4', '摇镜');
  await compose.kenburns('/tmp/mj_qa_p2.jpg', 2.5, '/tmp/mj_qa_te.mp4', '特写');
  await compose.kenburns('/tmp/mj_qa_p1.jpg', 2.5, '/tmp/mj_qa_fix.mp4', '固定');
  const seg = await compose.buildSegment(
    { idx: 1, visual: 't', dialogue: '台词测试', camera: '摇镜', duration: 2.5 },
    { panel: '/tmp/mj_qa_p1.jpg', audioDur: 0, clipDur: 0 }, '/tmp', { transition: 'fade', subSize: '大' });
  const black = await compose.blackSeg('/tmp');
  console.log('smoke OK:', seg.seg, black);
})().catch(e => { console.error(e); process.exit(1); });
"
```

Expected: 末行输出 `smoke OK: /tmp/seg_1.mp4 /tmp/seg_black.mp4`,无 ffmpeg 报错。再 `ffprobe -v error -show_entries stream=codec_type -of csv=p=0 /tmp/seg_black.mp4` — Expected: 输出含 `video` 与 `audio` 两行。

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.js
git commit -m "feat: 流水线接线——情绪配音缓存、转场/字幕字号/BGM/黑场合成" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `server.js` + `lib/util.js` — BGM 上传/删除端点、字段白名单、视图缺省

**Files:**

- Modify: `lib/util.js`(新增 `readRawTo`;exports)
- Modify: `server.js`(`route()` 支持 raw;分发器;BGM 两路由;projectView 四字段;PUT 白名单;shots 白名单)
- Test: `tests/util-raw.test.js`

**Interfaces:**

- Consumes: 无新依赖。
- Produces(Task 7 消费):
  - `POST /api/projects/:id/bgm?ext=<mp3|wav|m4a|ogg>`(raw body)→ `{ok:true,bgm:"/media/<id>/bgm.<ext>"}`;非法 ext 415;>30MB 413(半截文件清理);项目 `p.bgm` 存 rel `media/bgm.<ext>`
  - `DELETE /api/projects/:id/bgm` → 清全部扩展名 BGM 文件,`p.bgm=null`
  - GET 项目视图新增:`bgmUrl`(URL 或 null)、`bgmVolume`(缺省 25)、`transition`(缺省 'fade')、`subSize`(缺省 '中')
  - PUT `/api/projects/:id` 白名单 += `transition`/`subSize`(直传)与 `bgmVolume`(服务端夹 0-100);shots patch 白名单 += `emotion`
  - `util.readRawTo(req, dest, limit)` → 流式落盘,超限 reject `文件超过 30MB 上限` 并删半截文件

- [ ] **Step 1: 写失败测试** `tests/util-raw.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { readRawTo } = require("../lib/util");

function fakeReq(chunks) {
  const req = new EventEmitter();
  req.destroy = () => {};
  queueMicrotask(() => {
    for (const c of chunks)
      req.emit("data", Buffer.isBuffer(c) ? c : Buffer.from(c));
    req.emit("end");
  });
  return req;
}

test("readRawTo:分块流式落盘", async () => {
  const dest = path.join(
    os.tmpdir(),
    `mj_raw_${Math.random().toString(36).slice(2)}.bin`,
  );
  await readRawTo(fakeReq(["hello ", "manju"]), dest, 1024);
  assert.strictEqual(fs.readFileSync(dest, "utf8"), "hello manju");
  fs.rmSync(dest, { force: true });
});

test("readRawTo:超限拒绝并清理半截文件", async () => {
  const dest = path.join(
    os.tmpdir(),
    `mj_raw_${Math.random().toString(36).slice(2)}.bin`,
  );
  await assert.rejects(
    () =>
      readRawTo(fakeReq([Buffer.alloc(60, 1), Buffer.alloc(60, 2)]), dest, 100),
    /超过/,
  );
  assert.strictEqual(fs.existsSync(dest), false);
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/util-raw.test.js` — Expected: FAIL(`readRawTo` 未导出)
- [ ] **Step 3: 实现 `lib/util.js`**:在 `readBody` 函数之后插入:

```js
// 原始 body 流式落盘(BGM 上传):不经 JSON 解析;超限即断流并清理半截文件
function readRawTo(req, dest, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(dest);
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        out.destroy();
        fs.rmSync(dest, { force: true });
        reject(new Error("文件超过 30MB 上限"));
        req.destroy();
        return;
      }
      out.write(c);
    });
    req.on("end", () => out.end(() => resolve(dest)));
    req.on("error", (e) => {
      out.destroy();
      reject(e);
    });
    out.on("error", (e) => reject(e));
  });
}
```

exports 行 `module.exports = { id, sleep, readJSON, writeJSON, readBody, downloadTo, toDataUrl, findFont, sanitizeName };` 改为:

```js
module.exports = {
  id,
  sleep,
  readJSON,
  writeJSON,
  readBody,
  readRawTo,
  downloadTo,
  toDataUrl,
  findFont,
  sanitizeName,
};
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/util-raw.test.js` — Expected: PASS 2/2
- [ ] **Step 5: 改 `server.js`**,六处:

(a) requires 区(`const sb = require('./lib/storyboard');` 之后)加:

```js
const { readRawTo } = require("./lib/util");
```

(b) `route()` 函数(现 79-83 行)改为:

```js
function route(method, pattern, handler, opts = {}) {
  const names = [];
  const rx = new RegExp(
    "^" +
      pattern.replace(/:[a-zA-Z]+/g, (m) => {
        names.push(m.slice(1));
        return "([^/]+)";
      }) +
      "$",
  );
  routes.push({ method, rx, names, handler, raw: !!opts.raw });
}
```

(c) 分发器(现 372-376 行)改为:

```js
let body = {};
if (r.raw)
  body = req; // 原始流路由(BGM 上传):不 JSON 解析,handler 自行消费
else if (req.method === "POST" || req.method === "PUT") {
  const { readBody } = require("./lib/util");
  body = await readBody(req);
}
```

(d) `projectView` 的 return(现 53 行)——`coverImageUrl: url(p.coverImage),` 之后插入一行:

```js
    bgmUrl: url(p.bgm), bgmVolume: p.bgmVolume == null ? 25 : p.bgmVolume,
    transition: p.transition || 'fade', subSize: p.subSize || '中',
```

(e) PUT 白名单(现 220 行)`['title', 'script', 'style', 'shotsTarget']` 改为:

```js
for (const k of [
  "title",
  "script",
  "style",
  "shotsTarget",
  "transition",
  "subSize",
])
  if (k in body) p[k] = body[k];
if ("bgmVolume" in body)
  p.bgmVolume = Math.min(100, Math.max(0, Number(body.bgmVolume) || 0));
```

shots patch 白名单(现 235 行)`['sceneId', 'scene', 'visual', 'dialogue', 'speaker', 'camera', 'duration']` 改为(加 `'emotion'`):

```js
for (const k of [
  "sceneId",
  "scene",
  "visual",
  "dialogue",
  "speaker",
  "camera",
  "emotion",
  "duration",
])
  if (k in patch) sh[k] = patch[k];
```

(f) `DELETE /api/projects/:id` 路由(现 256-260 行)之后插入 BGM 两路由:

```js
// ---------- BGM 上传/移除(spec 深化 B):原始流落盘,零依赖 ----------
const BGM_EXTS = ["mp3", "wav", "m4a", "ogg"];
const BGM_MAX = 30 * 1024 * 1024;

route(
  "POST",
  "/api/projects/:id/bgm",
  async (req, res, params) => {
    const p = await loadProject(params.id);
    const ext = String(
      new URL(req.url, "http://x").searchParams.get("ext") || "",
    ).toLowerCase();
    if (!BGM_EXTS.includes(ext))
      return send(res, 415, { error: "不支持的音频格式,仅限 mp3/wav/m4a/ogg" });
    const media = path.join(store.projectDir(p.id), "media");
    const dest = path.join(media, `bgm.${ext}`);
    // 换扩展名重传前清掉旧文件,避免多文件并存导致 project.bgm 指向失效
    for (const e of BGM_EXTS)
      fs.rmSync(path.join(media, `bgm.${e}`), { force: true });
    try {
      await readRawTo(req, dest, BGM_MAX);
    } catch (e) {
      return send(res, /超过/.test(e.message) ? 413 : 500, {
        error: e.message,
      });
    }
    p.bgm = `media/bgm.${ext}`;
    store.saveProject(p);
    sseEmit(p.id);
    send(res, 200, { ok: true, bgm: `/media/${p.id}/bgm.${ext}` });
  },
  { raw: true },
);

route("DELETE", "/api/projects/:id/bgm", async (req, res, params) => {
  const p = await loadProject(params.id);
  const media = path.join(store.projectDir(p.id), "media");
  for (const e of BGM_EXTS)
    fs.rmSync(path.join(media, `bgm.${e}`), { force: true });
  p.bgm = null;
  store.saveProject(p);
  sseEmit(p.id);
  send(res, 200, { ok: true });
});
```

- [ ] **Step 6: 验证** — Run: `node --test && node --check server.js && node --check lib/util.js` — Expected: 全部 PASS、无输出
- [ ] **Step 7: Commit**

```bash
git add server.js lib/util.js tests/util-raw.test.js
git commit -m "feat: BGM 上传/删除端点(原始流+30MB 上限)与项目字段白名单扩展" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: `public/` — 镜头卡运镜/情绪选择、预览一致性侧栏、成片面板 BGM 与合成设置

**Files:**

- Modify: `public/app.js`(CAMERAS/EMOTIONS 常量;renderShotCard;lightbox;preview act;bgm 两 act;change 两分支;renderFilm)
- Modify: `public/style.css`(lightbox 行改造 + 侧栏/mini-select 样式)

**Interfaces:**

- Consumes: Task 6 的 `bgmUrl/bgmVolume/transition/subSize` 视图字段、BGM 两端点、shots emotion 白名单、`data-change` 既有通道。
- Produces: 无服务端新接口;纯 UI。

- [ ] **Step 1: style.css 两处**。将现 260-261 行两条 `.lightbox` 规则:

```css
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(0, 0, 0, 0.86);
  display: grid;
  place-items: center;
  cursor: zoom-out;
}
.lightbox img,
.lightbox video {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 10px;
}
```

替换为:

```css
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(0, 0, 0, 0.86);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  cursor: zoom-out;
}
.lightbox img,
.lightbox video {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 10px;
}
/* 预览弹层右侧:角色一致性人工比对侧栏(spec 深化 D) */
.lightbox:has(.lb-refs) img,
.lightbox:has(.lb-refs) video {
  max-width: calc(92vw - 240px);
}
.lightbox .lb-refs {
  max-width: 210px;
  max-height: 92vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lightbox .lb-refs-t {
  font-size: 12px;
  color: #ccc;
}
.lightbox .lb-refs figure {
  margin: 0;
}
.lightbox .lb-refs img {
  max-width: 190px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.lightbox .lb-refs figcaption {
  font-size: 11px;
  color: #bbb;
  margin-top: 3px;
}
/* 镜头卡内的迷你下拉(运镜/情绪) */
.mini-select {
  background: var(--bg2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 7px;
  font-size: 11.5px;
  padding: 2px 4px;
}
.mini-select:focus {
  border-color: var(--accent);
  outline: none;
}
```

- [ ] **Step 2: app.js — 常量与镜头卡**。在 `function renderShotCard(sh) {` 之前插入:

```js
const CAMERAS = ["固定", "缓推", "拉远", "摇镜", "特写"];
const EMOTIONS = ["平静", "严肃", "激动", "低沉", "惊讶", "悲伤"];
```

`renderShotCard` 内三处:

(a) media 常量(现 948-952 行)video/img 两个预览元素加 `data-idx`/`data-scene-id`(替换整块):

```js
const media = sh.clipUrl
  ? `<video src="${sh.clipUrl}" preload="metadata" data-act="preview" data-kind="video" data-url="${sh.clipUrl}" data-idx="${sh.idx}" data-scene-id="${sh.sceneId}"></video>`
  : sh.panelUrl
    ? `<img src="${sh.panelUrl}" loading="lazy" data-act="preview" data-kind="img" data-url="${sh.panelUrl}" data-idx="${sh.idx}" data-scene-id="${sh.sceneId}">`
    : `<div class="ph">🖼️<br><span style="font-size:12px">暂无分镜图</span></div>`;
```

(b) row1 中 `<span class="tag">📷 ${esc(sh.camera || "固定")}</span>` 替换为可编辑下拉:

```js
<select
  class="mini-select"
  data-change="shot"
  data-idx="${sh.idx}"
  data-field="camera"
  title="运镜(动态漫引擎生效;AI 视频提示词已含)"
>
  $
  {CAMERAS.map(
    (c) =>
      `<option ${c === (sh.camera || "固定") ? "selected" : ""}>${c}</option>`,
  ).join("")}
</select>
```

(c) 台词 textarea(现 967 行)替换为 台词+情绪 一行:

```js
<div style="display:flex;gap:6px;align-items:center">
  <textarea
    class="dlg"
    data-change="shot"
    data-idx="${sh.idx}"
    data-field="dialogue"
    rows="1"
    placeholder="台词(可空)"
    style="flex:1"
  >
    ${esc(sh.dialogue || "")}
  </textarea>
  <select
    class="mini-select"
    data-change="shot"
    data-idx="${sh.idx}"
    data-field="emotion"
    title="台词情绪(配音韵律)"
  >
    $
    {EMOTIONS.map(
      (m) =>
        `<option ${m === (sh.emotion || "平静") ? "selected" : ""}>${m}</option>`,
    ).join("")}
  </select>
</div>
```

- [ ] **Step 3: app.js — lightbox 升级与 preview 分支**。整函数替换(现 196-205 行):

```js
function lightbox(kind, url, shot) {
  const p = S.project;
  let refs = [];
  if (shot && p) {
    // 一致性质检(spec 深化 D):说话人 + 场景 cast 匹配到的角色设定图,并排人工比对
    const sc = (p.scenes || []).find((s) => s.id === shot.sceneId);
    const names = new Set(
      [...((sc && sc.cast) || []), shot.speaker].filter(Boolean),
    );
    refs = (p.characters || []).filter((c) => names.has(c.name) && c.refUrl);
  }
  const el = document.createElement("div");
  el.className = "lightbox";
  el.innerHTML =
    kind === "video"
      ? `<video src="${url}" controls autoplay></video>`
      : `<img src="${url}">`;
  if (refs.length) {
    const side = document.createElement("div");
    side.className = "lb-refs";
    side.innerHTML = `<div class="lb-refs-t">角色一致性比对</div>${refs
      .map(
        (c) =>
          `<figure><img src="${c.refUrl}"><figcaption>${esc(c.name)} 设定图</figcaption></figure>`,
      )
      .join("")}`;
    el.appendChild(side);
  }
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}
```

preview act 分支(现 1711 行)`} else if (act === "preview") lightbox(el.dataset.kind, el.dataset.url);` 替换为:

```js
    } else if (act === "preview") {
      const shot =
        S.project &&
        (S.project.shots || []).find(
          (s) =>
            String(s.idx) === el.dataset.idx &&
            s.sceneId === el.dataset.sceneId,
        );
      lightbox(el.dataset.kind, el.dataset.url, shot);
    } else if (act === "bgm-upload") {
      const inp = document.getElementById("bgm-file");
      const f = inp && inp.files && inp.files[0];
      if (!f) return toast("请先选择音频文件", "err");
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      toast("BGM 上传中…");
      const r = await fetch(`/api/projects/${S.project.id}/bgm?ext=${encodeURIComponent(ext)}`, { method: "POST", body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await refreshProject();
      toast("BGM 已上传,合成成片时自动混音", "ok");
    } else if (act === "bgm-remove") {
      if (!confirm("确定移除 BGM?")) return;
      await api(`/api/projects/${S.project.id}/bgm`, "DELETE");
      await refreshProject();
      toast("BGM 已移除", "ok");
    }
```

(其他无 data-idx 的预览入口——角色图、封面、BGM 试听——`shot` 为 undefined,自动无侧栏。)

- [ ] **Step 4: app.js — change 处理器两分支**。在 `} else if (kind === "arc" || kind === "beat") {`(现 1792 行)之前插入:

```js
  } else if (kind === "project") {
    send({ [el.dataset.field]: el.value });
  } else if (kind === "bgmvol") {
    const label = document.getElementById("bgm-vol-v");
    if (label) label.textContent = el.value;
    send({ bgmVolume: Number(el.value) });
  } else if (kind === "arc" || kind === "beat") {
```

(把原有的 `} else if (kind === "arc" …` 保留为插入块的尾部,不要复制成两个。)

- [ ] **Step 5: app.js — renderFilm 注入两块面板**。在现 1043 行 `    }`(成片区三元块结束)与现 1044 行 `    <div class="panel-card">`(成本表卡开始)之间插入:

```js
    <div class="panel-card">
      <h3>🎵 BGM 背景音乐</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="file" id="bgm-file" accept="audio/*" style="flex:1;min-width:0;font-size:12px">
        <button class="btn small" data-act="bgm-upload">⬆ 上传</button>
        ${p.bgmUrl ? `<button class="btn small" data-act="preview" data-kind="video" data-url="${p.bgmUrl}">🔊 试听</button>
        <button class="btn small" data-act="bgm-remove">✕ 移除</button>` : ""}
      </div>
      <div style="margin-top:8px;color:var(--dim);font-size:12px">${p.bgmUrl ? "已上传:重新合成时自动与配音混音(有台词自动压低,静默段恢复)" : "支持 mp3/wav/m4a/ogg,≤30MB;上传后合成成片时自动混音"}</div>
      <div class="form-row" style="margin-top:10px">
        <span style="flex:none">BGM 音量</span>
        <input type="range" min="0" max="100" value="${p.bgmVolume == null ? 25 : p.bgmVolume}" data-change="bgmvol" style="flex:1">
        <span id="bgm-vol-v" style="flex:none;width:36px;text-align:right">${p.bgmVolume == null ? 25 : p.bgmVolume}</span>
      </div>
    </div>
    <div class="panel-card">
      <h3>🎞 合成设置</h3>
      <div class="form-row">
        <span style="flex:none">转场</span>
        <select data-change="project" data-field="transition" style="flex:1">
          <option value="fade" ${(p.transition || "fade") === "fade" ? "selected" : ""}>淡入淡出(默认)</option>
          <option value="none" ${p.transition === "none" ? "selected" : ""}>硬切</option>
          <option value="black" ${p.transition === "black" ? "selected" : ""}>黑场过渡</option>
        </select>
      </div>
      <div class="form-row">
        <span style="flex:none">字幕字号</span>
        <select data-change="project" data-field="subSize" style="flex:1">
          <option value="小" ${p.subSize === "小" ? "selected" : ""}>小</option>
          <option value="中" ${p.subSize !== "小" && p.subSize !== "大" ? "selected" : ""}>中(默认)</option>
          <option value="大" ${p.subSize === "大" ? "selected" : ""}>大</option>
        </select>
      </div>
      <div style="color:var(--dim);font-size:12px;margin-top:6px">改动即时保存;重新「合成成片」后生效。</div>
    </div>
```

- [ ] **Step 6: 验证** — Run: `node --test && node --check public/app.js` — Expected: 全部 PASS、无输出
- [ ] **Step 7: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: 前端——镜头卡运镜/情绪选择、预览一致性侧栏、成片面板 BGM 与合成设置" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: README + 手动 QA 冒烟(全链收口)

**Files:**

- Modify: `README.md`(「### 双引擎:火山方舟 + 阿里云百炼(通义)」之前插入新小节)

**Interfaces:**

- Consumes: 全部前序任务。

- [ ] **Step 1: README 插入**(锚点行 `### 双引擎:火山方舟 + 阿里云百炼(通义)` 之前):

```markdown
### 工序深化:运镜 / 情绪配音 / BGM / 转场 / 一致性质检(Phase 1)

- **动态漫运镜**:分镜的 `camera`(固定/缓推/拉远/摇镜/特写)现在驱动免费动态漫引擎——缓推居中放大、拉远由近及远、摇镜水平扫过、特写快速推近,固定则完全静止。AI 生成分镜时自动标注运镜,镜头卡上可改。
- **情绪韵律配音**:每句台词带情绪(平静/严肃/激动/低沉/惊讶/悲伤),按情绪调整语速/音调/音量(edge-tts 韵律近似);改情绪自动重配音。镜头卡台词旁可改。
- **BGM 背景音乐**:成片面板上传本地音乐(mp3/wav/m4a/ogg,≤30MB),合成时整片循环混音——有台词自动闪避(ducking),静默段自动恢复;音量滑杆 0-100,0 视为不用 BGM。
- **转场与字幕**:成片面板「合成设置」可选 淡入淡出(默认)/硬切/黑场过渡,字幕字号 小/中/大 三档;改动即时保存,重新合成后生效。
- **一致性质检**:点击分镜图预览时右侧并排显示出场角色设定图,人工比对,不一致就 ↻ 重roll单镜。
```

- [ ] **Step 2: 全套件** — Run: `node --test` — Expected: 全部 PASS
- [ ] **Step 3: 手动 QA 冒烟**(启动 `./start.sh`,浏览器 http://127.0.0.1:8787;ffmpeg 侧先用命令直跑):

```bash
# BGM ducking 冒烟:造 6s"成片"+30s 循环 BGM → 混音后应有音轨且时长≈6s
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc=size=864x1536:rate=25:duration=6" -f lavfi -i "sine=frequency=440:duration=6" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest /tmp/mj_qa_film.mp4
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=220:duration=30" /tmp/mj_qa_bgm.wav
node -e "
const compose = require('./lib/compose');
(async () => {
  await compose.mixBgm('/tmp/mj_qa_film.mp4', '/tmp/mj_qa_bgm.wav', { vol: 0.25, hasVoice: true, dur: 6, dest: '/tmp/mj_qa_mixed.mp4' });
  console.log('mix OK');
})().catch(e => { console.error(e); process.exit(1); });
"
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/mj_qa_mixed.mp4
```

Expected: `mix OK` 且时长 ≈ 6.0(±0.2s);人耳/波形确认 BGM 存在。随后逐项过 UI 清单并记录到提交说明:

1. 旧项目(无任何新字段)打开成片面板:音量显示 25、转场显示 淡入淡出、字号显示 中(=零迁移缺省)。
2. 上传非法扩展名文件(如 .txt 改名 .mp3 由 accept 拦截;用 curl 直发 `?ext=txt`)→ toast「不支持的音频格式」(415)。
3. `curl -X POST --data-binary @/tmp/mj_qa_bgm.wav "http://127.0.0.1:8787/api/projects/<id>/bgm?ext=wav"` 成功 → 面板出现试听/移除;再传一个 >30MB 文件 → 413 toast,且 media/ 下无 `bgm.*` 残留(`ls data/projects/<id>/media/`确认)。
4. 音量滑杆拖动 → project.json `bgmVolume` 回读一致;转场/字号下拉 → `transition`/`subSize` 回读一致。
5. 动态漫引擎对含 摇镜/特写/固定 镜头的场景重新生成片段:摇镜画面水平平移、特写明显推近、固定完全静止(看 canvas 或成片)。
6. 改某镜情绪为 激动 → 重新配音后语速/音调可辨变化;voiceHash 变化触发重合成(日志可见,不再"跳过")。
7. 点击有出场角色的分镜图 → 预览右侧出现「角色一致性比对」侧栏;点击角色图/封面预览 → 无侧栏。
8. 转场 fade 重新合成 → 段间柔和;black → 段间黑场;成片尾部 BGM 无爆音。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: 工序深化(Phase 1)使用说明与 QA 清单" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录(写计划时已自查)

- **Spec 覆盖**:§3 运镜→T1/T4/T7;§4 BGM→T4/T6/T7;§5 情绪→T2/T3/T5/T7;§6 质检→T7;§7 转场/字幕→T4/T5/T6/T7;§8 兼容→各缺省回落点+Review Focus 1;§9 错误处理→T2 重试/T4 降级/T6 413/415;§10 测试→各 TDD 步+T8 冒烟;§11 不做→无越界改动;§12 约束→Global Constraints。无缺口。
- **占位符扫描**:无 TBD/TODO;所有代码步骤含完整代码;`storyboard.js` 的 exports 行按「追加 `normalizeShot,`」给出精确锚点与内容。
- **类型一致性**:`cameraExpr(camera,frames,W,H,fps)`(T1 定义=T4 消费);`emotionProsody→[rate,pitch,volume]`(T2 定义=T5 解构);`buildSegment(shot,files,dir,{transition,subSize})`(T4 定义=T5 传参);`mixBgm(filmIn,bgmIn,{vol,hasVoice,dur,dest})`(T4 定义=T5 调用);`readRawTo(req,dest,limit)`(T6 util=T6 路由);视图字段 `bgmUrl/bgmVolume/transition/subSize`(T6 产出=T7 消费)全部一致。
- **Review Focus 五行**均已挂到拥有代码的任务(见各行标注)。
