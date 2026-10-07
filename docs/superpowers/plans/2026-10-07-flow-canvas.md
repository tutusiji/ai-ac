# 全屏节点画布交互重构 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把漫剧工坊项目内交互从 tab 式 SPA 重构为 ComfyUI 风格的全屏节点画布(双层:流水线总览 + 镜头图),旧 tab 编辑器收进右侧详情面板,脉络工作室保留为全屏浮层。

**Architecture:** 画布是 project.json(API 视图)的纯投影——`flow-graph.js` 纯函数派生节点/连线/布局(可单测),`flow.js` 提供视口引擎与通用宿主(面板/浮层/日志/全屏),`app.js` 保留状态层、SSE、事件委托与各渲染函数并重写路由与壳。后端零改动、零第三方依赖。

**Tech Stack:** 原生 JS/CSS(经典 `<script>`,无构建)、SVG bezier 连线、DOM 节点卡、`node --test`(Node ≥ 18,本机 v22)、localStorage 位置记忆。

**Spec:** `docs/superpowers/specs/2026-10-07-flow-canvas-design.md`

## Global Constraints

- 零第三方依赖、无构建步骤;经典 `<script>` 全局函数模式(非 ES module)。
- 后端零改动:`server.js`、`lib/` 一个字都不动。
- 节点 id 格式稳定:总览 `idea|story|chars|panels|clips|voice|film|cover`;镜头层 `scene:<场景id>` 与 `shot:<场景id>:<镜号>`。
- 状态枚举映射:`pending→run(蓝)`、`done|animatic→done(绿)`、`error→error(红)`、`skipped→skip(橙)`、`none/空→pending(灰待做)`。
- 所有交互沿用 `data-act` / `data-change` + document 级事件委托;不新增事件总线。
- 画布节点卡内**不放**可编辑控件(textarea/input);编辑一律进右侧详情面板。
- localStorage 读写必须 try/catch(隐私模式降级为不记忆)。
- 每个任务结束时 `git commit`,信息末尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 单测命令:仓库根目录 `node --test tests/`。

## Review Focus

规格隐含但任务测试未直接覆盖、最容易咬到使用者的五类输入(每行已钉到归属任务):

1. **旧格式迁移项目**(场景「整集(旧)」,`arcId=''`、无 `story.arcs`)→ 镜头层必须正常出组、计数正确,不得假设章节存在 → Task 3 测试 `旧格式项目:整集(旧)场景正常成组`。
2. **非常规状态值** `clipStatus='animatic'` / `voiceStatus='skipped'` → 必须计为完成/跳过,不得显示为待做或报错 → Task 2 测试 `animatic 计入视频完成`、Task 3 测试 `pips 状态映射`。
3. **localStorage 不可用**(隐私模式/被禁)→ 画布完全可用,仅不记忆节点位置,无 JS 报错 → Task 5 Step 1(flow.js 的 ls 读写全 try/catch)+ Task 10 QA 第 9 项。
4. **URL 带未知/已删的 `scene`/`sel` 参数**(书签过期、场景已删)→ 静默忽略回落总览,不弹错不白屏 → Task 6 Step 4(onNodeSelect 对未知 id 静默忽略)+ Task 10 QA 第 10 项。
5. **SSE 高频刷新撞上正在输入的详情面板** → 行为与旧 tab 版本一致(600ms 防抖保存,重渲染由数据驱动),不得引入丢字回归 → Task 8 Step 5 冒烟第 2 项(焦点守卫)+ Task 10 QA 第 6 项。

---

### Task 1: 仓库初始化与基线提交

**Files:**

- Create: `.gitignore`

**Interfaces:**

- Consumes: 无
- Produces: git 仓库与干净基线,后续所有任务的 commit 都基于此;`node --test tests/` 目录约定

本项目当前**不是 git 仓库**,后续任务的提交步骤与 superpowers 执行流程(分支/评审)都依赖 git,先初始化。

- [ ] **Step 1: 初始化 git 仓库**

```bash
cd /home/tutuos/CodeLab/manju && git init -b main
```

- [ ] **Step 2: 写 .gitignore**

创建 `.gitignore`,内容:

```gitignore
node_modules/
.venv/
data/settings.json
data/projects/
*.log
.DS_Store
```

> `data/settings.json` 含明文 API Key,`data/projects/` 是用户项目媒体,均不入库(README「Key 安全」约定)。

- [ ] **Step 3: 基线提交(重构前的原始状态)**

```bash
cd /home/tutuos/CodeLab/manju
git add .gitignore README.md start.sh server.js lib public docs
git commit -m "chore: baseline before flow-canvas refactor

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 4: 验证**

Run: `git log --oneline` → 至少 1 条提交;`git status --short` → 无未跟踪的源码文件(仅 `data/`、`.venv/` 被忽略)。

### Task 2: flow-graph.js 总览层 buildGraph(TDD)

**Files:**

- Create: `public/flow-graph.js`
- Test: `tests/flow-graph.test.js`

**Interfaces:**

- Consumes: API 项目视图字段(已核对 `server.js:43-59`):`p.shots[].{idx,sceneId,visual,dialogue,panelStatus,clipStatus,voiceStatus,panelUrl,clipUrl,audioUrl}`、`p.scenes[].{id,title,locked,stats:{shots,panels,clips,voices}}`、`p.characters[].{id,refUrl,status}`、`p.story.{premise,direction,arcs}`、`p.script/filmUrl/coverImageUrl/running`、`settings.videoEngine`
- Produces: `buildGraph(project, settings, view) => { view, nodes, edges, bounds }`;节点字段 `{ id, kind, icon, title, status, sub, x, y, w, h, ports:{in:[x,y], out:[x,y]} }`;`zoomAt(vp, deltaY, cx, cy)`(Task 4 补充);CommonJS 导出 `{ buildGraph, zoomAt, FG, fgStage }` 供单测与 flow.js 使用

总览层:8 个固定节点、串行链、确定性布局。**拓扑恒定**(与项目状态无关),这保证 Task 8 的就地补丁可以按 id 对齐。

- [ ] **Step 1: 写失败测试**

创建 `tests/flow-graph.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { buildGraph } = require("../public/flow-graph.js");

const SETTINGS = { videoEngine: "seedance", resolution: "720p" };
function mkProj(over = {}) {
  return {
    id: "mj_test",
    title: "测试项目",
    style: "anime",
    script: "",
    shotsTarget: 6,
    cost: 0,
    running: null,
    lastError: null,
    story: { premise: "", direction: "", arcs: [] },
    scenes: [],
    shots: [],
    characters: [],
    film: "",
    coverImage: "",
    filmUrl: "",
    coverImageUrl: "",
    ...over,
  };
}
function mkShot(idx, sceneId, over = {}) {
  return {
    idx,
    sceneId,
    scene: "",
    visual: "画面" + idx,
    dialogue: "",
    speaker: "",
    camera: "固定",
    duration: 5,
    panel: "",
    panelStatus: "none",
    clip: "",
    clipStatus: "none",
    voiceStatus: "none",
    audio: "",
    audioDur: 0,
    error: "",
    panelUrl: "",
    clipUrl: "",
    audioUrl: "",
    ...over,
  };
}

test("总览:空项目输出 8 节点串行链,全部待做", () => {
  const g = buildGraph(mkProj(), SETTINGS, "overview");
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ["idea", "story", "chars", "panels", "clips", "voice", "film", "cover"],
  );
  assert.equal(g.edges.length, 7);
  assert.ok(
    g.edges.every(
      (e, i) => e.from === g.nodes[i].id && e.to === g.nodes[i + 1].id,
    ),
  );
  assert.ok(g.nodes.every((n) => n.status === "pending"));
});

test("总览:计数与状态推导", () => {
  const sc = {
    id: "sc_a",
    title: "场景A",
    locked: false,
    arcId: "",
    beatId: "",
    stats: { shots: 3, panels: 2, clips: 1, voices: 1 },
  };
  const p = mkProj({
    script: "一个创意",
    scenes: [sc],
    characters: [
      {
        id: "c1",
        name: "甲",
        desc: "",
        refUrl: "/media/x/a.jpg",
        status: null,
      },
      { id: "c2", name: "乙", desc: "", refUrl: "", status: "error" },
    ],
    shots: [
      mkShot(1, "sc_a", {
        panelStatus: "done",
        dialogue: "台词1",
        voiceStatus: "done",
      }),
      mkShot(2, "sc_a", { panelStatus: "done" }),
      mkShot(3, "sc_a", { panelStatus: "error", dialogue: "台词2" }),
    ],
  });
  const g = buildGraph(p, SETTINGS, "overview");
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(byId.idea.status, "done");
  assert.equal(byId.chars.status, "error"); // 有角色生成失败
  assert.equal(byId.chars.sub, "1/2");
  assert.equal(byId.panels.status, "error");
  assert.equal(byId.panels.sub, "2/3");
  assert.equal(byId.voice.sub, "1/2"); // n = 有台词的镜头数
  assert.equal(byId.clips.sub, "0/3 · 🔒0/1"); // 锁定计数挂在视频节点
  assert.ok(g.nodes.every((n) => n.w > 0 && n.h > 0 && n.ports.out[0] === n.w));
});

test("总览:running 阶段节点变 run", () => {
  const p = mkProj({
    running: "panels",
    shots: [mkShot(1, "sc_a", { panelStatus: "pending" })],
  });
  const g = buildGraph(p, SETTINGS, "overview");
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(byId.panels.status, "run");
  assert.equal(byId.idea.status, "pending");
});

test("animatic 计入视频完成;skipped 不计入配音完成", () => {
  const p = mkProj({
    shots: [
      mkShot(1, "sc_a", {
        clipStatus: "animatic",
        dialogue: "词",
        voiceStatus: "skipped",
      }),
      mkShot(2, "sc_a", { dialogue: "词" }),
    ],
  });
  const g = buildGraph(p, SETTINGS, "overview");
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(byId.clips.sub, "1/2 · 🔒0/0");
  assert.equal(byId.voice.sub, "0/2");
});

