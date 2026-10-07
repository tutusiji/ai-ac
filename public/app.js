'use strict';
/* 漫剧工坊 前端 SPA(零依赖) */

const S = {
  view: 'home', projects: [], project: null, tab: 'shots', sceneId: '',
  settings: null, catalog: null, voices: {}, styles: [], prices: null, health: null,
  sse: null, pollTimer: null, fetchTimer: null,
};
function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }

/* ---------- 前端路由:URL 即状态,刷新/直达/后退不丢位置 ---------- */
const TABS = ['story', 'shots', 'chars', 'script', 'film', 'logs'];
function projectPath(tab) {
  if (!S.project) return '/';
  let p = '/project/' + S.project.id + (tab ? '/' + tab : '');
  if (tab === 'shots' && S.sceneId && S.sceneId !== '__all__') p += '?scene=' + S.sceneId;
  return p;
}
function navigate(path) {
  if (location.pathname + location.search !== path) history.pushState({}, '', path);
  handleRoute();
}
async function handleRoute() {
  closeModal();
  const u = new URL(location.href);
  const seg = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (seg[0] === 'project' && seg[1]) {
    const pid = seg[1];
    const tab = TABS.includes(seg[2]) ? seg[2] : '';
    const scene = u.searchParams.get('scene') || '';
    if (S.project && S.project.id === pid) {
      S.view = 'project';
      if (tab) S.tab = tab;
      if (scene) S.sceneId = scene;
      render();
    } else {
      try {
        await openProject(pid, tab || undefined);
        if (scene && S.sceneId !== scene) { S.sceneId = scene; render(); }
      } catch (e) {
        toast('项目不存在或已删除,回到首页', 'err');
        history.replaceState({}, '', '/');
        S.view = 'home'; S.project = null; render();
      }
    }
  } else {
    S.view = 'home'; S.project = null;
    if (S.sse) { S.sse.close(); S.sse = null; }
    clearInterval(S.pollTimer);
    render();
  }
}
window.addEventListener('popstate', handleRoute);

