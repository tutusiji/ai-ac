# 编辑界面工作台化(左导航 + 全宽工作页)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把编辑界面从「画布 + 右侧 430px 抽屉」重构为「左侧常驻导航栏 + 九个全宽工作页」,画布降为其中一页,根治选中即弹面板、SSE 整块重渲、浮层遮挡三类交互问题。

**Architecture:** 纯前端改造 + 一个新纯函数路由模块。`public/flow-route.js` 承担 URL query ↔ 页面状态的全部解析/序列化与节点→页映射(唯一 TDD 锚点;落 public/ 而非 lib/——server.js 静态服务只认 public/,零服务端改动约束下浏览器必须直载,Node 测试 require 同一文件);`public/app.js` 的渲染入口收口为 `renderProject`(壳:rail + `#page`)+ `const { parseFlowQuery, flowRouteTo, pageForNode } = window.FlowRoute;`(T3 接线)+ `renderCurrentPage`(九页分派)+ `renderLight`(SSE 增量:状态灯必更、画布 Flow.patch、表单页焦点守卫);画布引擎 flow.js/flow-graph.js 原样保留,仅删除 FlowUI 的抽屉/浮层方法。零服务端改动、零数据迁移。

**Tech Stack:** Node 内置模块(bare `node --test`)+ 原生 HTML/CSS/JS(零依赖、无构建步骤)。

**Spec:** `docs/superpowers/specs/2026-10-12-editor-workbench-design.md`(计划与 spec 冲突时以 spec 为准)

## Global Constraints

- **零依赖**:Node 内置模块 + 原生前端三件套;不引入 npm 运行时依赖、不引入构建步骤。
- `data/settings.json`(明文 Key)与 `data/projects/`(用户媒体)永不入库、密钥永不打印;应用无鉴权。
- 引号约定(`.prettierrc`):**lib/server 单引号,tests/public 双引号**;PostToolUse prettier 钩子在位,编辑后整文件可能被重排,Edit 失配时先 grep 再改。
- 提交信息中文,结尾加 trailer:`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 测试命令:仓库根目录**裸 `node --test`**(不是 `node --test tests/`);基线 33/33 绿(HEAD e6ff5bf)。
- 画布引擎 `public/flow.js`(Flow)与 `public/flow-graph.js` 原样保留;仅 FlowUI 删除面板/浮层方法(openPanel/closePanel/openOverlay/closeOverlay/closeTop),保留 openLogs/closeLogs/toggleFullscreen。
- `#fw-logs` 底部日志抽屉、lightbox、toast/confirmDialog、data-act 全局委托、SSE 管道:零改动(事件委托的 act 分支按任务增删)。
- localStorage 画布位置记忆 key `manju.flow.<pid>.pos` 不变。
- 部署拓扑(仅 T6 冒烟时涉及):本地 8787 生产实例**不许动**;QA 用 `PORT=8899` 临时实例 + 临时项目,结束清理。

## Review Focus

1. **旧书签 URL 六类归一**——`?sel=idea|chars|film|panels|clips|voice|cover`、`?overlay=story`、`?view=shots`、`?drawer=logs`、以及无参数旧路径 `/project/<id>`:期望落地等价工作页,永不白屏。→ T1 flow-route 测试逐类钉死。
2. **非法 page/shot**——`?page=hack`、`?shot=abc`、`?shot=0`、`?shot=-3`:期望 parse 归一(canvas / 丢弃 shot),宿主回落分镜页全场景视图,不报错弹窗。→ T1 测试钉死 + T5 分派处二次校验。
3. **SSE 同步时用户正在表单页输入**——script/chars/film/cover/story/镜头页:期望跳过整块重渲、不丢字,rail 状态灯仍然更新。→ T4a `refreshCurrentPage` 焦点守卫 + T6 人工冒烟第 5 条。
4. **画布选中节点被删除**(另一标签触发了重生成):期望选中静默清除、上下文条消失、URL sel 清理,不报错。→ T4b `renderLight` canvas 分支 + T6 人工冒烟第 6 条。
5. **窄屏 <900px**——期望 rail 收窄为 48px 仅图标、不横向滚动。→ T2 媒体查询 + T6 人工冒烟第 7 条。

---

### Task 1: `public/flow-route.js` 路由纯函数模块(TDD)

**Files:**

- Create: `public/flow-route.js`
- Modify: `public/index.html`(脚本区插一行 `<script src="/flow-route.js"></script>`,见 Step 4)
- Test: `tests/flow-route.test.js`

**Interfaces:**

- Consumes: 无(纯函数,零依赖)。
- Produces(后续任务按此签名消费):
  - `parseFlowQuery(searchParams: URLSearchParams) → { page, view, scene, shot, sel, logsHint }`
  - `flowRouteTo(projectId: string, state: {page?, view?, scene?, shot?, sel?}) → string`
  - `pageForNode(node: {id, kind?, sceneId?, idx?}) → { page, scene?, shot? } | null`
  - 浏览器全局 `window.FlowRoute`(同一文件末尾挂载;Node 侧 `module.exports` 同三函数)

- [ ] **Step 1: 写失败测试**(tests 双引号约定;写入文件时引号按 .prettierrc,计划内代码块引号可能被 md 重排,以约定为准)

