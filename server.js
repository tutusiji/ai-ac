'use strict';
// 漫剧工坊 Manju Studio — 零依赖 Node 服务(REST + SSE + 静态资源)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const store = require('./lib/store');
const pipeline = require('./lib/pipeline');
const ark = require('./lib/ark');
const aliyun = require('./lib/aliyun');
const tts = require('./lib/tts');
const sb = require('./lib/storyboard');

const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

store.ensureDirs();

// ---------- SSE ----------
const sseClients = new Map(); // pid → Set<res>
function sseEmit(pid, payload = {}) {
  const set = sseClients.get(pid);
  if (!set) return;
  const data = `data: ${JSON.stringify({ type: 'update', ...payload })}\n\n`;
  for (const res of set) { try { res.write(data); } catch { set.delete(res); } }
}
setInterval(() => {
  for (const [pid, set] of sseClients) {
    for (const res of set) { try { res.write(': hb\n\n'); } catch { set.delete(res); } }
  }
}, 15000).unref();

// ---------- 小工具 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, obj) {
  const body = obj instanceof Error ? JSON.stringify({ error: obj.message, hint: obj.hint || '', code: obj.code || '' })
    : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function projectView(p) {
  // 补充给前端的媒体 URL 映射
  const url = rel => rel && rel !== 'animatic' ? `/media/${p.id}/${rel.replace(/^media\//, '')}` : null;
  const shots = (p.shots || []).map(s => ({ ...s, panelUrl: url(s.panel), clipUrl: url(s.clip), audioUrl: url(s.audio) }));
  const characters = (p.characters || []).map(c => ({ ...c, refUrl: url(c.refImage) }));
  // 场景级进度统计(供脉络工作室的状态灯)
  const scenes = (p.scenes || []).map(sc => {
    const ss = shots.filter(x => x.sceneId === sc.id);
    return { ...sc, stats: { shots: ss.length, panels: ss.filter(x => x.panelStatus === 'done').length, clips: ss.filter(x => x.clipStatus === 'done').length, voices: ss.filter(x => x.voiceStatus === 'done').length } };
  });
  return { ...p, shots, characters, scenes, filmUrl: url(p.film), coverImageUrl: url(p.coverImage),
    history: {
      undo: (p.history && p.history.undo || []).length,
      redo: (p.history && p.history.redo || []).length,
      last: (p.history && p.history.undo && p.history.undo.length) ? p.history.undo[p.history.undo.length - 1].label : '',
    },
    ttsReady: tts.available() };
}
// 项目对象内存缓存:同一项目的所有请求共享同一引用,避免流水线串行执行时
// 后入队阶段持有旧快照、把前一阶段的镜头状态覆盖掉
const projectCache = new Map();
async function loadProject(pid) {
  if (!projectCache.has(pid)) {
    const p = store.getProject(pid);
    if (!p) throw Object.assign(new Error('项目不存在'), { code: 'NotFound' });
    projectCache.set(pid, p);
  }
  return projectCache.get(pid);
}
function publicProject(p) {
  const { log, ...rest } = p;
  return { ...rest, log: (log || []).slice(-40) };
}

// ---------- 路由 ----------
const routes = [];
function route(method, pattern, handler) {
  const names = [];
  const rx = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, m => { names.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, names, handler });
}

route('GET', '/api/health', async (req, res) => {
  const s = store.getSettings();
  const creds = store.textCreds(s);
  send(res, 200, {
    ok: true,
    keyConfigured: !!store.arkKey(s),
    keySource: s.arkKey ? 'settings' : (process.env.VOLCENGINE_ARK_API_KEY || process.env.ARK_API_KEY) ? 'env' : 'none',
    planConfigured: creds.plan,
    planKeySource: store.planKey(s) ? (s.planKey ? 'settings' : 'env') : 'none',
    aliyunConfigured: !!store.qianwenKey(s),
    aliyunKeySource: store.qianwenKey(s) ? (s.qianwenKey ? 'settings' : 'env') : 'none',
    textProvider: s.textProvider, imageProvider: s.imageProvider, videoProvider: s.videoProvider, voiceProvider: s.voiceProvider,
    chatModel: s.chatModel, imageModel: s.imageModel, videoModel: s.videoModel,
    videoEngine: s.videoEngine, resolution: s.resolution,
    ttsReady: tts.available(), ttsEnabled: s.ttsEnabled,
  });
});

