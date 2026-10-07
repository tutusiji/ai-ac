'use strict';
// 生产流水线:分镜脚本 → 角色设定图 → 分镜图 → 视频片段 → 配音 → 合成成片
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { sleep, id, sanitizeName } = require('./util');
const store = require('./store');
const ark = require('./ark');
const aliyun = require('./aliyun');
const sb = require('./storyboard');
const tts = require('./tts');
const compose = require('./compose');

const cancelled = new Set();       // pid → 用户请求停止
const chains = new Map();          // pid → 串行执行链

// 每次状态变化都落盘,保证浏览器刷新/SSE 拉取时看到实时进度
function persist(project, emit) { store.saveProject(project); emit(); }

function mediaDir(project) { return path.join(store.projectDir(project.id), 'media'); }
function abs(project, rel) { return rel ? path.join(store.projectDir(project.id), rel) : null; }

function log(project, msg) {
  project.log = project.log || [];
  project.log.push({ t: new Date().toISOString(), msg });
  if (project.log.length > 120) project.log = project.log.slice(-120);
  console.log(`[${project.id}] ${msg}`);
}

// 面板尺寸兜底链:阿里(万相内部兜底)或 ark(自定义 9:16 → 1:1)→ 裁切归一到 864x1536;creds 按供应商路由
async function genPanelWithFallback(creds, settings, prompt, refs, dest) {
  if (creds.vendor === 'aliyun') {
    await aliyun.imageToFile(creds.key, creds.editModel, prompt, dest, { refs });
  } else {
    const sizes = [];
    const m = String(settings.panelSizeCustom || '').match(/^(\d{3,4})x(\d{3,4})$/);
    if (m) sizes.push(settings.panelSizeCustom);
    sizes.push('864x1536', '1024x1024');
    let lastErr;
    let ok = false;
    for (const size of [...new Set(sizes)]) {
      try {
        await ark.imageToFile(creds.key, settings.imageModel, prompt, dest, { size, refs, base: creds.base });
        ok = true;
        break;
      } catch (e) { lastErr = e; }
    }
    if (!ok) throw lastErr;
  }
  const norm = dest.replace(/\.\w+$/, '') + '_n.jpg';
  await compose.run(['-i', dest, '-vf', `scale=${compose.W}:${compose.H}:force_original_aspect_ratio=increase,crop=${compose.W}:${compose.H}`,
    '-frames:v', '1', '-q:v', '3', norm]);
  fs.renameSync(norm, dest);
}

// 逐场景分镜:纯文本产出,上下文携带全剧走向/章节/节拍
// 注意:统一调度按 (project, settings, emit, shotIdx, sceneId) 传参,场景阶段只消费 sceneId
async function stageSceneShots(project, settings, emit, _shotIdx, sceneId) {
  const creds = store.textCreds(settings);
  const scene = (project.scenes || []).find(s => s.id === sceneId);
  if (!scene) throw new Error('场景不存在');
  const arc = (project.story.arcs || []).find(a => a.id === scene.arcId) || null;
  const beat = arc ? (arc.beats || []).find(b => b.id === scene.beatId) : null;
  const castDesc = (project.characters || [])
    .filter(c => (scene.cast || []).includes(c.name)).map(c => `${c.name}(${c.desc})`).join(';');
  log(project, `为场景「${scene.title}」生成分镜(${vendorLabel(creds)} ${chatModelOf(settings, creds)},纯文本)…`);
  const data = await sb.sceneShots(creds, chatModelOf(settings, creds), project.style, {
    premise: project.story.premise, direction: project.story.direction,
    arc, beat, scene, cast: castDesc, count: project.shotsTarget || 5,
  });
  for (const c of data.characters) {
    let ex = (project.characters || []).find(x => x.name === c.name);
    if (!ex) { ex = { id: id('char'), name: c.name, desc: c.desc, voice: '', refImage: null, status: '' }; project.characters.push(ex); }
    else if (c.desc && !ex.desc) ex.desc = c.desc;
  }
  const hadMedia = (project.shots || []).some(s => s.sceneId === sceneId && (s.panel || (s.clip && s.clip !== 'animatic')));
  store.pushHistory(project, `重排场景「${scene.title}」分镜`);
  const baseIdx = (project.shots || []).reduce((m, s) => Math.max(m, s.idx || 0), 0);
  project.shots = (project.shots || []).filter(s => s.sceneId !== sceneId).concat(data.shots.map((sh, i) => ({
    idx: baseIdx + i + 1, sceneId,
    scene: scene.title, visual: sh.visual, dialogue: sh.dialogue, speaker: sh.speaker, camera: sh.camera, duration: sh.duration,
    panel: null, clip: null, audio: null, audioDur: 0,
    panelStatus: 'none', clipStatus: 'none', voiceStatus: 'none', error: '',
  })));
  if (hadMedia) log(project, `⚠ 场景「${scene.title}」分镜重排:原分镜图/视频关联已解除,需重新生成`);
  log(project, `场景「${scene.title}」分镜完成:${data.shots.length} 镜`);
  project.cost = store.estimateCost(settings, project);
}