test("总览:布局为左→右等距分列", () => {
  const g = buildGraph(mkProj(), SETTINGS, "overview");
  for (let i = 1; i < g.nodes.length; i++) {
    assert.equal(g.nodes[i].x - g.nodes[i - 1].x, g.nodes[i - 1].w + 96);
  }
  assert.ok(g.bounds.w > g.nodes[7].x + g.nodes[7].w);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/`
Expected: FAIL,`Cannot find module '../public/flow-graph.js'`

- [ ] **Step 3: 实现总览层**

创建 `public/flow-graph.js`:

```js
"use strict";
/* flow-graph.js — 节点画布纯函数层:
   project(API 视图)+ settings + view → { view, nodes, edges, bounds }。
   零 DOM 依赖;node --test 可直接 require(见 tests/flow-graph.test.js)。 */

const FG = {
  NODE_W: 200,
  NODE_H: 92,
  OVER_GAP: 96,
  OVER_X: 60,
  OVER_Y: 140, // 总览层
  SGW: 232,
  SG_HEAD: 64,
  SG_PAD: 16, // 场景分组
  SHW: 184,
  SHH: 196,
  SH_GAP: 14, // 镜头卡
  SG_X: 60,
  SG_Y: 110,
  SG_GAPX: 36,
  SG_GAPY: 36, // 镜头层网格
  FILM_W: 220,
  FILM_GAP: 64,
  SC_COLS: 3, // 场景网格列数
};

const fgClamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 条目状态 → 画布状态。本应用约定:pending=生成中,none/空=未生成,
   animatic=动态漫(视为完成),skipped=配音跳过 */
function fgStage(st) {
  if (st === "pending") return "run";
  if (st === "done" || st === "animatic") return "done";
  if (st === "error") return "error";
  if (st === "skipped") return "skip";
  return "pending";
}

/* 聚合节点状态:该阶段在跑 → run;任一条目失败 → error;全部完成 → done;否则 pending */
function fgAgg(stage, running, hasErr, doneN, total) {
  if (running === stage) return "run";
  if (hasErr) return "error";
  if (total > 0 && doneN >= total) return "done";
  return "pending";
}

function overviewGraph(p, settings) {
  const shots = p.shots || [],
    chars = p.characters || [],
    scenes = p.scenes || [];
  const withDlg = shots.filter((s) => (s.dialogue || "").trim());
  const animatic = settings && settings.videoEngine === "animatic";
  const running = p.running || "";
  const done = (arr, f) => arr.filter(f).length;

  const panelsDone = done(shots, (s) => s.panelStatus === "done");
  const panelsErr = shots.some((s) => s.panelStatus === "error");
  const clipsDone = done(
    shots,
    (s) => s.clipStatus === "done" || s.clipStatus === "animatic",
  );
  const clipsErr = shots.some((s) => s.clipStatus === "error");
  const voiceDone = done(shots, (s) => s.voiceStatus === "done");
  const voiceErr = shots.some((s) => s.voiceStatus === "error");
  const charsDone = done(chars, (c) => !!c.refUrl);
  const charsErr = chars.some((c) => c.status === "error");
  const lockedN = scenes.filter((s) => s.locked).length;
  const arcsN = ((p.story && p.story.arcs) || []).length;
  const scenesReady =
    scenes.length > 0 && scenes.every((s) => (s.stats || {}).shots > 0);

  const mk = (id, kind, icon, title, status, sub) => ({
    id,
    kind,
    icon,
    title,
    status,
    sub,
    w: FG.NODE_W,
    h: FG.NODE_H,
    x: FG.OVER_X,
    y: FG.OVER_Y,
    ports: { in: [0, FG.NODE_H / 2], out: [FG.NODE_W, FG.NODE_H / 2] },
  });

  const nodes = [
    mk(
      "idea",
      "idea",
      "📝",
      "创意",
      p.script ? "done" : "pending",
      p.script ? "已写创意" : "先写故事创意",
    ),
    mk(
      "story",
      "story",
      "🧭",
      "脉络",
      fgAgg("sceneShots", running, false, scenesReady ? 1 : 0, 1),
      `${scenes.length} 场景 · ${arcsN} 章节`,
    ),
    mk(
      "chars",
      "chars",
      "👤",
      "角色图",
      fgAgg("characters", running, charsErr, charsDone, chars.length),
      `${charsDone}/${chars.length}`,
    ),
    mk(
      "panels",
      "panels",
      "🖼",
      "分镜图",
      fgAgg("panels", running, panelsErr, panelsDone, shots.length),
      `${panelsDone}/${shots.length}`,
    ),
    mk(
      "clips",
      "clips",
      "🎬",
      animatic ? "动态漫" : "视频",
      animatic
        ? "done"
        : fgAgg("clips", running, clipsErr, clipsDone, shots.length),
      animatic
        ? "免费引擎已启用"
        : `${clipsDone}/${shots.length} · 🔒${lockedN}/${scenes.length}`,
    ),
    mk(
      "voice",
      "voice",
      "🎙",
      "配音",
      fgAgg("voice", running, voiceErr, voiceDone, withDlg.length),
      `${voiceDone}/${withDlg.length}`,
    ),
    mk(
      "film",
      "film",
      "🎞",
      "合成",
      p.filmUrl ? "done" : running === "film" ? "run" : "pending",
      p.filmUrl ? "成片就绪" : "等待素材",
    ),
    mk(
      "cover",
      "cover",
      "🎨",
      "封面",
      p.coverImageUrl ? "done" : running === "cover" ? "run" : "pending",
      p.coverImageUrl ? "海报已生成" : "可选",
    ),
  ];
  nodes.forEach((nd, i) => {
    nd.x = FG.OVER_X + i * (FG.NODE_W + FG.OVER_GAP);
  });

  const chain = [
    "idea",
    "story",
    "chars",
    "panels",
    "clips",
    "voice",
    "film",
    "cover",
  ];
  const edges = chain
    .slice(0, -1)
    .map((a, i) => ({ id: "e_" + a, from: a, to: chain[i + 1] }));

  const last = nodes[nodes.length - 1];
  return {
    view: "overview",
    nodes,
    edges,
    bounds: { w: last.x + last.w + FG.OVER_X, h: FG.OVER_Y + FG.NODE_H + 120 },
  };
}

function buildGraph(p, settings, view) {
  return view === "shots"
    ? shotsGraph(p, settings)
    : overviewGraph(p, settings);
}

/* shotsGraph 在 Task 3 实现;先给空实现让总览测试通过 */
function shotsGraph() {
  return { view: "shots", nodes: [], edges: [], bounds: { w: 800, h: 600 } };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildGraph, zoomAt: null, FG, fgStage }; // zoomAt 在 Task 4 补上
}
```

> 注意:`module.exports` 里 `zoomAt: null` 是占位,Task 4 实现后替换为真函数。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: PASS,5 个测试全绿

- [ ] **Step 5: 提交**

```bash
cd /home/tutuos/CodeLab/manju
git add public/flow-graph.js tests/flow-graph.test.js
git commit -m "feat(flow): overview-layer graph derivation with TDD

buildGraph(project, settings, 'overview') projects the fixed 8-node
pipeline chain with counts, statuses and deterministic layout.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: flow-graph.js 镜头层 shotsGraph(TDD)

**Files:**

- Modify: `public/flow-graph.js`
- Test: `tests/flow-graph.test.js`

**Interfaces:**

- Consumes: Task 2 的 `buildGraph` 骨架、`fgStage`、`FG` 常量
- Produces: `buildGraph(p, s, 'shots')` 输出场景分组节点(kind `scene`,字段 `locked/stats/sceneId/desc`)与镜头节点(kind `shot`,字段 `idx/sceneId/line/thumbUrl/pips{txt,img,vid,aud}`),边 `shot:* → film`

镜头层只铺场景分组 + 镜头卡 + 合成节点;创意/角色/封面经详情面板与命令面板触达(Task 7)。布局两遍:先算每组高度,再逐行累计 y;镜头卡世界坐标 = 组坐标 + 头部高 + 纵向偏移。

- [ ] **Step 1: 追加失败测试**

在 `tests/flow-graph.test.js` 末尾追加(复用文件里的 `mkProj`/`mkShot`/`SETTINGS`):

```js
test("镜头层:场景成组、pips 映射、全部汇入合成节点", () => {
  const p = mkProj({
    scenes: [
      {
        id: "sc_a",
        title: "场景A",
        locked: true,
        arcId: "",
        beatId: "",
        stats: { shots: 2, panels: 2, clips: 1, voices: 1 },
      },
      {
        id: "sc_b",
        title: "场景B",
        locked: false,
        arcId: "",
        beatId: "",
        stats: { shots: 1, panels: 0, clips: 0, voices: 0 },
      },
    ],
    shots: [
      mkShot(1, "sc_a", {
        panelStatus: "done",
        clipStatus: "animatic",
        dialogue: "词",
        voiceStatus: "skipped",
      }),
      mkShot(2, "sc_a", { panelStatus: "pending" }),
      mkShot(3, "sc_b", { panelStatus: "error" }),
    ],
  });
  const g = buildGraph(p, SETTINGS, "shots");
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const ga = byId["scene:sc_a"];
  assert.equal(ga.kind, "scene");
  assert.equal(ga.locked, true);
  assert.equal(ga.stats.shots, 2);
  const s1 = byId["shot:sc_a:1"];
  assert.deepEqual(s1.pips, {
    txt: "done",
    img: "done",
    vid: "done",
    aud: "skip",
  });
  assert.equal(byId["shot:sc_a:2"].pips.img, "run");
  assert.equal(byId["shot:sc_b:3"].pips.img, "error");
  const shotEdges = g.edges.filter((e) => e.to === "film");
  assert.equal(shotEdges.length, 3);
  assert.ok(byId.film.x > Math.max(ga.x, byId["scene:sc_b"].x));
});

test("旧格式项目:整集(旧)场景正常成组", () => {
  const p = mkProj({
    scenes: [
      {
        id: "sc_old",
        title: "整集(旧)",
        arcId: "",
        beatId: "",
        locked: false,
        stats: { shots: 6, panels: 6, clips: 6, voices: 6 },
      },
    ],
    shots: Array.from({ length: 6 }, (_, i) =>
      mkShot(i + 1, "sc_old", { panelStatus: "done" }),
    ),
  });
  const g = buildGraph(p, SETTINGS, "shots");
  assert.ok(
    g.nodes.find((n) => n.id === "scene:sc_old"),
    "整集(旧)必须有分组节点",
  );
  assert.equal(g.nodes.filter((n) => n.kind === "shot").length, 6);
  assert.equal(g.edges.filter((e) => e.to === "film").length, 6);
  assert.doesNotThrow(() => buildGraph(p, SETTINGS, "overview"));
});

test("镜头层:场景网格 3 列换行、镜头卡在组内偏移", () => {
  const scenes = Array.from({ length: 4 }, (_, i) => ({
    id: "sc_" + i,
    title: "场景" + i,
    locked: false,
    arcId: "",
    beatId: "",
    stats: { shots: 1, panels: 0, clips: 0, voices: 0 },
  }));
  const p = mkProj({
    scenes,
    shots: scenes.map((s, i) => mkShot(i + 1, s.id)),
  });
  const g = buildGraph(p, SETTINGS, "shots");
  const groups = g.nodes.filter((n) => n.kind === "scene");
  assert.ok(groups[3].y > groups[0].y + groups[0].h, "第 4 场景必须换行");
  const s = g.nodes.find((n) => n.id === "shot:sc_0:1");
  assert.ok(s.x > groups[0].x && s.y > groups[0].y, "镜头卡在组内偏移");
});

test("镜头层:空场景只有分组节点,无镜头边,film 始终存在", () => {
  const p = mkProj({
    scenes: [
      {
        id: "sc_empty",
        title: "空场景",
        arcId: "",
        beatId: "",
        locked: false,
        stats: { shots: 0, panels: 0, clips: 0, voices: 0 },
      },
    ],
    shots: [],
  });
  const g = buildGraph(p, SETTINGS, "shots");
  assert.ok(g.nodes.find((n) => n.id === "scene:sc_empty"));
  assert.ok(!g.nodes.some((n) => n.kind === "shot"));
  assert.ok(!g.edges.some((e) => e.to === "film"));
  assert.ok(g.nodes.find((n) => n.id === "film"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/`
Expected: FAIL——`shotsGraph` 仍是空实现,镜头层断言不满足

- [ ] **Step 3: 实现 shotsGraph**

把 `public/flow-graph.js` 里的占位函数替换为:

```js
function shotsGraph(p, settings) {
  const scenes = p.scenes || [];
  const shots = p.shots || [];
  const running = p.running || "";
  const nodes = [];
  const edges = [];

  // 每组高度 = 头部 + 镜头数 ×(卡高+间距)+ 底部内边距
  const groups = scenes.map((sc) => {
    const ss = shots
      .filter((s) => s.sceneId === sc.id)
      .sort((a, b) => a.idx - b.idx);
    return {
      sc,
      ss,
      h: FG.SG_HEAD + ss.length * (FG.SHH + FG.SH_GAP) + FG.SG_PAD + 10,
    };
  });

  // 行布局:行高 = 该行最高组,y 逐行累计
  let cursorY = FG.SG_Y;
  let maxRight = 0;
  for (let i = 0; i < groups.length; i += FG.SC_COLS) {
    const rowG = groups.slice(i, i + FG.SC_COLS);
    let rowH = 0;
    rowG.forEach((g, c) => {
      g.x = FG.SG_X + c * (FG.SGW + FG.SG_GAPX);
      g.y = cursorY;
      rowH = Math.max(rowH, g.h);
      maxRight = Math.max(maxRight, g.x + FG.SGW);
    });
    cursorY += rowH + FG.SG_GAPY;
  }

  groups.forEach((g) => {
    const anyRun = g.ss.some((s) =>
      [s.panelStatus, s.clipStatus, s.voiceStatus].includes("pending"),
    );
    const anyErr = g.ss.some((s) =>
      [s.panelStatus, s.clipStatus, s.voiceStatus].includes("error"),
    );
    const st = anyRun
      ? "run"
      : anyErr
        ? "error"
        : g.ss.length > 0 && g.ss.every((s) => s.panelStatus === "done")
          ? "done"
          : "pending";
    nodes.push({
      id: "scene:" + g.sc.id,
      kind: "scene",
      icon: g.sc.locked ? "🔒" : "🎞",
      title: g.sc.title,
      status: st,
      locked: !!g.sc.locked,
      sceneId: g.sc.id,
      desc: g.sc.description || "",
      stats: g.sc.stats || {
        shots: g.ss.length,
        panels: 0,
        clips: 0,
        voices: 0,
      },
      x: g.x,
      y: g.y,
      w: FG.SGW,
      h: g.h,
      ports: { in: [0, FG.SG_HEAD / 2], out: [FG.SGW, FG.SG_HEAD / 2] },
    });
    g.ss.forEach((s, i) => {
      nodes.push({
        id: "shot:" + g.sc.id + ":" + s.idx,
        kind: "shot",
        idx: s.idx,
        sceneId: g.sc.id,
        title: "第 " + s.idx + " 镜",
        line: (s.dialogue || s.visual || "").slice(0, 60),
        thumbUrl: s.panelUrl || "",
        pips: {
          txt: "done",
          img: fgStage(s.panelStatus),
          vid: fgStage(s.clipStatus),
          aud: fgStage(s.voiceStatus),
        },
        x: g.x + FG.SG_PAD,
        y: g.y + FG.SG_HEAD + i * (FG.SHH + FG.SH_GAP),
        w: FG.SHW,
        h: FG.SHH,
        ports: { in: [0, FG.SHH / 2], out: [FG.SHW, FG.SHH / 2] },
      });
    });
  });

  // 合成节点(最宽组右侧)
  const filmX = maxRight + FG.FILM_GAP;
  nodes.push({
    id: "film",
    kind: "film",
    icon: "🎞",
    title: "合成成片",
    status: p.filmUrl ? "done" : running === "film" ? "run" : "pending",
    sub: p.filmUrl ? "成片就绪" : "汇总全部镜头",
    x: filmX,
    y: FG.SG_Y,
    w: FG.FILM_W,
    h: FG.NODE_H,
    ports: { in: [0, FG.NODE_H / 2], out: [FG.FILM_W, FG.NODE_H / 2] },
  });

  nodes
    .filter((n) => n.kind === "shot")
    .forEach((n) => {
      edges.push({
        id: "e_" + n.id.replace(/:/g, "_"),
        from: n.id,
        to: "film",
      });
    });

  return {
    view: "shots",
    nodes,
    edges,
    bounds: { w: filmX + FG.FILM_W + 60, h: cursorY + 60 },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: PASS——Task 2 的 5 个 + Task 3 的 4 个测试全绿

> 纯函数层完成。先 `node --test tests/` 全绿,再提交。

- [ ] **Step 5: 提交**

```bash
cd /home/tutuos/CodeLab/manju
git add public/flow-graph.js tests/flow-graph.test.js
git commit -m "feat(flow): shots-layer graph derivation (scene groups + shot cards)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 4: 视口数学 zoomAt(TDD)+ flow.css 完整样式

**Files:**

- Modify: `public/flow-graph.js`(末尾追加 zoomAt 并修正导出)
- Create: `public/flow.css`
- Test: `tests/flow-graph.test.js`(末尾追加)

**Interfaces:**

- Consumes: Task 2/3 的 flow-graph.js
- Produces: `zoomAt(vp, deltaY, cx, cy) => { x, y, scale }`(缩放锚定光标,0.3~2.5 钳制),flow.js 视口事件直接使用;`flow.css` 覆盖 Task 5 引擎与 Task 6 壳所需全部类名(`.fw-node/.fw-shot/.fw-group/.fw-edge/#fw-drawer/#fw-overlay/#fw-logs/.fw-toolbar` 等)

- [ ] **Step 1: 追加 zoomAt 失败测试**

在 `tests/flow-graph.test.js` 末尾追加:

```js
const { zoomAt } = require("../public/flow-graph.js");

test("zoomAt: 缩放锚定光标,钳制 0.3~2.5", () => {
  const vp = { x: 100, y: 50, scale: 1 };
  const wx = (400 - vp.x) / vp.scale; // 光标下的世界坐标
  const vp2 = zoomAt(vp, -240, 400, 300);
  assert.ok(Math.abs((400 - vp2.x) / vp2.scale - wx) < 1e-9);
  assert.ok(vp2.scale > 1 && vp2.scale <= 2.5);
  const vp3 = zoomAt({ x: 0, y: 0, scale: 2.5 }, -99999, 400, 300);
  assert.equal(vp3.scale, 2.5);
  const vp4 = zoomAt({ x: 0, y: 0, scale: 0.3 }, 99999, 400, 300);
  assert.equal(vp4.scale, 0.3);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/`
Expected: FAIL——`zoomAt` 是 null 导出,调用报 TypeError

- [ ] **Step 3: 实现 zoomAt**

在 `public/flow-graph.js` 的 `buildGraph` 之后追加:

```js
function zoomAt(vp, deltaY, cx, cy) {
  const scale = fgClamp(vp.scale * Math.exp(-deltaY * 0.0016), 0.3, 2.5);
  // 平移量使光标下的世界点保持不动:(cx-x)/scale 不变
  const k = scale / vp.scale;
  return { x: cx - (cx - vp.x) * k, y: cy - (cy - vp.y) * k, scale };
}
```

- [ ] **Step 4: 修正导出与浏览器全局**

把 `public/flow-graph.js` 末尾的导出守卫替换为(`zoomAt: null` 占位换成真函数):

```js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildGraph, zoomAt, FG, fgStage };
}
```

> 浏览器端无需额外导出:flow-graph.js 是经典 `<script>`,顶层 `function`/`const` 即全局绑定,`flow.js` 与 `app.js` 可直接引用 `buildGraph`/`zoomAt`/`FG`。守卫只在 node --test 下命中。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/`
Expected: PASS,共 6 个测试全绿(含 zoomAt 锚定与钳制断言)

- [ ] **Step 6: 创建 public/flow.css(画布全量样式)**

新建 `public/flow.css`,一次写入以下完整内容(全部复用 style.css `:root` 里已有的 CSS 变量,不新增颜色字面量;类名与 Task 5/6 的 DOM 一一对应):

```css
/* ===== 流程画布(flow.css)· 复用 style.css 主题变量 ===== */
body.flow-mode {
  overflow: hidden;
}
body.flow-mode #topbar {
  display: none;
}