创建 `tests/flow-route.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseFlowQuery,
  flowRouteTo,
  pageForNode,
} = require('../public/flow-route');

const parse = (q) => parseFlowQuery(new URLSearchParams(q));

test('新参数完整解析:page/scene/shot', () => {
  const r = parse('page=storyboard&scene=sc1&shot=3');
  assert.deepStrictEqual(r, {
    page: 'storyboard',
    view: 'overview',
    scene: 'sc1',
    shot: 3,
    sel: '',
    logsHint: false,
  });
});

test('空参数 → canvas 缺省,view=overview', () => {
  const r = parse('');
  assert.strictEqual(r.page, 'canvas');
  assert.strictEqual(r.view, 'overview');
  assert.strictEqual(r.scene, '');
  assert.strictEqual(r.shot, 0);
  assert.strictEqual(r.sel, '');
  assert.strictEqual(r.logsHint, false);
});

test('非法 page 归一为 canvas,合法九页全通过', () => {
  assert.strictEqual(parse('page=hack').page, 'canvas');
  for (const p of [
    'canvas',
    'script',
    'chars',
    'storyboard',
    'clips',
    'voice',
    'film',
    'cover',
    'story',
  ]) {
    assert.strictEqual(parse('page=' + p).page, p);
  }
});

test('view=shots 保留(画布镜头层)', () => {
  assert.strictEqual(parse('view=shots').view, 'shots');
  assert.strictEqual(parse('view=other').view, 'overview');
});

test('旧参数归一:sel=idea|chars|film → script|chars|film', () => {
  assert.strictEqual(parse('sel=idea').page, 'script');
  assert.strictEqual(parse('sel=chars').page, 'chars');
  assert.strictEqual(parse('sel=film').page, 'film');
});

test('旧参数归一:sel=panels → storyboard;clips/voice/cover 同名页', () => {
  assert.strictEqual(parse('sel=panels').page, 'storyboard');
  assert.strictEqual(parse('sel=clips').page, 'clips');
  assert.strictEqual(parse('sel=voice').page, 'voice');
  assert.strictEqual(parse('sel=cover').page, 'cover');
});

test('旧参数归一:overlay=story → page=story;drawer=logs → logsHint', () => {
  assert.strictEqual(parse('overlay=story').page, 'story');
  const r = parse('drawer=logs');
  assert.strictEqual(r.page, 'canvas');
  assert.strictEqual(r.logsHint, true);
});

test('旧参数归一:view=shots → page=canvas&view=shots', () => {
  const r = parse('view=shots&scene=sc9');
  assert.strictEqual(r.page, 'canvas');
  assert.strictEqual(r.view, 'shots');
  assert.strictEqual(r.scene, 'sc9');
});

test('旧参数归一仅在无 page 参数时生效(page 优先)', () => {
  const r = parse('page=film&sel=idea');
  assert.strictEqual(r.page, 'film');
  assert.strictEqual(r.sel, 'idea'); /* sel 原样读出,宿主只在 canvas 页使用 */
});

test('shot 非数字/0/负数 → 丢弃(0)', () => {
  assert.strictEqual(parse('shot=abc').shot, 0);
  assert.strictEqual(parse('shot=0').shot, 0);
  assert.strictEqual(parse('shot=-3').shot, 0);
  assert.strictEqual(parse('shot=7').shot, 7);
});

test('flowRouteTo:page=canvas 不写 page 参数,sel 仅 canvas 页写', () => {
  assert.strictEqual(flowRouteTo('p1', { page: 'canvas' }), '/project/p1');
  assert.strictEqual(
    flowRouteTo('p1', { page: 'canvas', sel: 'shot:sc1:2' }),
    '/project/p1?sel=shot%3Asc1%3A2',
  );
  assert.strictEqual(
    flowRouteTo('p1', { page: 'script', sel: 'idea' }),
    '/project/p1?page=script',
  );
});

test('flowRouteTo:空值不序列化,子参齐全', () => {
  assert.strictEqual(flowRouteTo('p1', {}), '/project/p1');
  assert.strictEqual(
    flowRouteTo('p1', { page: 'storyboard', scene: 'sc1', shot: 3 }),
    '/project/p1?page=storyboard&scene=sc1&shot=3',
  );
  assert.strictEqual(
    flowRouteTo('p1', { page: 'canvas', view: 'shots', scene: 'sc2' }),
    '/project/p1?view=shots&scene=sc2',
  );
});

test('flowRouteTo ↔ parse 往返一致', () => {
  const states = [
    { page: 'canvas', sel: 'idea' },
    { page: 'storyboard', scene: 'sc1' },
    { page: 'storyboard', scene: 'sc1', shot: 4 },
    { page: 'film' },
    { page: 'canvas', view: 'shots', scene: 'sc2' },
  ];
  for (const st of states) {
    const url = flowRouteTo('p1', st);
    const q = new URL(url, 'https://x.local').searchParams;
    const r = parseFlowQuery(q);
    assert.strictEqual(r.page, st.page);
    assert.strictEqual(r.view, st.view || 'overview');
    assert.strictEqual(r.scene, st.scene || '');
    assert.strictEqual(r.shot, st.shot || 0);
    assert.strictEqual(r.sel, st.sel || '');
  }
});

test('pageForNode:八总览节点映射', () => {
  assert.deepStrictEqual(pageForNode({ id: 'idea' }), { page: 'script' });
  assert.deepStrictEqual(pageForNode({ id: 'chars' }), { page: 'chars' });
  assert.deepStrictEqual(pageForNode({ id: 'panels' }), { page: 'storyboard' });
  assert.deepStrictEqual(pageForNode({ id: 'clips' }), { page: 'clips' });
  assert.deepStrictEqual(pageForNode({ id: 'voice' }), { page: 'voice' });
  assert.deepStrictEqual(pageForNode({ id: 'film' }), { page: 'film' });
  assert.deepStrictEqual(pageForNode({ id: 'cover' }), { page: 'cover' });
  assert.deepStrictEqual(pageForNode({ id: 'story' }), { page: 'story' });
});

test('pageForNode:scene → 分镜页定位 tab;shot → 镜头页', () => {
  assert.deepStrictEqual(
    pageForNode({ id: 'scene:sc1', kind: 'scene', sceneId: 'sc1' }),
    {
      page: 'storyboard',
      scene: 'sc1',
    },
  );
  assert.deepStrictEqual(
    pageForNode({ id: 'shot:sc1:3', kind: 'shot', sceneId: 'sc1', idx: 3 }),
    { page: 'storyboard', scene: 'sc1', shot: 3 },
  );
});

test('pageForNode:未知节点 → null', () => {
  assert.strictEqual(pageForNode(null), null);
  assert.strictEqual(pageForNode({}), null);
  assert.strictEqual(pageForNode({ id: 'mystery' }), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/flow-route.test.js`
Expected: FAIL —— `Cannot find module '../public/flow-route'`(模块不存在,属于正确的失败原因)。

- [ ] **Step 3: 最小实现**(写入文件时引号按 .prettierrc;public/ 约定双引号)

创建 `public/flow-route.js`:

```js
'use strict';
/* flow-route — 工作台路由纯函数:URL query ↔ 页面状态。
   新 URL:/project/<id>?page=<page>&<子参>
   page ∈ canvas|script|chars|storyboard|clips|voice|film|cover|story(缺省 canvas)
   子参:view=shots(画布镜头层) · scene=<id>(分镜 tab/镜头层过滤) · shot=<idx>(镜头页)
   sel=<nodeId>:画布选中,仅 page=canvas 时序列化;parse 原样读出供画布恢复高亮
   兼容映射(仅当 URL 无 page 参数时生效,书签不失效):
     sel=idea|chars|film → script|chars|film;sel=panels→storyboard;sel=clips/voice/cover 同名页
     overlay=story → page=story;drawer=logs → logsHint:true(宿主一次性开日志抽屉)
   非法 page → canvas;shot 非数字 → 丢弃(0)。 */

const PAGES = [
  'canvas',
  'script',
  'chars',
  'storyboard',
  'clips',
  'voice',
  'film',
  'cover',
  'story',
];

const SEL_PAGE_MAP = {
  idea: 'script',
  chars: 'chars',
  film: 'film',
  panels: 'storyboard',
  clips: 'clips',
  voice: 'voice',
  cover: 'cover',
};

function parseFlowQuery(q) {
  let page = q.get('page') || '';
  if (!page) {
    if (q.get('overlay') === 'story') page = 'story';
    else {
      const sel = q.get('sel') || '';
      if (SEL_PAGE_MAP[sel]) page = SEL_PAGE_MAP[sel];
    }
  }
  if (!PAGES.includes(page)) page = 'canvas';
  const shot = parseInt(q.get('shot'), 10);
  return {
    page,
    view: q.get('view') === 'shots' ? 'shots' : 'overview',
    scene: q.get('scene') || '',
    shot: Number.isInteger(shot) && shot > 0 ? shot : 0,
    sel: q.get('sel') || '',
    logsHint: q.get('drawer') === 'logs',
  };
}

function flowRouteTo(projectId, state) {
  const st = state || {};
  const q = new URLSearchParams();
  if (st.page && st.page !== 'canvas') q.set('page', st.page);
  if (st.view === 'shots') q.set('view', 'shots');
  if (st.scene) q.set('scene', st.scene);
  if (st.shot) q.set('shot', String(st.shot));
  if (st.page === 'canvas' && st.sel) q.set('sel', st.sel);
  const qs = q.toString();
  return '/project/' + projectId + (qs ? '?' + qs : '');
}

function pageForNode(node) {
  if (!node || !node.id) return null;
  const overview = {
    idea: { page: 'script' },
    chars: { page: 'chars' },
    panels: { page: 'storyboard' },
    clips: { page: 'clips' },
    voice: { page: 'voice' },
    film: { page: 'film' },
    cover: { page: 'cover' },
    story: { page: 'story' },
  };
  if (overview[node.id]) return overview[node.id];
  if (node.kind === 'scene' && node.sceneId) {
    return { page: 'storyboard', scene: node.sceneId };
  }
  if (node.kind === 'shot' && node.sceneId && node.idx) {
    return { page: 'storyboard', scene: node.sceneId, shot: node.idx };
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseFlowQuery, flowRouteTo, pageForNode };
}
if (typeof window !== 'undefined') {
  window.FlowRoute = { parseFlowQuery, flowRouteTo, pageForNode };
}
```

