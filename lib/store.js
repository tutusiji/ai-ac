'use strict';
const fs = require('fs');
const path = require('path');
const { id, readJSON, writeJSON } = require('./util');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const PROJECTS_DIR = path.join(DATA, 'projects');

const DEFAULT_SETTINGS = {
  arkKey: '',                                        // 按量 Key(视频用);留空回退环境变量 VOLCENGINE_ARK_API_KEY / ARK_API_KEY
  planKey: '',                                       // Agent Plan 专属 Key(文本+生图走套餐额度);留空则全部走按量
  planBase: 'https://ark.cn-beijing.volces.com/api/plan/v3',
  // ---- 阿里云百炼(通义)双引擎:各能力可独立选择供应商 ----
  qianwenKey: '',                                    // 百炼标准 Key(sk- 开头;sk-sp- 团队版不可用)
  textProvider: 'ark',                               // ark | aliyun
  imageProvider: 'ark',                              // ark | aliyun
  videoProvider: 'ark',                              // ark | aliyun(万相 i2v)
  voiceProvider: 'edge',                             // edge(免费) | aliyun(qwen3-tts)
  aliyunTextModel: 'qwen-plus',
  aliyunImageT2I: 'wan2.6-t2i',
  aliyunImageEdit: 'wan2.6-image',
  aliyunVideoModel: 'wan2.6-i2v-flash',
  aliyunTtsModel: 'qwen3-tts-flash',
  // ---- 火山引擎默认模型 ----
  chatModel: 'doubao-seed-2-1-lite',                 // 套餐内默认(turbo 即将下线)
  imageModel: 'doubao-seedream-5-0-pro',             // 套餐内 Seedream 5.0 pro
  videoModel: 'doubao-seedance-1-0-pro-fast-251015', // 套餐不含视频,走按量
  videoEngine: 'ark',                                // ark = 图生视频 | animatic = 分镜图动态漫(0 视频成本)
  resolution: '720p',                                // 视频输出分辨率
  shotsTarget: 6,
  speakerVoices: {},                                 // {说话人: edge-tts 音色}
  modelState: {},                                    // {model: {ok, reason, checkedAt}} 运行时学习
  ttsEnabled: true,
  promptPolish: true,                               // 生图前用文本模型润色提示词(借鉴 LumenX 两阶段链)
};

// 漫剧一集的成本估算单价(约值,以方舟官网为准)
const PRICES = {
  image: 0.2,                                        // Seedream 4.0 每张(约 ¥)
  video720: 0.37,                                    // Seedance 1.0 pro 档 720p 5s(约 ¥)
  video480: 0.2,                                     // 480p 5s(约 ¥)
  chat: 0.02,                                        // 剧本+分镜 LLM(约 ¥)
  tts: 0,                                            // edge-tts 免费
};

function ensureDirs() { fs.mkdirSync(PROJECTS_DIR, { recursive: true }); }

function settingsPath() { return path.join(DATA, 'settings.json'); }