.flow-shell {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--bg);
}
#flow-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background-image: radial-gradient(
    circle,
    rgba(233, 231, 225, 0.1) 1px,
    transparent 1.4px
  );
  background-size: 28px 28px;
}
#flow-root.panning {
  cursor: grabbing;
}

.fw-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.fw-wires {
  position: absolute;
  left: -5000px;
  top: -5000px;
  width: 10000px;
  height: 10000px;
  overflow: visible;
  pointer-events: none;
}
.fw-wires path {
  fill: none;
  stroke: var(--line);
  stroke-width: 2;
  transition: stroke 0.2s;
}
.fw-wires path.run {
  stroke: var(--accent);
  stroke-dasharray: 7 6;
  animation: fwDash 1s linear infinite;
}
.fw-wires path.err {
  stroke: var(--err);
}

.fw-node {
  position: absolute;
  background: var(--card);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
  user-select: none;
  animation: fwSlideIn 0.18s ease;
}
.fw-node.sel {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(255, 92, 57, 0.18);
}
.fw-node .fw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
}
.fw-node .fw-ico {
  flex: none;
  font-size: 16px;
}
.fw-node .fw-tt {
  min-width: 0;
}
.fw-node .fw-title {
  font-weight: 700;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fw-node .fw-sub {
  font-size: 11.5px;
  color: var(--dim);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fw-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--line);
  flex: none;
  margin-left: auto;
}

.fw-node.st-pending .fw-dot {
  background: var(--line);
}
.fw-node.st-run .fw-dot {
  background: #4a9eff;
  animation: fwPulse 1.2s ease-in-out infinite;
}
.fw-node.st-run {
  border-color: rgba(74, 158, 255, 0.55);
}
.fw-node.st-done .fw-dot {
  background: var(--ok);
}
.fw-node.st-done {
  border-color: rgba(62, 207, 142, 0.45);
}
.fw-node.st-error .fw-dot {
  background: var(--err);
}
.fw-node.st-error {
  border-color: rgba(255, 84, 112, 0.55);
}
.fw-node.st-skip .fw-dot {
  background: var(--warn);
}

/* 节点宽度一律由内联 style(图的 n.w)决定,CSS 不定宽 */

/* 镜头卡 */
.fw-node.fw-shot {
  overflow: hidden;
}
.fw-shot-thumb {
  width: 100%;
  height: 108px;
  object-fit: cover;
  display: block;
  background: var(--bg2);
}
.fw-ph {
  height: 108px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dim);
  font-size: 11px;
  background: var(--bg2);
}
.fw-shot .fw-line {
  padding: 7px 10px 0;
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 42px;
}
.fw-pips {
  display: flex;
  gap: 4px;
  padding: 8px 10px 10px;
}
.fw-pip {
  position: relative;
  flex: 1;
  text-align: center;
  font-size: 10.5px;
  padding: 3px 0;
  border-radius: 7px;
  background: var(--bg2);
  color: var(--dim);
  border: 1px solid var(--line);
}
.fw-pip.done {
  color: var(--ok);
  border-color: rgba(62, 207, 142, 0.4);
}
.fw-pip.run {
  color: #4a9eff;
  border-color: rgba(74, 158, 255, 0.4);
}
.fw-pip.error {
  color: var(--err);
  border-color: rgba(255, 84, 112, 0.4);
}
.fw-pip.skip {
  color: var(--warn);
  border-color: rgba(255, 176, 46, 0.4);
}
.fw-pip .fw-reroll {
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%);
  display: none;
  white-space: nowrap;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--card2);
  border: 1px solid var(--line);
  color: var(--text);
  cursor: pointer;
  z-index: 3;
}
.fw-pip:hover .fw-reroll {
  display: block;
}
.fw-pip .fw-reroll:hover {
  border-color: var(--accent);
}

/* 场景分组节点 */
.fw-node.fw-group {
  cursor: default;
}
.fw-group > .fw-head {
  border-bottom: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  cursor: grab;
}
.fw-group .fw-body {
  padding: 10px 14px 14px;
}
.fw-group .fw-desc {
  font-size: 11.5px;
  color: var(--dim);
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fw-group .fw-stats {
  font-size: 11px;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.fw-shot-h { padding: 7px 10px 0; font-size: 11px; color: var(--dim); }

/* 悬浮工具条 */
.fw-toolbar {
  position: fixed;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 16px;
  background: rgba(23, 27, 41, 0.82);
  backdrop-filter: blur(14px);
  border: 1px solid var(--line);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
.fw-toolbar .fw-spacer {
  flex: 1;
}
.fw-chip {
  font-size: 12px;
  color: var(--dim);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.fw-chip b {
  color: var(--text);
}
.fw-btn {
  border: 1px solid var(--line);
  background: var(--card2);
  color: var(--text);
  border-radius: 9px;
  padding: 5px 10px;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}
.fw-btn:hover {
  border-color: var(--accent);
}
.fw-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.fw-btn.fw-mini {
  padding: 2px 7px;
  font-size: 11px;
  border-radius: 7px;
}
.fw-conn {
  color: var(--warn);
}

/* 右侧详情面板 */
#fw-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 430px;
  max-width: 92vw;
  z-index: 55;
  background: var(--bg2);
  border-left: 1px solid var(--line);
  box-shadow: -18px 0 44px rgba(0, 0, 0, 0.4);
  transform: translateX(102%);
  transition: transform 0.22s ease;
  display: flex;
  flex-direction: column;
}
#fw-drawer.open {
  transform: none;
}
#fw-drawer .fw-drawer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  flex: none;
}
#fw-drawer .fw-drawer-title {
  font-weight: 700;
  font-size: 14px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#fw-drawer .fw-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}

/* 全屏浮层(脉络工作室) */
#fw-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--bg);
  overflow-y: auto;
  display: none;
}
#fw-overlay.open {
  display: block;
}
#fw-overlay .fw-overlay-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: rgba(14, 16, 22, 0.9);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
#fw-overlay .fw-overlay-title {
  font-weight: 700;
  font-size: 15px;
  flex: 1;
}
#fw-overlay .fw-overlay-body {
  max-width: 1080px;
  margin: 0 auto;
  padding: 18px 16px 60px;
}

/* 底部日志抽屉 */
#fw-logs {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 40vh;
  min-height: 240px;
  z-index: 56;
  background: var(--bg2);
  border-top: 1px solid var(--line);
  transform: translateY(102%);
  transition: transform 0.22s ease;
  display: flex;
  flex-direction: column;
}
#fw-logs.open {
  transform: none;
}
#fw-logs .fw-logs-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  flex: none;
}
#fw-logs .fw-logs-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--dim);
}

@keyframes fwPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
@keyframes fwDash {
  to {
    stroke-dashoffset: -26;
  }
}
@keyframes fwSlideIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

> 面板/浮层/日志抽屉内部的表单与卡片样式,全部复用 style.css 既有类(`.card/.btn/.field/.hint/.cost-table/.draft-row` 等),flow.css 只负责壳与画布。

- [ ] **Step 7: 语法与测试门禁**

Run: `node --check public/flow-graph.js && node --test tests/`
Expected: 语法 OK + 全部 PASS

- [ ] **Step 8: Commit**

```bash
cd /home/tutuos/CodeLab/manju
git add public/flow-graph.js public/flow.css tests/flow-graph.test.js
git commit -m "feat(flow): viewport zoom math + canvas stylesheet

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: flow.js 画布引擎 + FlowUI 宿主

**Files:**

- Create: `public/flow.js`

**Interfaces:**

- Consumes: Task 2/3 的全局绑定 `buildGraph` 输出(`{view,nodes,edges,bounds}`,节点含 `id/kind/icon/title/status/sub/x/y/w/h/ports/line/thumbUrl/pips/locked/sceneId/idx/desc/stats`)、`zoomAt(vp,deltaY,cx,cy)`;app.js 的全局 `toast`(运行时才调用,加载顺序无碍)
- Produces: 全局绑定 `Flow` 与 `FlowUI`(经典脚本顶层 `const`,并显式 `window.Flow/window.FlowUI` 供控制台调试):
  - `Flow.mount(rootEl, { onSelect(nodeId|null), onOpen(nodeId) })`
  - `Flow.setProject(pid)` — 切换 localStorage 位置记忆(`manju.flow.<pid>.pos`)
  - `Flow.setGraph(graph)` / `Flow.patch(graph)` — 全量渲染 / 同 id 集合就地补丁(id 集合或 view 变化时自动退化为全量)
  - `Flow.fit()` — 内容适配视口;`Flow.select(nodeId|null)`;`Flow.resetLayout()`
  - `FlowUI.openPanel(node, html)` / `closePanel()`;`openOverlay(title, html)` / `closeOverlay()`;`openLogs(html)` / `closeLogs()`;`closeTop()`;`toggleFullscreen()`

拖拽从节点任意位置发起(`button/input` 除外)——比 spec「拖节点头」更宽:总览节点从头拖同样成立,镜头卡没有头只能整卡拖,4px 阈值保证点击不受影响。

本任务是纯 DOM 交互层,不写 node 单测(需要真实 DOM);门禁是 `node --check` + Task 10 手动 QA。引擎不碰数据:`app.js` 负责调 `buildGraph` 并把结果交给 `Flow`;节点内 `data-act` 按钮点击后仍走 app.js 的 document 级委托,**零事件重接线**。

- [ ] **Step 1: 写 flow.js 全量实现**

新建 `public/flow.js`:

```js
"use strict";
/* flow.js — 画布引擎与宿主(零依赖):
   视口(平移/缩放/节点拖拽)+ SVG bezier 连线 + 节点渲染与 SSE 局部补丁
   + 详情面板 / 全屏浮层 / 日志抽屉 / 真全屏切换。
   依赖 flow-graph.js 的全局绑定(buildGraph/zoomAt/FG);toast 在点击时才调用。 */