// 供应商感知的模型名
function chatModelOf(settings, creds) { return creds.vendor === 'aliyun' ? (settings.aliyunTextModel || 'qwen-plus') : settings.chatModel; }
function imageModelOf(settings, creds) { return creds.vendor === 'aliyun' ? (creds.editModel || 'wan2.6-image') : settings.imageModel; }
const vendorLabel = c => c.vendor === 'aliyun' ? '阿里' : (c.plan ? '套餐' : '按量');

// 借鉴 LumenX 两阶段链:草稿 → 多参考图引用式润色;关闭/无 Key/失败时退回草稿
async function polishForShot(project, settings, draft, refNames, idx, kind = 'panel') {
  const tCreds = store.textCreds(settings);
  if (!settings.promptPolish || !tCreds.key) return { prompt: draft, polished: false };
  try {
    const r = await sb.polishPrompt(tCreds, chatModelOf(settings, tCreds), draft, {
      refLines: (refNames || []).map((n, i) => `图${i + 1}:${n}`), kind,
    });
    if (r.polished) log(project, `${kind === 'cover' ? '封面' : '第 ' + idx + ' 镜'}提示词已润色(多参考图引用式,${vendorLabel(tCreds)} ${chatModelOf(settings, tCreds)})`);
    return r;
  } catch (e) {
    log(project, `${kind === 'cover' ? '封面' : '第 ' + idx + ' 镜'}提示词润色失败,使用草稿:${e.message}`);
    return { prompt: draft, polished: false };
  }
}

async function stageStoryboard(project, settings, emit) {
  // 有场景清单时:逐场景生成分镜(纯文本,不产生任何图像/视频费用)
  if ((project.scenes || []).length) {
    for (const sc of project.scenes) {
      if (cancelled.has(project.id)) { log(project, '已停止'); return; }
      await stageSceneShots(project, settings, emit, sc.id);
      persist(project, emit);
    }
    return;
  }
  const creds = store.textCreds(settings);
  log(project, `生成分镜脚本(${vendorLabel(creds)} ${chatModelOf(settings, creds)})…`);
  const data = await sb.generate(creds, chatModelOf(settings, creds), project.script, project.style, project.shotsTarget);
  const oldChars = project.characters || [];
  const oldShots = project.shots || [];
  project.title = data.title || project.title;
  project.characters = (data.characters || []).map(c => {
    const prev = oldChars.find(o => o.name === c.name);
    return { id: prev ? prev.id : id('char'), name: c.name, desc: c.desc, voice: c.voice || '', refImage: prev ? prev.refImage : null };
  });
  project.shots = data.shots.map(sh => {
    const prev = oldShots.find(o => o.idx === sh.idx);
    return {
      idx: sh.idx, scene: sh.scene, visual: sh.visual, dialogue: sh.dialogue,
      speaker: sh.speaker, camera: sh.camera, duration: sh.duration,
      panel: prev ? prev.panel : null,
      clip: prev && prev.clip !== 'animatic' ? prev.clip : null,
      audio: null, audioDur: 0,
      panelStatus: prev && prev.panel ? 'done' : 'none',
      clipStatus: prev && prev.clip && prev.clip !== 'animatic' ? 'done' : 'none',
      voiceStatus: 'none', error: '',
    };
  });
  if (data.mock) project.log.push({ t: new Date().toISOString(), msg: '⚠ 兜底分镜:未配置方舟 Key,分镜质量有限,请在设置中配置 Key 后重新生成分镜' });
  log(project, `分镜完成:${project.shots.length} 镜 / ${project.characters.length} 角色`);
  project.cost = store.estimateCost(settings, project);
}

