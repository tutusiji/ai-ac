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