route('GET', '/api/settings', async (req, res) => {
  const s = store.getSettings();
  const creds = store.textImageCreds(s);
  send(res, 200, {
    ...s, arkKey: undefined, planKey: undefined, qianwenKey: undefined,
    keyConfigured: !!store.arkKey(s),
    keySource: s.arkKey ? 'settings' : (process.env.VOLCENGINE_ARK_API_KEY || process.env.ARK_API_KEY) ? 'env' : 'none',
    planConfigured: creds.plan,
    planKeySource: store.planKey(s) ? (s.planKey ? 'settings' : 'env') : 'none',
    aliyunConfigured: !!store.qianwenKey(s),
    aliyunKeySource: store.qianwenKey(s) ? (s.qianwenKey ? 'settings' : 'env') : 'none',
  });
});

route('PUT', '/api/settings', async (req, res, params, body) => {
  const patch = {};
  for (const k of ['arkKey', 'planKey', 'planBase', 'chatModel', 'imageModel', 'videoModel', 'videoEngine', 'resolution', 'ttsEnabled',
    'qianwenKey', 'textProvider', 'imageProvider', 'videoProvider', 'voiceProvider',
    'aliyunTextModel', 'aliyunImageT2I', 'aliyunImageEdit', 'aliyunVideoModel', 'aliyunTtsModel', 'promptPolish']) {
    if (k in body) patch[k] = body[k];
  }
  if ('speakerVoices' in body) patch.speakerVoices = body.speakerVoices;
  const s = store.updateSettings(patch);
  const creds = store.textImageCreds(s);
  send(res, 200, {
    ...s, arkKey: undefined, planKey: undefined, modelState: undefined,
    keyConfigured: !!store.arkKey(s),
    keySource: s.arkKey ? 'settings' : (process.env.VOLCENGINE_ARK_API_KEY || process.env.ARK_API_KEY) ? 'env' : 'none',
    planConfigured: creds.plan,
    planKeySource: store.planKey(s) ? (s.planKey ? 'settings' : 'env') : 'none',
    aliyunConfigured: !!store.qianwenKey(s),
    aliyunKeySource: store.qianwenKey(s) ? (s.qianwenKey ? 'settings' : 'env') : 'none',
  });
});