const Flow = (() => {
  let root = null, world = null, nodesLayer = null, wires = null;
  let vp = { x: 60, y: 90, scale: 1 };
  let graph = null;
  let nodeEls = new Map();
  let posMem = {}, posKey = "";
  let drag = null, press = null, suppressClick = false;
  let selId = null;
  let onSel = null, onOpen = null;
  let edgeRaf = 0;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fe = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* localStorage 全 try/catch:隐私模式下静默降级为不记忆 */
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  function mount(rootEl, handlers) {
    root = rootEl;
    root.innerHTML = '<div class="fw-world"><svg class="fw-wires"></svg><div class="fw-nodes"></div></div>';
    world = root.querySelector(".fw-world");
    wires = root.querySelector(".fw-wires");
    nodesLayer = root.querySelector(".fw-nodes");
    if (handlers) { onSel = handlers.onSelect || null; onOpen = handlers.onOpenNode || null; }
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("dblclick", dbl);
    /* 节点拖拽结束后吞掉紧跟的 click,防止误触节点内按钮 */
    root.addEventListener("click", (e) => {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
    }, true);
    applyVp();
  }

  function setProject(pid) {
    posKey = "manju.flow." + pid + ".pos";
    posMem = ls.get(posKey);
  }

  /* —— 图进入引擎:覆盖位置记忆(记下自动布局原点 _ox/_oy 供重置) —— */
  function setGraph(g) {
    graph = g;
    for (const n of g.nodes) {
      n._ox = n.x; n._oy = n.y;
      const p = posMem[n.id];
      if (p) { n.x = p.x; n.y = p.y; }
    }
    renderAll();
  }

  /* —— SSE 高频路径:节点 id 集合与 view 不变 → 就地补丁(不重建 DOM,动画不重启) —— */
  function patch(g) {
    const same = graph && g.view === graph.view &&
      g.nodes.length === graph.nodes.length &&
      g.nodes.every((n, i) => n.id === graph.nodes[i].id);
    if (!same) return setGraph(g);
    const oldById = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const n of g.nodes) {
      const o = oldById.get(n.id);
      if (o) { n.x = o.x; n.y = o.y; n._ox = o._ox; n._oy = o._oy; }
      patchNode(n);
    }
    graph = g;
    /* 几何未变,只同步边状态类(innerHTML 重建会重启虚线动画) */
    const st = new Map(graph.nodes.map((m) => [m.id, m.status]));
    wires.querySelectorAll("path").forEach((p) => {
      const e = graph.edges.find((x) => x.id === p.dataset.edge);
      if (!e) return;
      const cls = edgeClass(st.get(e.from), st.get(e.to));
      if (p.getAttribute("class") !== cls) p.setAttribute("class", cls);
    });
  }

  function kindClass(n) {
    if (n.kind === "shot") return "fw-shot";
    if (n.kind === "scene") return "fw-group";
    return "";
  }

  function renderAll() {
    if (!nodesLayer) return;
    nodesLayer.innerHTML = "";
    nodeEls.clear();
    for (const n of graph.nodes) {
      const el = document.createElement("div");
      el.className = "fw-node " + kindClass(n) + " st-" + n.status;
      el.dataset.nodeId = n.id;
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      if (n.w) el.style.width = n.w + "px";
      el.innerHTML = nodeHtml(n);
      nodesLayer.appendChild(el);
      nodeEls.set(n.id, el);
    }
    renderEdges();
    applySelection();
  }

  /* —— 节点卡 HTML(只读:不放可编辑控件;按钮沿用 data-act 全局委托) —— */
  function nodeHtml(n) {
    if (n.kind === "shot") {
      const pips = [["txt", "文", ""], ["img", "图", "panels"], ["vid", "片", "clips"], ["aud", "音", "voice"]]
        .map(([k, lab, stage]) =>
          `<span class="fw-pip ${n.pips[k] || ""}">${lab}` +
          (stage ? `<button class="fw-reroll" data-act="gen" data-stage="${stage}" data-shot-idx="${n.idx}" title="重新生成">↻</button>` : "") +
          `</span>`).join("");
      return `<img class="fw-shot-thumb" alt="" ${n.thumbUrl ? `src="${fe(n.thumbUrl)}"` : "hidden"}>
        <div class="fw-ph" ${n.thumbUrl ? "hidden" : ""}>暂无图</div>` +
        `<div class="fw-shot-h">第 ${n.idx} 镜</div>` +
        `<div class="fw-line">${fe(n.line)}</div>` +
        `<div class="fw-pips">${pips}</div>`;
    }
    if (n.kind === "scene") {
      const st = n.stats || {};
      return `<div class="fw-head"><span class="fw-ico">${n.icon}</span>
        <span class="fw-tt"><span class="fw-title">${fe(n.title)}</span>
        <span class="fw-sub">镜头 ${st.shots || 0}</span></span>
        <button class="fw-btn fw-mini fw-lock" data-act="toggle-lock" data-scene-id="${fe(n.sceneId)}">${n.locked ? "解锁" : "锁定"}</button>
        <span class="fw-dot"></span></div>
        <div class="fw-body">${n.desc ? `<div class="fw-desc">${fe(n.desc)}</div>` : ""}
        <div class="fw-stats">图 ${st.panels || 0}/${st.shots || 0} · 片 ${st.clips || 0}/${st.shots || 0} · 音 ${st.voices || 0}/${st.shots || 0}</div>
        ${st.shots ? "" : `<button class="fw-btn fw-mini fw-genscene" data-act="gen" data-stage="sceneShots" data-scene-id="${fe(n.sceneId)}" style="margin-top:8px">🪄 生成本场景分镜</button>`}</div>`;
    }
    /* 总览 8 节点 + 镜头层 film 节点共用模板 */
    return `<div class="fw-head"><span class="fw-ico">${n.icon}</span>
      <span class="fw-tt"><span class="fw-title">${fe(n.title)}</span>
      ${n.sub ? `<span class="fw-sub">${fe(n.sub)}</span>` : ""}</span>
      <span class="fw-dot"></span></div>`;
  }

  /* —— 就地补丁:只改类名与 textContent,不重建节点 DOM(动画不重启、输入不丢) —— */
  function setTxt(el, sel, v) {
    if (v === undefined) return;
    const t = el.querySelector(sel);
    if (t && t.textContent !== String(v)) t.textContent = v;
  }

  function patchNode(n) {
    const el = nodeEls.get(n.id);
    if (!el) return;
    const st = "st-" + n.status;
    if (!el.classList.contains(st)) el.className = el.className.replace(/st-\w+\b/, st);
    setTxt(el, ".fw-title", n.title);
    setTxt(el, ".fw-sub", n.sub);
    setTxt(el, ".fw-ico", n.icon);
    if (n.kind === "shot") {
      setTxt(el, ".fw-line", n.line);
      const img = el.querySelector(".fw-shot-thumb"), ph = el.querySelector(".fw-ph");
      if (img) {
        if (n.thumbUrl && img.getAttribute("src") !== n.thumbUrl) img.src = n.thumbUrl;
        img.hidden = !n.thumbUrl;
        if (ph) ph.hidden = !!n.thumbUrl;
      }
      if (n.pips) ["txt", "img", "vid", "aud"].forEach((k, i) => {
        const pip = el.querySelectorAll(".fw-pip")[i];
        if (pip) pip.className = "fw-pip " + (n.pips[k] || "");
      });
    }
    if (n.kind === "scene") {
      const s = n.stats || {};
      setTxt(el, ".fw-sub", "镜头 " + (s.shots || 0));
      setTxt(el, ".fw-stats", `图 ${s.panels || 0}/${s.shots || 0} · 片 ${s.clips || 0}/${s.shots || 0} · 音 ${s.voices || 0}/${s.shots || 0}`);
      const gen = el.querySelector(".fw-genscene");
      if (gen) gen.hidden = !!s.shots;
      const lk = el.querySelector(".fw-lock");
      if (lk) lk.textContent = n.locked ? "解锁" : "锁定";
    }
  }

  /* —— 连线:cubic bezier,端点取图坐标 ports(不依赖 CSS 实测尺寸) —— */
  function edgeClass(stA, stB) {
    if (stA === "error" || stB === "error") return "err";
    if (stA === "run" || stB === "run") return "run";
    return "";
  }

  function renderEdges() {
    if (!wires) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    let html = "";
    for (const e of graph.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      const x1 = a.x + a.ports.out[0], y1 = a.y + a.ports.out[1];
      const x2 = b.x + b.ports.in[0], y2 = b.y + b.ports.in[1];
      const mx = (x1 + x2) / 2;
      html += `<path class="${edgeClass(a.status, b.status)}" data-edge="${fe(e.id)}" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
    }
    wires.innerHTML = html;
  }

  function applySelection() {
    for (const [id, el] of nodeEls) el.classList.toggle("sel", id === selId);
  }

  function select(id) { selId = id || null; applySelection(); }

  /* —— 视口 —— */
  function applyVp() {
    if (!world || !root) return;
    world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`;
    root.style.backgroundPosition = `${vp.x}px ${vp.y}px`;
    root.style.backgroundSize = `${28 * vp.scale}px ${28 * vp.scale}px`;
  }

  function fit() {
    if (!root) return;
    if (!graph || !graph.nodes.length) { vp = { x: 60, y: 90, scale: 1 }; return applyVp(); }
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 200)); maxY = Math.max(maxY, n.y + (n.h || 92));
    }
    const pad = 48, W = root.clientWidth, H = root.clientHeight;
    const s = clamp(Math.min(W / (maxX - minX + pad * 2), H / (maxY - minY + pad * 2)), 0.3, 1.25);
    vp = { scale: s, x: (W - (maxX - minX) * s) / 2 - minX * s, y: (H - (maxY - minY) * s) / 2 - minY * s };
    applyVp();
  }

  /* —— 指针交互:4px 阈值区分点击/拖拽;按钮不参与拖拽 —— */
  function down(e) {
    if (e.button !== 0) return;
    if (e.target.closest("button, a, input, textarea")) { press = null; return; }
    press = { x: e.clientX, y: e.clientY, node: e.target.closest(".fw-node") };
    drag = null;
  }

  function move(e) {
    if (!press) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (!drag) {
      if (Math.hypot(dx, dy) < 4) return;
      try { root.setPointerCapture(e.pointerId); } catch {}
      if (press.node) {
        const n = graph.nodes.find((m) => m.id === press.node.dataset.nodeId);
        if (!n) return;
        drag = { mode: "node", id: n.id, ox: n.x, oy: n.y };
      } else {
        drag = { mode: "pan", ox: vp.x, oy: vp.y };
        root.classList.add("panning");
      }
    }
    if (drag.mode === "pan") {
      vp.x = drag.ox + dx; vp.y = drag.oy + dy; applyVp();
    } else {
      const n = graph.nodes.find((m) => m.id === drag.id);
      if (!n) return;
      n.x = drag.ox + dx / vp.scale; n.y = drag.oy + dy / vp.scale;
      const el = nodeEls.get(drag.id);
      if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
      posMem[n.id] = { x: n.x, y: n.y };
      scheduleEdges();
    }
  }

  function up(e) {
    root.classList.remove("panning");
    if (press && !drag) {
      const id = press.node ? press.node.dataset.nodeId : null;
      selId = id; applySelection();
      if (onSel) onSel(id);
    } else if (press && drag && drag.mode === "node") {
      suppressClick = true;
      ls.set(posKey, posMem); /* 拖完才写 localStorage */
    }
    press = null; drag = null;
  }

  function dbl(e) {
    const el = e.target.closest(".fw-node");
    if (el && onOpen) onOpen(el.dataset.nodeId);
  }

  function wheel(e) {
    e.preventDefault();
    if (!root) return;
    const r = root.getBoundingClientRect();
    vp = zoomAt(vp, e.deltaY, e.clientX - r.left, e.clientY - r.top);
    applyVp();
  }

  function scheduleEdges() {
    if (edgeRaf) return;
    edgeRaf = requestAnimationFrame(() => { edgeRaf = 0; renderEdges(); });
  }

  function resetLayout() {
    ls.del(posKey); posMem = {};
    if (graph) for (const n of graph.nodes) {
      if (n._ox !== undefined) { n.x = n._ox; n.y = n._oy; }
    }
    renderAll(); fit();
  }

  return { mount, setProject, setGraph, patch, fit, select, resetLayout };
})();