function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, readJSON(settingsPath(), {}));
}
function updateSettings(patch) {
  const cur = getSettings();
  const next = Object.assign({}, cur, patch);
  if (patch.modelState) next.modelState = Object.assign({}, cur.modelState, patch.modelState);
  if (patch.speakerVoices) next.speakerVoices = Object.assign({}, cur.speakerVoices, patch.speakerVoices);
  writeJSON(settingsPath(), next);
  return next;
}
function arkKey(settings) {
  const s = settings || getSettings();
  return (s.arkKey || '').trim() || process.env.VOLCENGINE_ARK_API_KEY || process.env.ARK_API_KEY || '';
}
function planKey(settings) {
  const s = settings || getSettings();
  return (s.planKey || '').trim() || process.env.ARK_PLAN_API_KEY || '';
}
// 阿里云百炼 Key:标准 sk-(env: QIANWEN_API_KEY / DASHSCOPE_API_KEY)
function qianwenKey(settings) {
  const s = settings || getSettings();
  return (s.qianwenKey || '').trim() || process.env.QIANWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
}
// 文本/生图凭证:配了 Agent Plan Key 就走套餐端点,否则全部按量
function textImageCreds(settings) {
  const s = settings || getSettings();
  const pk = planKey(s);
  if (pk) return { key: pk, base: (s.planBase || '').trim() || require('./ark').PLAN_BASE, plan: true };
  return { key: arkKey(s), base: require('./ark').BASE, plan: false };
}
// 按能力路由:每类能力可独立选择 火山(套餐/按量)或 阿里百炼
// 显式选择阿里但 Key 缺失时直接报错,绝不静默回退到火山(避免"以为在用阿里")
const ALIYUN_KEY_HINT = '在「设置 → 阿里云百炼」填入标准 sk- Key(百炼控制台创建)';
function textCreds(settings) {
  const s = settings || getSettings();
  if (s.textProvider === 'aliyun') {
    const k = qianwenKey(s);
    if (!k) throw Object.assign(new Error('文本引擎已选阿里百炼,但未配置百炼 Key'), { hint: ALIYUN_KEY_HINT, code: 'NoAliyunKey' });
    return { key: k, base: require('./aliyun').COMPAT, plan: false, vendor: 'aliyun' };
  }
  return { ...textImageCreds(s), vendor: 'ark' };
}
function imageCreds(settings) {
  const s = settings || getSettings();
  if (s.imageProvider === 'aliyun') {
    const k = qianwenKey(s);
    if (!k) throw Object.assign(new Error('生图引擎已选阿里百炼,但未配置百炼 Key'), { hint: ALIYUN_KEY_HINT, code: 'NoAliyunKey' });
    return { key: k, vendor: 'aliyun', t2iModel: s.aliyunImageT2I, editModel: s.aliyunImageEdit };
  }
  return { ...textImageCreds(s), vendor: 'ark' };
}
function videoCreds(settings) {
  const s = settings || getSettings();
  if (s.videoProvider === 'aliyun') {
    const k = qianwenKey(s);
    if (!k) throw Object.assign(new Error('视频引擎已选阿里百炼,但未配置百炼 Key'), { hint: ALIYUN_KEY_HINT, code: 'NoAliyunKey' });
    return { key: k, vendor: 'aliyun', model: s.aliyunVideoModel };
  }
  return { key: arkKey(s), vendor: 'ark', model: s.videoModel };
}

function projectDir(pid) { return path.join(PROJECTS_DIR, pid); }