- [ ] **Step 4: index.html 插脚本行 + 验证**

`public/index.html` 脚本区,flow.js 之后、app.js 之前插入一行,使脚本顺序为 flow-graph.js → flow.js → flow-route.js → app.js(只要求在 app.js 之前):

```html
<script src="/flow-route.js"></script>
```

Run: `node --check public/flow-route.js && node --check public/app.js`
Expected: 无输出。
Run: `node --test`
Expected: 全绿(33 旧 + 17 新 = 50/50)。

- [ ] **Step 5: 提交**

```bash
git add public/flow-route.js tests/flow-route.test.js public/index.html
git commit -m "feat: flow-route 工作台路由纯函数(新参数往返/旧书签归一/节点页映射,浏览器+Node 双导出)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 壳层先行——HTML/CSS(删抽屉/浮层,增 rail/工作页/上下文条样式)

**Files:**

- Modify: `public/index.html:31-40`(删 #fw-drawer、#fw-overlay 两块)
- Modify: `public/flow.css:316-396`(删右侧面板/成片单列补丁/全屏浮层三个样式块)、`public/flow.css:259-262`(工具条 fixed→absolute)、文件末尾追加画布页/上下文条样式
- Modify: `public/style.css`(文件末尾追加工作台样式)

**Interfaces:**

- Consumes: 无(纯 HTML/CSS;app.js 对已删 DOM 的引用全部优雅降级——`FlowUI.openPanel` 对 `#fw-drawer` 缺失是 `if (!d) return` 空操作,`syncHosts` 对 `#fw-overlay` 缺失同路,`closeTop` 逐层判空)。
- Produces: T4a/T5 消费的 CSS 类:`.wb-shell` `#rail` `.rail-item/.rail-ico/.rail-label/.rail-dot/.rail-spacer` `#page` `.workpage` `.page-head` `.sb-tabs/.sb-tab` `.shot-page`;`#fw-ctxbar`(flow.css);`.flow-canvas` 容器;`.fw-toolbar` 改为 absolute 定位。

本任务后应用**无 JS 报错但面板不再弹出**(抽屉宿主已删,openPanel 空操作)——这是过渡态,T3/T4 接管。测试仍 33/33(本任务不新增测试,行为验证在 T6 冒烟)。

- [ ] **Step 1: index.html 删除两层宿主**

删除 `#fw-drawer` 与 `#fw-overlay` 两个 div 块(现 31-40 行),保留 `#fw-logs`。改后 `<div id="modal-root"></div>` 与 `<div id="fw-logs">` 相邻:

```html
<div id="modal-root"></div>
<div id="toasts"></div>
<div id="fw-logs">
  <div class="fw-logs-head">
    <b>📜 执行日志</b><span class="fw-spacer"></span>
    <button class="fw-btn" data-act="flow-close-logs">✕ 收起</button>
  </div>
  <div class="fw-logs-body"></div>
</div>
```

- [ ] **Step 2: flow.css 删三个样式块、工具条改 absolute**

删除 316 行起的注释 `/* 右侧详情面板 */` 及其后三块(至 `#fw-overlay .fw-overlay-body` 规则结束,即原 316-396 行;`/* 底部日志抽屉 */` 注释与 `#fw-logs` 起保留)。

`.fw-toolbar` 的定位属性由 fixed 改 absolute(在 `.flow-canvas` 容器内定位,T4a 落地;旧 `.flow-shell` 同为 fixed inset 0,视觉等价):

```css
.fw-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
```

文件末尾(`@keyframes fwSlideIn` 之后)追加:

```css
/* ===== 工作台:画布页与上下文条 ===== */
.flow-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
#fw-ctxbar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 45;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(92%, 620px);
  padding: 8px 14px;
  border-radius: 14px;
  background: rgba(23, 27, 41, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid var(--line);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
#fw-ctxbar[hidden] {
  display: none;
}
#fw-ctxbar b {
  font-size: 13px;
}
```

- [ ] **Step 3: style.css 追加工作台样式**(文件末尾)

```css
/* ===== 工作台:左导航 + 全宽工作页 ===== */
.wb-shell {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  background: var(--bg);
}
#rail {
  width: 96px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  background: var(--bg2);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}
.rail-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 4px 7px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--dim);
  font-size: 11.5px;
  cursor: pointer;
}
.rail-item:hover,
.rail-item.on {
  background: var(--card2);
  color: var(--text);
}
.rail-item.on .rail-ico {
  color: var(--accent);
}
.rail-ico {
  font-size: 19px;
  line-height: 1;
}
.rail-label {
  white-space: nowrap;
}
.rail-dot {
  position: absolute;
  top: 7px;
  right: 18px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line);
}
.rail-dot.ok {
  background: var(--ok);
}
.rail-dot.run {
  background: #4a9eff;
  animation: fwPulse 1.2s ease-in-out infinite;
}
.rail-dot.err {
  background: var(--err);
}
.rail-dot.warn {
  background: var(--warn);
}
.rail-spacer {
  flex: 1;
}
#page {
  flex: 1;
  min-width: 0;
  position: relative;
  overflow-y: auto;
}
.workpage {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 22px 70px;
}
.workpage .panel-card {
  margin-bottom: 14px;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.page-head h2 {
  font-size: 17px;
  margin: 0;
}
.page-head .spacer {
  flex: 1;
}
.sb-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 12px;
}
.sb-tab {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card2);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.sb-tab small {
  color: var(--dim);
  font-size: 11px;
}
.sb-tab.on {
  border-color: var(--accent);
}
.shot-page .shot {
  max-width: 640px;
  margin: 0 auto;
}
@media (max-width: 900px) {
  #rail {
    width: 48px;
    padding: 8px 5px;
  }
  .rail-label {
    display: none;
  }
  .rail-dot {
    right: 10px;
  }
}
```

注:`fwPulse` 关键帧在 flow.css 定义,浏览器按全局名称解析,style.css 引用有效。

- [ ] **Step 4: 语法与静态验证**

Run: `node --check public/app.js && node --check public/flow.js && node --check public/flow-graph.js`
Expected: 无输出(三个文件本任务未改,确认基线)。
手动:浏览器打开本地实例项目页,确认无 console 报错(面板不再弹出属预期过渡态)。

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/flow.css public/style.css
git commit -m "refactor: 删抽屉/浮层宿主与样式,增工作台 rail/工作页/上下文条 CSS

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: app.js 路由层换血(FLOW_TAB_MAP 消亡,URL 全走 flow-route)