route('GET', '/api/catalog', async (req, res) => {
  const s = store.getSettings();
  const key = store.arkKey(s);
  let models = null;
  try { models = await ark.listModels(key); } catch (e) { models = { error: e.message }; }
  // Agent Plan(Medium)套餐内可用模型(用户权益清单);视频不在套餐内,走按量
  send(res, 200, {
    models,
    modelState: s.modelState || {},
    planChat: [
      'doubao-seed-2-1-pro', 'doubao-seed-2-1-lite', 'doubao-seed-2-1-turbo', 'doubao-seed-2-0-lite', 'doubao-seed-2-0-mini',
      'doubao-seed-evolving', 'deepseek-v4-1-flash', 'deepseek-v4-flash', 'deepseek-v4-pro',
      'glm-5-3', 'glm-5-3-flash', 'kimi-k3', 'kimi-k2-8-preview', 'kimi-k2-7-code', 'minimax-m3',
    ],
    planImage: ['doubao-seedream-5-0-pro', 'doubao-seedream-5-0-lite'],
    video: ['doubao-seedance-1-0-pro-fast-251015', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-5-260628'],
    // 阿里云百炼(通义)可选模型
    aliyunChat: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3.6-plus'],
    aliyunImage: ['wan2.6-t2i', 'wan2.7-image', 'wan2.7-image-pro', 'qwen-image-2.0-pro'],
    aliyunVideo: ['wan2.6-i2v-flash', 'wan2.6-i2v', 'wan2.5-i2v-preview'],
  });
});

route('POST', '/api/models/check', async (req, res, params, body) => {
  const s = store.getSettings();
  const kind = body.kind || 'chat';
  const model = body.model || (kind === 'chat' ? s.chatModel : s.imageModel);
  let ok = false, reason = '';
  try {
    if (kind === 'chat') {
      const creds = store.textCreds(s);
      if (creds.vendor === 'aliyun') await aliyun.chat(creds.key, model || s.aliyunTextModel, [{ role: 'user', content: 'ping' }], { max_tokens: 2 });
      else await ark.chat(creds.key, model || s.chatModel, [{ role: 'user', content: 'ping' }], { max_tokens: 2, base: creds.base });
      ok = true;
    } else if (kind === 'image') {
      const creds = store.imageCreds(s);
      if (creds.vendor === 'aliyun') await aliyun.imageToFile(creds.key, creds.t2iModel, 'a red circle on white background, minimal', path.join(require('os').tmpdir(), 'manju_imgcheck.jpg'), {});
      else await ark.image(creds.key, model || s.imageModel, 'a red circle on white background, minimal', { size: '512x512', base: creds.base });
      ok = true;
    } else { reason = '视频模型仅在真实生成时校验(避免产生费用)'; }
  } catch (e) { reason = (e.hint ? e.hint + ' ' : '') + e.message; }
  store.updateSettings({ modelState: { [model]: { ok, reason, checkedAt: new Date().toISOString() } } });
  send(res, 200, { model, kind, ok, reason });
});

route('GET', '/api/styles', async (req, res) => {
  send(res, 200, Object.entries(sb.STYLES).map(([key, v]) => ({ key, label: v.label })));
});
route('GET', '/api/voices', async (req, res) => send(res, 200, tts.VOICES));
route('GET', '/api/prices', async (req, res) => send(res, 200, store.PRICES));

route('GET', '/api/projects', async (req, res) => send(res, 200, store.listProjects()));

route('POST', '/api/projects', async (req, res, params, body) => {
  const project = store.createProject(body);
  projectCache.set(project.id, project); // 立即入缓存:流水线在此对象上跑,避免后续请求读到旧快照
  if (body.script && body.autostart === true) {          // 反抽卡:默认不自动生成,先进脉络工作室
    pipeline.enqueue(project, 'storyboard', store.getSettings(), () => sseEmit(project.id));
  }
  send(res, 200, projectView(project));
});

// AI 草稿(纯文本,不落盘):premise 故事骨架 / arcs 章节 / beats 节拍 / scenes 场景
route('POST', '/api/ai/draft', async (req, res, params, body) => {
  const s = store.getSettings();
  const creds = store.textCreds(s);
  if (!creds.key) return send(res, 400, { error: '未配置方舟 Key', hint: '在「设置」里填入 Agent Plan 或按量 Key' });
  const data = await sb.draft(creds, creds.vendor === 'aliyun' ? (s.aliyunTextModel || 'qwen-plus') : s.chatModel, body.kind, body);
  send(res, 200, data);
});

route('GET', '/api/projects/:id', async (req, res, params) => {
  const p = await loadProject(params.id);
  send(res, 200, projectView(publicProject(p)));
});

route('PUT', '/api/projects/:id', async (req, res, params, body) => {
  const p = await loadProject(params.id);
  // 结构性修改前压入撤销栈(纯字段编辑由前端打 '编辑' 标签,3 秒内合并)
  if ([body.story, body.scenes, body.shots, body.characters, body.removeSceneShots].some(x => x !== undefined)) {
    store.pushHistory(p, body.label || '编辑');
  }
  for (const k of ['title', 'script', 'style', 'shotsTarget']) if (k in body) p[k] = body[k];
  if (body.story) {
    p.story = p.story || { premise: '', direction: '', arcs: [] };
    for (const k of ['premise', 'direction']) if (k in body.story) p.story[k] = body.story[k];
    if (Array.isArray(body.story.arcs)) p.story.arcs = body.story.arcs;
  }
  if (Array.isArray(body.scenes)) p.scenes = body.scenes;   // 整表替换(前端发完整清单,含 locked)
  if (Array.isArray(body.removeSceneShots) && body.removeSceneShots.length) {
    const ids = new Set(body.removeSceneShots);
    p.shots = (p.shots || []).filter(s => !ids.has(s.sceneId));
  }
  if (Array.isArray(body.shots)) {
    for (const patch of body.shots) {
      const sh = (p.shots || []).find(s => s.idx === Number(patch.idx));
      if (!sh) continue;
      for (const k of ['sceneId', 'scene', 'visual', 'dialogue', 'speaker', 'camera', 'duration']) if (k in patch) sh[k] = patch[k];
    }
  }
  if (Array.isArray(body.characters)) {
    for (const patch of body.characters) {
      let c = patch.id
        ? (p.characters || []).find(x => x.id === patch.id)
        : (p.characters || []).find(x => x.name === patch.name);   // AI 草稿按名字合并
      if (!c && !patch.id) {
        c = { id: require('./lib/util').id('char'), name: patch.name || '角色', desc: '', voice: '', refImage: null, status: '' };
        (p.characters = p.characters || []).push(c);
      }
      if (!c) continue;
      for (const k of ['name', 'desc', 'voice']) if (k in patch) c[k] = patch[k];
    }
  }
  store.saveProject(p);
  sseEmit(p.id);
  send(res, 200, projectView(publicProject(p)));
});

route('DELETE', '/api/projects/:id', async (req, res, params) => {
  store.deleteProject(params.id);
  projectCache.delete(params.id);
  send(res, 200, { ok: true });
});

route('POST', '/api/projects/:id/undo', async (req, res, params) => {
  const p = await loadProject(params.id);
  const label = store.undoHistory(p);
  if (label === null) return send(res, 400, { error: '没有可撤销的操作' });
  store.saveProject(p);
  sseEmit(p.id);
  send(res, 200, { ok: true, label });
});

route('POST', '/api/projects/:id/redo', async (req, res, params) => {
  const p = await loadProject(params.id);
  const label = store.redoHistory(p);
  if (label === null) return send(res, 400, { error: '没有可重做的操作' });
  store.saveProject(p);
  sseEmit(p.id);
  send(res, 200, { ok: true, label });
});

route('POST', '/api/projects/:id/generate/:stage', async (req, res, params, body) => {
  const p = await loadProject(params.id);
  const stage = params.stage;
  if (!['storyboard', 'sceneShots', 'characters', 'panels', 'clips', 'voice', 'film', 'cover'].includes(stage)) {
    return send(res, 400, { error: '未知阶段:' + stage });
  }
  const settings = store.getSettings();
  if (stage === 'storyboard') {
    if (body.script !== undefined) p.script = body.script;
    if (body.style) p.style = body.style;
    store.saveProject(p);
  }
  pipeline.enqueue(p, stage, settings, () => sseEmit(p.id),
    body.shotIdx ? Number(body.shotIdx) : undefined,
    body.sceneId || undefined);
  send(res, 200, { ok: true, queued: stage });
});

route('POST', '/api/projects/:id/stop', async (req, res, params) => {
  pipeline.stop(params.id);
  send(res, 200, { ok: true });
});

route('GET', '/api/projects/:id/events', async (req, res, params) => {
  const p = await loadProject(params.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  if (!sseClients.has(p.id)) sseClients.set(p.id, new Set());
  sseClients.get(p.id).add(res);
  req.on('close', () => { sseClients.get(p.id) && sseClients.get(p.id).delete(res); });
});

// ---------- 静态资源 ----------
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  const sendIndex = () => {
    fs.readFile(path.join(PUBLIC, 'index.html'), (e2, buf2) => {
      if (e2) { res.writeHead(500); return res.end('server error'); }
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(buf2);
    });
  };
  fs.readFile(full, (err, buf) => {
    if (err) {
      // SPA fallback:无扩展名的路径交给前端路由(刷新 /project/:id 不落 404)
      if (!path.extname(file)) return sendIndex();
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
function serveMedia(req, res, pid, rel) {
  const full = path.normalize(path.join(store.projectDir(pid), 'media', rel));
  if (!full.startsWith(path.join(store.projectDir(pid), 'media'))) { res.writeHead(403); return res.end(); }
  const stat = fs.existsSync(full) ? fs.statSync(full) : null;
  if (!stat || !stat.isFile()) { res.writeHead(404); return res.end('Not Found'); }
  const range = req.headers.range;
  if (range && /\.(mp4|mp3)$/.test(full)) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m && m[1] ? parseInt(m[1]) : 0;
    const end = m && m[2] ? parseInt(m[2]) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(full).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(u.pathname);
  try {
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.rx);
        if (!m) continue;
        const params = {};
        r.names.forEach((n, i) => { params[n] = m[i + 1]; });
        let body = {};
        if (req.method === 'POST' || req.method === 'PUT') {
          const { readBody } = require('./lib/util');
          body = await readBody(req);
        }
        return await r.handler(req, res, params, body);
      }
      return send(res, 404, { error: '接口不存在:' + pathname });
    }
    if (pathname.startsWith('/media/')) {
      const [, , pid, ...rest] = pathname.split('/');
      return serveMedia(req, res, pid, rest.join('/'));
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[error]', pathname, e.message);
    return send(res, e.code === 'NotFound' ? 404 : 500, { error: e.message, hint: e.hint || '', code: e.code || '' });
  }
});

server.listen(PORT, HOST, () => {
  const s = store.getSettings();
  console.log('');
  console.log('  漫剧工坊 Manju Studio');
  console.log(`  ➜  http://${HOST}:${PORT}`);
  console.log(`  ➜  方舟 Key: ${store.arkKey(s) ? '已配置(来源:' + (s.arkKey ? '设置' : '环境变量') + ')' : '未配置(将进入零成本演示模式)'}`);
  console.log(`  ➜  引擎: 文本 ${s.chatModel} / 生图 ${s.imageModel} / 视频 ${s.videoEngine === 'animatic' ? '动态漫(免费)' : s.videoModel}`);
  console.log('');
});
