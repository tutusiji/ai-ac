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
