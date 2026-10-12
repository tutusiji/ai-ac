# 编辑界面工作台化设计(左导航 + 全宽工作页)

日期:2026-10-12
状态:待评审
前置:`2026-10-07-flow-canvas-design.md`(全屏节点画布,已交付)——本文重构其面板宿主形态:画布引擎本体(flow.js/flow-graph.js)原样保留,交互从「画布 + 右侧抽屉」改为「工作台:左导航 + 全宽工作页」。

## 1. 背景与目标

现状交互:**单击任意画布节点 → 右侧 430px 固定抽屉**(`#fw-drawer`)承载十个入口(剧本/角色/成片/脉络/分镜图/片段/配音/封面/场景/镜头)的全部面板。用户确认的四项痛点(2026-10-12 对谈):

1. **选中即弹面板**——单击本意是「看一眼」,却强制打开面板(非用户主动);
2. **SSE 整块重渲闪动**——面板随每次同步整块 innerHTML 替换(仅有焦点保护);
3. **浮层遮挡画布**——抽屉盖住画布右侧,被遮节点不可达,对比两个面板要来回开关;
4. **形态错配**——剧本/成片/角色等重编辑内容住进侧边小窗,成片双列网格被迫压成单列(`flow.css:358` 自供注)。

**目标**:工作台模型——左侧常驻导航栏(带状态灯)+ 全宽工作页;画布降为其中一页(仍是生产监控与跳转入口);打开一律显式;刷新只补丁不重建;重内容各自拥有全宽工作区。

## 2. 现状基线(实现所依赖的代码事实)

- 画布引擎:`public/flow.js` `Flow`(mount/setProject/setGraph/patch/fit/select/resetLayout)与 `public/flow-graph.js`(buildGraph/zoomAt/FG)——**原样保留**;`Flow.patch` 已实现"几何未变只补状态类"的就地更新,画布页刷新直接复用。
- 面板宿主:`flow.js:313` `FlowUI.openPanel/closePanel`(`#fw-drawer`,430px)、`openOverlay/closeOverlay`(`#fw-overlay`,脉络工作室)、`openLogs/closeLogs`(底部日志抽屉,`#fw-logs`)、`closeTop`(Esc 三层栈)。
- 打开链:app.js `onNodeSelect`(单击=选中+`flowPanelFor(n)` 弹面板+写 URL `sel=`)、`onNodeOpen`(双击:story→脉络浮层,scene→`view=shots`,其余同单击);SSE 同步时 `S.flow.sel` 指向的节点会**再次**触发 `flowPanelFor`(app.js:505 起的 editing 守卫是唯一缓冲)。
- URL 状态:`applyFlowQuery`(view/sel/scene/overlay/drawer 五参数)+ `flowUrl/flowNav/navigate`(replaceState);`FLOW_TAB_MAP` 做旧 tab URL → flow query 的书签兼容。
- 页面内容(全部已存在,只需换宿主与布局):`renderScript`(剧本,story2col 双栏)、`renderChars`(角色卡)、`scenePanel`(场景字段 + `renderShotCard` 镜头网格)、`shotPanel`(镜头详情,内含 renderShotCard)、`panelsPanel/clipsPanel/voicePanel`(进度总览+批量按钮)、`renderFilm`(成片,film-wrap 双列被抽屉补丁压单列;含 BGM/合成设置/成本表)、`coverPanel`、`renderStory`(脉络,现走浮层)、`renderShotCard`(镜头卡:图/视频/台词/运镜/情绪/生成)。
- 全局件:`lightbox`(含一致性侧栏)、`toast/confirmDialog`、data-act 全局事件委托、style.css 设计变量——全部不动。
- 测试设施:裸 `node --test`,现有 33 用例全在 lib/ 层;public/ 无 DOM 测试设施。引用约定:`.prettierrc`(lib/server 单引号,tests/public 双引号)。

## 3. 信息架构:左导航栏