async function stageCharacters(project, settings, emit) {
  const creds = store.imageCreds(settings);
  const targets = (project.characters || []).filter(c => !c.refImage);
  if (!targets.length) { log(project, '角色设定图已齐全'); return; }
  for (const c of targets) {
    if (cancelled.has(project.id)) { log(project, '已停止'); return; }
    c.status = 'pending'; persist(project, emit);
    try {
      if (!creds.key) {
        const dest = path.join(mediaDir(project), `char_${sanitizeName(c.name)}.jpg`);
        await compose.mockPanel(`【${c.name}】\n${c.desc}`, c.idx || 0, dest);
        c.refImage = `media/char_${sanitizeName(c.name)}.jpg`;
      } else {
        const dest = path.join(mediaDir(project), `char_${sanitizeName(c.name)}.jpg`);
        if (creds.vendor === 'aliyun') {
          await aliyun.imageToFile(creds.key, creds.t2iModel, sb.characterPrompt(project.style, c), dest, {});
        } else {
          await ark.imageToFile(creds.key, settings.imageModel, sb.characterPrompt(project.style, c), dest, { size: '1024x1024', base: creds.base });
        }
        c.refImage = `media/char_${sanitizeName(c.name)}.jpg`;
        project.cost = store.estimateCost(settings, project);
      }
      c.status = 'done';
      log(project, `角色设定图完成:${c.name}`);
    } catch (e) {
      c.status = 'error'; c.error = (e.hint ? e.hint + ' ' : '') + e.message;
      log(project, `角色图失败 ${c.name}:${e.message}`);
      throw e;
    }
    persist(project, emit);
  }
}

async function stagePanels(project, settings, emit, shotIdx) {
  const creds = store.imageCreds(settings);
  const targets = (project.shots || []).filter(s => (!shotIdx || s.idx === shotIdx) && (!s.panel || shotIdx));
  for (const sh of targets) {
    if (cancelled.has(project.id)) { log(project, '已停止'); return; }
    sh.panelStatus = 'pending'; sh.error = ''; persist(project, emit);
    try {
      const prompt = sb.panelPrompt(project.style, sh, project.characters);
      const refPairs = (project.characters || [])
        .filter(c => (sh.visual + (sh.dialogue || '') + (sh.speaker || '')).includes(c.name) && c.refImage)
        .map(c => ({ name: c.name, path: abs(project, c.refImage) }));
      const refs = refPairs.map(x => x.path);
      const { prompt: finalPrompt, polished } = await polishForShot(project, settings, prompt, refPairs.map(x => x.name), sh.idx);
      const dest = path.join(mediaDir(project), `panel_${sh.idx}.jpg`);
      if (!creds.key) await compose.mockPanel(`${sh.idx}. ${sh.visual}`, sh.idx, dest);
      else await genPanelWithFallback(creds, settings, finalPrompt, refs, dest);
      sh.panel = `media/panel_${sh.idx}.jpg`;
      sh.panelStatus = 'done';
      project.cost = store.estimateCost(settings, project);
      log(project, `分镜图完成:第 ${sh.idx} 镜(${vendorLabel(creds)}${refs.length ? `,参考 ${refs.length} 张角色图` : ''}${polished ? ',提示词已润色' : ''})`);
    } catch (e) {
      sh.panelStatus = 'error'; sh.error = (e.hint ? e.hint + ' ' : '') + e.message;
      log(project, `分镜图失败 第${sh.idx}镜:${e.message}`);
    }
    persist(project, emit);
  }
}