function listProjects() {
  ensureDirs();
  return fs.readdirSync(PROJECTS_DIR)
    .filter(d => fs.existsSync(path.join(PROJECTS_DIR, d, 'project.json')))
    .map(d => {
      const p = readJSON(path.join(PROJECTS_DIR, d, 'project.json'), null);
      const firstPanel = p && (p.shots || []).find(s => s.panel);
      const coverRel = p && p.coverImage;
      return p && {
        id: p.id, title: p.title, style: p.style, updatedAt: p.updatedAt,
        cover: coverRel ? `/media/${p.id}/${coverRel.replace(/^media\//, '')}`
          : firstPanel ? `/media/${p.id}/${firstPanel.panel.replace(/^media\//, '')}`
          : (p.film ? `/media/${p.id}/film.mp4` : null),
        film: p.film || null, shotCount: (p.shots || []).length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function createProject({ title, style, script, shotsTarget }) {
  ensureDirs();
  const pid = id('mj');
  const project = {
    id: pid,
    title: (title || '未命名漫剧').slice(0, 40),
    style: style || '韩系条漫',
    script: script || '',
    shotsTarget: Math.min(12, Math.max(3, Number(shotsTarget) || 6)),
    story: { premise: script || '', direction: '', arcs: [] },  // 脉络:一句话走向 + 故事走向 + 章节(内含节拍)
    scenes: [],                                                 // 场景清单(挂章节/节拍,逐场景展开为分镜)
    characters: [],
    shots: [],
    log: [],
    cost: 0,
    film: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(projectDir(pid), 'media'), { recursive: true });
  saveProject(project);
  return project;
}

// 旧项目迁移:补 story/scenes 结构,存量镜头挂到"整集"场景
function ensureStory(project) {
  if (!project.story) project.story = { premise: project.script || '', direction: '', arcs: [] };
  if (!project.scenes) project.scenes = [];
  if (!project.scenes.length && (project.shots || []).length) {
    const sc = { id: id('sc'), arcId: '', beatId: '', title: '整集(旧)', location: '', time: '', cast: [], description: project.script || '', locked: false };
    project.scenes.push(sc);
    project.shots.forEach(s => { s.sceneId = sc.id; });
  }
  (project.shots || []).forEach(s => { if (!s.sceneId) s.sceneId = project.scenes[0] ? project.scenes[0].id : ''; });
}

function getProject(pid) {
  const p = readJSON(path.join(projectDir(pid), 'project.json'), null);
  if (p) ensureStory(p);
  return p;
}

function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  writeJSON(path.join(projectDir(project.id), 'project.json'), project);
}

function deleteProject(pid) {
  fs.rmSync(projectDir(pid), { recursive: true, force: true });
}

// ---------- 撤销/重做:结构性修改的快照栈(连续文本编辑 3 秒内合并,上限 20 步) ----------
const HISTORY_CAP = 20;
function snapOf(project) {
  return JSON.parse(JSON.stringify({
    story: project.story || { premise: '', direction: '', arcs: [] },
    scenes: project.scenes || [],
    shots: project.shots || [],
    characters: project.characters || [],
  }));
}
function pushHistory(project, label = '编辑') {
  project.history = project.history || { undo: [], redo: [] };
  const now = Date.now();
  const u = project.history.undo;
  const last = u[u.length - 1];
  if (label === '编辑' && last && last.label === '编辑' && now - last.t < 3000) {
    last.t = now; last.state = snapOf(project);      // 打字产生的连续 PUT 合并为一步
  } else {
    u.push({ label, t: now, state: snapOf(project) });
    if (u.length > HISTORY_CAP) u.shift();
  }
  project.history.redo = [];
}
function undoHistory(project) {
  const h = project.history;
  if (!h || !h.undo.length) return null;
  h.redo.push({ label: h.undo[h.undo.length - 1].label, t: Date.now(), state: snapOf(project) });
  const prev = h.undo.pop();
  Object.assign(project, JSON.parse(JSON.stringify(prev.state)));
  return prev.label;
}
function redoHistory(project) {
  const h = project.history;
  if (!h || !h.redo.length) return null;
  h.undo.push({ label: h.redo[h.redo.length - 1].label, t: Date.now(), state: snapOf(project) });
  const nxt = h.redo.pop();
  Object.assign(project, JSON.parse(JSON.stringify(nxt.state)));
  return nxt.label;
}

function estimateCost(settings, project) {
  const shots = project.shots || [];
  const panels = shots.filter(s => s.panelStatus === 'done').length;
  const chars = (project.characters || []).filter(c => c.refImage).length;
  const clips = shots.filter(s => s.clipStatus === 'done').length;
  const vp = settings.resolution === '480p' ? PRICES.video480 : PRICES.video720;
  return +(panels * PRICES.image + chars * PRICES.image + clips * vp
    + (project.coverImage ? PRICES.image : 0)
    + (project.script ? PRICES.chat : 0)).toFixed(2);
}

module.exports = {
  ROOT, DATA, PROJECTS_DIR, DEFAULT_SETTINGS, PRICES,
  ensureDirs, getSettings, updateSettings, arkKey, planKey, qianwenKey, textImageCreds, textCreds, imageCreds, videoCreds,
  pushHistory, undoHistory, redoHistory,
  listProjects, createProject, getProject, saveProject, deleteProject, projectDir, estimateCost,
};