**Files:**

- Modify: `public/app.js`(路由区 24-68、handleRoute 91-118、create-project 1283-1287、renderLight 519、onNodeSelect 737-743、act 分支 1811-1823、keydown 1921-1929、nextStepOf 563-567 与 1586/1830、palette 键 1 于 1966)

**Interfaces:**

- Consumes: Task 1 的 `parseFlowQuery/flowRouteTo/pageForNode`(本任务只接前两个;`pageForNode` 在 T4b 接)。
- Produces: `S.flow` 新形状 `{ page, view, scene, shot, sel }`(+过渡桥字段 `overlay/drawer`,T4a 删);`flowNav(over)` 语义不变(合并进 S.flow 后 navigate)。本任务后**旧 UI 仍可用**(overlay=story 桥接 syncHosts、logs 桥接 syncHosts),URL 已是新格式。

过渡桥说明(spec §7 归一语义 + 旧宿主存续):applyFlowQuery 把 `page=story` 投影为 `S.flow.overlay="story"`、`logsHint` 投影为 `S.flow.drawer="logs"`,让 T3 阶段的 syncHosts(浮层/日志宿主)照常工作;T4a 删 syncHosts 时一并删桥。

- [ ] **Step 1: 头部路由区重写**

删除 `FLOW_TAB_MAP` 常量(app.js:25-32);`applyFlowQuery/flowUrl/flowNav`(34-68)替换为(app.js 通过 T1 挂好的 `window.FlowRoute` 全局消费路由函数;T1 已含双导出尾部,本任务在页面里确认 `window.FlowRoute` 可用即可):

**产出路径裁定(计划级):**模块最终落 **`public/flow-route.js`**,不是 `lib/`——server.js 静态服务只认 `public/`(server.js:624 `path.join(PUBLIC, file)`),零服务端改动约束下浏览器必须能直载;Node 测试 `require("../public/flow-route")` 消费同一文件。文件 = Task 1 Step 3 的实现(引号按 public 约定**双引号**,含末尾双导出尾部——`module.exports` 带 `typeof module` 守卫,浏览器直载不抛错)。

`public/index.html` 脚本区插入(顺序:flow-graph.js → flow.js → flow-route.js → app.js;只要求在 app.js 之前):

```html
<script src="/flow-route.js"></script>
```

app.js 路由区(24-68)最终替换为:

```js
/* ---------- 前端路由:URL 即状态,刷新/直达/后退不丢位置 ---------- */
const { parseFlowQuery, flowRouteTo, pageForNode } = window.FlowRoute;

function applyFlowQuery(u) {
  const r = parseFlowQuery(u.searchParams);
  S.flow = {
    page: r.page,
    view: r.view,
    scene: r.scene,
    shot: r.shot,
    sel: r.page === 'canvas' ? r.sel : '',
  };
  if (r.scene) S.sceneId = r.scene; /* 兼容仍读 S.sceneId 的生成兜底 */
  /* 过渡桥:旧宿主 syncHosts 仍读 overlay/drawer;T4 删桥 */
  S.flow.overlay = r.page === 'story' ? 'story' : '';
  S.flow.drawer = r.logsHint ? 'logs' : '';
}

function flowNav(over = {}) {
  navigate(flowRouteTo(S.project.id, { ...S.flow, ...over }));
}
```

- [ ] **Step 2: handleRoute 清理**

- 旧 tab 路径重定向块(91-99,`FLOW_TAB_MAP` 分支)整体删除;`if (seg[2])` 未知路径回落(100-101)保留。
- 反抽卡块(113-118)改为:

```js
if (!location.search && bare) {
  /* 反抽卡:全新项目直接进脉络页 */
  history.replaceState({}, '', flowRouteTo(pid, { page: 'story' }));
  applyFlowQuery(new URL(location.href));
  syncHosts();
}
```

- create-project 成功跳转(1283-1287)改为:

```js
await openProject(p.id);
navigate(
  flowRouteTo(p.id, {
    page: body.autostart ? 'canvas' : 'story',
    view: body.autostart ? 'shots' : 'overview',
  }),
);
```

- [ ] **Step 3: 既有 flowUrl 调用点全部改写**(grep `flowUrl(` 应为 0 处)

| 位置                           | 原文                                                                              | 改为                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| renderLight ~519               | `history.replaceState({}, "", flowUrl({ sel: "" }));`                             | `history.replaceState({}, "", flowRouteTo(S.project.id, S.flow));`(其上 `S.flow.sel = "";` 不动) |
| onNodeSelect ~737              | `history.replaceState({}, "", flowUrl({ sel: "" }));`                             | 同上写法(其上 `S.flow.sel = "";` 不动)                                                           |
| onNodeSelect ~742-743          | `S.flow.sel = id;`<br>`history.replaceState({}, "", flowUrl({ sel: id }));`       | `S.flow.sel = id;`<br>`history.replaceState({}, "", flowRouteTo(S.project.id, S.flow));`         |
| act flow-close-logs ~1822-1823 | `S.flow.drawer = "";`<br>`history.replaceState({}, "", flowUrl({ drawer: "" }));` | 保留第一行,第二行改 `history.replaceState({}, "", flowRouteTo(S.project.id, S.flow));`           |
| keydown Esc ~1929              | `if (closedHost) history.replaceState({}, "", flowUrl({}));`                      | `if (closedHost) history.replaceState({}, "", flowRouteTo(S.project.id, S.flow));`               |

- [ ] **Step 4: 死分支与旧参调用点清理**

- act 分支 `flow-close-panel`(1811-1815)与 `flow-close-overlay`(1816-1819)整体删除(其按钮宿主已在 T2 删)。
- nextStepOf 的 goto(563-567)改为:

```js
const goto = (t) => () => {
  if (t === 'script') return flowNav({ page: 'script' });
  if (t === 'shots') return flowNav({ view: 'shots' });
  flowNav({ page: 'story' });
};
```

- 1586 行 `flowNav({ overlay: "story" })` → `flowNav({ page: "story" })`;1830 行 `flow-open-story` 分支内同改。
- palette 快捷键 1(1966)`flowNav({ view: "overview", sel: "" })` → `flowNav({ page: "canvas" })`。
- keydown Esc 的 overlay 重复行(1926-1927 两行相同)删一行,保留 `else if (closedHost === "overlay") S.flow.overlay = "";`(桥字段仍被 syncHosts 读,Esc 关浮层需清桥)。

- [ ] **Step 5: 验证**

Run: `grep -n "flowUrl\|FLOW_TAB_MAP" public/app.js`
Expected: 无输出。
Run: `node --check public/app.js && node --check public/flow-route.js`
Expected: 无输出。
Run: `node --test`
Expected: 全绿(50/50,flow-route 测试 require 路径已指向 public/)。
手动冒烟(本地实例):打开项目 → URL `?page=...` 格式;旧书签 `/project/<id>?sel=idea` 打开落到剧本内容(过渡态在画布页内嵌?否——过渡态下 `page=script` 无宿主,**预期表现:URL 归一成功、主区为旧画布且无报错**;完整页面在 T4a 亮出)。

- [ ] **Step 6: 提交**