const FlowUI = {
  openPanel(node, html) {
    const d = document.getElementById("fw-drawer");
    if (!d) return;
    d.querySelector(".fw-drawer-title").textContent = node ? (node.icon ? node.icon + " " : "") + node.title : "";
    d.querySelector(".fw-drawer-body").innerHTML = html;
    d.classList.add("open");
  },
  closePanel() { const d = document.getElementById("fw-drawer"); if (d) d.classList.remove("open"); },
  openOverlay(title, html) {
    const o = document.getElementById("fw-overlay");
    if (!o) return;
    o.querySelector(".fw-overlay-title").textContent = title;
    o.querySelector(".fw-overlay-body").innerHTML = html;
    o.classList.add("open");
  },
  closeOverlay() { const o = document.getElementById("fw-overlay"); if (o) o.classList.remove("open"); },
  openLogs(html) {
    const l = document.getElementById("fw-logs");
    if (!l) return;
    const b = l.querySelector(".fw-logs-body");
    b.innerHTML = html;
    l.classList.add("open");
    b.scrollTop = b.scrollHeight;
  },
  closeLogs() { const l = document.getElementById("fw-logs"); if (l) l.classList.remove("open"); },
  closeTop() {
    const ov = document.getElementById("fw-overlay"), d = document.getElementById("fw-drawer"), l = document.getElementById("fw-logs");
    if (ov && ov.classList.contains("open")) { FlowUI.closeOverlay(); return true; }
    if (d && d.classList.contains("open")) { FlowUI.closePanel(); return true; }
    if (l && l.classList.contains("open")) { FlowUI.closeLogs(); return true; }
    return false;
  },
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { toast("浏览器拒绝了全屏请求", "err"); }
  },
};

window.Flow = Flow;
window.FlowUI = FlowUI;
```

- [ ] **Step 2: 语法门禁**

Run: `node --check public/flow.js`
Expected: 无输出(语法 OK)

- [ ] **Step 3: Commit**

```bash
cd /home/tutuos/CodeLab/manju
git add public/flow.js
git commit -m "feat(flow): canvas engine (viewport/edges/patch) + panel host

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: app.js 壳层与路由(flow shell)+ index.html 接线

**Files:**

- Modify: `public/app.js`(路由/壳/工具条/键盘/命令面板)
- Modify: `public/index.html`(样式与脚本引入、静态宿主)

**Interfaces:**

- Consumes: Task 5 `Flow`/`FlowUI`;Task 2 `buildGraph`;app.js 既有全局 `S/api/navigate/render/toast/$/esc/throttledRefresh/doHistory/nextStepOf` 与各 `render*()` 渲染函数(返回 HTML 字符串)
- Produces: `FLOW_TAB_MAP`(旧 tab URL → flow query 映射)、`applyFlowQuery(u)`、`flowUrl(over)`/`flowNav(over)`、重写后的 `handleRoute/openProject/renderProject`、`mountFlow()/rebuildGraph(fit)/syncHosts()/logsHtml()/toolbarHtml(p)/updateToolbar()/flowPanelFor(node)/onNodeSelect(id)/onNodeOpen(id)`、新 `data-act`:`flow-logs/flow-close-panel/flow-close-overlay/flow-close-logs/flow-fullscreen/flow-reset-layout`

SSE 每次消息触发 `refreshProject() → render()` 全量重建画布是本任务的**已知中间态**(视口会复位),Task 8 改为就地补丁解决;本任务的门禁只验证静态浏览与路由。

- [ ] **Step 1: index.html 接线**

`<link rel="stylesheet" href="/style.css">` 之后加一行:

```html
<link rel="stylesheet" href="/flow.css">
```

`<div id="toasts"></div>` 之后、`<script src="/app.js">` 之前插入静态宿主(固定定位,不随 render() 重建,面板打开状态跨刷新保持):

```html
<div id="fw-drawer">
  <div class="fw-drawer-head"><div class="fw-drawer-title"></div>
    <button class="fw-btn" data-act="flow-close-panel">✕</button></div>
  <div class="fw-drawer-body"></div>
</div>
<div id="fw-overlay">
  <div class="fw-overlay-head"><div class="fw-overlay-title"></div>
    <button class="fw-btn" data-act="flow-close-overlay">✕ 关闭</button></div>
  <div class="fw-overlay-body"></div>
</div>
<div id="fw-logs">
  <div class="fw-logs-head"><b>📜 执行日志</b><span class="fw-spacer"></span>
    <button class="fw-btn" data-act="flow-close-logs">✕ 收起</button></div>
  <div class="fw-logs-body"></div>
</div>
<script src="/flow-graph.js"></script>
<script src="/flow.js"></script>
```

(`<script src="/app.js"></script>` 保持在最后——加载顺序 flow-graph.js → flow.js → app.js。)

- [ ] **Step 2: 路由重写(URL 即状态 + 旧 tab 重定向)**

删除 `const TABS = [...]` 与 `function projectPath(tab) {...}`(app.js 第 12-17 行),在原位替换为:

```js
/* 旧 tab URL → flow query(书签不失效) */
const FLOW_TAB_MAP = { story: 'overlay=story', shots: 'view=shots', chars: 'sel=chars', script: 'sel=idea', film: 'sel=film', logs: 'drawer=logs' };

function applyFlowQuery(u) {
  const q = u.searchParams;
  S.flow = {
    view: q.get('view') === 'shots' ? 'shots' : 'overview',
    sel: q.get('sel') || '',
    scene: q.get('scene') || '',
    overlay: q.get('overlay') === 'story' ? 'story' : '',
    drawer: q.get('drawer') === 'logs' ? 'logs' : '',
  };
  if (S.flow.scene) S.sceneId = S.flow.scene; /* 兼容仍读 S.sceneId 的生成兜底 */
}

function flowUrl(over = {}) {
  const f = { view: 'overview', sel: '', scene: '', overlay: '', drawer: '', ...(S.flow || {}), ...over };
  const q = new URLSearchParams();
  if (f.view === 'shots') q.set('view', 'shots');
  if (f.sel) q.set('sel', f.sel);
  if (f.scene && f.view === 'shots') q.set('scene', f.scene);
  if (f.overlay) q.set('overlay', f.overlay);
  if (f.drawer) q.set('drawer', f.drawer);
  const qs = q.toString();
  return '/project/' + S.project.id + (qs ? '?' + qs : '');
}
function flowNav(over = {}) { navigate(flowUrl(over)); }
```

再整段替换 `handleRoute`(`navigate` 函数原样保留):

```js
async function handleRoute() {
  closeModal(); closePalette();
  const u = new URL(location.href);
  const seg = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (seg[0] !== 'project' || !seg[1]) {
    S.view = 'home'; S.project = null;
    return render();
  }
  const pid = seg[1];
  /* 旧 tab 路径一次性重定向到等价 flow 视图 */
  if (seg[2] && FLOW_TAB_MAP[seg[2]]) {
    history.replaceState({}, '', '/project/' + pid + '?' + FLOW_TAB_MAP[seg[2]]);
    return handleRoute();
  }
  if (seg[2]) history.replaceState({}, '', '/project/' + pid); /* 未知路径回落总览 */
  applyFlowQuery(u);
  if (S.project && S.project.id === pid) { S.view = 'project'; render(); return; }
  try {
    await openProject(pid);
  } catch (e) {
    toast('项目不存在或已删除,回到首页', 'err');
    history.replaceState({}, '', '/');
    S.view = 'home'; S.project = null; render();
  }
}
```

- [ ] **Step 3: openProject 重写**

整段替换(去掉 forceTab/S.tab 逻辑;S.flow 已由 applyFlowQuery 从 URL 恢复):

```js
async function openProject(pid) {
  S.project = await api('/api/projects/' + pid);
  S.view = 'project';
  watch(pid);
  render();
}
```

- [ ] **Step 4: renderProject 重写为画布壳**

整段替换 `renderProject`(原第 369-413 行,流程条/tabs/横幅全部移除),并**删除** `renderTab` 整个函数(原第 415-429 行;日志分支由 `logsHtml` 承接):

```js
const FLOW_STAGE_LABELS = { storyboard: '分镜脚本', sceneShots: '场景分镜', characters: '角色图',
  panels: '分镜图', clips: '视频', voice: '配音', film: '合成', cover: '封面' };

function renderProject() {
  const p = S.project;
  S._ns = nextStepOf(p);
  app().innerHTML = `
  <div class="flow-shell">
    <div class="fw-toolbar" id="fw-toolbar">${toolbarHtml(p)}</div>
    <div id="flow-root"></div>
  </div>`;
  mountFlow();
  syncHosts();
}

function toolbarHtml(p) {
  const canUndo = p.history && p.history.undo, canRedo = p.history && p.history.redo;
  return `
    <button class="fw-btn" data-act="home" title="返回首页">☰</button>
    <b class="fw-chip" data-act="rename-project" style="cursor:pointer" title="点击重命名">${esc(p.title)}</b>
    ${p.running ? `<span class="fw-chip">⏳ ${esc(FLOW_STAGE_LABELS[p.running] || p.running)} 运行中</span>
      <button class="fw-btn" data-act="stop">⏹ 停止</button>`
      : (p.lastError ? '<span class="fw-chip" style="color:var(--err)">⚠ 出错,见日志</span>' : '')}
    ${S._ns ? `<span class="fw-chip">下一步:${esc(S._ns.text)}</span>
      <button class="fw-btn primary" data-act="ns-go">${esc(S._ns.btn)}</button>` : ''}
    <span class="fw-spacer"></span>
    <span class="fw-chip" title="按约值单价估算">¥<b>${Number(p.cost || 0).toFixed(2)}</b></span>
    <button class="fw-btn" data-act="undo" ${canUndo ? '' : 'disabled'} title="撤销:${esc((p.history && p.history.last) || '无')}">↶</button>
    <button class="fw-btn" data-act="redo" ${canRedo ? '' : 'disabled'} title="重做">↷</button>
    <span class="fw-chip fw-conn" id="fw-conn" hidden>重连中…</span>
    <button class="fw-btn" data-act="flow-logs" title="执行日志">📜</button>
    <button class="fw-btn" data-act="open-settings" title="设置">⚙</button>
    <button class="fw-btn" data-act="flow-reset-layout" title="重置画布布局">🧹</button>
    <button class="fw-btn" data-act="flow-fullscreen" title="浏览器全屏">⛶</button>`;
}
function updateToolbar() { const el = $('#fw-toolbar'); if (el) el.innerHTML = toolbarHtml(S.project); }

function logsHtml() {
  const logs = ((S.project && S.project.log) || []).slice().reverse();
  return logs.map(l => `<div>${new Date(l.t).toLocaleTimeString('zh-CN')}  ${esc(l.msg)}</div>`).join('')
    || '<div class="empty">暂无日志</div>';
}

function mountFlow() {
  const rootEl = $('#flow-root');
  if (!rootEl) return;
  Flow.setProject(S.project.id);
  Flow.mount(rootEl, { onSelect: onNodeSelect, onOpenNode: onNodeOpen });
  rebuildGraph(true);
}

function rebuildGraph(fit) {
  try {
    S._graph = buildGraph(S.project, S.settings, S.flow.view);
  } catch (e) {
    console.error('buildGraph failed', e);
    toast('画布构图异常:' + e.message + ',可点工具条 🧹 重置布局', 'err');
    return;
  }
  Flow.setGraph(S._graph);
  if (fit) Flow.fit();
  if (S.flow.sel) {
    const n = (S._graph.nodes || []).find(x => x.id === S.flow.sel);
    if (n) { Flow.select(n.id); flowPanelFor(n); }
  }
}

/* URL 里的 overlay/drawer 落到宿主(Task 9 精修脉络浮层) */
function syncHosts() {
  if (S.flow.overlay === 'story') FlowUI.openOverlay('🧭 脉络工作室', renderStory());
  else FlowUI.closeOverlay();
  if (S.flow.drawer === 'logs') FlowUI.openLogs(logsHtml());
}

function flowPanelFor(n) {
  if (n.id === 'idea') return FlowUI.openPanel(n, renderScript());
  if (n.id === 'chars') return FlowUI.openPanel(n, renderChars());
  if (n.id === 'film') return FlowUI.openPanel(n, renderFilm());
  /* 其余节点:Task 7 提供专用面板;此兜底展示节点摘要,操作走节点按钮 / Ctrl+K */
  return FlowUI.openPanel(n, `<div class="panel-card"><h3>${esc((n.icon || '') + ' ' + n.title)}</h3>
    <div class="hint">${esc(n.sub || n.desc || '')}</div>
    <div class="note" style="margin-top:10px;color:var(--dim);font-size:12.5px">操作入口:节点卡上的按钮,或 Ctrl+K 命令面板。</div></div>`);
}

function onNodeSelect(id) {
  if (!id) {
    FlowUI.closePanel();
    history.replaceState({}, '', flowUrl({ sel: '' }));
    return;
  }
  const n = (S._graph.nodes || []).find(x => x.id === id);
  if (!n) return; /* URL 带了已失效的 sel:静默忽略 */
  Flow.select(id);
  flowPanelFor(n);
  history.replaceState({}, '', flowUrl({ sel: id }));
}

function onNodeOpen(id) { /* 双击 */
  if (id === 'story') { flowNav({ view: S.flow.view === 'overview' ? 'shots' : 'overview' }); return; }
  if (id.startsWith('scene:')) { flowNav({ view: 'shots', scene: id.slice(6) }); return; }
}
```