async function stageClips(project, settings, emit, shotIdx, sceneId) {
  const vc = store.videoCreds(settings);
  let targets = (project.shots || []).filter(s => (!shotIdx || s.idx === shotIdx) && s.panel);
  if (sceneId && !shotIdx) targets = targets.filter(s => s.sceneId === sceneId);
  if (!targets.length) { log(project, '没有可生成的镜头(需先有分镜图)'); return; }
  // 视频闸门:批量生成只对"已锁定分镜"的场景开放,避免脉络未定就烧视频
  if (!shotIdx) {
    const lockedIds = new Set((project.scenes || []).filter(s => s.locked).map(s => s.id));
    targets = targets.filter(s => lockedIds.has(s.sceneId));
    if (!targets.length) throw new Error('视频已加闸:请先在分镜台对要生成的场景点「🔒 锁定分镜」再批量生成视频');
  }
  if (settings.videoEngine === 'animatic') {
    for (const sh of targets) { sh.clip = 'animatic'; sh.clipStatus = 'animatic'; }
    log(project, '动态漫模式:跳过视频生成,合成时将用分镜图做缓推动效(0 视频成本)');
    persist(project, emit);
    return;
  }
  for (const sh of targets) {
    if (cancelled.has(project.id)) { log(project, '已停止'); return; }
    sh.clipStatus = 'pending'; sh.error = ''; persist(project, emit);
    try {
      const duration = (sh.duration || 5) > 7 ? 10 : 5;
      const prompt = sb.videoPrompt(project.style, sh);
      let url;
      if (vc.vendor === 'aliyun') {
        const taskId = await aliyun.videoSubmit(vc.key, vc.model, prompt, {
          imagePath: abs(project, sh.panel), resolution: settings.resolution, duration,
        });
        log(project, `第 ${sh.idx} 镜阿里万相任务已提交 ${taskId}(${vc.model} ${settings.resolution} ${duration}s)`);
        url = await aliyun.videoWait(vc.key, taskId, { onTick: st => { emit(); } });
      } else {
        const taskId = await ark.videoSubmit(vc.key, vc.model, prompt, {
          imagePath: abs(project, sh.panel),
          resolution: settings.resolution, duration, ratio: '9:16',
        });
        log(project, `第 ${sh.idx} 镜视频任务已提交 ${taskId}(${vc.model} ${settings.resolution} ${duration}s)`);
        url = await ark.videoWait(vc.key, taskId, { onTick: st => { emit(); } });
      }
      const dest = path.join(mediaDir(project), `clip_${sh.idx}.mp4`);
      await require('./util').downloadTo(url, dest);
      sh.clip = `media/clip_${sh.idx}.mp4`;
      sh.clipStatus = 'done';
      project.cost = store.estimateCost(settings, project);
      log(project, `视频片段完成:第 ${sh.idx} 镜`);
    } catch (e) {
      sh.clipStatus = 'error'; sh.error = (e.hint ? e.hint + ' ' : '') + e.message;
      log(project, `视频失败 第${sh.idx}镜:${e.message}`);
    }
    persist(project, emit);
  }
}