```bash
git add public/app.js public/flow-route.js tests/flow-route.test.js public/index.html
git commit -m "refactor: 路由层切换 flow-route(FLOW_TAB_MAP 消亡,S.flow 改 page 五参)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4a: 工作台壳与页面分派(rail + renderCurrentPage + SSE 刷新策略)

**Files:**

- Modify: `public/app.js`(renderProject 663-673、renderLight 492-523、toolbarHtml 尾 700-703、handleRoute 同项目分支 103-107、applyFlowQuery 桥、keydown Esc、syncHosts 删、act 增 rail-go/flow-close-logs 简化)

**Interfaces:**

- Consumes: `flowRouteTo`(T3)、`parseFlowQuery`(T3)。
- Produces(T4b/T5 消费):`renderCurrentPage()`(读 `S.flow.page/scene/shot` 分派;canvas 走 `renderCanvasPage()`);`renderCanvasPage()`(挂 `#fw-toolbar`/`#flow-root`/`#fw-ctxbar`);`railHtml(p)`/`syncRail(p)`/`railLight(page,p)`/`stageLight(statuses,total)`;`FORM_PAGES` 常量;`S._syncSeq`/`S._pageSeq` 刷新序号协议;`refreshCurrentPage()`。

- [ ] **Step 1: rail 渲染三件套**(放在 `renderProject` 前)

```js
/* ---------- 工作台:左导航(状态灯取数见 spec §3) ---------- */
const RAIL_PAGES = [
  { page: 'canvas', icon: '🗺', label: '画布' },
  { page: 'script', icon: '📜', label: '剧本' },
  { page: 'chars', icon: '👥', label: '角色' },
  { page: 'storyboard', icon: '🎞', label: '分镜' },
  { page: 'clips', icon: '🎬', label: '片段' },
  { page: 'voice', icon: '🎙', label: '配音' },
  { page: 'film', icon: '🎞', label: '成片' },
  { page: 'cover', icon: '🖼', label: '封面' },
];

function stageLight(statuses, total) {
  if (!total) return 'none';
  const st = statuses.filter(Boolean);
  if (st.includes('error')) return 'err';
  if (st.includes('pending') || st.includes('run')) return 'run';
  return st.length === total && st.every((s) => s === 'done') ? 'ok' : 'warn';
}

function railLight(page, p) {
  const shots = p.shots || [];
  if (page === 'script') {
    if (p.running === 'storyboard')
      return 'run'; /* 分镜脚本(含故事骨架)生成中 */
    return ((p.story || {}).arcs || []).length ? 'ok' : 'none';
  }
  if (page === 'chars') {
    const cs = p.characters || [];
    return cs.length ? (cs.some((c) => !c.refUrl) ? 'warn' : 'ok') : 'none';
  }
  if (page === 'storyboard') {
    return stageLight(
      shots.map((s) => s.panelStatus),
      shots.length,
    );
  }
  if (page === 'clips') {
    return stageLight(
      shots.map((s) => s.clipStatus),
      shots.length,
    );
  }
  if (page === 'voice') {
    if (!shots.length) return 'none';
    if (shots.some((s) => s.voiceStatus === 'pending')) return 'run';
    return shots.some((s) => (s.dialogue || '').trim() && !s.audioUrl)
      ? 'warn'
      : 'ok';
  }
  if (page === 'film') {
    if (p.filmUrl) return 'ok';
    if (p.running === 'film') return 'run';
    if (p.lastError) return 'err';
    return 'none';
  }
  if (page === 'cover') {
    if (p.coverImageUrl) return 'ok';
    if (p.running === 'cover') return 'run';
    return 'none';
  }
  return ''; /* canvas 无灯 */
}

function railHtml(p) {
  const items = RAIL_PAGES.map(
    (r) => `
    <button class="rail-item ${S.flow.page === r.page ? 'on' : ''}" data-act="rail-go" data-page="${r.page}" title="${r.label}">
      <span class="rail-ico">${r.icon}</span><span class="rail-label">${r.label}</span>
      ${r.page === 'canvas' ? '' : `<i class="rail-dot ${railLight(r.page, p)}" data-light="${r.page}"></i>`}
    </button>`,
  ).join('');
  return (
    items +
    `<div class="rail-spacer"></div>
    <button class="rail-item" data-act="open-settings" title="设置"><span class="rail-ico">⚙</span><span class="rail-label">设置</span></button>
    <button class="rail-item" data-act="flow-logs" title="执行日志"><span class="rail-ico">📜</span><span class="rail-label">日志</span></button>
    <button class="rail-item" data-act="flow-fullscreen" title="浏览器全屏"><span class="rail-ico">⛶</span><span class="rail-label">全屏</span></button>`
  );
}

/* SSE 每次同步调用:只改 class,不重建 rail DOM */
function syncRail(p) {
  for (const r of RAIL_PAGES) {
    const dot = document.querySelector(`.rail-dot[data-light="${r.page}"]`);
    if (dot) dot.className = 'rail-dot ' + railLight(r.page, p);
  }
  document
    .querySelectorAll('#rail .rail-item[data-page]')
    .forEach((b) => b.classList.toggle('on', b.dataset.page === S.flow.page));
}
```

裁定记录(计划内):script 灯的「出错=红」用项目级 `p.lastError`(服务端不记阶段,粗信号,可接受);storyboard/clips 灯对「有镜头但未生成」回落 warn(黄)——spec 表未列,复用其调色板。story 页加入表单类守卫(spec §6.3 未列,但 renderStory 全是输入框,属守卫意图内)。

- [ ] **Step 2: renderProject 拆壳 + renderCurrentPage/refreshCurrentPage**

`renderProject`(663-673)替换为:

```js
function renderProject() {
  const p = S.project;
  S._ns = nextStepOf(p);
  app().innerHTML = `
  <div class="wb-shell">
    <nav id="rail" aria-label="工作台导航">${railHtml(p)}</nav>
    <main id="page"></main>
  </div>`;
  if (S._logsHint) {
    S._logsHint = false;
    FlowUI.openLogs(logsHtml());
  }
  renderCurrentPage();
}

/* 九页分派;整块替换只发生在页面切换时(spec §6.5) */
const FORM_PAGES = ['script', 'chars', 'film', 'cover', 'story'];

function renderCurrentPage() {
  const host = $('#page');
  if (!host) return;
  S._pageSeq = S._syncSeq || 0;
  const f = S.flow;
  if (f.page === 'canvas') return renderCanvasPage();
  let html = '';
  if (f.page === 'script') html = renderScript();
  else if (f.page === 'chars') html = renderChars();
  else if (f.page === 'storyboard')
    html = f.shot ? '' : panelsPanel(); /* 过渡:真分镜页在 T5 落地 */
  else if (f.page === 'clips') html = clipsPanel();
  else if (f.page === 'voice') html = voicePanel();
  else if (f.page === 'film') html = renderFilm();
  else if (f.page === 'cover') html = coverPanel();
  else if (f.page === 'story') html = renderStory();
  host.innerHTML = `<div class="workpage">${html}</div>`;
  host.scrollTop = 0;
}

/* SSE 增量:表单页焦点中或数据未变 → 跳过整块重渲(spec §6.3) */
function refreshCurrentPage() {
  const host = $('#page');
  if (!host) return;
  const editing =
    host.contains(document.activeElement) &&
    document.activeElement.matches('input, textarea, select');
  const formish =
    FORM_PAGES.includes(S.flow.page) ||
    (S.flow.page === 'storyboard' && S.flow.shot);
  if (formish && (editing || S._pageSeq === S._syncSeq)) return;
  renderCurrentPage();
}

function renderCanvasPage() {
  const host = $('#page');
  if (!host) return;
  host.innerHTML = `
  <div class="flow-canvas">
    <div class="fw-toolbar" id="fw-toolbar">${toolbarHtml(S.project)}</div>
    <div id="flow-root"></div>
    <div id="fw-ctxbar" hidden></div>
  </div>`;
  mountFlow();
}
```