- [ ] **Step 5: nextStepOf 的跳转目标改为 flow 视图**

`nextStepOf` 开头(原第 347 行)替换(现有 `goto('script')`/`goto('story')`/`goto('shots')` 调用点全部保持不变,三分支覆盖):

```js
  const goto = t => () => {
    if (t === 'script') return flowNav({ view: 'overview', sel: 'idea' });
    if (t === 'shots') return flowNav({ view: 'shots' });
    flowNav({ overlay: 'story' });
  };
```

两处 `navigate(\`/project/${p.id}/shots?scene=${...}\`)` 分别改为
`flowNav({ view: 'shots', scene: noPanel.sceneId })` 与 `flowNav({ view: 'shots', scene: empty.id })`。

- [ ] **Step 6: 动作接线(新 flow-* acts + 四处旧 act 改写)**

点击委托里 `act === 'preview'` 分支之后追加:

```js
    } else if (act === 'flow-logs') { FlowUI.openLogs(logsHtml()); }
    } else if (act === 'flow-close-panel') { FlowUI.closePanel(); history.replaceState({}, '', flowUrl({ sel: '' })); }
    } else if (act === 'flow-close-overlay') { FlowUI.closeOverlay(); history.replaceState({}, '', flowUrl({ overlay: '' })); }
    } else if (act === 'flow-close-logs') { FlowUI.closeLogs(); history.replaceState({}, '', flowUrl({ drawer: '' })); }
    } else if (act === 'flow-fullscreen') { FlowUI.toggleFullscreen(); }
    } else if (act === 'flow-reset-layout') { Flow.resetLayout(); toast('画布布局已重置', 'ok'); }
```

四处旧 act 改写:

1. `act === 'tab'` 分支(`navigate(projectPath(el.dataset.tab))`)——**整行删除**(tab 条已不存在)。
2. create-project 尾部(原第 667-668 行)替换为:

```js
      await openProject(p.id);
      navigate('/project/' + p.id + (body.autostart ? '?view=shots' : '?overlay=story'));
```

3. `adopt-draft` 尾部(原第 793-794 行)替换为:

```js
      S.draft = null; closeModal(); toast('已采纳写入', 'ok'); flowNav({ overlay: 'story' });
```

4. `goto-scene` 分支(原第 831 行)替换为:

```js
    } else if (act === 'goto-scene') { flowNav({ view: 'shots', scene: el.dataset.sceneId }); }
```

- [ ] **Step 7: 键盘**

keydown 处理器改三处:

```js
  if (e.key === 'Escape') {
    closeModal(); closePalette();
    if (S.view === 'project' && S.flow && FlowUI.closeTop()) {
      history.replaceState({}, '', flowUrl({ sel: '', overlay: '', drawer: '' }));
    }
    return;
  }
```

Ctrl 分支里 `S.tab === 'story'` 条件替换为 `S.flow && S.flow.overlay === 'story'`(脉络浮层内 Ctrl+Z/Y 撤销)。

数字键分支(原 `'123456'.indexOf` 循环)替换为:

```js
  if (S.view === 'project' && S.project) {
    if (e.key === '1') { flowNav({ view: 'overview', sel: '' }); return; }
    if (e.key === '2') { flowNav({ view: 'shots' }); return; }
    if (e.key === 'u') { doHistory('undo'); return; }
    if (e.key === 'y') { doHistory('redo'); return; }
  } else if (S.view === 'home' && e.key === 'n') { newProjectModal(); }
```

- [ ] **Step 8: 命令面板与快捷键速查**

`paletteItems()` 的项目分支(原第 934-946 行,`['脉络','分镜台',...].forEach` 起的全部条目)替换为:

```js
  if (S.view === 'project' && S.project) {
    items.push({ label: S.flow.view === 'overview' ? '🖼 切换到镜头图' : '🗺 切换到总览', hint: '1/2',
      run: () => flowNav({ view: S.flow.view === 'overview' ? 'shots' : 'overview' }) });
    items.push({ label: '🧹 重置画布布局', run: () => { Flow.resetLayout(); toast('画布布局已重置', 'ok'); } });
    items.push({ label: '🎨 生成/重生成封面', run: () => api(`/api/projects/${S.project.id}/generate/cover`, 'POST', {}).then(() => { toast('封面已排队', 'ok'); throttledRefresh(); }) });
    items.push({ label: '🎬 批量生成视频(需锁定场景)', run: () => api(`/api/projects/${S.project.id}/generate/clips`, 'POST', S.flow.scene ? { sceneId: S.flow.scene } : {}).then(() => { toast('已排队:视频', 'ok'); throttledRefresh(); }) });
    items.push({ label: '🔊 批量配音(未变化的自动跳过)', run: () => api(`/api/projects/${S.project.id}/generate/voice`, 'POST', {}).then(() => { toast('已排队:配音', 'ok'); throttledRefresh(); }) });
    items.push({ label: '🎞 合成成片', run: () => api(`/api/projects/${S.project.id}/generate/film`, 'POST', {}).then(() => { toast('已排队:合成', 'ok'); throttledRefresh(); }) });
    items.push({ label: '📜 执行日志', run: () => FlowUI.openLogs(logsHtml()) });
    items.push({ label: '↶ 撤销', hint: 'U', run: () => doHistory('undo') });
    items.push({ label: '↷ 重做', hint: 'Y', run: () => doHistory('redo') });
  } else {
```

`shortcutsModal()` 表格:`1~6 切 tab` 行替换为 `<tr><td><span class="kbd">1</span> / <span class="kbd">2</span></td><td>总览画布 / 镜头图画布</td></tr>`;`Ctrl+Z 脉络 tab` 行的作用说明改为「脉络工作室浮层内:撤销 / 重做结构修改」;追加一行 `<tr><td><span class="kbd">Esc</span></td><td>依次收起:浮层 → 详情面板 → 日志抽屉</td></tr>`。

- [ ] **Step 9: 门禁与手动冒烟**

Run: `node --check public/app.js && node --test tests/`
Expected: 语法 OK + 全部 PASS

Run: `./start.sh` 后浏览器验证(零成本演示模式):
1. `/` 首页正常;进入项目 → 全屏画布 + 工具条 + 8 节点串行链
2. 旧 URL 六种 `/project/:id/{story,shots,chars,script,film,logs}` 各自正确落地(浮层/镜头图/面板/抽屉)
3. 单击 idea/chars/film → 对应面板;单击其他节点 → 摘要兜底面板
4. 双击脉络 ⇄ 镜头图;`1`/`2` 切换;场景双击聚焦;URL 反映 view/scene/sel
5. 滚轮缩放到光标、拖空白平移、拖节点换位、刷新后位置保留、🧹 重置生效
6. 📜 日志抽屉、⛶ 全屏、Esc 逐层收起、Ctrl+K 面板条目可执行
7. 刷新直连 `/project/:id?view=shots&scene=<id>&sel=<nodeId>` 恢复现场

已知中间态(留待 Task 8):SSE 消息触发全量重建,生成过程中视口会复位。

- [ ] **Step 10: Commit**

```bash
cd /home/tutuos/CodeLab/manju
git add public/app.js public/index.html
git commit -m "feat(flow): fullscreen canvas shell, URL-as-state routing, legacy tab redirects

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 详情面板(七种专用面板)+ 旧 tab 渲染函数清理

**Files:**

- Modify: `public/app.js`

**Interfaces:**

- Consumes: Task 6 的 `flowPanelFor/onNodeSelect/flowNav/logsHtml`;既有渲染函数 `renderScript/renderChars/renderFilm/renderShotCard(本任务提取)`;既有 `data-change="shot|scene"` 600ms 防抖保存与 `data-act="gen/toggle-lock/preview/goto-scene"` 委托
- Produces: `renderShotCard(sh)`(单镜编辑卡,复用原分镜台卡片)、`shotPanel(n)/scenePanel(n)/storyPanel(n)/panelsPanel(n)/clipsPanel(n)/voicePanel(n)/coverPanel(n)`、新 `data-act`:`flow-open-story/flow-sel-shot`

所有面板都是**只拼 HTML 字符串**的纯渲染函数,编辑控件沿用 `data-change` 防抖与 `data-act` 委托,零新增事件代码。

- [ ] **Step 1: 提取 renderShotCard**

新建函数(放在 `renderChars` 之前),内容**原样照抄**原 `renderShots` 里 `list.map(sh => { ... })` 的回调体(原第 444-477 行:badge/media/shot 卡模板),签名改为:

```js
function renderShotCard(sh) {
  const badge = (st, doneTxt) => `<span class="badge ${st}">${st === 'done' ? doneTxt : st === 'pending' ? '生成中…' : st === 'error' ? '失败' : st === 'animatic' ? '动态漫' : '未生成'}</span>`;
  const media = sh.clipUrl
    ? `<video src="${sh.clipUrl}" preload="metadata" data-act="preview" data-kind="video" data-url="${sh.clipUrl}"></video>`
    : sh.panelUrl
      ? `<img src="${sh.panelUrl}" loading="lazy" data-act="preview" data-kind="img" data-url="${sh.panelUrl}">`
      : `<div class="ph">🖼️<br><span style="font-size:12px">暂无分镜图</span></div>`;
  return `<div class="shot">
    <div class="visual-box">${media}
      <span class="badge ${sh.clipStatus === 'done' ? 'done' : sh.clipStatus === 'animatic' ? 'done' : sh.panelStatus === 'error' || sh.clipStatus === 'error' ? 'error' : sh.panelStatus === 'pending' || sh.clipStatus === 'pending' ? 'pending' : ''}">
        ${sh.clipStatus === 'done' ? '视频 ✓' : sh.clipStatus === 'animatic' ? '动态漫 ✓' : sh.clipStatus === 'error' ? '视频失败' : sh.panelStatus === 'done' ? '分镜图 ✓' : sh.panelStatus === 'error' ? '图失败' : sh.panelStatus === 'pending' || sh.clipStatus === 'pending' ? '生成中…' : '待生成'}</span>
      <span class="shot-no">第 ${sh.idx} 镜</span>
    </div>
    <div class="body">
      <div class="row1">
        <span class="tag">🎬 ${esc(sh.scene || '—')}</span>
        <span class="tag">📷 ${esc(sh.camera || '固定')}</span>
        <span class="tag">${sh.duration || 5}s</span>
        ${sh.audioUrl ? `<span class="tag" style="color:var(--ok)">🔊 ${esc(sh.speaker)}</span>` : sh.dialogue ? `<span class="tag">🗣 ${esc(sh.speaker || '旁白')}</span>` : ''}
      </div>
      <textarea class="visual" data-change="shot" data-idx="${sh.idx}" data-field="visual" rows="2">${esc(sh.visual)}</textarea>
      <textarea class="dlg" data-change="shot" data-idx="${sh.idx}" data-field="dialogue" rows="1" placeholder="台词(可空)">${esc(sh.dialogue || '')}</textarea>
      ${sh.error ? `<div class="err">${esc(sh.error)}</div>` : ''}
      <div class="ops">
        <button class="btn small" data-act="gen" data-stage="panels" data-shot-idx="${sh.idx}">🎨 ${sh.panelStatus === 'done' ? '重绘' : '生成图'}</button>
        ${S.settings.videoEngine === 'animatic' ? '' : `<button class="btn small" data-act="gen" data-stage="clips" data-shot-idx="${sh.idx}" ${sh.panelStatus !== 'done' ? 'disabled title="先有分镜图"' : ''}>🎬 ${sh.clipStatus === 'done' ? '重做视频' : '生成视频'}</button>`}
        ${sh.audioUrl ? `<button class="btn small" data-act="preview" data-kind="video" data-url="${sh.audioUrl}">🔊 试听</button>` : ''}
        ${sh.dialogue ? `<button class="btn small" data-act="gen" data-stage="voice" data-shot-idx="${sh.idx}">🎙 配音</button>` : ''}
      </div>
    </div>
  </div>`;
}
```

(与原实现唯一的差异:`sh.speaker` 输出包了 `esc()`,修复属性注入。)

- [ ] **Step 2: 七种专用面板**

在 `flowPanelFor` 附近新增(`esc` 为 app.js 既有工具):

```js
function shotPanel(n) {
  const p = S.project;
  const sh = (p.shots || []).find(s => s.idx === n.idx && s.sceneId === n.sceneId);
  const sc = (p.scenes || []).find(s => s.id === n.sceneId);
  const siblings = (p.shots || []).filter(s => s.sceneId === n.sceneId).map(s => s.idx).sort((a, b) => a - b);
  const i = siblings.indexOf(n.idx);
  const prev = siblings[i - 1], next = siblings[i + 1];
  return `<div class="hint" style="margin-bottom:10px">场景:${esc(sc ? sc.title : n.sceneId)}${sc && sc.locked ? ' 🔒' : ''}</div>
    ${sh ? renderShotCard(sh) : '<div class="empty">该镜头不存在(可能已被删除)</div>'}
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      ${prev ? `<button class="btn small" data-act="flow-sel-shot" data-scene-id="${n.sceneId}" data-idx="${prev}">← 第 ${prev} 镜</button>` : '<span></span>'}
      <span class="spacer"></span>
      ${next ? `<button class="btn small" data-act="flow-sel-shot" data-scene-id="${n.sceneId}" data-idx="${next}">第 ${next} 镜 →</button>` : ''}
    </div>`;
}