async function stageVoice(project, settings, emit, shotIdx) {
  const targets = (project.shots || []).filter(s => (!shotIdx || s.idx === shotIdx) && (s.dialogue || '').trim());
  const useAliyunTts = settings.voiceProvider === 'aliyun' && store.qianwenKey(settings);
  if (!settings.ttsEnabled || (!useAliyunTts && !tts.available())) {
    for (const sh of targets) { sh.audio = null; sh.voiceStatus = 'skipped'; }
    log(project, settings.ttsEnabled
      ? (useAliyunTts ? '' : '未检测到 .venv(edge-tts),跳过配音')
      : '配音已在设置中关闭');
    persist(project, emit);
    return;
  }
  // 阿里 Qwen-TTS 音色按说话人关键词映射(Cherry/Serena/Ethan)
  const aliVoice = s => /男|爸|叔|哥|弟|先生/.test(s || '') ? 'Ethan' : /女|妈|姐|妹|婆|姨/.test(s || '') ? 'Serena' : 'Cherry';
  for (const sh of targets) {
    if (cancelled.has(project.id)) { log(project, '已停止'); return; }
    sh.voiceStatus = 'pending'; persist(project, emit);
    try {
      let voice;
      const dest = path.join(mediaDir(project), `voice_${sh.idx}.mp3`);
      { // 台词/音色/引擎均未变化 → 跳过重合成
        const probeVoice = useAliyunTts ? `qwen3-tts:${aliVoice(sh.speaker)}` : tts.pickVoice(sh.speaker, settings.speakerVoices[sh.speaker]);
        const probeHash = crypto.createHash('md5').update(`${sh.dialogue}|${probeVoice}|${useAliyunTts ? 'ali:' + settings.aliyunTtsModel : 'edge'}`).digest('hex').slice(0, 10);
        if (sh.voiceHash === probeHash && sh.audio && fs.existsSync(dest)) {
          sh.voiceStatus = 'done';
          log(project, `第 ${sh.idx} 镜配音未变化,跳过重合成`);
          persist(project, emit);
          continue;
        }
      }
      if (useAliyunTts) {
        voice = `qwen3-tts:${aliVoice(sh.speaker)}`;
        await aliyun.tts(store.qianwenKey(settings), sh.dialogue, aliVoice(sh.speaker), dest, { model: settings.aliyunTtsModel });
      } else {
        voice = tts.pickVoice(sh.speaker, settings.speakerVoices[sh.speaker]);
        await tts.synthesize(sh.dialogue, voice, dest);
      }
      // 借鉴 LumenX dialogue-hash:台词/音色/引擎未变化时跳过重合成
      sh.voiceHash = crypto.createHash('md5').update(`${sh.dialogue}|${voice}|${useAliyunTts ? 'ali:' + settings.aliyunTtsModel : 'edge'}`).digest('hex').slice(0, 10);
      sh.audio = `media/voice_${sh.idx}.mp3`;
      sh.audioDur = await tts.probeDuration(dest);
      sh.voice = voice;
      sh.voiceStatus = 'done';
      log(project, `配音完成:第 ${sh.idx} 镜 ${voice} ${sh.audioDur.toFixed(1)}s`);
    } catch (e) {
      sh.voiceStatus = 'error'; sh.error = 'TTS:' + e.message;
      log(project, `配音失败 第${sh.idx}镜:${e.message}`);
    }
    persist(project, emit);
  }
}

async function stageFilm(project, settings, emit) {
  // 按脉络顺序合成:场景顺序 → 场景内镜头序号
  const orderOf = new Map((project.scenes || []).map((s, i) => [s.id, i]));
  const shots = [...(project.shots || [])].sort((a, b) =>
    ((orderOf.get(a.sceneId) ?? 999) - (orderOf.get(b.sceneId) ?? 999)) || ((a.idx || 0) - (b.idx || 0)));
  if (!shots.length) throw new Error('请先生成分镜');
  const dir = mediaDir(project);
  const segs = [];
  for (const sh of shots) {
    if (cancelled.has(project.id)) { log(project, '已停止'); return; }
    const clipRel = sh.clip && sh.clip !== 'animatic' ? sh.clip : null;
    const clipAbs = abs(project, clipRel);
    const clipDur = clipAbs && fs.existsSync(clipAbs) ? await compose.probeDuration(clipAbs) : 0;
    let panelAbs = abs(project, sh.panel);
    if (!panelAbs || !fs.existsSync(panelAbs)) {
      panelAbs = await compose.mockPanel(`${sh.idx}. ${sh.visual}`, sh.idx, path.join(dir, `panel_${sh.idx}.jpg`));
      sh.panel = `media/panel_${sh.idx}.jpg`;
      sh.panelStatus = 'done';
    }
    const { seg } = await compose.buildSegment(sh, {
      clip: clipAbs,
      panel: panelAbs,
      audio: abs(project, sh.audio),
      audioDur: sh.audioDur || 0,
      clipDur,
    }, dir);
    segs.push(seg);
    log(project, `片段合成:第 ${sh.idx} 镜`);
    persist(project, emit);
  }
  const film = path.join(dir, 'film.mp4');
  await compose.concatSegments(segs, film);
  project.film = 'media/film.mp4';
  const dur = await compose.probeDuration(film);
  log(project, `成片完成:film.mp4 ${dur.toFixed(1)}s`);
}