- [ ] **Step 3: renderLight 改造(SSE 增量入口)**

`renderLight`(492-523)整体替换为:

```js
/* SSE 高频路径:状态灯必更;画布页补丁;其余页按守卫重渲 */
function renderLight() {
  const p = S.project;
  S._ns = nextStepOf(p);
  updateToolbar();
  syncRail(p);
  if (S.flow.page === 'canvas') {
    try {
      S._graph = buildGraph(p, S.settings, S.flow.view);
      Flow.patch(S._graph);
    } catch (e) {
      console.error('buildGraph failed', e);
      toast('画布构图异常:' + e.message + ',可点工具条 🧹 重置布局', 'err');
      return;
    }
    if (
      S.flow.sel &&
      !(S._graph.nodes || []).some((x) => x.id === S.flow.sel)
    ) {
      /* 选中节点已被删除:清选中与 URL 参数(人工冒烟第 6 条) */
      S.flow.sel = '';
      Flow.select(null);
      history.replaceState({}, '', flowRouteTo(p.id, S.flow));
    }
    return;
  }
  S._syncSeq = (S._syncSeq || 0) + 1;
  refreshCurrentPage();
}
```

- [ ] **Step 4: 周边接线**

- `handleRoute` 同项目分支(103-107)改为壳感知(页内切换不重建壳):

```js
if (S.project && S.project.id === pid) {
  S.view = 'project';
  if (document.getElementById('rail')) {
    syncRail(S.project);
    renderCurrentPage();
  } else render();
  return;
}
```

- `applyFlowQuery` 里 T3 的两行桥字段(`S.flow.overlay = ...`、`S.flow.drawer = ...`)替换为:

```js
if (r.logsHint) S._logsHint = true; /* 宿主 renderProject 一次性开日志抽屉 */
```

- `syncHosts`(778-792)整体删除(反抽卡块内的 `syncHosts();` 调用一并删;浮层消亡,story 转正为页)。
- `toolbarHtml` 尾部(700-703)删掉 `📜`(flow-logs)、`⚙`(open-settings)、`⛶`(flow-fullscreen)三个按钮——已上 rail;保留 `#fw-conn` 与 🧹。
- keydown Esc(1917-1931)替换为:

```js
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    closePalette();
    if (S.view !== "project" || !S.flow) return;
    const l = document.getElementById("fw-logs");
    if (l && l.classList.contains("open")) {
      FlowUI.closeLogs();
      return; /* 日志抽屉不占页栈:单独收起 */
    }
    if (S.flow.page === "storyboard" && S.flow.shot) {
      flowNav({ shot: 0 }); /* 镜头页 → 分镜页 */
    } else if (S.flow.page !== "canvas") {
      flowNav({ page: "canvas" }); /* 其余页 → 画布 */
    } else if (S.flow.sel) {
      Flow.select(null);
      S.flow.sel = "";
      history.replaceState({}, "", flowRouteTo(S.project.id, S.flow));
    }
    return;
  }
```

(其后 Ctrl/Cmd+K 与快捷键区块原样保留。)

- act 分支新增(rail-go;放在 `open-settings` 分支旁):

```js
    } else if (act === "rail-go") {
      flowNav({ page: el.dataset.page, shot: 0, sel: "" });
```

- [ ] **Step 5: 验证**

Run: `grep -n "syncHosts\|fw-overlay\|fw-drawer" public/app.js public/flow.js`
Expected: 无输出(app.js 侧;flow.js 的 openPanel/openOverlay 方法本体 T4b 删,此处 grep 排除 flow.js 时应无输出——如 flow.js 命中属预期,仅确认 app.js 无)。
Run: `node --check public/app.js`
Expected: 无输出。
Run: `node --test`
Expected: 50/50。
手动冒烟(本地实例):项目页出 rail;九页可点切换(script/chars/clips/voice/film/cover/story 全宽渲染;storyboard 显示过渡的进度面板;画布页工具条/画布正常);story 页直接渲染(非浮层);SSE 灯随生成变化;Esc 从 story 页回画布。

- [ ] **Step 6: 提交**

```bash
git add public/app.js
git commit -m "feat: 工作台壳——左导航状态灯 + renderCurrentPage 九页分派 + SSE 守卫刷新

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4b: 画布交互定稿(单击仅选中 + 上下文条 + 双击进页 + FlowUI 清理)

**Files:**

- Modify: `public/app.js`(onNodeSelect/onNodeOpen 730-757、rebuildGraph 769-775、renderLight canvas 分支、flowPanelFor 953-964 与 shotPanel 794-814、storyPanel 842-867 删除、act ctx-open 增 / flow-sel-shot 删)
- Modify: `public/flow.js`(FlowUI 删 openPanel/closePanel/openOverlay/closeOverlay/closeTop 313-345,头注释 2-5)

**Interfaces:**

- Consumes: T1 `pageForNode`;T4a `renderCanvasPage`(已含 `#fw-ctxbar` 容器)。
- Produces: `updateCtxbar()`/`statusWord(n)`;onNodeSelect(id)/onNodeOpen(id) 新语义(id 为空 = 点空白)。

- [ ] **Step 1: onNodeSelect/onNodeOpen 重写**

```js
/* 节点交互:单击仅选中(底部上下文条),双击进对应工作页(spec §5.1/§10) */
function onNodeSelect(id) {
  S.flow.sel = id || '';
  updateCtxbar();
  if (S.flow.page !== 'canvas') return; /* 非画布页不写选中态 */
  history.replaceState({}, '', flowRouteTo(S.project.id, S.flow));
}

function onNodeOpen(id) {
  const n = (S._graph.nodes || []).find((x) => x.id === id);
  if (!n) return;
  if (n.kind === 'scene') {
    /* spec §10:双击 scene 保留画布内镜头层视图;进分镜页走上下文条 */
    flowNav({ view: 'shots', scene: n.sceneId, sel: '' });
    return;
  }
  const t = pageForNode(n);
  if (t) flowNav({ ...t, shot: t.shot || 0, sel: '' });
}

function statusWord(n) {
  return (
    {
      pending: '待处理',
      run: '生成中',
      done: '已完成',
      error: '出错',
      skip: '已跳过',
    }[n.status] || ''
  );
}

function updateCtxbar() {
  const bar = document.getElementById('fw-ctxbar');
  if (!bar) return;
  const n = S.flow.sel
    ? (S._graph.nodes || []).find((x) => x.id === S.flow.sel)
    : null;
  if (!n) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  const tgt = pageForNode(n);
  bar.innerHTML = `<span class="rail-ico">${n.icon || '🎬'}</span>
    <b>${esc(n.title || (n.kind === 'shot' ? '第 ' + n.idx + ' 镜' : ''))}</b>
    <span class="hint">${statusWord(n)}</span>
    ${tgt ? '<button class="fw-btn primary" data-act="ctx-open">打开 →</button>' : ''}`;
  bar.hidden = false;
}
```