function scenePanel(n) {
  const p = S.project;
  const sc = (p.scenes || []).find(s => s.id === n.sceneId);
  if (!sc) return '<div class="empty">场景不存在</div>';
  const list = (p.shots || []).filter(s => s.sceneId === sc.id).sort((a, b) => a.idx - b.idx);
  return `<div class="panel-card">
      <div class="form-row"><span>场景名</span><input type="text" data-change="scene" data-id="${sc.id}" data-field="title" value="${esc(sc.title)}"></div>
      <div class="form-row"><span>地点 / 时间</span>
        <input type="text" data-change="scene" data-id="${sc.id}" data-field="location" value="${esc(sc.location || '')}" placeholder="地点" style="flex:1">
        <input type="text" data-change="scene" data-id="${sc.id}" data-field="time" value="${esc(sc.time || '')}" placeholder="时间" style="flex:1"></div>
      <div class="form-row"><span>出场角色</span><input type="text" data-change="scene" data-id="${sc.id}" data-field="cast" value="${esc((sc.cast || []).join(','))}" placeholder="逗号分隔"></div>
      <div style="margin-top:8px"><textarea data-change="scene" data-id="${sc.id}" data-field="description" rows="3" placeholder="场景内容(要能被画出来)">${esc(sc.description || '')}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn small ${sc.locked ? '' : 'primary'}" data-act="toggle-lock" data-scene-id="${sc.id}">${sc.locked ? '🔒 已锁定(点按解锁)' : '🔒 锁定分镜(解锁批量视频)'}</button>
        <button class="btn small" data-act="gen" data-stage="sceneShots" data-scene-id="${sc.id}">🪄 AI 生成本场景分镜</button>
      </div>
    </div>
    ${list.length
      ? `<div class="shots-grid" style="margin-top:12px">${list.map(renderShotCard).join('')}</div>`
      : '<div class="empty" style="margin-top:12px">该场景还没有分镜,点上面「AI 生成本场景分镜」。</div>'}`;
}
```

```js
function storyPanel() {
  const p = S.project;
  const scenes = p.scenes || [];
  return `<div class="panel-card"><h3>脉络进度</h3>
    ${scenes.length ? scenes.map(sc => {
      const st = sc.stats || {};
      const has = (st.shots || 0) > 0;
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
        <b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sc.title)}${sc.locked ? ' 🔒' : ''}</b>
        <span class="hint">${has ? `分镜${st.shots} · 图${st.panels}/${st.shots} · 片${st.clips}/${st.shots}` : '未展开'}</span>
        ${has ? `<button class="btn small" data-act="goto-scene" data-scene-id="${sc.id}">查看镜头 ›</button>`
              : `<button class="btn small" data-act="gen" data-stage="sceneShots" data-scene-id="${sc.id}">🪄 生成分镜</button>`}
      </div>`;
    }).join('') : '<div class="empty">还没有场景:先打开脉络工作室,把节拍拆成场景。</div>'}
    <div style="margin-top:12px"><button class="btn primary" data-act="flow-open-story">🧭 打开脉络工作室</button></div>
  </div>`;
}

function panelsPanel() {
  const p = S.project;
  return `<div class="panel-card"><h3>分镜图进度(按场景)</h3>
    ${(p.scenes || []).map(sc => {
      const st = sc.stats || {};
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
        <b style="flex:1">${esc(sc.title)}</b>
        <span class="hint">图 ${st.panels || 0}/${st.shots || 0}</span>
        <button class="btn small" data-act="goto-scene" data-scene-id="${sc.id}">去镜头 ›</button>
      </div>`;
    }).join('') || '<div class="empty">还没有场景</div>'}
    <div class="hint" style="margin-top:10px">镜头图逐镜生成:双击「脉络」节点进入镜头图;镜头卡 pip 悬停可 ↻ 单镜重roll。</div></div>`;
}

function clipsPanel() {
  const p = S.project;
  const animatic = S.settings.videoEngine === 'animatic';
  return `<div class="panel-card"><h3>视频片段(锁定闸门)</h3>
    <div class="hint">${animatic
      ? '当前为动态漫模式:ffmpeg 直绘运镜,0 成本,无需锁定即可参与合成。'
      : '未 🔒 锁定的场景,批量生成视频会被服务端直接拒绝;单镜重roll不受限。'}</div>
    ${(p.scenes || []).map(sc => {
      const st = sc.stats || {};
      const pending = (st.shots || 0) - (st.clips || 0);
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
        <b style="flex:1">${esc(sc.title)} ${sc.locked ? '🔒' : '🔓'}</b>
        <span class="hint">片 ${st.clips || 0}/${st.shots || 0}</span>
        ${sc.locked && pending > 0 && !animatic ? `<button class="btn small" data-act="gen" data-stage="clips" data-scene-id="${sc.id}">🎬 生成 ${pending} 镜视频</button>` : ''}
      </div>`;
    }).join('') || '<div class="empty">还没有场景</div>'}
    <div class="hint" style="margin-top:10px">批量只处理「已锁定且分镜图完成」的镜头;Ctrl+K 里也有全项目批量入口。</div></div>`;
}
```

```js
function voicePanel() {
  const p = S.project;
  const withDlg = (p.shots || []).filter(s => (s.dialogue || '').trim());
  return `<div class="panel-card"><h3>配音(edge-tts,¥0)</h3>
    <div class="hint">台词按说话人自动分配音色;台词/音色未变化时自动跳过(hash 缓存),重复点不重复合成。「(内心)」开头为内心独白。</div>
    <div style="margin-top:10px"><button class="btn primary" data-act="gen" data-stage="voice">🔊 为全部台词配音</button></div>
    ${withDlg.map(sh => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">第 ${sh.idx} 镜 · ${esc(sh.speaker || '旁白')}:${esc((sh.dialogue || '').slice(0, 24))}</span>
      <span class="badge ${sh.voiceStatus === 'done' ? 'done' : sh.voiceStatus === 'error' ? 'error' : sh.voiceStatus === 'pending' ? 'pending' : ''}">${sh.voiceStatus === 'done' ? '✓' : sh.voiceStatus === 'skipped' ? '跳过' : sh.voiceStatus === 'error' ? '失败' : sh.voiceStatus === 'pending' ? '生成中' : '待生成'}</span>
      ${sh.audioUrl ? `<button class="btn small" data-act="preview" data-kind="video" data-url="${sh.audioUrl}">试听</button>` : ''}
      <button class="btn small" data-act="gen" data-stage="voice" data-shot-idx="${sh.idx}" title="重新配音">↻</button>
    </div>`).join('') || '<div class="empty">还没有台词:先到镜头面板写台词。</div>'}
  </div>`;
}

function coverPanel() {
  const p = S.project;
  return p.coverImageUrl
    ? `<div class="panel-card">
        <img src="${p.coverImageUrl}" style="width:100%;border-radius:12px" data-act="preview" data-kind="img" data-url="${p.coverImageUrl}">
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn small" style="text-decoration:none" href="${p.coverImageUrl}" download="cover.jpg">⬇ 下载封面</a>
          <button class="btn small" data-act="gen" data-stage="cover">🎨 重新生成</button>
        </div>
        <div class="hint" style="margin-top:8px">1080×1440 竖版海报:故事核心冲突 + 最多 2 张角色设定图参考 + 剧集名艺术字(套餐生图,≈¥0.2)。</div>
      </div>`
    : `<div class="panel-card" style="text-align:center;padding:40px 0">
        🎨<br>还没有封面<br>
        <button class="btn primary" data-act="gen" data-stage="cover">生成封面</button>
        <div class="hint" style="margin-top:8px">1080×1440 竖版海报,首页卡片与成片页下载都会用到,可随时重roll。</div>
      </div>`;
}
```

- [ ] **Step 3: flowPanelFor 全量替换**

把 Task 6 的兜底版 `flowPanelFor` 整段替换为:

```js
function flowPanelFor(n) {
  if (n.id === 'idea') return FlowUI.openPanel(n, renderScript());
  if (n.id === 'chars') return FlowUI.openPanel(n, renderChars());
  if (n.id === 'film') return FlowUI.openPanel(n, renderFilm());
  if (n.id === 'story') return FlowUI.openPanel(n, storyPanel());
  if (n.id === 'panels') return FlowUI.openPanel(n, panelsPanel());
  if (n.id === 'clips') return FlowUI.openPanel(n, clipsPanel());
  if (n.id === 'voice') return FlowUI.openPanel(n, voicePanel());
  if (n.id === 'cover') return FlowUI.openPanel(n, coverPanel());
  if (n.kind === 'scene') return FlowUI.openPanel(n, scenePanel(n));
  if (n.kind === 'shot') return FlowUI.openPanel(n, shotPanel(n));
}
```

- [ ] **Step 4: 新 act 与命令面板补条目**

点击委托追加(Task 6 的 flow-* 分支之后):

```js
    } else if (act === 'flow-open-story') { flowNav({ overlay: 'story' }); }
    } else if (act === 'flow-sel-shot') {
      const nid = 'shot:' + (el.dataset.sceneId || S.flow.scene) + ':' + Number(el.dataset.idx);
      if ((S._graph.nodes || []).some(x => x.id === nid)) onNodeSelect(nid);
    }
```

`paletteItems()` 项目分支里「🧹 重置画布布局」之后插入:

```js
    items.push({ label: '🪄 AI 生成本场景分镜(纯文本)', run: () => {
      const sid = S.flow.scene || ((S.project.scenes || []).find(sc => !(S.project.shots || []).some(x => x.sceneId === sc.id)) || {}).id;
      if (!sid) return toast('没有待展开的场景', 'err');
      api(`/api/projects/${S.project.id}/generate/sceneShots`, 'POST', { sceneId: sid }).then(() => { toast('已排队:场景分镜', 'ok'); throttledRefresh(); });
    } });
```

- [ ] **Step 5: 删除旧物**

1. **删除** `renderShots` 整个函数(卡片已由 `renderShotCard` 承接,场景选择条由画布展开状态替代)。
2. **删除** `stepChip` 整个函数(流程条已移除,无引用)。
3. **删除** change 委托里的 `scene-select` 分支:

```js
  if (kind === 'scene-select') {
    S.sceneId = el.value === '__all__' ? '__all__' : el.value;
    history.replaceState({}, '', projectPath('shots'));
    render(); return;
  }
```

4. `S` 初始化里删除 `tab: 'shots',`(sceneId 保留,gen 兜底仍在用)。
5. 全文搜索确认:`grep -n "renderShots\|stepChip\|scene-select\|S.tab\|TABS\|projectPath" public/app.js` → 无结果。

- [ ] **Step 6: 门禁、冒烟与提交**

Run: `node --check public/app.js && node --test tests/`
Expected: 语法 OK + 全部 PASS

浏览器冒烟(演示模式):
1. story/panels/clips/voice/cover 五个总览节点面板各自渲染正确,「打开脉络工作室」「去镜头」按钮直达
2. 场景节点面板:改场景名(600ms 防抖保存)→ 画布上场景标题跟随变化;锁定切换 → 节点按钮文案变
3. 镜头节点面板:改台词/画面描述 → 保存后镜头卡 .fw-line 与 pips 变化;单镜重绘/重做视频/配音可用;← → 切镜
4. Ctrl+K 出现「AI 生成本场景分镜」;空场景场景节点上的 🪄 按钮可用,生成后按钮消失

```bash
cd /home/tutuos/CodeLab/manju
git add public/app.js
git commit -m "feat(flow): purpose-built detail panels; remove legacy tab renderers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: SSE 实时就地补丁 + 断线重连指示

**Files:**

- Modify: `public/app.js`

**Interfaces:**

- Consumes: Task 5 `Flow.patch`(id 集合不变→就地补丁,否则自动全量)、Task 6 的 `updateToolbar/flowUrl/flowPanelFor/rebuildGraph`
- Produces: `render(light)` 分级渲染(全量=重建壳,light=补丁)、重写后的 `refreshProject/watch/syncHosts`、工具条 `#fw-conn` 重连中指示

关键约束:**SSE 高频刷新不得打断正在输入的面板/浮层**——焦点在面板输入控件内时跳过该宿主的内容重填(防丢字,优于旧 tab 版全量重渲染的行为)。

- [ ] **Step 1: render 分级与 renderLight**

`render` 函数整段替换:

