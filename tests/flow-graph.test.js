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
