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