// 封面海报:核心冲突 + 主角参考图 + 标题艺术字,竖版 3:4(套餐生图)
async function stageCover(project, settings, emit) {
  const creds = store.textImageCreds(settings);
  if (!creds.key) throw new Error('封面生成需要方舟 Key(演示模式不支持)');
  project.coverStatus = 'pending'; emit && persist(project, emit);
  const chars = (project.characters || []).filter(c => c.refImage).slice(0, 2);
  const st = sb.STYLES[project.style] || sb.STYLES['韩系条漫'];
  const premise = (project.story && project.story.premise) || project.script || project.title;
  const cast = chars.map(c => `${c.name}(${c.desc})`).join(';');
  const prompt = `${st.image}。竖版漫剧封面海报,主视觉呈现核心冲突:${premise}。${cast ? `主角形象:${cast},严格保持与参考图一致。` : ''}画面上方醒目大号精致艺术字标题:「${project.title}」。电影感打光,海报级构图,细节丰富,无水印无边框。`;
  const refs = chars.map(c => abs(project, c.refImage));
  const { prompt: finalPrompt } = await polishForShot(project, settings, prompt, chars.map(c => c.name), 0, 'cover');
  const dest = path.join(mediaDir(project), 'cover.jpg');
  let lastErr;
  for (const size of ['1080x1440', '1024x1024']) {
    try {
      await ark.imageToFile(creds.key, settings.imageModel, finalPrompt, dest, { size, refs, base: creds.base });
      const norm = dest.replace(/\.\w+$/, '') + '_n.jpg';
      await compose.run(['-i', dest, '-vf', 'scale=1080:1440:force_original_aspect_ratio=increase,crop=1080:1440',
        '-frames:v', '1', '-q:v', '3', norm]);
      fs.renameSync(norm, dest);
      project.coverImage = 'media/cover.jpg';
      project.cost = store.estimateCost(settings, project);
      log(project, `封面图已生成(${chars.length} 张角色参考图${settings.imageModel})`);
      project.coverStatus = 'done';
      return;
    } catch (e) { lastErr = e; }
  }
  project.coverStatus = 'error';
  throw lastErr;
}

const STAGES = { storyboard: stageStoryboard, sceneShots: stageSceneShots, characters: stageCharacters, panels: stagePanels, clips: stageClips, voice: stageVoice, film: stageFilm, cover: stageCover };

// 串行执行:同项目任务排队;返回排队位置提示
function enqueue(project, stage, settings, emit, shotIdx, sceneId) {
  const prev = chains.get(project.id) || Promise.resolve();
  const task = prev.then(async () => {
    project.running = stage;
    emit();
    try {
      await STAGES[stage](project, settings, emit, shotIdx, sceneId);
      project.running = null;
      project.lastError = '';
    } catch (e) {
      project.running = null;
      project.lastError = (e.hint ? e.hint + ' ' : '') + e.message;
      log(project, `阶段 ${stage} 失败:${e.message}`);
    } finally {
      store.saveProject(project);
      emit();
    }
  });
  chains.set(project.id, task);
  return task;
}

function stop(pid) { cancelled.add(pid); setTimeout(() => cancelled.delete(pid), 60 * 1000); }

module.exports = { enqueue, stop, mediaDir };