- [ ] **Step 2: rebuildGraph 与 renderLight canvas 分支收尾**

rebuildGraph 的 sel 块(769-775)改为:

```js
if (S.flow.sel && (S._graph.nodes || []).some((x) => x.id === S.flow.sel))
  Flow.select(S.flow.sel);
updateCtxbar();
```

renderLight canvas 分支在「选中节点已删」清理块之后、`return;` 之前插入一行 `updateCtxbar();`。

- [ ] **Step 3: 死代码删除**

- `flowPanelFor`(953-964)、`shotPanel`(794-814)、`storyPanel`(842-867)三个函数整体删除(scenePanel 保留,T5 改签名复用)。
- act 分支 `flow-sel-shot`(1831-1838)删除;新增 `ctx-open`:

```js
    } else if (act === "ctx-open") {
      const n = (S._graph.nodes || []).find((x) => x.id === S.flow.sel);
      const t = n && pageForNode(n);
      if (t) flowNav({ ...t, shot: t.shot || 0, sel: "" });
```

- [ ] **Step 4: flow.js 删面板/浮层方法**

FlowUI(313-352)替换为:

```js
const FlowUI = {
  openLogs(html) {
    const l = document.getElementById('fw-logs');
    if (!l) return;
    const b = l.querySelector('.fw-logs-body');
    b.innerHTML = html;
    l.classList.add('open');
    b.scrollTop = b.scrollHeight;
  },
  closeLogs() {
    const l = document.getElementById('fw-logs');
    if (l) l.classList.remove('open');
  },
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast('浏览器拒绝了全屏请求', 'err');
    }
  },
};
```

头注释(2-5 行)中 `+ 详情面板 / 全屏浮层 / 日志抽屉 / 真全屏切换` 改为 `+ 日志抽屉 / 真全屏切换`。

- [ ] **Step 5: 验证**

Run: `grep -n "openPanel\|closePanel\|openOverlay\|closeOverlay\|closeTop\|flowPanelFor\|shotPanel\|storyPanel" public/app.js public/flow.js`
Expected: 无输出(scenePanel 命中属预期——grep 词选 openPanel 等精确词,不含 scenePanel)。
Run: `node --check public/app.js && node --check public/flow.js && node --test`
Expected: check 无输出;测试 50/50。
手动冒烟:画布单击节点仅高亮+底部上下文条(不弹任何面板);上下文条「打开 →」进对应页;双击 scene 切画布镜头层、双击 idea 进剧本页;点空白上下文条消失;Esc 清选中。

- [ ] **Step 6: 提交**

