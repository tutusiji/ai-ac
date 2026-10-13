"use strict";
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
  "canvas",
  "script",
  "chars",
  "storyboard",
  "clips",
  "voice",
  "film",
  "cover",
  "story",
];

const SEL_PAGE_MAP = {
  idea: "script",
  chars: "chars",
  film: "film",
  panels: "storyboard",
  clips: "clips",
  voice: "voice",
  cover: "cover",
};

function parseFlowQuery(q) {
  let page = q.get("page") || "";
  if (!page) {
    if (q.get("overlay") === "story") page = "story";
    else {
      const sel = q.get("sel") || "";
      if (SEL_PAGE_MAP[sel]) page = SEL_PAGE_MAP[sel];
    }
  }
  if (!PAGES.includes(page)) page = "canvas";
  const shot = parseInt(q.get("shot"), 10);
  return {
    page,
    view: q.get("view") === "shots" ? "shots" : "overview",
    scene: q.get("scene") || "",
    shot: Number.isInteger(shot) && shot > 0 ? shot : 0,
    sel: q.get("sel") || "",
    logsHint: q.get("drawer") === "logs",
  };
}

function flowRouteTo(projectId, state) {
  const st = state || {};
  const q = new URLSearchParams();
  if (st.page && st.page !== "canvas") q.set("page", st.page);
  if (st.view === "shots") q.set("view", "shots");
  if (st.scene) q.set("scene", st.scene);
  if (st.shot) q.set("shot", String(st.shot));
  if (st.page === "canvas" && st.sel) {
    if (SEL_PAGE_MAP[st.sel]) {
      /* sel 与旧书签取值撞车(idea/chars/film 等):显式补 page=canvas 消歧,
         否则刷新时会被旧书签归一误判成对应工作页(往返一致测试钉死此行为)。 */
      q.set("page", "canvas");
    }
    q.set("sel", st.sel);
  }
  const qs = q.toString();
  return "/project/" + projectId + (qs ? "?" + qs : "");
}

function pageForNode(node) {
  if (!node || !node.id) return null;
  const overview = {
    idea: { page: "script" },
    chars: { page: "chars" },
    panels: { page: "storyboard" },
    clips: { page: "clips" },
    voice: { page: "voice" },
    film: { page: "film" },
    cover: { page: "cover" },
    story: { page: "story" },
  };
  if (overview[node.id]) return overview[node.id];
  if (node.kind === "scene" && node.sceneId) {
    return { page: "storyboard", scene: node.sceneId };
  }
  if (node.kind === "shot" && node.sceneId && node.idx) {
    return { page: "storyboard", scene: node.sceneId, shot: node.idx };
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseFlowQuery, flowRouteTo, pageForNode };
}
if (typeof window !== "undefined") {
  window.FlowRoute = { parseFlowQuery, flowRouteTo, pageForNode };
}