```js
function render(light) {
  document.title = S.view === 'project' && S.project ? `${S.project.title} · 漫剧工坊` : '漫剧工坊 · Manju Studio';
  document.body.classList.toggle('flow-mode', S.view === 'project');
  if (S.view === 'home') return renderHome();
  if (!light || !S._graph) return renderProject(); /* 首次/换项目/换视图仍走全量 */
  renderLight();
}

/* SSE 高频路径:补丁画布 + 刷新工具条 + 跟随宿主,不重建壳 */
function renderLight() {
  const p = S.project;
  S._ns = nextStepOf(p);
  updateToolbar();
  try {
    S._graph = buildGraph(p, S.settings, S.flow.view);
    Flow.patch(S._graph);
  } catch (e) {
    console.error('buildGraph failed', e);
    toast('画布构图异常:' + e.message + ',可点工具条 🧹 重置布局', 'err');
    return;
  }
  const drawer = document.getElementById('fw-drawer');
  const editing = drawer && drawer.contains(document.activeElement) &&
    document.activeElement.matches('input, textarea, select');
  if (S.flow.sel) {
    const n = (S._graph.nodes || []).find(x => x.id === S.flow.sel);
    if (n) { if (!editing) flowPanelFor(n); }
    else { /* 选中的节点被删除:收面板并清 URL 参数 */
      FlowUI.closePanel(); Flow.select(null);
      history.replaceState({}, '', flowUrl({ sel: '' }));
    }
  }
  syncHosts(true);
}
```

`refreshProject` 整段替换(改为 light 渲染):

```js
async function refreshProject() {
  if (!S.project) return;
  S.project = await api('/api/projects/' + S.project.id);
  render(true);
}
```

- [ ] **Step 2: syncHosts 支持轻量刷新**

Task 6 的 `syncHosts` 整段替换为:

```js
function syncHosts(light) {
  const ov = document.getElementById('fw-overlay');
  const ovOpen = !!(ov && ov.classList.contains('open'));
  if (S.flow.overlay === 'story') {
    /* 浮层内正在输入时跳过重填,防丢字 */
    const typing = ovOpen && ov.contains(document.activeElement) &&
      document.activeElement.matches('input, textarea');
    if (!light || !ovOpen || !typing) FlowUI.openOverlay('🧭 脉络工作室', renderStory());
  } else if (ovOpen) FlowUI.closeOverlay();
  if (S.flow.drawer === 'logs') FlowUI.openLogs(logsHtml());
}
```

- [ ] **Step 3: watch 重写(重连中指示 + 轮询兜底协同)**

`watch` 整段替换:

```js
function watch(pid) {
  if (S.sse) { S.sse.close(); S.sse = null; }
  clearInterval(S.pollTimer); S.pollTimer = null;
  const es = new EventSource(`/api/projects/${pid}/events`);
  es.onopen = () => {
    clearInterval(S.pollTimer); S.pollTimer = null;
    const c = $('#fw-conn'); if (c) c.hidden = true;
  };
  es.onmessage = () => throttledRefresh();
  es.onerror = () => {
    const c = $('#fw-conn'); if (c) c.hidden = false; /* 工具条亮「重连中…」 */
    if (!S.pollTimer) S.pollTimer = setInterval(() => S.project && refreshProject(), 4000);
  };
  S.sse = es;
}
```

- [ ] **Step 4: 数据变更后的 render() 改为轻量**

三处直接改数据的 `render()` 尾调用改为 `render(true)`(画布走补丁,不重建壳、不复位视口):

1. `toggle-lock` 分支末尾;
2. `save-story` 分支末尾;
3. `sel-arc` 分支(`S.selArc = el.dataset.arc; render();`)。

> `undo/redo` 已走 `refreshProject()` 自动变 light;`adopt-draft`/路由变化仍走全量(URL 变了,应当重建)。

- [ ] **Step 5: 门禁、实时性冒烟与提交**

Run: `node --check public/app.js && node --test tests/`
Expected: 语法 OK + 全部 PASS

浏览器冒烟(演示模式,重点 Task 8 新行为):
1. 触发一次场景分镜生成:生成过程中**视口不复位**、节点变蓝脉冲、连线流动虚线、镜头卡逐个落图——全程无壳重建闪烁
2. 生成过程中打开镜头面板改台词:输入不被刷新打断(焦点守卫),600ms 防抖保存成功
3. 拔网线/杀服务 → 工具条出现「重连中…」,恢复后指示消失、数据追平
4. 锁定切换 → 场景节点按钮文案与连线状态就地更新,视口不动
5. 删除一个场景(URL sel 指向其镜头)→ 面板自动收起,无报错

```bash
cd /home/tutuos/CodeLab/manju
git add public/app.js
git commit -m "feat(flow): SSE in-place canvas patching with focus-guarded hosts, reconnect chip

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: 脉络工作室浮层精修(反抽卡落点 + 文案)

**Files:**

- Modify: `public/app.js`

**Interfaces:**

- Consumes: Task 6 已接线的 `syncHosts`(overlay=story 渲染 `renderStory()`)、`flowNav`、Ctrl+Z 浮层条件、`flow-open-story/flow-close-overlay` acts;Task 8 的 focus 守卫
- Produces: 全新项目首跳默认打开脉络浮层;两处「剧本 tab」文案改为画布语境

`renderStory()` 本体**零改动**(四级草稿流、data-act 委托、Ctrl+Z 撤销链原样可用)——浮层宿主只是换了展示容器。

- [ ] **Step 1: 全新项目首跳脉络浮层**

`handleRoute` 里 `await openProject(pid);` 之后追加(try 块内):

```js
    const bare = !(S.project.shots || []).length && !((S.project.story || {}).arcs || []).length;
    if (!location.search && bare) { /* 反抽卡:全新项目直接进脉络工作室 */
      history.replaceState({}, '', flowUrl({ overlay: 'story' }));
      applyFlowQuery(new URL(location.href));
      syncHosts();
    }
```

- [ ] **Step 2: 文案改画布语境(两处)**

1. `draft-premise` 分支:`return toast('请先在「剧本」tab 写一段创意,AI 才有原料', 'err');` 改为 `return toast('请先写故事创意:打开总览「创意」节点面板', 'err');`
2. `renderStory` 里起草按钮:`(先在「剧本」tab 写创意)` 改为 `(先写创意:总览「创意」节点)`

- [ ] **Step 3: 门禁、冒烟与提交**

Run: `node --check public/app.js && node --test tests/`
Expected: 语法 OK + 全部 PASS

浏览器冒烟:
1. 新建项目(不勾自动开始)→ 直接落进全屏脉络浮层;URL 为 `?overlay=story`,刷新保持在浮层
2. 浮层内:AI 起草骨架 → 改 → 采纳 → 走向写入且浮层仍开;拆章节/节拍/场景全链路
3. 浮层内 Ctrl+Z 撤销章节删除,画布背后场景组同步变化
4. 场景采纳后:场景节点出现在画布(浮层背后透出),点 ✕ 关闭浮层可见;场景「查看镜头」跳镜头图

```bash
cd /home/tutuos/CodeLab/manju
git add public/app.js
git commit -m "feat(flow): story studio overlay polish (new-project landing, canvas-era copy)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: README 更新 + 全链路手动 QA

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: Task 1-9 的全部交付物;`./start.sh` 零成本演示模式
- Produces: 与画布一致的文档 + 逐项通过的验收记录

- [ ] **Step 1: README「交互指南」整节替换**

把 README 的 `## 交互指南` 一节(从标题到下一节标题之前)替换为:

```markdown
## 交互指南

- **全屏节点画布**:进入项目即画布。流水线 8 节点串行链(创意→脉络→角色图→分镜图→视频→配音→合成→封面),
  连线表达生产流向,状态随 SSE 实时流动(蓝=运行中、绿=完成、红=失败、橙=跳过);
- **双层视图**:双击「脉络」节点(或按 `2`)展开镜头图——场景分组 + 镜头卡(缩略图 + 文/图/片/音四工序 pip,
  pip 悬停可单镜重roll);`1` 回总览;
- **详情面板**:单击节点右侧滑出面板,编辑能力全部在这里(节点卡只读,不放输入框);`Esc` 依次收起浮层/面板/日志;
- **脉络工作室**:脉络节点面板按钮打开全屏浮层,四级草稿流(走向→章节→节拍→场景)与 Ctrl+Z 撤销链不变;
- **下一步引导**:工具条芯片按项目状态实时计算当前最该做的事,点击直达;
- **位置记忆**:拖动节点自动记忆(localStorage,按项目独立),工具条 🧹 一键重置;
- **URL 即状态**:`?view=shots&scene=<id>&sel=<nodeId>&overlay=story&drawer=logs`,刷新/后退/分享链接直达;
  旧 `/project/:id/{story,shots,chars,script,film,logs}` 书签自动重定向到等价视图;
- **命令面板**:`Ctrl+K` 搜索并执行任何操作(切层、生成、锁定、撤销、打开项目、设置…),`↑↓` 选择 `Enter` 执行;
- **快捷键**:`1`/`2` 切层,`U`/`Y` 撤销重做,`N` 新建项目,`?` 速查表;单键在输入框内打字时不触发;
- **统一确认框**:所有删除操作使用样式化确认(说明影响范围 + 提示可用 Ctrl+Z 撤销),Esc/点遮罩=取消。
```

- [ ] **Step 2: README「目录结构」public/ 展开并补 tests/**

把目录结构代码块里的:

```
├── public/              # 前端 SPA(原生 JS/CSS,无构建)
```

替换为:

```
├── public/              # 前端 SPA(原生 JS/CSS,无构建)
│   ├── flow-graph.js    # 画布纯函数层:project → 节点/连线/布局(node --test 可测)
│   ├── flow.js          # 画布引擎:视口/SVG连线/SSE补丁 + 面板/浮层/日志宿主
│   ├── flow.css         # 画布与宿主样式(复用 style.css 主题变量)
│   ├── app.js           # 状态/路由/SSE/事件委托/详情面板
│   └── style.css index.html
├── tests/
│   └── flow-graph.test.js   # 画布图推导单测(node --test tests/)
```

- [ ] **Step 3: 全链路手动 QA(`./start.sh` 演示模式,逐项打勾)**

1. 平移/缩放手感、缩放到光标;拖动节点后刷新位置保留;🧹 重置布局生效
2. 双层切换:双击脉络 / `1` / `2` / URL 直达;场景分组双击聚焦该场景
3. 面板全链路:创意编辑→生成分镜;分镜文案改→防抖保存→单镜重roll;角色图生成;成片播放/下载
4. 脉络工作室浮层:走向→章节→节拍→场景四级草稿流,Ctrl+Z 撤销;新建项目首跳浮层
5. 旧 URL 六种 tab 路径各自正确落地;Ctrl+K 每个条目可执行
6. 演示模式生成中:节点/连线实时变色、视口不复位、镜头卡缩略图与 pip 就地更新
7. 断网 → 「重连中…」出现,4s 轮询兜底;恢复 → 指示消失、数据追平
8. ⛶ 真全屏进出;📜 日志抽屉开合;Esc 依次收起浮层→面板→抽屉
9. 隐私模式(禁 localStorage):画布完全可用,仅不记忆节点位置,控制台无报错
10. 过期书签 `?scene=<已删id>&sel=<已删节点>`:静默回落总览、面板收起,无白屏无报错

发现问题 → 就地修复(小修直接改,行为级改动回对应任务补测试)→ 重跑 `node --test tests/`。

- [ ] **Step 4: Commit**

```bash
cd /home/tutuos/CodeLab/manju
git add README.md
git commit -m "docs: canvas-era interaction guide and project layout

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 计划自检记录

- **Spec 覆盖**:§4 布局/工具条→Task 6;§5.1 总览→Task 2;§5.2 镜头层→Task 3/5/7;§6 交互规范→Task 5/6(滚轮/拖拽/单击/双击/Esc/Ctrl+K/快捷键/全屏);§7 工程结构→Task 2-6 文件一一对应;§8 迁移表→Task 6(FLOW_TAB_MAP/renderScript→idea 面板/renderStory→浮层/logs→抽屉/首页不变)+ Task 7(renderShots→镜头面板/renderFilm→film+cover 面板);§9 错误处理→Task 6(rebuildGraph try/catch)/Task 8(重连指示)/Task 5(ls try/catch、Fullscreen toast)/闸门文案(clipsPanel);§10 测试→Task 2-3 单测 + Task 10 QA。
- **占位符扫描**:Task 6 Step 4 的 `flowPanelFor` 兜底分支是完整的通用实现(节点摘要 + 指引),且被 Task 7 Step 3 全量替换——非 TBD。
- **类型一致性**:`Flow.patch/setGraph` 输入 = `buildGraph` 输出(Task 2 Produces ↔ Task 5 Consumes);`fgStage` 输出枚举 `run|done|error|skip|pending` = flow.css `st-*`/`fw-pip` 类名;节点 id 格式(含 `shot:<场景id>:<idx>`)在 Task 2 约束、Task 3 实现、Task 6/7 的 `shot:`/`scene:` 前缀解析一致;`data-change="shot|scene"` 防抖字段名与旧代码一致。