```bash
git add public/app.js public/flow.js
git commit -m "feat: 画布单击仅选中+上下文条,双击/打开进工作页;FlowUI 删面板浮层

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 分镜页与镜头子页(scene tab、上一镜/下一镜、film 双列恢复)

**Files:**

- Modify: `public/app.js`(scenePanel 816-840 签名改造、renderCurrentPage storyboard 分派、新 renderStoryboard/renderShotPage、panelsPanel 869-885 删除、act goto-scene 1717-1719 改、新增 sb-tab/open-shot/shot-nav/page-back、renderShotCard 卡片可点)
- 无 CSS 改动(T2 已备 `.sb-tabs/.shot-page/.page-head`)

**Interfaces:**

- Consumes: T4a `renderCurrentPage`(storyboard 分派占位行替换);T1 `pageForNode` 不直接用(分派走 S.flow)。
- Produces: `renderStoryboard()`/`renderShotPage()`;`scenePanel(sc)`(入参从图节点改为场景对象);acts `sb-tab`/`open-shot`/`shot-nav`/`page-back`。

- [ ] **Step 1: scenePanel 签名改造**(816-840)

函数头两行替换(`sc` 由 find 改为入参):

```js
function scenePanel(sc) {
  const p = S.project;
  const list = (p.shots || [])
    .filter((s) => s.sceneId === sc.id)
    .sort((a, b) => a.idx - b.idx);
```

函数体其余不变(引用 `sc.id/sc.title/...` 处原样)。

- [ ] **Step 2: renderStoryboard + renderShotPage**(放在 scenePanel 后)

```js
function renderStoryboard() {
  const p = S.project;
  const scenes = p.scenes || [];
  if (!S.flow.scene || !scenes.some((s) => s.id === S.flow.scene))
    S.flow.scene = scenes[0] ? scenes[0].id : '';
  const cur = scenes.find((s) => s.id === S.flow.scene) || null;
  const tabs = scenes
    .map((sc) => {
      const st = sc.stats || {};
      return `<button class="sb-tab ${sc.id === S.flow.scene ? 'on' : ''}" data-act="sb-tab" data-scene-id="${sc.id}">
        <b>${esc(sc.title)}${sc.locked ? ' 🔒' : ''}</b>
        <small>图${st.panels || 0}/${st.shots || 0} · 片${st.clips || 0}/${st.shots || 0} · 音${st.voices || 0}/${st.shots || 0}</small>
      </button>`;
    })
    .join('');
  return `<div class="page-head">
      <h2>🎞 分镜</h2>
      <span class="hint">${scenes.length ? `共 ${scenes.length} 个场景` : ''}</span>
    </div>
    <div class="sb-tabs">${
      tabs ||
      '<span class="empty-inline">还没有场景:到「剧本」页生成分镜脚本,或在「脉络」页拆场景</span>'
    }</div>
    ${cur ? scenePanel(cur) : ''}`;
}

function renderShotPage() {
  const p = S.project;
  const sceneId = S.flow.scene;
  const idx = S.flow.shot;
  const sh = (p.shots || []).find(
    (s) => s.idx === idx && s.sceneId === sceneId,
  );
  const sc = (p.scenes || []).find((s) => s.id === sceneId);
  const siblings = (p.shots || [])
    .filter((s) => s.sceneId === sceneId)
    .map((s) => s.idx)
    .sort((a, b) => a - b);
  const i = siblings.indexOf(idx);
  const prev = siblings[i - 1],
    next = siblings[i + 1];
  return `<div class="page-head">
      <button class="btn small" data-act="page-back">← 返回分镜</button>
      <h2>第 ${idx} 镜</h2>
      <span class="hint">${esc(sc ? sc.title : sceneId)}${sc && sc.locked ? ' 🔒' : ''}</span>
      <div class="spacer"></div>
      ${prev ? `<button class="btn small" data-act="shot-nav" data-scene-id="${sceneId}" data-idx="${prev}">← 上一镜</button>` : '<span></span>'}
      ${next ? `<button class="btn small" data-act="shot-nav" data-scene-id="${sceneId}" data-idx="${next}">下一镜 →</button>` : ''}
    </div>
    <div class="shot-page">${sh ? renderShotCard(sh) : '<div class="empty">该镜头不存在</div>'}</div>`;
}
```

- [ ] **Step 3: 分派替换 + 死代码删除**

- `renderCurrentPage` 的 storyboard 行(过渡占位)替换为:

```js
  else if (f.page === "storyboard") {
    /* URL 指向不存在的 shot/scene → 回落分镜页全场景视图,不报错(spec §10) */
    const ok =
      f.shot &&
      (p.shots || []).some((s) => s.idx === f.shot && s.sceneId === f.scene);
    html = ok ? renderShotPage() : renderStoryboard();
  }
```

(注意 `renderCurrentPage` 此处需 `const p = S.project;` 在分派前取好;T4a 版本无 p,补一行。)

- `panelsPanel`(869-885)整体删除。
- act `goto-scene`(1717-1719)改为进分镜页:

```js
    } else if (act === "goto-scene") {
      flowNav({ page: "storyboard", scene: el.dataset.sceneId, shot: 0, sel: "" });
```

- act `flow-open-story` 分支删除(storyPanel 已亡,无产出方)。
- 新增四个 act(放在 goto-scene 旁):

```js
    } else if (act === "sb-tab") {
      flowNav({ page: "storyboard", scene: el.dataset.sceneId, shot: 0, sel: "" });
    } else if (act === "page-back") {
      flowNav({ shot: 0 });
    } else if (act === "shot-nav") {
      flowNav({
        page: "storyboard",
        scene: el.dataset.sceneId || S.flow.scene,
        shot: Number(el.dataset.idx),
        sel: "",
      });
    } else if (act === "open-shot") {
      if (e.target.closest("input, textarea, select")) return; /* 卡内编辑不打断 */
      flowNav({
        page: "storyboard",
        scene: el.dataset.sceneId,
        shot: Number(el.dataset.idx),
        sel: "",
      });
```

- [ ] **Step 4: 镜头卡可点**(renderShotCard ~977)

卡片根 div 加 data-act:

```js
  return `<div class="shot" data-act="open-shot" data-scene-id="${sh.sceneId}" data-idx="${sh.idx}">
```

(卡内 textarea/select/按钮各有自身控件或 data-act,`open-shot` 分支的 input/textarea/select 守卫拦编辑点击;`img/video` 与各按钮的 data-act 更近,closest 命中它们,不受影响。)

- [ ] **Step 5: 验证**

Run: `grep -n "panelsPanel" public/app.js`
Expected: 无输出。
Run: `node --check public/app.js && node --test`
Expected: check 无输出;50/50。
手动冒烟:分镜页场景 tab 切换、tab 上进度微标正确;镜头卡点击 → 镜头页大卡;上一镜/下一镜循环到场景首尾即隐藏;Esc:镜头页→分镜页→画布;URL 直接输 `?page=storyboard&scene=<id>&shot=999` 回落分镜页;成片页双列布局(视频列 + 设置/成本列);剧本页 story2col 双栏展开。

- [ ] **Step 6: 提交**

```bash
git add public/app.js
git commit -m "feat: 分镜工作页(场景 tab+镜头网格)与镜头子页(上一镜/下一镜);goto-scene 改进分镜页

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 文档、回归与 QA 冒烟

**Files:**

- Modify: `README.md`(交互说明:抽屉 → 工作台)
- Create: 无新测试(T1 已带;本任务是回归 + 人工冒烟门)

**Interfaces:** 无(收尾任务)。

- [ ] **Step 1: README 交互段更新**

找到 README 中描述右侧抽屉/面板的段落(grep `抽屉`),改为工作台描述:

```markdown
### 工作台交互(2026-10)

编辑界面为工作台模型:左侧导航栏(画布/剧本/角色/分镜/片段/配音/成片/封面,带实时状态灯)+ 全宽工作页。
画布单击节点仅选中并浮出底部上下文条,「打开 →」或双击进入对应工作页;画布双击场景键切镜头层。
URL `?page=<页>` 可直达/刷新/分享(旧 `?sel=`/`?overlay=story`/`?drawer=logs` 书签自动归一)。
Esc:镜头页→分镜页→画布;日志抽屉开着先收日志。
```

(保持 README 既有标题层级与语气,融进对应小节,不整段重写。)

- [ ] **Step 2: 静态与单测全绿**

Run: `for f in public/*.js; do node --check "$f" || exit 1; done`
Expected: 无输出。(若 Task 1 执行时 flow-route 落在 public/,按实际路径检查。)
Run: `node --test`
Expected: 50/50 全绿。

- [ ] **Step 3: QA 冒烟(临时实例,QA 协议)**

启动临时实例(**不得触碰 8787 生产实例与其 data/**):

```bash
PORT=8899 nohup node server.js > /tmp/manju-qa-8899.log 2>&1 &
```

浏览器打开 `http://localhost:8899`,新建临时项目,逐条执行并记录:

1. 切页显式性:画布单击节点**不弹面板**,仅高亮+底部上下文条;「打开 →」/双击进对应页。
2. 九页布局:成片双列(视频列+BGM/合成设置/成本列)、剧本双栏、角色网格、片段/配音/封面/脉络全宽。
3. 分镜页:场景 tab 切换;镜头卡 → 镜头页;上一镜/下一镜;← 返回。
4. Esc 栈:镜头页→分镜页→画布;其余页→画布;日志开着先收日志。
5. SSE 守卫:分镜页某镜头触发生成,另一标签同项目打开剧本页并在 textarea 输入,等待同步——输入不丢、rail 灯变化。
6. 选中节点删除容错:画布选中一个镜头,另一标签删除该场景 → 当前画布不报错、选中清除、URL sel 消失。
7. 窄屏:窗口缩到 <900px,rail 收窄为图标,无横向滚动。
8. 旧书签:`/project/<临时id>?sel=idea`、`?overlay=story`、`?drawer=logs`、`?view=shots` 逐个打开,分别落到剧本/脉络/画布+日志/画布镜头层。
9. 刷新恢复:停在成片页按 F5,仍在成片页。
10. 上下文条打开分镜页定位:画布双击镜头 → 镜头页对准该镜;scene 节点上下文条「打开」→ 分镜页对准该场景 tab。

清理:

```bash
kill %1; rm -rf data-qatmp 2>/dev/null; git status --porcelain
```

(临时项目建于 8899 实例自身 data/;确认 `git status` 干净——data/ 已 gitignore。)

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: README 工作台交互说明(左导航+全宽工作页+URL 直达)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 执行注意事项(给实施者)

- **prettier 钩子**:首次 Edit 某文件后整文件可能被重排,后续 Edit 的 old_string 失配时先 `grep -n` 重新定位,不要盲改。
- **计划内 md 代码块引号不可信**:`.prettierrc` 无 `*.md` 覆盖,PostToolUse 钩子会把计划里嵌入的 public/tests 代码块统一重排为单引号——**实施时以各文件自己的约定为准**(lib/server 单引号、public/tests 双引号),计划代码块仅作结构参考;各 Step 标题已就地标注。
- **Task 1 路径裁定**:模块最终落 `public/flow-route.js`(浏览器 `<script>` 直载 + Node `require` 双职),测试 `require("../public/flow-route")`;Task 1/3 的引号按 public 双引号约定。Task 3 的 index.html 脚本插入顺序:flow-graph.js → flow.js → **flow-route.js** → app.js(flow-route 不依赖 flow.js,顺序仅要求在 app.js 之前)。
- **S.flow 形状的唯一权威**:本计划。旧字段(overlay/drawer)只存在于 T3 过渡桥,T4a 删净;grep `S.flow.overlay\|S.flow.drawer` 在 T4a 后应为 0。
- **不要顺手改**画布引擎(flow.js 的 Flow 对象)、buildGraph、SSE 管道、lightbox——spec §8 复用清单里的「原样保留」是硬约束。