- **常驻左栏**(`#rail`,固定宽 96px,深色,右侧 1px 分隔线):八个入口,纵向排列,每项 = 图标 + 短标签 + **状态灯**:

| 入口 | page 值    | 图标 | 状态灯取数(自 S.project)                                            |
| ---- | ---------- | ---- | ------------------------------------------------------------------- |
| 画布 | canvas     | 🗺    | 无灯(生产监控本身)                                                  |
| 剧本 | script     | 📜   | arcs 为空=灰;任一 beat 生成中=蓝脉冲;出错=红;其余=绿                |
| 角色 | chars      | 👥   | 无角色=灰;有角色缺 refUrl=黄;其余=绿                                |
| 分镜 | storyboard | 🎞    | 无 shots=灰;任一 panelStatus error=红;pending/run=蓝脉冲;全 done=绿 |
| 片段 | clips      | 🎬   | 同上,取 clipStatus                                                  |
| 配音 | voice      | 🎙    | shots 有 dialogue 无 audio=黄;生成中=蓝;全有=绿;无 shots=灰         |
| 成片 | film       | 🎞    | 无 filmUrl=灰;合成中=蓝;出错=红;有=绿                               |
| 封面 | cover      | 🖼    | 无 coverImageUrl=灰;生成中=蓝;有=绿                                 |

- 状态灯为**唯一常新的部分**:SSE 每次同步优先就地更新(只改 class,不重建 rail DOM)。
- 栏底(与工具入口分隔):设置 ⚙(现 open-settings)、日志 📜(开底部日志抽屉)、全屏 ⛶。
- 窄屏(<900px)rail 收窄为仅图标(48px,隐藏文字标签);不做更深的移动适配(见 §12)。

## 4. 工作页规格(全宽 = 视口宽 − rail)

| 页                 | 内容与布局                                                                                                                                                      | 相对现状                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **画布**           | 现 flow 画布 + 工具条(总览/镜头层视图切换、重置布局)原样托管                                                                                                    | 从「整个界面」降为一页;**单击节点只选中,不再弹面板**;选中后画布底部浮出**上下文条**(§5);双击节点/上下条「打开」→ 进对应工作页 |
| **剧本**           | `renderScript` 现有 story2col(章节树 + 正文编辑)                                                                                                                | 换宿主:430px 抽屉 → 全宽,双栏自然展开                                                                                         |
| **角色**           | `renderChars` 角色卡网格                                                                                                                                        | 全宽网格                                                                                                                      |
| **分镜**           | **场景 tab 条**(横排,来自 p.scenes,含每场景 图/片/音 进度微标)+ 选中场景的「场景字段表单 + 镜头卡网格」(现 scenePanel 内容推广为多场景)+ 批量生成按钮           | 新页;点镜头卡 → 镜头页                                                                                                        |
| **镜头**(分镜子页) | 大图 + 视频/动态漫预览 + 台词/运镜/情绪编辑 + 生成按钮(现 shotPanel/renderShotCard 内容放大重排)+ **上一镜/下一镜**(场景内循环,服务质检回路逐镜过图)+ ←返回分镜 | 新页;URL `page=storyboard&shot=N`                                                                                             |
| **片段 / 配音**    | `clipsPanel` / `voicePanel` 进度总览 + 批量按钮                                                                                                                 | 全宽                                                                                                                          |
| **成片**           | `renderFilm` **恢复双列**(film-wrap 默认两列:视频列 + BGM/合成设置/成本表列)                                                                                    | 删除 `flow.css` 单列补丁;最大受益页                                                                                           |
| **封面**           | `coverPanel`                                                                                                                                                    | 全宽                                                                                                                          |
| **脉络**           | `renderStory`(脉络工作室)                                                                                                                                       | **浮层转正为普通页**(page=story),全屏浮层设施消亡                                                                             |

## 5. 交互规格

### 5.1 打开时机(根治「选中即弹」)

