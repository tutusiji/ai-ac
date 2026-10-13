"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const {
  parseFlowQuery,
  flowRouteTo,
  pageForNode,
} = require("../public/flow-route");

const parse = (q) => parseFlowQuery(new URLSearchParams(q));

test("新参数完整解析:page/scene/shot", () => {
  const r = parse("page=storyboard&scene=sc1&shot=3");
  assert.deepStrictEqual(r, {
    page: "storyboard",
    view: "overview",
    scene: "sc1",
    shot: 3,
    sel: "",
    logsHint: false,
  });
});

test("空参数 → canvas 缺省,view=overview", () => {
  const r = parse("");
  assert.strictEqual(r.page, "canvas");
  assert.strictEqual(r.view, "overview");
  assert.strictEqual(r.scene, "");
  assert.strictEqual(r.shot, 0);
  assert.strictEqual(r.sel, "");
  assert.strictEqual(r.logsHint, false);
});

test("非法 page 归一为 canvas,合法九页全通过", () => {
  assert.strictEqual(parse("page=hack").page, "canvas");
  for (const p of [
    "canvas",
    "script",
    "chars",
    "storyboard",
    "clips",
    "voice",
    "film",
    "cover",
    "story",
  ]) {
    assert.strictEqual(parse("page=" + p).page, p);
  }
});

test("view=shots 保留(画布镜头层)", () => {
  assert.strictEqual(parse("view=shots").view, "shots");
  assert.strictEqual(parse("view=other").view, "overview");
});

test("旧参数归一:sel=idea|chars|film → script|chars|film", () => {
  assert.strictEqual(parse("sel=idea").page, "script");
  assert.strictEqual(parse("sel=chars").page, "chars");
  assert.strictEqual(parse("sel=film").page, "film");
});

test("旧参数归一:sel=panels → storyboard;clips/voice/cover 同名页", () => {
  assert.strictEqual(parse("sel=panels").page, "storyboard");
  assert.strictEqual(parse("sel=clips").page, "clips");
  assert.strictEqual(parse("sel=voice").page, "voice");
  assert.strictEqual(parse("sel=cover").page, "cover");
});

test("旧参数归一:overlay=story → page=story;drawer=logs → logsHint", () => {
  assert.strictEqual(parse("overlay=story").page, "story");
  const r = parse("drawer=logs");
  assert.strictEqual(r.page, "canvas");
  assert.strictEqual(r.logsHint, true);
});

test("旧参数归一:view=shots → page=canvas&view=shots", () => {
  const r = parse("view=shots&scene=sc9");
  assert.strictEqual(r.page, "canvas");
  assert.strictEqual(r.view, "shots");
  assert.strictEqual(r.scene, "sc9");
});

test("旧参数归一仅在无 page 参数时生效(page 优先)", () => {
  const r = parse("page=film&sel=idea");
  assert.strictEqual(r.page, "film");
  assert.strictEqual(r.sel, "idea"); /* sel 原样读出,宿主只在 canvas 页使用 */
});

test("shot 非数字/0/负数 → 丢弃(0)", () => {
  assert.strictEqual(parse("shot=abc").shot, 0);
  assert.strictEqual(parse("shot=0").shot, 0);
  assert.strictEqual(parse("shot=-3").shot, 0);
  assert.strictEqual(parse("shot=7").shot, 7);
});

test("flowRouteTo:page=canvas 不写 page 参数,sel 仅 canvas 页写", () => {
  assert.strictEqual(flowRouteTo("p1", { page: "canvas" }), "/project/p1");
  assert.strictEqual(
    flowRouteTo("p1", { page: "canvas", sel: "shot:sc1:2" }),
    "/project/p1?sel=shot%3Asc1%3A2",
  );
  assert.strictEqual(
    flowRouteTo("p1", { page: "script", sel: "idea" }),
    "/project/p1?page=script",
  );
});

test("flowRouteTo:空值不序列化,子参齐全", () => {
  assert.strictEqual(flowRouteTo("p1", {}), "/project/p1");
  assert.strictEqual(
    flowRouteTo("p1", { page: "storyboard", scene: "sc1", shot: 3 }),
    "/project/p1?page=storyboard&scene=sc1&shot=3",
  );
  assert.strictEqual(
    flowRouteTo("p1", { page: "canvas", view: "shots", scene: "sc2" }),
    "/project/p1?view=shots&scene=sc2",
  );
});

test("flowRouteTo ↔ parse 往返一致", () => {
  const states = [
    { page: "canvas", sel: "idea" },
    { page: "storyboard", scene: "sc1" },
    { page: "storyboard", scene: "sc1", shot: 4 },
    { page: "film" },
    { page: "canvas", view: "shots", scene: "sc2" },
  ];
  for (const st of states) {
    const url = flowRouteTo("p1", st);
    const q = new URL(url, "https://x.local").searchParams;
    const r = parseFlowQuery(q);
    assert.strictEqual(r.page, st.page);
    assert.strictEqual(r.view, st.view || "overview");
    assert.strictEqual(r.scene, st.scene || "");
    assert.strictEqual(r.shot, st.shot || 0);
    assert.strictEqual(r.sel, st.sel || "");
  }
});

test("pageForNode:八总览节点映射", () => {
  assert.deepStrictEqual(pageForNode({ id: "idea" }), { page: "script" });
  assert.deepStrictEqual(pageForNode({ id: "chars" }), { page: "chars" });
  assert.deepStrictEqual(pageForNode({ id: "panels" }), { page: "storyboard" });
  assert.deepStrictEqual(pageForNode({ id: "clips" }), { page: "clips" });
  assert.deepStrictEqual(pageForNode({ id: "voice" }), { page: "voice" });
  assert.deepStrictEqual(pageForNode({ id: "film" }), { page: "film" });
  assert.deepStrictEqual(pageForNode({ id: "cover" }), { page: "cover" });
  assert.deepStrictEqual(pageForNode({ id: "story" }), { page: "story" });
});

test("pageForNode:scene → 分镜页定位 tab;shot → 镜头页", () => {
  assert.deepStrictEqual(
    pageForNode({ id: "scene:sc1", kind: "scene", sceneId: "sc1" }),
    {
      page: "storyboard",
      scene: "sc1",
    },
  );
  assert.deepStrictEqual(
    pageForNode({ id: "shot:sc1:3", kind: "shot", sceneId: "sc1", idx: 3 }),
    { page: "storyboard", scene: "sc1", shot: 3 },
  );
});

test("pageForNode:未知节点 → null", () => {
  assert.strictEqual(pageForNode(null), null);
  assert.strictEqual(pageForNode({}), null);
  assert.strictEqual(pageForNode({ id: "mystery" }), null);
});