/* ---------- 工具 ---------- */
const $ = sel => document.querySelector(sel);
const app = () => $('#app');
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || res.status); e.hint = data.hint || ''; throw e; }
  return data;
}
function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5200);
}
function modal(html) {
  $('#modal-root').innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
  // 点击遮罩空白处关闭;弹窗内按钮靠 document 委托响应,不能在此拦截冒泡
  $('#modal-root .overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
}
let activeConfirm = null;
function closeModal() {
  const r = activeConfirm; activeConfirm = null;
  $('#modal-root').innerHTML = '';
  if (r) r(false);
}
function confirmDialog(message, { okText = '确认删除' } = {}) {
  return new Promise(resolve => {
    activeConfirm = resolve;
    modal(`<h2>⚠ 确认操作</h2><p class="confirm-msg">${esc(message)}</p>
      <div class="foot"><button class="btn" data-cx="no">取消</button><button class="btn danger" data-cx="yes">${esc(okText)}</button></div>`);
    $('#modal-root [data-cx="no"]').onclick = () => { const r = activeConfirm; activeConfirm = null; closeModal(); r(false); };
    $('#modal-root [data-cx="yes"]').onclick = () => { const r = activeConfirm; activeConfirm = null; closeModal(); r(true); };
  });
}
function lightbox(kind, url) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = kind === 'video' ? `<video src="${url}" controls autoplay></video>` : `<img src="${url}">`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

/* ---------- 平台选比价弹窗(右上角 ❓) ---------- */
function whyArkModal() {
  modal(`
    <h2>🏆 为什么选火山方舟(2026-10 比价结论)</h2>
    <table class="cost-table">
      <tr><th>平台</th><th>计费方式</th><th>单集成本(6镜×5s)</th><th>API 流水线</th><th>结论</th></tr>
      <tr><td><b>火山方舟(本方案)</b></td><td>按量,无月费</td><td><b>≈ ¥2(480p) / ¥3.5(720p)</b></td><td>✅ 文本+图+视频一体</td><td class="win" style="color:var(--ok)">✓ 已选:当前账号可用</td></tr>
      <tr><td>即梦网页版</td><td>会员制(大额档≈0.1元/秒)</td><td>≈ ¥3</td><td>❌ 无公开 API</td><td>便宜但纯手动,无法自动化</td></tr>
      <tr><td>可灵开放平台</td><td>灵感值(约0.3~1元+/秒)</td><td>≈ ¥4~8</td><td>✅</td><td>单价偏高</td></tr>
      <tr><td>Vidu API</td><td>按量(&lt;0.3元/秒)</td><td>≈ ¥2~3</td><td>✅</td><td>便宜,但文本/生图需另配、角色一致性弱</td></tr>
      <tr><td>阿里云百炼(通义)</td><td>按量(部分模型有免费额度)</td><td>≈ ¥2~3(万相 720p 按秒,以官网为准)</td><td>✅ 通义文本+万相图+Wan 视频</td><td class="win" style="color:var(--ok)">✓ 已接入:双引擎可切换</td></tr>
    </table>
    <div class="note" style="margin-top:12px;color:var(--dim);font-size:12.5px;line-height:1.8">
      · 单价为 2026-10 公开资料约值,以各平台官网为准<br>
      · 本账号已订阅 <b style="color:var(--accent2)">Agent Plan Medium</b>:文本+生图走套餐额度(0 现金),仅视频按量<br>
      · 平台为<b style="color:var(--accent2)">双引擎</b>:火山(套餐/按量)+ 阿里百炼(通义/万相/Wan),每个能力可在设置里独立切换;也可本地 ComfyUI 跑阿里开源模型(Wan2.2 / Qwen-Image,魔搭 ModelScope 下载)<br>
      · 若月产量继续放大,可在方舟控制台直接升级套餐档位,无需改平台配置
    </div>`);
}

/* ---------- 数据加载 ---------- */
async function loadAll() {
  const [health, settings, styles, voices, prices] = await Promise.all([
    api('/api/health'), api('/api/settings'), api('/api/styles'), api('/api/voices'), api('/api/prices'),
  ]);
  Object.assign(S, { health, settings, styles, voices, prices });
  S.projects = await api('/api/projects');
  renderHealth();
}
function renderHealth() {
  const h = S.health;
  const chip = $('#health-chip');
  const has = h.planConfigured || h.keyConfigured || h.aliyunConfigured;
  const parts = [];
  if (h.planConfigured) parts.push('套餐');
  if (h.keyConfigured) parts.push('按量');
  if (h.aliyunConfigured) parts.push('阿里');
  chip.textContent = has ? (h.ttsReady || h.aliyunConfigured ? `● 引擎就绪(${parts.join('+')})` : '● Key 已配置 / TTS 缺失') : '○ 演示模式(未配置 Key)';
  chip.className = 'chip ' + (has ? (h.ttsReady || h.aliyunConfigured ? 'ok' : 'err') : '');
}
async function openProject(pid, forceTab) {
  S.project = await api('/api/projects/' + pid);
  // 反抽卡:新项目优先进入脉络工作室
  S.tab = forceTab || ((!S.project.shots.length && !(S.project.story && S.project.story.arcs.length)) ? 'story' : (S.tab === 'story' ? 'story' : 'shots'));
  const firstScene = (S.project.scenes || [])[0];
  if (!S.project.scenes || !S.project.scenes.some(s => s.id === S.sceneId)) S.sceneId = firstScene ? firstScene.id : '';
  S.view = 'project';
  watch(pid);
  render();
}
async function refreshProject() {
  if (!S.project) return;
  S.project = await api('/api/projects/' + S.project.id);
  render();
}
function throttledRefresh() {
  clearTimeout(S.fetchTimer);
  S.fetchTimer = setTimeout(refreshProject, 350);
}
function watch(pid) {
  if (S.sse) { S.sse.close(); S.sse = null; }
  clearInterval(S.pollTimer);
  const es = new EventSource(`/api/projects/${pid}/events`);
  es.onmessage = throttledRefresh;
  es.onerror = () => { if (!S.pollTimer) S.pollTimer = setInterval(() => S.project && refreshProject(), 4000); };
  S.sse = es;
}

/* ---------- 脉络工作室:走向 → 章节 → 节拍 → 场景(全部先打磨,后生成) ---------- */
function sceneStatusChip(sc) {
  const st = sc.stats || { shots: 0, panels: 0, clips: 0 };
  if (!st.shots) return '<span class="schip none">未展开</span>';
  const parts = [`分镜${st.shots}`];
  if (st.panels) parts.push(`图${st.panels}/${st.shots}`);
  if (st.clips) parts.push(`视频${st.clips}/${st.shots}`);
  return `<span class="schip ${sc.locked ? 'locked' : 'ready'}">${sc.locked ? '🔒 ' : ''}${parts.join(' · ')}</span>`;
}

function renderStory() {
  const p = S.project;
  const story = p.story || { premise: '', direction: '', arcs: [] };
  const arcs = story.arcs || [];

  // 流程条:章节 → 节拍 → 场景状态
  const flow = arcs.length ? arcs.map(a => {
    const beats = a.beats || [];
    const beatChips = beats.map(b => {
      const scs = (p.scenes || []).filter(s => s.beatId === b.id);
      const inner = scs.length
        ? scs.map(s => `<span class="flow-scene ${s.locked ? 'lk' : ''}" data-act="goto-scene" data-scene-id="${s.id}" title="${esc(s.description || '')}">${esc(s.title)}${sceneStatusChip(s)}</span>`).join('')
        : '<span class="flow-scene none">待拆场景</span>';
      return `<div class="flow-beat"><b>${esc(b.title)}</b><small>${esc(b.emotion || '')}</small>${inner}</div>`;
    }).join('');
    return `<div class="flow-arc"><h5>${esc(a.title)}</h5>${beatChips || '<div class="flow-beat none">待拆节拍</div>'}</div>`;
  }).join('<span class="flow-arrow">➜</span>') : '<span class="empty-inline">还没有章节:先「AI 起草故事骨架」或手动添加</span>';

  // 章节导航 + 详情(主从布局:左侧选章节,右侧宽松编辑)
  if (!S.selArc || !arcs.some(x => x.id === S.selArc)) S.selArc = arcs[0] ? arcs[0].id : '';
  const sel = arcs.find(x => x.id === S.selArc) || null;

  const arcNav = arcs.map(x => {
    const nb = (x.beats || []).length;
    const nsc = (p.scenes || []).filter(s => s.arcId === x.id).length;
    return `<div class="arc-nav-item ${x.id === S.selArc ? 'on' : ''}" data-act="sel-arc" data-arc="${x.id}">
      <b>${esc(x.title || '未命名章节')}</b><small>${nb} 节拍 · ${nsc} 场景</small></div>`;
  }).join('');

  const detail = !sel ? '<div class="empty" style="padding:40px 0">左侧选择一个章节,或点「＋添加章节」</div>' : `
    <div class="arc-head2">
      <input class="arc-title" data-change="arc" data-id="${sel.id}" data-field="title" value="${esc(sel.title)}" placeholder="章节名">
      <input data-change="arc" data-id="${sel.id}" data-field="purpose" value="${esc(sel.purpose)}" placeholder="本章在全局中的作用">
      <textarea class="arc-sum" data-change="arc" data-id="${sel.id}" data-field="summary" rows="2" placeholder="本章概要:事件与转折">${esc(sel.summary)}</textarea>
      <div class="arc-ops">
        <button class="btn small" data-act="draft-beats" data-arc="${sel.id}">🪄 AI 拆节拍</button>
        <button class="btn small" data-act="add-beat" data-arc="${sel.id}">＋节拍</button>
        <button class="btn small danger" data-act="del-arc" data-arc="${sel.id}">删除本章</button>
      </div>
    </div>
    ${(sel.beats || []).map((b, bi) => {
      const scs = (p.scenes || []).filter(s => s.beatId === b.id);
      const sceneCards = scs.map(s => `
        <div class="scene-card">
          <div class="srow">
            <input data-change="scene" data-id="${s.id}" data-field="title" value="${esc(s.title)}" placeholder="场景名">
            <input data-change="scene" data-id="${s.id}" data-field="location" value="${esc(s.location)}" placeholder="地点">
            <input data-change="scene" data-id="${s.id}" data-field="time" value="${esc(s.time)}" placeholder="时间">
            <input data-change="scene" data-id="${s.id}" data-field="cast" value="${esc((s.cast || []).join(','))}" placeholder="出场角色(逗号分隔)" style="flex:1.4">
          </div>
          <textarea data-change="scene" data-id="${s.id}" data-field="description" rows="2" placeholder="场景内容:人物在做什么、画面氛围、戏剧任务(要能被画出来)">${esc(s.description)}</textarea>
          <div class="sfoot">
            ${sceneStatusChip(s)}
            <div class="spacer"></div>
            <button class="btn small" data-act="goto-scene" data-scene-id="${s.id}">去分镜 ›</button>
            <button class="btn small danger" data-act="del-scene" data-scene-id="${s.id}">删除场景</button>
          </div>
        </div>`).join('');
      return `<div class="beat-card">
        <div class="beat-head">
          <span class="bno">${bi + 1}</span>
          <input data-change="beat" data-arc="${sel.id}" data-id="${b.id}" data-field="title" value="${esc(b.title)}" placeholder="节拍名">
          <input data-change="beat" data-arc="${sel.id}" data-id="${b.id}" data-field="emotion" value="${esc(b.emotion)}" placeholder="情绪基调" style="max-width:110px">
          <div class="spacer"></div>
          <button class="btn small" data-act="draft-scenes" data-arc="${sel.id}" data-beat="${b.id}">🪄 AI 拆场景</button>
          <button class="btn small" data-act="add-scene" data-arc="${sel.id}" data-beat="${b.id}">＋场景</button>
          <button class="btn small danger" data-act="del-beat" data-arc="${sel.id}" data-beat="${b.id}">✕</button>
        </div>
        <input class="beat-intent" data-change="beat" data-arc="${sel.id}" data-id="${b.id}" data-field="intent" value="${esc(b.intent)}" placeholder="这个节拍要推进什么(≤30字)">
        <textarea class="beat-sum" data-change="beat" data-arc="${sel.id}" data-id="${b.id}" data-field="summary" rows="2" placeholder="发生什么(≤70字)">${esc(b.summary)}</textarea>
        <div class="scene-cards">${sceneCards || '<div class="hint" style="padding:4px 2px">本节拍还没有场景 —— 「🪄 AI 拆场景」或「＋场景」</div>'}</div>
      </div>`;
    }).join('') || '<div class="hint" style="padding:6px 2px">本章还没有节拍 —— 「🪄 AI 拆节拍」或「＋节拍」</div>'}`;

  return `
  <div class="panel-card" style="margin-bottom:16px">
    <h3>故事走向(先定骨架,再谈画面)</h3>
    <div class="story-grid">
      <div><label class="mini">一句话核心(premise)</label>
        <textarea id="story-premise" rows="2" placeholder="例:机械少女只剩24小时电量,少年想陪她看完人生第一场日出">${esc(story.premise)}</textarea></div>
      <div><label class="mini">走向(direction):开头-发展-转折-高潮-结局</label>
        <textarea id="story-direction" rows="4" placeholder="250-400 字,写清情感曲线和每章转折">${esc(story.direction)}</textarea></div>
    </div>
    <div class="form-row">
      <button class="btn" data-act="save-story">保存走向</button>
      <button class="btn primary" data-act="draft-premise">🪄 AI 起草故事骨架${p.script ? '(基于剧本创意)' : '(先在「剧本」tab 写创意)'}</button>
      <span class="hint">AI 只产草稿 → 你改 → 点「采纳」才写入,不会自动生成任何画面</span>
    </div>
  </div>

  <div class="flowstrip">${flow}</div>

  <div class="wrap-head"><h1 style="font-size:16px">章节与节拍</h1><div class="spacer"></div>
    <button class="btn" data-act="add-arc">＋添加章节</button></div>
  ${arcs.length ? `<div class="story2col"><aside class="arc-nav">${arcNav}</aside><section class="arc-detail">${detail}</section></div>` : '<div class="empty">还没有章节。用「AI 起草故事骨架」一键生成,或「＋添加章节」手动搭。</div>'}
  <div class="hint" style="margin-top:14px">工作流:走向 → 章节 → 节拍 → 场景 → 分镜台逐场景出分镜(纯文本)→ 满意后 🔒 锁定 → 才解锁批量图/视频。视频闸门在分镜台,锁定前批量生成会被拒绝。</div>`;
}

function showDraftModal() {
  const d = S.draft;
  if (!d) return;
  const rows = d.items.map((it, i) => `<div class="draft-row">${d.fields.map(f =>
    f.type === 'textarea'
      ? `<textarea data-draft="${i}" data-field="${f.key}" rows="2" placeholder="${f.label}">${esc(it[f.key] || '')}</textarea>`
      : `<input data-draft="${i}" data-field="${f.key}" value="${esc(it[f.key] || '')}" placeholder="${f.label}">`).join('')}</div>`).join('');
  modal(`<h2>🪄 ${esc(d.title)} <span class="hint">AI 草稿 · 改完点「采纳」才写入</span></h2>${rows}
    <div class="foot">
      <button class="btn" data-act="draft-more">🪄 再补一组</button>
      <button class="btn" data-act="close-modal">丢弃</button>
      <button class="btn primary" data-act="adopt-draft">✓ 采纳写入</button>
    </div>`);
}
function readDraft() {
  const items = S.draft.items.map(it => ({ ...it }));
  document.querySelectorAll('[data-draft]').forEach(el => {
    const i = Number(el.dataset.draft), f = el.dataset.field;
    if (items[i]) items[i][f] = el.value.trim();
  });
  return items;
}
function render() {
  document.title = S.view === 'project' && S.project ? `${S.project.title} · 漫剧工坊` : '漫剧工坊 · Manju Studio';
  if (S.view === 'home') renderHome();
  else renderProject();
}

function renderHome() {
  const cards = S.projects.map(p => `
    <div class="pcard" data-act="open-project" data-id="${p.id}">
      <div class="cover" style="${p.cover ? `background-image:url(${p.cover})` : ''}">${p.cover ? '' : '🎞️'}</div>
      <div class="meta"><span class="badge">${p.shotCount || 0} 镜</span><b>${esc(p.title)}</b><span>${esc(p.style || '')} · ${new Date(p.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${p.film ? ' · ✅ 有成片' : ''}</span></div>
    </div>`).join('');
  app().innerHTML = `
  <section class="hero">
    <h1>漫剧工坊 <em>Manju Studio</em></h1>
    <p>从一句话创意到竖屏成片的完整流水线:分镜脚本 → 角色设定图 → 分镜图 → AI 图生视频 → 免费配音 → 字幕烧录与合成。
    文本/生图/生视频统一走<b style="color:var(--accent)">火山方舟</b>(豆包文本 + Seedream + Seedance),配音用 edge-tts(¥0),合成由本地 ffmpeg 完成。</p>
    <div class="pills">
      <span class="pill">${S.health.planConfigured ? 'Agent Plan <b>套餐生效中</b>(文本/生图 0 现金)' : '按量付费 · <b>无月费</b>'}</span>
      <span class="pill">一集 6 镜 ≈ <b>¥2~4</b></span>
      <span class="pill">TTS <b>¥0</b></span>
      <span class="pill">角色一致性 <b>参考图生成</b></span>
    </div>
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn primary" data-act="new-project">＋ 新建漫剧项目</button>
      ${S.health.keyConfigured ? '' : `<button class="btn" data-act="open-settings">先去配置方舟 Key</button>`}
    </div>
  </section>

  <div class="wrap-head"><h1 style="font-size:18px">我的项目</h1><div class="spacer"></div>
    <button class="btn" data-act="new-project">＋ 新建</button></div>
  <div class="grid-projects">${cards || '<div class="empty">还没有项目<br>点右上角「新建」,粘贴一段故事创意,30 秒后就能看到分镜。</div>'}</div>`;
}

/* ---------- 渲染:项目 ---------- */
function stepChip(stage, label, n, project) {
  const done = n && /^(\d+\/\d+)$/.test(n) && n.split('/')[0] === n.split('/')[1];
  const active = project.running === stage;
  return `<div class="step ${done ? 'done' : ''} ${active ? 'active' : ''}" data-act="gen" data-stage="${stage}" title="点击执行该阶段">
    <span class="num">${done ? '✓' : active ? '⏳' : ''}</span>${label}<span class="n">${n || ''}</span></div>`;
}

function nextStepOf(p) {
  const shots = p.shots || [], scenes = p.scenes || [], chars = p.characters || [];
  const story = p.story || {};
  const goto = tab => () => navigate(projectPath(tab));
  if (!p.script && !story.premise) return { text: '从一句话创意开始:先写一段故事创意', btn: '去剧本', go: goto('script') };
  if (!story.premise && !(story.arcs || []).length) return { text: '让 AI 起草故事骨架,开始脉络设计', btn: '去脉络', go: goto('story') };
  if (!(story.arcs || []).length) return { text: '把故事走向拆成大章节', btn: '去脉络', go: goto('story') };
  if (!scenes.length) return { text: '把节拍拆成可拍摄的场景', btn: '去脉络', go: goto('story') };
  const empty = scenes.find(s => !shots.some(x => x.sceneId === s.id));
  if (empty) return { text: `为「${empty.title}」生成分镜(纯文本,免费)`, btn: '去生成', go: () => navigate(`/project/${p.id}/shots?scene=${empty.id}`) };
  if (chars.some(c => !c.refImage)) return { text: '生成缺失的角色设定图(跨镜头形象一致的基础)', btn: '去生成', gen: { stage: 'characters' } };
  const noPanel = shots.find(s => s.panelStatus !== 'done');
  if (noPanel) return { text: `为第 ${noPanel.idx} 镜生成画面(套餐内 0 现金)`, btn: '去生成', go: () => navigate(`/project/${p.id}/shots?scene=${noPanel.sceneId}`), gen: { stage: 'panels', body: { shotIdx: noPanel.idx } } };
  if (!scenes.some(s => s.locked)) return { text: '分镜满意后 🔒 锁定场景,才解锁批量视频', btn: '去锁定', go: goto('shots') };
  const lockedPending = shots.filter(s => { const sc = scenes.find(x => x.id === s.sceneId); return sc && sc.locked && s.panelStatus === 'done' && s.clipStatus === 'none'; });
  if (lockedPending.length) {
    const sc = scenes.find(x => x.id === lockedPending[0].sceneId);
    return { text: `为已锁定的「${sc.title}」生成视频片段(${lockedPending.length} 镜,按量计费)`, btn: '去生成', gen: { stage: 'clips', body: { sceneId: sc.id } } };
  }
  if (shots.some(s => (s.dialogue || '').trim() && s.voiceStatus !== 'done' && s.voiceStatus !== 'skipped'))
    return { text: '为台词配音(edge-tts 免费,未变化的自动跳过)', btn: '去配音', gen: { stage: 'voice' } };
  if (!p.film) return { text: '所有素材就绪,合成成片', btn: '去合成', gen: { stage: 'film' } };
  return { text: '全流程完成 —— 可重roll细节、生成封面,或新建下一集', btn: '生成封面', gen: { stage: 'cover' } };
}

function renderProject() {
  const p = S.project;
  S._ns = nextStepOf(p);
  const shots = p.shots || [];
  const chars = p.characters || [];
  const engineAnimatic = S.settings.videoEngine === 'animatic';
  const withDlg = shots.filter(s => (s.dialogue || '').trim());
  const doneCount = (arr, f) => arr.filter(f).length;

  const steps = [
    stepChip('storyboard', '① 分镜脚本', shots.length ? shots.length + '镜' : '', p),
    stepChip('characters', '② 角色图', chars.length ? `${doneCount(chars, c => c.refImage)}/${chars.length}` : '', p),
    stepChip('panels', '③ 分镜图', shots.length ? `${doneCount(shots, s => s.panelStatus === 'done')}/${shots.length}` : '', p),
    stepChip('clips', engineAnimatic ? '④ 动态漫(免费)' : '④ 视频片段(锁定后)', shots.length ? (engineAnimatic ? '已启用' : `${doneCount(shots, s => s.clipStatus === 'done')}/${shots.length}`) : '', p),
    stepChip('voice', '⑤ 配音', withDlg.length ? `${doneCount(shots, s => s.voiceStatus === 'done')}/${withDlg.length}` : '', p),
    stepChip('film', '⑥ 合成成片', p.film ? '✓' : '', p),
  ];

  const tabs = [
    ['story', '脉络'], ['shots', `分镜台(${shots.length})`], ['chars', `角色(${chars.length})`],
    ['script', '剧本'], ['film', '成片'], ['logs', '日志'],
  ].map(([k, label]) => `<div class="tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${label}</div>`).join('');

  app().innerHTML = `
  <div class="proj-head">
    <span class="back" data-act="home">← 项目</span>
    <h1 data-act="rename-project" title="点击重命名">${esc(p.title)}</h1>
    <span class="chip">${esc(p.style)}</span>
    <span class="chip">${engineAnimatic ? '动态漫模式' : 'Seedance ' + S.settings.resolution}</span>
    <span class="spacer"></span>
    <span class="status-dot ${p.running ? 'run' : p.lastError ? 'err' : shots.length && p.film ? 'ok' : ''}"></span>
    <span style="font-size:12px;color:var(--dim)">${p.running ? '执行中:' + p.running : p.lastError ? '出错' : shots.length ? '待命' : '空项目'}</span>
    <span class="cost-chip" title="按约值单价估算:生图 ¥0.2/张 · 视频 ¥${S.prices.video720}/条(720p) · TTS ¥0">预估已花费 ≈ ¥${p.cost || 0}</span>
    ${p.coverImageUrl ? `<img src="${p.coverImageUrl}" class="cover-thumb" data-act="preview" data-kind="img" data-url="${p.coverImageUrl}" title="封面图,点击放大">` : ''}
    <button class="btn small" data-act="gen" data-stage="cover">🎨 ${p.coverImageUrl ? '重生成封面' : '生成封面'}</button>
    <button class="btn small" data-act="undo" ${p.history && p.history.undo ? '' : 'disabled'} title="撤销:${esc((p.history && p.history.last) || '无')}">↶ 撤销${p.history && p.history.undo ? '(' + p.history.undo + ')' : ''}</button>
    <button class="btn small" data-act="redo" ${p.history && p.history.redo ? '' : 'disabled'} title="重做">↷ 重做${p.history && p.history.redo ? '(' + p.history.redo + ')' : ''}</button>
    ${p.running ? '<button class="btn small danger" data-act="stop">⏹ 停止队列</button>' : ''}
  </div>
  ${p.lastError ? `<div class="err-banner">⚠ ${esc(p.lastError)}<br><span style="color:var(--dim)">可在「设置」中更换已开通的模型,或到火山方舟控制台开通对应模型后重试。</span></div>` : ''}
  ${S._ns ? `<div class="nextstep"><span class="ns-badge">下一步</span><span class="ns-text">${esc(S._ns.text)}</span><button class="btn small primary" data-act="ns-go">${esc(S._ns.btn)}</button><span class="hint" style="margin-left:auto">Ctrl+K = 命令面板</span></div>` : ''}
  <div class="pipeline">${steps.join('')}</div>
  <div class="tabs">${tabs}</div>
  <div id="tab-body">${renderTab()}</div>`;
}

function renderTab() {
  if (S.tab === 'story') return renderStory();
  if (S.tab === 'shots') return renderShots();
  if (S.tab === 'chars') return renderChars();
  if (S.tab === 'script') return renderScript();
  if (S.tab === 'film') return renderFilm();
  if (S.tab === 'logs') {
    const logs = (S.project.log || []).slice().reverse();
    return `<div class="panel-card"><h3>执行日志</h3><div class="log-list">${
      logs.map(l => `<div><span class="t">${new Date(l.t).toLocaleTimeString('zh-CN')}</span>${esc(l.msg)}</div>`).join('') || '<div class="empty">暂无日志</div>'
    }</div></div>`;
  }
  return '';
}

function renderShots() {
  const p = S.project;
  const scenes = p.scenes || [];
  if (!scenes.length) {
    return `<div class="empty">还没有场景。<br>到「脉络」tab 用 AI 把节拍拆成场景,再回到这里逐场景生成分镜。<br>
      <button class="btn primary" data-act="tab" data-tab="story">去脉络工作室</button></div>`;
  }
  if (!S.sceneId || !scenes.some(s => s.id === S.sceneId)) S.sceneId = scenes[0].id;
  const cur = scenes.find(s => s.id === S.sceneId);
  const list = p.shots.filter(s => s.sceneId === S.sceneId);
  const cards = list.map(sh => {
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
          ${sh.audioUrl ? `<span class="tag" style="color:var(--ok)">🔊 ${sh.speaker}</span>` : sh.dialogue ? `<span class="tag">🗣 ${esc(sh.speaker || '旁白')}</span>` : ''}
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
  }).join('');
  const sceneBar = `
  <div class="scene-bar">
    <select data-change="scene-select">
      ${scenes.map(s => `<option value="${s.id}" ${s.id === S.sceneId ? 'selected' : ''}>${esc(s.title)}${s.locked ? ' 🔒' : ''}</option>`).join('')}
      <option value="__all__" ${S.sceneId === '__all__' ? 'selected' : ''}>全部场景(${p.shots.length} 镜)</option>
    </select>
    ${cur ? `<span class="scene-desc" title="${esc(cur.description)}">${esc(cur.description || '')}</span>` : '<span class="scene-desc">全部场景的镜头</span>'}
    <div class="spacer"></div>
    ${cur ? `<button class="btn small ${cur.locked ? '' : 'primary'}" data-act="toggle-lock" data-scene-id="${cur.id}">${cur.locked ? '🔒 已锁定(点按解锁)' : '🔒 锁定分镜(解锁批量视频)'}</button>
    <button class="btn small" data-act="gen" data-stage="sceneShots" data-scene-id="${cur.id}">🪄 AI 生成本场景分镜(纯文本)</button>` : ''}
  </div>`;
  if (!list.length && S.sceneId !== '__all__') {
    return sceneBar + `<div class="empty">场景「${esc(cur.title)}」还没有分镜。<br>
      <button class="btn primary" data-act="gen" data-stage="sceneShots" data-scene-id="${cur.id}">🪄 AI 生成本场景分镜(纯文本,免费)</button>
      <div class="hint">会基于故事走向/章节/节拍上下文产出 4-8 镜,生成后可逐镜改台词与画面描述</div></div>`;
  }
  return sceneBar + `<div class="shots-grid">${cards}</div>`;
}

function renderChars() {
  const p = S.project;
  if (!(p.characters || []).length) return `<div class="empty">还没有角色。先生成「① 分镜脚本」。</div>`;
  const cards = p.characters.map(c => `
    <div class="char">
      <div class="img">${c.refUrl ? `<img src="${c.refUrl}" data-act="preview" data-kind="img" data-url="${c.refUrl}">` : `<div>${c.status === 'pending' ? '⏳ 生成中…' : '👤<br><span style="font-size:12px">暂无设定图</span>'}</div>`}</div>
      <div class="body">
        <input type="text" data-change="char" data-id="${c.id}" data-field="name" value="${esc(c.name)}" style="width:100%;background:var(--bg2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:13px">
        <textarea data-change="char" data-id="${c.id}" data-field="desc" rows="2">${esc(c.desc)}</textarea>
        <div style="display:flex;gap:6px">
          <button class="btn small" data-act="gen" data-stage="characters" ${c.refUrl ? 'disabled' : ''}>${c.refUrl ? '✓ 已生成' : '🎨 生成设定图'}</button>
          ${c.status === 'error' ? `<span style="color:var(--err);font-size:11px;align-self:center">${esc(c.error || '')}</span>` : ''}
        </div>
      </div>
    </div>`).join('');
  return `<div class="wrap-head"><span style="color:var(--dim);font-size:13px">角色设定图用于分镜图生成的参考,保证同一角色在所有镜头里长相一致。</span>
    <div class="spacer"></div><button class="btn" data-act="gen" data-stage="characters">🎨 为缺图角色批量生成</button></div>
    <div class="chars-grid">${cards}</div>`;
}

function renderScript() {
  const p = S.project;
  return `<div class="panel-card" style="max-width:860px">
    <h3>故事创意 / 剧本</h3>
    <textarea class="big" id="script-input" placeholder="粘贴你的故事创意或完整剧本,例如:都市夜归的少年在便利店遇到一只会说话的猫,它自称是失业的神明……">${esc(p.script || '')}</textarea>
    <div class="form-row">
      <span>画风</span>
      <select id="style-input">${S.styles.map(s => `<option value="${s.key}" ${p.style === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
      <span>镜头数</span>
      <input type="number" id="shots-input" min="3" max="12" value="${p.shotsTarget || 6}" style="width:70px">
      <div class="spacer"></div>
      <button class="btn" data-act="save-script">保存</button>
      <button class="btn primary" data-act="gen-storyboard">✨ ${p.shots.length ? '重新生成分镜(会覆盖现有镜头)' : '生成分镜脚本'}</button>
    </div>
    <div style="color:var(--dim);font-size:12.5px;line-height:1.8;margin-top:8px">生成分镜后,到「分镜台」逐镜微调画面描述与台词,再按 ②→⑥ 顺序执行。台词以「(内心)」开头的将作为内心独白配音。</div>
  </div>`;
}

function renderFilm() {
  const p = S.project;
  const shots = p.shots || [];
  const panels = shots.filter(s => s.panelStatus === 'done').length;
  const chars = (p.characters || []).filter(c => c.refUrl).length;
  const clips = shots.filter(s => s.clipStatus === 'done').length;
  const vp = S.settings.resolution === '480p' ? S.prices.video480 : S.prices.video720;
  return `<div class="film-wrap">
    ${p.filmUrl
      ? `<div><video src="${p.filmUrl}?t=${Date.now()}" controls></video>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn small" style="text-decoration:none" href="${p.filmUrl}" download="film.mp4">⬇ 下载成片</a>
          ${p.coverImageUrl ? `<a class="btn small" style="text-decoration:none" href="${p.coverImageUrl}" download="cover.jpg">⬇ 下载封面</a>` : ''}
          <button class="btn small" data-act="gen" data-stage="film">重新合成</button></div></div>`
      : `<div class="panel-card" style="display:grid;place-items:center;min-height:300px;text-align:center;color:var(--dim);line-height:2">
          🎞️<br>还没有成片<br><button class="btn primary" data-act="gen" data-stage="film" ${shots.length ? '' : 'disabled'}>合成成片</button></div>`}
    <div class="panel-card">
      <h3>成本与管线状态</h3>
      <table class="cost-table">
        <tr><th>资源</th><th>数量</th><th>单价(约)</th><th>小计</th></tr>
        <tr><td>分镜图(Seedream 4.0)</td><td>${panels} 张</td><td>¥${S.prices.image}</td><td><b>¥${(panels * S.prices.image).toFixed(2)}</b></td></tr>
        <tr><td>角色设定图(Seedream 4.0)</td><td>${chars} 张</td><td>¥${S.prices.image}</td><td><b>¥${(chars * S.prices.image).toFixed(2)}</b></td></tr>
        <tr><td>视频片段(${S.settings.videoEngine === 'animatic' ? '动态漫,免费' : 'Seedance ' + S.settings.resolution})</td><td>${S.settings.videoEngine === 'animatic' ? 0 : clips} 条</td><td>${S.settings.videoEngine === 'animatic' ? '¥0' : '¥' + vp}</td><td><b>¥${(S.settings.videoEngine === 'animatic' ? 0 : clips * vp).toFixed(2)}</b></td></tr>
        <tr><td>配音(edge-tts)</td><td>${shots.filter(s => s.audioUrl).length} 段</td><td>¥0</td><td><b>¥0</b></td></tr>
        <tr><td>文本(剧本/分镜)</td><td>1 次</td><td>≈¥${S.prices.chat}</td><td><b>¥${S.prices.chat}</b></td></tr>
        <tr><th colspan="3">本集预估合计</th><th><b style="color:var(--accent2)">¥${p.cost || 0}</b></th></tr>
      </table>
      <div style="margin-top:12px;color:var(--dim);font-size:12.5px;line-height:1.9">
        · 合成流程:每镜视频(或分镜图 Ken Burns 动效)对齐配音时长 → 烧录台词字幕 → 无损拼接 864×1536@25fps<br>
        · 想省钱:设置里把视频引擎切到「动态漫」,视频成本直接归零,成片仍带运镜和配音
      </div>
    </div>
  </div>`;
}

/* ---------- 弹窗 ---------- */
function newProjectModal() {
  modal(`
    <h2>新建漫剧项目</h2>
    <label>项目名</label><input type="text" id="np-title" value="未命名漫剧">
    <label>画风</label><select id="np-style">${S.styles.map(s => `<option value="${s.key}">${s.label}</option>`).join('')}</select>
    <label>镜头数(每镜约 5 秒)</label><input type="number" id="np-shots" min="3" max="12" value="6">
    <label>故事创意 / 剧本(作为脉络工作室的原料;创建后先进「脉络」打磨,不会自动生成画面)</label>
    <textarea id="np-script" placeholder="例:高三少年在暴雨夜的天台遇到一个自称来自十年后的机械少女,她只剩 24 小时电量,想看一场真正的日出……"></textarea>
    <div class="form-row"><input type="checkbox" id="np-auto"> <label for="np-auto" style="margin:0">跳过脉络打磨,创建后直接按旧模式自动生成分镜(不推荐)</label></div>
    <div class="foot"><button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-act="create-project">创建项目</button></div>`);
}

async function settingsModal() {
  if (!S.catalog) S.catalog = await api('/api/catalog').catch(() => null);
  const st = S.settings;
  const opts = (list, cur) => list.map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('');
  const state = m => {
    const ms = (S.catalog && S.catalog.modelState) ? S.catalog.modelState[m] : null;
    if (!ms) return '';
    return ms.ok ? '<span class="mstate ok">● 已验证可用</span>' : `<span class="mstate err">● ${esc((ms.reason || '').slice(0, 60))}</span>`;
  };
  const speakers = S.project ? [...new Set((S.project.shots || []).map(s => s.speaker).filter(Boolean))] : [];
  modal(`
    <h2>⚙ 平台设置</h2>
    <label>Agent Plan API Key(文本+生图走套餐额度;留空则这两类也走按量)</label>
    <input type="text" id="st-plankey" placeholder="${st.planKeySource === 'env' ? '当前使用环境变量 ARK_PLAN_API_KEY' : st.planKeySource === 'settings' ? '当前使用已保存的套餐 Key' : '尚未配置套餐'}" value="">
    <div class="sect"><h3 style="font-size:14px;margin-bottom:10px">阿里云百炼(通义)— 文本备用引擎</h3>
      <label>百炼 API Key(标准 sk- 开头;sk-sp- 团队版不可用;留空用环境变量 QIANWEN_API_KEY;文本模型有免费额度)</label>
      <input type="text" id="st-qianwenkey" placeholder="${st.aliyunKeySource === 'env' ? '当前使用环境变量中的百炼 Key' : st.aliyunKeySource === 'settings' ? '当前使用已保存的百炼 Key' : '尚未配置阿里百炼'}" value="">
      <div class="form-row" style="margin-top:12px">
        <span>文本</span>
        <div class="radio-row">${[['ark', '火山(AgentPlan 套餐)'], ['aliyun', '阿里通义(免费额度)']].map(([v, l]) => `<button class="btn small ${st.textProvider === v ? 'on' : ''}" data-act="set-prov" data-cap="text" data-v="${v}">${l}</button>`).join('')}</div>
      </div>
      <div class="model-grid" style="margin-top:14px">
        <div><label>阿里文本模型</label><select id="st-alichat">${opts(S.catalog ? S.catalog.aliyunChat : ['qwen-plus'], st.aliyunTextModel)}</select></div>
      </div>
      <div class="hint" style="margin-top:8px">生图 / 视频 / 配音固定走火山方舟(阿里按量未开通,不提供入口):生图与封面用套餐 Seedream,视频走按量 Seedance,配音用免费 edge-tts。</div>
    </div>
    <div class="sect"><h3 style="font-size:14px;margin-bottom:10px">生成引擎(火山 · 文本模型均在 AgentPlan 套餐内,0 现金)</h3>
      <label>按量 API Key(视频生成用——套餐不含视频;留空使用环境变量 VOLCENGINE_ARK_API_KEY)</label>
      <input type="text" id="st-key" placeholder="${st.keySource === 'env' ? '当前使用环境变量中的 Key' : st.keySource === 'settings' ? '当前使用已保存的按量 Key' : '尚未配置'}" value="">
      <div class="model-grid">
        <div><label>文本模型(套餐,剧本/分镜)</label><select id="st-chat">${opts(S.catalog ? S.catalog.planChat : [], st.chatModel)}</select>${state(st.chatModel)}</div>
        <div><label>生图模型(套餐,角色/分镜图)</label><select id="st-image">${opts(S.catalog ? S.catalog.planImage : [], st.imageModel)}</select></div>
        <div><label>视频模型(按量,图生视频)</label><select id="st-video">${opts(S.catalog ? S.catalog.video : [], st.videoModel)}</select></div>
        <div><label>连通性测试</label><div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small" data-act="test-model">🔌 文本</button>
          <button class="btn small" data-act="test-model-image">🧪 生图(耗少量额度)</button>
        </div></div>
      </div>
      <div class="form-row" style="margin-top:16px">
        <span>视频引擎</span>
        <div class="radio-row">
          <button class="btn small ${st.videoEngine === 'ark' ? 'on' : ''}" data-act="set-engine" data-v="ark">AI 视频(按量)</button>
          <button class="btn small ${st.videoEngine === 'animatic' ? 'on' : ''}" data-act="set-engine" data-v="animatic">动态漫(0 视频成本)</button>
        </div>
        <span style="margin-left:14px">分辨率</span>
        <div class="radio-row">
          ${['480p', '720p'].map(r => `<button class="btn small ${st.resolution === r ? 'on' : ''}" data-act="set-res" data-v="${r}">${r}</button>`).join('')}
        </div>
      </div>
      <div class="form-row"><input type="checkbox" id="st-tts" ${st.ttsEnabled ? 'checked' : ''}> <label for="st-tts" style="margin:0">启用配音(edge-tts,免费)</label></div>
      <div class="form-row"><input type="checkbox" id="st-polish" ${st.promptPolish !== false ? 'checked' : ''}> <label for="st-polish" style="margin:0">生图前用文本模型润色提示词(多参考图引用式,借鉴 LumenX 两阶段链,套餐内 0 现金)</label></div>
    </div>
    ${speakers.length ? `<div class="sect"><h3 style="font-size:14px;margin-bottom:10px">音色分配(本项目说话人 → edge-tts 音色)</h3>
      ${speakers.map(sp => `<div class="form-row"><span style="min-width:90px">${esc(sp)}</span>
        <select data-voice-speaker="${esc(sp)}" style="flex:1"><option value="">自动推断(按说话人名字)</option>${Object.keys(S.voices).map(v => `<option value="${v}" ${(st.speakerVoices[sp] || '') === v ? 'selected' : ''}>${v}(${S.voices[v]})</option>`).join('')}</select></div>`).join('')}
    </div>` : ''}
    <div class="sect"><h3 style="font-size:14px;margin-bottom:10px">成本单价(约值,以方舟官网为准)</h3>
      <table class="cost-table">
        <tr><td>生图(套餐内 0 现金;按量参考价)</td><td>≈ ¥0.2/张</td></tr>
        <tr><td>Seedance 720p 5s(按量)</td><td>≈ ¥0.37/条</td></tr>
        <tr><td>Seedance 480p 5s(按量)</td><td>≈ ¥0.2/条</td></tr>
        <tr><td>文本(套餐内 0 现金)</td><td>≈ ¥0.02/集</td></tr>
        <tr><td>edge-tts 配音</td><td>¥0</td></tr>
      </table>
    </div>
    <div class="foot"><button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-act="save-settings">保存设置</button></div>`);
}

/* ---------- 事件 ---------- */
const debounces = {};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  try {
    if (act === 'home') navigate('/');
    else if (act === 'open-project') navigate('/project/' + el.dataset.id);
    else if (act === 'new-project') newProjectModal();
    else if (act === 'close-modal') closeModal();
    else if (act === 'create-project') {
      const body = {
        title: $('#np-title').value.trim() || '未命名漫剧',
        style: $('#np-style').value,
        shotsTarget: Number($('#np-shots').value) || 6,
        script: $('#np-script').value.trim(),
        autostart: $('#np-auto') ? $('#np-auto').checked : false,
      };
      if (!body.script) return toast('请先写一段故事创意', 'err');
      const p = await api('/api/projects', 'POST', body);
      closeModal();
      toast(body.autostart ? '项目已创建,正在生成分镜…' : '项目已创建,先去「脉络」打磨故事走向', 'ok');
      await openProject(p.id, body.autostart ? 'shots' : 'story');
      history.pushState({}, '', projectPath(S.tab));
    } else if (act === 'open-settings') settingsModal();
    else if (act === 'why-ark') whyArkModal();
    else if (act === 'set-prov') { S.settings[el.dataset.cap + 'Provider'] = el.dataset.v; settingsModal(); }
    else if (act === 'set-engine') { S.settings.videoEngine = el.dataset.v; settingsModal(); }
    else if (act === 'set-res') { S.settings.resolution = el.dataset.v; settingsModal(); }
    else if (act === 'save-settings') {
      const body = {
        chatModel: $('#st-chat').value, imageModel: $('#st-image').value, videoModel: $('#st-video').value,
        videoEngine: S.settings.videoEngine, resolution: S.settings.resolution,
        ttsEnabled: $('#st-tts').checked,
        promptPolish: $('#st-polish').checked,
        textProvider: S.settings.textProvider,
        aliyunTextModel: $('#st-alichat').value,
      };
      const key = $('#st-key').value.trim();
      if (key) body.arkKey = key;
      const planKeyVal = $('#st-plankey').value.trim();
      if (planKeyVal) body.planKey = planKeyVal;
      const aliKeyVal = $('#st-qianwenkey').value.trim();
      if (aliKeyVal) body.qianwenKey = aliKeyVal;
      document.querySelectorAll('[data-voice-speaker]').forEach(sel => { body.speakerVoices = body.speakerVoices || {}; body.speakerVoices[sel.dataset.voiceSpeaker] = sel.value; });
      S.settings = await api('/api/settings', 'PUT', body);
      S.health = await api('/api/health');
      S.catalog = null;
      renderHealth(); closeModal(); toast('设置已保存', 'ok'); render();
    } else if (act === 'test-model') {
      S.settings.chatModel = $('#st-chat').value;
      toast('正在测试 ' + S.settings.chatModel + ' …');
      const r = await api('/api/models/check', 'POST', { kind: 'chat', model: S.settings.chatModel });
      toast(r.ok ? `✓ ${r.model} 可用(套餐)` : `✗ ${r.reason}`, r.ok ? 'ok' : 'err');
      S.catalog = await api('/api/catalog'); settingsModal();
    } else if (act === 'test-model-image') {
      S.settings.imageModel = $('#st-image').value;
      toast('正在测试 ' + S.settings.imageModel + '(生成一张 512 测试图)…');
      const r = await api('/api/models/check', 'POST', { kind: 'image', model: S.settings.imageModel });
      toast(r.ok ? `✓ ${r.model} 可用(套餐生图)` : `✗ ${r.reason}`, r.ok ? 'ok' : 'err');
      S.catalog = await api('/api/catalog'); settingsModal();
    } else if (act === 'undo' || act === 'redo') {
      try {
        const r = await api(`/api/projects/${S.project.id}/${act}`, 'POST', {});
        toast(`${act === 'undo' ? '↶ 已撤销' : '↷ 已重做'}:${r.label}`, 'ok');
      } catch (e) { toast(e.message, 'err'); }
      await refreshProject();
    } else if (act === 'ns-go') {
      const ns = S._ns; if (!ns) return;
      if (ns.gen) { await api(`/api/projects/${S.project.id}/generate/${ns.gen.stage}`, 'POST', ns.gen.body || {}); toast(`已排队:${ns.gen.stage}`, 'ok'); throttledRefresh(); }
      else ns.go();
    } else if (act === 'sel-arc') { S.selArc = el.dataset.arc; render();
    } else if (act === 'save-story') {
      S.project = await api('/api/projects/' + S.project.id, 'PUT', {
        story: { premise: $('#story-premise').value, direction: $('#story-direction').value }, label: '编辑',
      });
      toast('故事走向已保存', 'ok'); render();
    } else if (act === 'draft-premise') {
      if (!S.project.script) return toast('请先在「剧本」tab 写一段创意,AI 才有原料', 'err');
      const req = { kind: 'premise', idea: S.project.script, count: 1 };
      toast('AI 正在起草故事骨架…');
      const data = await api('/api/ai/draft', 'POST', req);
      S.draft = { kind: 'premise', req, title: '故事骨架:核心冲突与走向', items: [{ title: data.title || '', premise: data.premise || '', direction: data.direction || '' }],
        fields: [{ key: 'title', label: '剧集名', type: 'input' }, { key: 'premise', label: '一句话核心(≤50字)', type: 'textarea' }, { key: 'direction', label: '故事走向(250-400字)', type: 'textarea' }],
        extra: data.characters || [] };
      showDraftModal();
    } else if (act === 'draft-arcs') {
      const st = S.project.story || {};
      if (!st.premise && !st.direction) return toast('先保存故事走向,再拆章节', 'err');
      const req = { kind: 'arcs', premise: st.premise, direction: st.direction, count: 3 };
      toast('AI 正在拆章节…');
      const data = await api('/api/ai/draft', 'POST', req);
      S.draft = { kind: 'arcs', req, title: '章节草稿', items: data.arcs || [],
        fields: [{ key: 'title', label: '章节名', type: 'input' }, { key: 'purpose', label: '全局作用', type: 'input' }, { key: 'summary', label: '本章概要', type: 'textarea' }] };
      showDraftModal();
    } else if (act === 'draft-beats') {
      const arc = (S.project.story.arcs || []).find(a => a.id === el.dataset.arc);
      if (!arc) return toast('章节不存在', 'err');
      const st = S.project.story || {};
      const req = { kind: 'beats', premise: st.premise, direction: st.direction, arc: { title: arc.title, summary: arc.summary }, count: 3 };
      toast('AI 正在拆节拍…');
      const data = await api('/api/ai/draft', 'POST', req);
      S.draft = { kind: 'beats', req, arcId: arc.id, title: `「${arc.title}」节拍草稿`, items: data.beats || [],
        fields: [{ key: 'title', label: '节拍名', type: 'input' }, { key: 'emotion', label: '情绪', type: 'input' }, { key: 'intent', label: '推进什么', type: 'input' }, { key: 'summary', label: '发生什么', type: 'textarea' }] };
      showDraftModal();
    } else if (act === 'draft-scenes') {
      const arc = (S.project.story.arcs || []).find(a => a.id === el.dataset.arc);
      const beat = arc ? (arc.beats || []).find(b => b.id === el.dataset.beat) : null;
      if (!arc || !beat) return toast('节拍不存在', 'err');
      const st = S.project.story || {};
      const cast = (S.project.characters || []).map(c => c.name).join(',');
      const req = { kind: 'scenes', premise: st.premise, arc: { title: arc.title, summary: arc.summary }, beat: { title: beat.title, summary: beat.summary }, cast, count: 2 };
      toast('AI 正在把节拍落成场景…');
      const data = await api('/api/ai/draft', 'POST', req);
      S.draft = { kind: 'scenes', req, arcId: arc.id, beatId: beat.id, title: `「${beat.title}」场景草稿`, items: (data.scenes || []).map(s => ({ ...s, cast: (s.cast || []).join(',') })),
        fields: [{ key: 'title', label: '场景名', type: 'input' }, { key: 'location', label: '地点', type: 'input' }, { key: 'time', label: '时间', type: 'input' }, { key: 'cast', label: '出场角色(逗号分隔)', type: 'input' }, { key: 'description', label: '场景内容(要能被画出来)', type: 'textarea' }] };
      showDraftModal();
    } else if (act === 'draft-more') {
      if (!S.draft) return;
      const req = { ...S.draft.req, count: (S.draft.req.count || 2) + 2 };
      toast('AI 正在补充…');
      const data = await api('/api/ai/draft', 'POST', req);
      const key = { arcs: 'arcs', beats: 'beats', scenes: 'scenes' }[S.draft.kind];
      const more = key ? (data[key] || []) : [];
      if (S.draft.kind === 'scenes') more.forEach(s => { s.cast = (s.cast || []).join(','); });
      S.draft.items = S.draft.items.concat(more);
      showDraftModal();
    } else if (act === 'adopt-draft') {
      const d = S.draft; if (!d) return;
      const items = readDraft();
      const pid = S.project.id;
      if (d.kind === 'premise') {
        const body = { story: { premise: items[0].premise, direction: items[0].direction }, label: '采纳 AI 草稿' };
        if (items[0].title && S.project.title === '未命名漫剧') body.title = items[0].title;
        if (d.extra && d.extra.length) body.characters = d.extra.map(c => ({ name: c.name, desc: c.desc }));
        S.project = await api('/api/projects/' + pid, 'PUT', body);
      } else if (d.kind === 'arcs') {
        const arcs = (S.project.story.arcs || []).concat(items.map(a => ({ id: uid('arc'), ...a, beats: [] })));
        S.project = await api('/api/projects/' + pid, 'PUT', { story: { arcs }, label: '采纳 AI 草稿' });
      } else if (d.kind === 'beats') {
        const arcs = (S.project.story.arcs || []).map(a => a.id === d.arcId
          ? { ...a, beats: (a.beats || []).concat(items.map(b => ({ id: uid('beat'), ...b }))) } : a);
        S.project = await api('/api/projects/' + pid, 'PUT', { story: { arcs } });
      } else if (d.kind === 'scenes') {
        const fresh = items.map(s => ({ id: uid('sc'), arcId: d.arcId, beatId: d.beatId, title: s.title, location: s.location, time: s.time,
          cast: String(s.cast || '').split(/[,，]/).map(t => t.trim()).filter(Boolean), description: s.description, locked: false }));
        S.project = await api('/api/projects/' + pid, 'PUT', { scenes: (S.project.scenes || []).concat(fresh), label: '采纳 AI 草稿' });
      }
      S.draft = null; closeModal(); toast('已采纳写入', 'ok'); S.tab = 'story';
      history.replaceState({}, '', projectPath('story')); render();
    } else if (act === 'add-arc') {
      const nid = uid('arc');
      const arcs = (S.project.story.arcs || []).concat([{ id: nid, title: '新章节', purpose: '', summary: '', beats: [] }]);
      S.selArc = nid;
      S.project = await api('/api/projects/' + S.project.id, 'PUT', { story: { arcs }, label: '添加章节' }); render();
    } else if (act === 'del-arc') {
      const scs = (S.project.scenes || []).filter(s => s.arcId === el.dataset.arc);
      const nShots = scs.reduce((n, s) => n + (S.project.shots || []).filter(x => x.sceneId === s.id).length, 0);
      if (scs.length && !(await confirmDialog(`该章节包含 ${scs.length} 个场景 / ${nShots} 个镜头,删除后将一并移除(可 Ctrl+Z 撤销)。确认删除本章?`))) return;
      const arcs = (S.project.story.arcs || []).filter(a => a.id !== el.dataset.arc);
      const body = { story: { arcs }, scenes: (S.project.scenes || []).filter(s => s.arcId !== el.dataset.arc), label: '删除章节' };
      if (scs.length) body.removeSceneShots = scs.map(s => s.id);
      S.project = await api('/api/projects/' + S.project.id, 'PUT', body); render();
    } else if (act === 'add-beat') {
      const arcs = (S.project.story.arcs || []).map(a => a.id === el.dataset.arc
        ? { ...a, beats: (a.beats || []).concat([{ id: uid('beat'), title: '新节拍', intent: '', emotion: '', summary: '' }]) } : a);
      S.project = await api('/api/projects/' + S.project.id, 'PUT', { story: { arcs } }); render();
    } else if (act === 'del-beat') {
      const arcs = (S.project.story.arcs || []).map(a => a.id === el.dataset.arc
        ? { ...a, beats: (a.beats || []).filter(b => b.id !== el.dataset.beat) } : a);
      const dead = (S.project.scenes || []).filter(s => s.beatId === el.dataset.beat);
      if (dead.length && !(await confirmDialog(`该节拍下有 ${dead.length} 个场景及其镜头,删除后一并移除(可 Ctrl+Z 撤销)。确认删除?`))) return;
      const body = { story: { arcs }, scenes: (S.project.scenes || []).filter(s => s.beatId !== el.dataset.beat), label: '删除节拍' };
      if (dead.length) body.removeSceneShots = dead.map(s => s.id);
      S.project = await api('/api/projects/' + S.project.id, 'PUT', body); render();
    } else if (act === 'add-scene') {
      const fresh = { id: uid('sc'), arcId: el.dataset.arc, beatId: el.dataset.beat, title: '新场景', location: '', time: '', cast: [], description: '', locked: false };
      S.project = await api('/api/projects/' + S.project.id, 'PUT', { scenes: (S.project.scenes || []).concat([fresh]), label: '添加场景' }); render();
    } else if (act === 'del-scene') {
      const sc = (S.project.scenes || []).find(s => s.id === el.dataset.sceneId);
      const n = sc ? (S.project.shots || []).filter(x => x.sceneId === sc.id).length : 0;
      if (n && !(await confirmDialog(`该场景有 ${n} 个镜头(可能含已生成的图/视频),删除后一并移除(可 Ctrl+Z 撤销)。确认删除场景?`))) return;
      S.project = await api('/api/projects/' + S.project.id, 'PUT', { scenes: (S.project.scenes || []).filter(s => s.id !== el.dataset.sceneId), removeSceneShots: [el.dataset.sceneId], label: '删除场景' });
      if (S.sceneId === el.dataset.sceneId) S.sceneId = '';
      render();
    } else if (act === 'goto-scene') {
      navigate('/project/' + S.project.id + '/shots?scene=' + el.dataset.sceneId);
    } else if (act === 'toggle-lock') {
      const scenes = (S.project.scenes || []).map(s => s.id === el.dataset.sceneId ? { ...s, locked: !s.locked } : s);
      void 0;
      const t = scenes.find(s => s.id === el.dataset.sceneId);
      S.project = await api('/api/projects/' + S.project.id, 'PUT', { scenes });
      toast(t.locked ? '🔒 场景分镜已锁定,批量视频已解锁' : '已解锁该场景', 'ok'); render();
    } else if (act === 'rename-project') {
      const name = prompt('重命名项目:', S.project.title);
      if (name && name.trim()) { S.project = await api('/api/projects/' + S.project.id, 'PUT', { title: name.trim() }); render(); }
    } else if (act === 'save-script') {
      S.project = await api('/api/projects/' + S.project.id, 'PUT', { script: $('#script-input').value, style: $('#style-input').value, shotsTarget: Number($('#shots-input').value) || 6 });
      toast('剧本已保存', 'ok'); render();
    } else if (act === 'gen-storyboard') {
      const script = $('#script-input').value, style = $('#style-input').value, shotsTarget = Number($('#shots-input').value) || 6;
      if (!script.trim()) return toast('请先写故事创意', 'err');
      await api(`/api/projects/${S.project.id}/generate/storyboard`, 'POST', { script, style, shotsTarget });
      toast('已提交分镜生成…'); throttledRefresh();
    } else if (act === 'tab') { navigate(projectPath(el.dataset.tab)); }
    else if (act === 'gen') {
      const body = {};
      if (el.dataset.shotIdx) body.shotIdx = Number(el.dataset.shotIdx);
      if (el.dataset.stage === 'storyboard') body.script = S.project.script;
      if (el.dataset.sceneId) body.sceneId = el.dataset.sceneId;
      else if (S.sceneId && ['panels', 'clips', 'voice'].includes(el.dataset.stage)) body.sceneId = S.sceneId;
      await api(`/api/projects/${S.project.id}/generate/${el.dataset.stage}`, 'POST', body);
      toast(`已排队:${el.dataset.stage}${body.shotIdx ? '(第 ' + body.shotIdx + ' 镜)' : body.sceneId ? '(当前场景)' : ''}`);
      throttledRefresh();
    } else if (act === 'stop') { await api(`/api/projects/${S.project.id}/stop`, 'POST', {}); toast('将在当前镜头完成后停止'); }
    else if (act === 'preview') lightbox(el.dataset.kind, el.dataset.url);
  } catch (err) {
    toast(err.message + (err.hint ? ' — ' + err.hint : ''), 'err');
  }
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el || !S.project) return;
  const kind = el.dataset.change;
  if (kind === 'scene-select') {
    S.sceneId = el.value === '__all__' ? '__all__' : el.value;
    history.replaceState({}, '', projectPath('shots'));
    render(); return;
  }
  const send = async (body) => {
    body.label = body.label || '编辑';
    try { S.project = await api('/api/projects/' + S.project.id, 'PUT', body); }
    catch (err) { toast(err.message, 'err'); }
  };
  if (kind === 'shot') {
    clearTimeout(debounces[el.dataset.idx + el.dataset.field]);
    debounces[el.dataset.idx + el.dataset.field] = setTimeout(() => {
      send({ shots: [{ idx: Number(el.dataset.idx), [el.dataset.field]: el.value }] });
    }, 600);
  } else if (kind === 'char') {
    clearTimeout(debounces['c' + el.dataset.id]);
    debounces['c' + el.dataset.id] = setTimeout(() => {
      send({ characters: [{ id: el.dataset.id, [el.dataset.field]: el.value }] });
    }, 600);
  } else if (kind === 'scene') {
    clearTimeout(debounces['s' + el.dataset.id + el.dataset.field]);
    debounces['s' + el.dataset.id + el.dataset.field] = setTimeout(() => {
      const scenes = (S.project.scenes || []).map(s => s.id === el.dataset.id
        ? { ...s, [el.dataset.field]: el.dataset.field === 'cast' ? el.value.split(/[,，]/).map(t => t.trim()).filter(Boolean) : el.value } : s);
      send({ scenes });
    }, 600);
  } else if (kind === 'arc' || kind === 'beat') {
    clearTimeout(debounces[kind + el.dataset.id + el.dataset.field]);
    debounces[kind + el.dataset.id + el.dataset.field] = setTimeout(() => {
      const arcs = (S.project.story.arcs || []).map(a => {
        if (kind === 'arc') return a.id === el.dataset.id ? { ...a, [el.dataset.field]: el.value } : a;
        return { ...a, beats: (a.beats || []).map(b => b.id === el.dataset.id && a.id === el.dataset.arc ? { ...b, [el.dataset.field]: el.value } : b) };
      });
      send({ story: { arcs } });
    }, 600);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closePalette(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'k') { e.preventDefault(); openPalette(); return; }
    if (S.view === 'project' && S.project && S.tab === 'story') {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doHistory('undo'); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doHistory('redo'); return; }
    }
    return;
  }
  if (S.pal) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === '?') { shortcutsModal(); return; }
  if (S.view === 'project' && S.project) {
    const i = '123456'.indexOf(e.key);
    if (i >= 0) { navigate(projectPath(TABS[i])); return; }
    if (e.key === 'u') { doHistory('undo'); return; }
    if (e.key === 'y') { doHistory('redo'); return; }
  } else if (S.view === 'home' && e.key === 'n') { newProjectModal(); }
});

function paletteItems() {
  const items = [];
  if (S.view === 'project' && S.project) {
    ['脉络', '分镜台', '角色', '剧本', '成片', '日志'].forEach((l, i) =>
      items.push({ label: `切换到 ${l}`, hint: String(i + 1), run: () => navigate(projectPath(TABS[i])) }));
    items.push({ label: '🪄 AI 生成本场景分镜(纯文本)', run: () => S.sceneId && S.sceneId !== '__all__' ? api(`/api/projects/${S.project.id}/generate/sceneShots`, 'POST', { sceneId: S.sceneId }).then(() => { toast('已排队:场景分镜', 'ok'); throttledRefresh(); }) : toast('请先在分镜台选择一个场景', 'err') });
    items.push({ label: '🎨 生成/重生成封面', run: () => api(`/api/projects/${S.project.id}/generate/cover`, 'POST', {}).then(() => { toast('封面已排队', 'ok'); throttledRefresh(); }) });
    items.push({ label: '🔒 锁定/解锁当前场景', run: () => { const sc = (S.project.scenes || []).find(x => x.id === S.sceneId); if (!sc) return toast('请先在分镜台选择场景', 'err'); const scenes = (S.project.scenes || []).map(x => x.id === sc.id ? { ...x, locked: !x.locked } : x); api(`/api/projects/${S.project.id}`, 'PUT', { scenes, label: '锁定切换' }).then(() => { toast(sc.locked ? '已解锁' : '🔒 已锁定', 'ok'); render(); }); } });
    items.push({ label: '🎬 批量生成视频(当前场景,需锁定)', run: () => api(`/api/projects/${S.project.id}/generate/clips`, 'POST', S.sceneId && S.sceneId !== '__all__' ? { sceneId: S.sceneId } : {}).then(() => { toast('已排队:视频', 'ok'); throttledRefresh(); }) });
    items.push({ label: '🔊 批量配音(未变化的自动跳过)', run: () => api(`/api/projects/${S.project.id}/generate/voice`, 'POST', {}).then(() => { toast('已排队:配音', 'ok'); throttledRefresh(); }) });
    items.push({ label: '🎞 合成成片', run: () => api(`/api/projects/${S.project.id}/generate/film`, 'POST', {}).then(() => { toast('已排队:合成', 'ok'); throttledRefresh(); }) });
    items.push({ label: '↶ 撤销', hint: 'U', run: () => doHistory('undo') });
    items.push({ label: '↷ 重做', hint: 'Y', run: () => doHistory('redo') });
  } else {
    (S.projects || []).forEach(pr => items.push({ label: `打开《${pr.title}》`, run: () => navigate('/project/' + pr.id) }));
    items.push({ label: '＋ 新建漫剧项目', hint: 'N', run: () => newProjectModal() });
  }
  items.push({ label: '⚙ 打开设置', run: () => settingsModal() });
  items.push({ label: '❓ 平台选型比价结论', run: () => whyArkModal() });
  items.push({ label: '⌨ 快捷键速查', hint: '?', run: () => shortcutsModal() });
  return items;
}
function palFiltered() {
  const q = (S.pal ? S.pal.q : '').trim().toLowerCase();
  return paletteItems().filter(it => !q || it.label.toLowerCase().includes(q));
}
function renderPalList() {
  const items = palFiltered();
  if (S.pal.sel >= items.length) S.pal.sel = Math.max(0, items.length - 1);
  $('#pal-list').innerHTML = items.map((it, i) => `<div class="pal-item ${i === S.pal.sel ? 'sel' : ''}" data-pi="${i}"><span>${esc(it.label)}</span>${it.hint ? `<span class="kbd">${it.hint}</span>` : ''}</div>`).join('') || '<div class="pal-item none">无匹配命令</div>';
  [...$('#pal-list').querySelectorAll('.pal-item')].forEach(el => {
    el.addEventListener('click', () => { const it = palFiltered()[Number(el.dataset.pi)]; closePalette(); if (it) it.run(); });
  });
}
function openPalette() {
  S.pal = { q: '', sel: 0 };
  $('#modal-root').innerHTML = `<div class="overlay pal-ov" id="pal-ov"><div class="pal-box" onclick="event.stopPropagation()">
    <input id="pal-input" placeholder="搜索命令…(生成/切换/打开/锁定…)">
    <div id="pal-list" class="pal-list"></div>
    <div class="pal-foot hint">↑↓ 选择 · Enter 执行 · Esc 关闭</div></div></div>`;
  const ov = $('#pal-ov');
  ov.addEventListener('click', e => { if (e.target === ov) closePalette(); });
  const input = $('#pal-input');
  input.addEventListener('input', () => { S.pal.q = input.value; S.pal.sel = 0; renderPalList(); });
  input.addEventListener('keydown', e => {
    const items = palFiltered();
    if (e.key === 'ArrowDown') { e.preventDefault(); S.pal.sel = Math.min(S.pal.sel + 1, items.length - 1); renderPalList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.pal.sel = Math.max(S.pal.sel - 1, 0); renderPalList(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[S.pal.sel]; if (it) { closePalette(); it.run(); } }
  });
  renderPalList();
  input.focus();
}
function closePalette() { S.pal = null; const ov = $('#pal-ov'); if (ov) ov.remove(); }

function shortcutsModal() {
  modal(`<h2>⌨ 快捷键与命令</h2>
  <table class="cost-table">
    <tr><th>按键</th><th>作用</th></tr>
    <tr><td><span class="kbd">Ctrl</span> + <span class="kbd">K</span></td><td>命令面板:搜索并执行任何操作</td></tr>
    <tr><td><span class="kbd">1</span> ~ <span class="kbd">6</span></td><td>项目内切换:脉络 / 分镜台 / 角色 / 剧本 / 成片 / 日志</td></tr>
    <tr><td><span class="kbd">Ctrl</span>+<span class="kbd">Z</span> / <span class="kbd">Y</span></td><td>脉络 tab:撤销 / 重做结构修改</td></tr>
    <tr><td><span class="kbd">U</span> / <span class="kbd">Y</span></td><td>任意 tab:撤销 / 重做</td></tr>
    <tr><td><span class="kbd">N</span></td><td>首页:新建漫剧项目</td></tr>
    <tr><td><span class="kbd">?</span></td><td>打开本速查表</td></tr>
  </table>
  <div class="note" style="margin-top:10px;color:var(--dim);font-size:12.5px">单键快捷键在输入框内打字时不触发;右上角 ❓ 是平台选型比价结论。</div>`);
}
async function doHistory(act) {
  try {
    const r = await api(`/api/projects/${S.project.id}/${act}`, 'POST', {});
    toast(`${act === 'undo' ? '↶ 已撤销' : '↷ 已重做'}:${r.label}`, 'ok');
    await refreshProject();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 启动 ---------- */
(async function init() {
  try {
    await loadAll();
    handleRoute();          // 按当前 URL 恢复视图(支持刷新/直达/分享链接)
  } catch (e) {
    app().innerHTML = `<div class="empty">服务加载失败:${esc(e.message)}<br>请确认 node server.js 正在运行。</div>`;
  }
})();