- 画布页单击节点 = **仅选中**(高亮 + 底部上下文条出现);收起选中(点空白)= 上下文条消失。URL `sel=` 保留为画布页内部状态(**仅 page=canvas 时序列化**),不触发任何面板(与 §7 的 parse/serialize 对齐)。
- **上下文条**:画布底部居中浮出的非遮挡条(`#fw-ctxbar`,占位高度 ~48px,不盖画布中心),内容 = 节点图标 + 标题 + 状态词 + 「打开 →」按钮。双击节点与「打开」等效。
- 节点 → 页映射(双击与上下文条共用,抽纯函数 `pageForNode`):
  idea→script · chars→chars · panels→storyboard · clips→clips · voice→voice · film→film · cover→cover · story→story · scene→storyboard(定位该场景 tab)· shot→镜头页(该 shot idx)
- 导航栏点击 = 显式切页;页内「←返回」与 Esc 沿调用栈后退(镜头页→分镜页→画布页;其余页→画布页)。日志抽屉(底部)不占 Esc 栈——保持现状快捷键外单独 Esc 直接收起。

### 5.2 键盘与既有全局件

- Esc:镜头页→分镜页→画布;日志抽屉开着则先收日志(顺序:日志 → 页后退,`closeTop` 相应简化)。
- lightbox / toast / confirmDialog / SSE 管道 / data-act 委托:零改动。

## 6. 刷新策略(SSE,根治「闪动」)

渲染入口收口为 `renderCurrentPage()`(替代现 renderProject 内的面板重挂逻辑):

1. **导航栏状态灯**:每次同步必更,仅改 class/textContent(不重建 rail)。
2. **画布页**:沿用 `Flow.patch` 就地补丁(现状已是,不改);上下文条文本就地更新。
3. **表单类页**(script/chars/film/cover/shot):默认**跳过重渲**,除非(a)用户焦点不在任何 input/textarea/select 且(b)自该页上次渲染后项目数据确有变化(以轻量指纹比较:同步计数或关键字段快照,实现取简)——沿用现 editing 守卫思想,显式化为页级属性。
4. **进度类页**(storyboard/clips/voice):照常重渲(读为主,无输入状态)。
5. 页面切换(导航/打开)时整页渲染一次——这是唯一允许的整块替换。

## 7. 路由设计(`lib/flow-route.js` 新纯函数模块,唯一 TDD 锚点)

```js
/* 新 URL:/project/<id>?page=<page>&<子参>
   page ∈ canvas|script|chars|storyboard|clips|voice|film|cover|story(缺省 canvas)
   子参:view=shots(画布镜头层) · scene=<id>(分镜 tab/画布镜头层过滤) · shot=<idx>(镜头页)
   sel=<nodeId>:画布选中,仅 page=canvas 时序列化;parse 原样读出供画布恢复高亮
   兼容映射(仅当 URL 无 page 参数时生效,书签不失效,parse 内归一):
     sel=idea|chars|film → page=script|chars|film;sel=panels→storyboard;sel=clips/voice/cover 同名页
     overlay=story → page=story;view=shots → page=canvas&view=shots
     drawer=logs → parse 返回 logsHint:true(宿主一次性开日志抽屉,不进 URL 序列化)
   非法 page 值 → canvas;shot 非数字 → 丢弃 */
parseFlowQuery(searchParams) → { page, view, scene, shot, sel, logsHint }
flowRouteTo(projectId, state) → "/project/<id>?..."(空值不序列化;sel 仅 page=canvas 时写;page=canvas 时不写 page 参数,保持 URL 简洁)
pageForNode(node) → { page, scene?, shot? } | null(未知节点 null,宿主静默忽略)
```

- 纯函数、零依赖,配 `tests/flow-route.test.js`:新参数往返、五类旧参数归一、非法值回落、pageForNode 十类节点映射。
- 宿主(app.js)`navigate`/`popstate` 机制沿用;`FLOW_TAB_MAP` 删除(职责并入 parse)。

## 8. 复用与删除清单

**复用原样**:flow.js(Flow)、flow-graph.js、lightbox、toast/confirmDialog、#fw-logs 底部日志抽屉、data-act 委托、style.css 变量与 panel-card/表单/按钮体系、SSE 管道与 buildGraph。

**删除**:`#fw-drawer` 与 `FlowUI.openPanel/closePanel`、`#fw-overlay` 与 `openOverlay/closeOverlay`、`closeTop` 的三层栈(简化为「日志 → 页后退」)、`flow.css` 的 drawer/overlay 样式块与 `.film-wrap` 单列补丁、`FLOW_TAB_MAP`、`flowPanelFor` 与渲染入口里的 sel→面板重挂逻辑。

**新增**:`#rail` 导航栏、`#fw-ctxbar` 上下文条、九个工作页的宿主容器与布局 CSS、`lib/flow-route.js` + 测试。

**改动**:`renderProject` 拆为 rail + `renderCurrentPage`;`onNodeSelect`(单击不再弹面板)、`onNodeOpen`(双击 → pageForNode 导航)、`applyFlowQuery/flowUrl`(改调 flow-route)、各 render 函数的容器类名(内容函数体尽量不动)。

## 9. 数据与兼容

- **零服务端改动、零数据迁移**:纯 public/ + lib/flow-route.js;项目 JSON、SSE 协议、API 全不动。
- 旧书签 URL 经 parse 归一(§7);localStorage 画布位置记忆 key 不变。
- 部署:与现有流程一致(start.sh 重启 + souxy.com 生效;无新依赖、无构建步骤)。

## 10. 错误处理与边界

- 未知/已删节点选中:静默忽略(沿用现状);URL 指向不存在 shot/scene → 回落分镜页全场景视图,不报错弹窗。
- 非法 page/子参:parse 归一(§7),永不白屏。
- SSE 断连重连:页内容不因重连整块闪烁(§6 规则天然覆盖)。
- 画布页内双击 scene 的旧跳转(view=shots)保留为画布内部视图切换;同时上下文条提供「进分镜页」入口,两者不冲突。

## 11. 测试策略(零依赖 `node --test`)

1. `tests/flow-route.test.js`(TDD,先失败后实现):parse 新旧参数矩阵、serialize 往返、pageForNode 映射、非法值回落——约 10-14 用例。
2. 全套件回归(33 + 新增)全绿;`node --check` 全部 public/*.js 与 lib/flow-route.js。
3. 人工冒烟清单(spec 验收):切页显式性(单击节点不弹面板)/ 上下文条打开 / 九页布局(重点:成片双列、剧本双栏、分镜场景 tab)/ 镜头页往返与上一镜下一镜 / Esc 栈 / 旧 URL 书签归一 / SSE 状态灯与页面不闪 / 日志抽屉。

## 12. 明确不做(本阶段)

- rail 折叠/自定义排序/拖拽;多页同开或分屏;画布节点内联编辑(节点仍只读,编辑在工作页);
- 移动端/平板深度适配(仅 <900px 收窄 rail,不保功能完整);
- 工作页内的实时协作、撤销/重做历史栈(超出本阶段);
- 主题/密度切换。

## 13. 全局约束(沿承上一 spec,仍然全部生效)

- **零依赖**:Node 内置模块 + 原生前端三件套,不引入任何 npm 运行时依赖、不引入构建步骤。
- `data/settings.json`(明文 Key)与 `data/projects/`(用户媒体)永不入库、密钥永不打印。
- 引号:.prettierrc 约定(lib/server 单引号,tests/public 双引号),PostToolUse prettier 钩子在位。
- 提交信息中文 + `Co-Authored-By: Claude Code <noreply@anthropic.com>` trailer。
- 部署目标 souxy.com:7507(本地 8787 → frp → nginx),与既有拓扑一致。
