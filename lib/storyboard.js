'use strict';
// 分镜脚本生成:LLM 结构化输出 + 无 LLM 兜底;生图/生视频提示词拼装
const ark = require('./ark');

const STYLES = {
  '韩系条漫': {
    label: '韩系彩色条漫(都市现代)',
    image: '韩系彩色条漫风格,干净赛璐璐上色,柔和光影,现代都市质感,精致五官,高清细节',
    llm: '现代都市韩式彩色条漫,画面干净明亮,情绪细腻',
  },
  '热血少年漫': {
    label: '日式热血少年漫',
    image: '日式热血少年漫画风格,高对比度阴影,强烈透视与速度线,鲜艳色块,动感构图',
    llm: '热血少年漫画,节奏紧凑,冲突强烈,台词有力',
  },
  '国风水墨': {
    label: '国风水墨动漫',
    image: '中国风水墨动漫风格,大量留白,淡彩晕染,毛笔笔触,古风意境',
    llm: '国风古韵,意境悠长,用词古雅',
  },
  '赛博朋克': {
    label: '赛博朋克霓虹',
    image: '赛博朋克漫画风格,霓虹灯光,雨夜街道,机械细节,高反差冷暖对比',
    llm: '赛博朋克世界观,冷峻紧张,科技感强',
  },
  '少女甜宠': {
    label: '少女漫画甜宠',
    image: '少女漫画风格,粉彩色调,柔光花瓣特效,大眼睛萌系人物,浪漫氛围',
    llm: '甜宠氛围,情绪细腻,心动瞬间',
  },
};

function systemPrompt(styleKey, shotsTarget) {
  const st = STYLES[styleKey] || STYLES['韩系条漫'];
  return `你是顶级AI漫剧编剧兼分镜师。根据用户给出的故事创意,写一集竖屏漫剧(9:16)分镜脚本。
硬性要求:
- 共 ${shotsTarget} 个镜头,每镜头 3-6 秒,起承转合完整,结尾留钩子
- 剧作风格:${st.llm}
- visual 是给AI绘图的单画面描述:包含人物外观(发型/服装/表情)、动作、场景、光影、景别(远景/中景/近景/特写),不超过70字,不得出现"上一镜头"等指代
- dialogue 是本镜头台词,口语化不超过25字;没有台词给空字符串;内心独白加"(内心)"前缀
- speaker 只能是 characters 里的角色名或"旁白"
- camera 用一个词:固定/缓推/拉远/摇镜/特写
- characters 是本集全部角色(最多4个),desc 完整描述外观(发型发色/瞳色/服装/年龄气质),40字以内,供AI绘制角色设定图
只输出 JSON:
{"title":"剧集名","characters":[{"name":"角色名","desc":"外观描述","voice":"男-青年|男-成熟|女-青年|女-少女|女-活泼|长者"}],"shots":[{"idx":1,"scene":"场景","visual":"画面描述","dialogue":"台词","speaker":"角色名或旁白","camera":"缓推","duration":5}]}
不要输出 JSON 以外的任何内容。`;
}

function extractJSON(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// 无 LLM 时的兜底分镜:按句切分,保证全流程可跑通
function fallbackStoryboard(script, shotsTarget) {
  const lines = String(script || '一个关于勇气与成长的都市故事').split(/[。!?~\n;]+/).map(s => s.trim()).filter(Boolean);
  const cams = ['固定', '缓推', '特写', '拉远'];
  const shots = [];
  for (let i = 0; i < shotsTarget; i++) {
    const text = lines[i % Math.max(lines.length, 1)] || '主角迎着光走向前方';
    shots.push({
      idx: i + 1, scene: '主场景',
      visual: text.slice(0, 60) || '主角迎着光走向前方',
      dialogue: i % 2 === 1 ? String(text).slice(0, 20) : '',
      speaker: '旁白', camera: cams[i % 4], duration: 5,
    });
  }
  return { title: '未命名漫剧', characters: [{ name: '主角', desc: '年轻主角,黑色短发,简约外套,眼神坚定', voice: '男-青年' }], shots };
}

async function generate(creds, chatModel, script, styleKey, shotsTarget) {
  if (!creds.key) return Object.assign(fallbackStoryboard(script, shotsTarget), { mock: true });
  const text = await ark.chat(creds.key, chatModel, [
    { role: 'system', content: systemPrompt(styleKey, shotsTarget) },
    { role: 'user', content: '故事创意:' + script },
  ], { temperature: 0.9, max_tokens: 4096, base: creds.base });
  const data = extractJSON(text);
  if (!data.shots || !data.shots.length) throw new ark.ArkError('LLM', 'LLM 未返回有效分镜');
  data.shots = data.shots.slice(0, 12).map((s, i) => ({
    idx: i + 1,
    scene: s.scene || '',
    visual: String(s.visual || '').slice(0, 120),
    dialogue: String(s.dialogue || '').slice(0, 60),
    speaker: s.speaker || '旁白',
    camera: s.camera || '固定',
    duration: Math.min(6, Math.max(3, Number(s.duration) || 5)),
  }));
  data.characters = (data.characters || []).slice(0, 4).map(c => ({
    name: c.name || '角色', desc: String(c.desc || '').slice(0, 80), voice: c.voice || '',
  }));
  return data;
}

function panelPrompt(styleKey, shot, characters) {
  const st = STYLES[styleKey] || STYLES['韩系条漫'];
  const text = shot.visual + (shot.dialogue || '') + (shot.speaker || '');
  const cast = (characters || []).filter(c => text.includes(c.name)).map(c => `${c.name}(${c.desc})`).join(';');
  return `${st.image}。漫画分镜画面:${shot.visual}。${cast ? `出场角色外观:${cast}。严格保持与参考图中角色形象一致。` : ''}构图完整,无文字无边框,高质量插画。`;
}

function characterPrompt(styleKey, character) {
  const st = STYLES[styleKey] || STYLES['韩系条漫'];
  return `${st.image}。角色设定图:${character.desc}。单人全身立绘,正面微侧站姿,简洁浅色背景,清晰完整展示发型服装与体型,高清。`;
}

function videoPrompt(styleKey, shot) {
  const st = STYLES[styleKey] || STYLES['韩系条漫'];
  return `${st.image},${shot.visual},${shot.camera}镜头运动,角色动作自然流畅,画面稳定,高质量动漫短片`;
}

/* ---------- 故事脉络工作室:四级 AI 草稿(全部只产文本,采纳后才落盘) ---------- */

const DRAFT_SYSTEM = `你是资深漫剧故事架构师,负责在生成任何画面之前打磨故事脉络。
原则:冲突驱动、节拍紧凑、每个场景都要"能被画出来";输出严格 JSON,不输出任何多余内容。`;

const DRAFT_PROMPTS = {
  premise: `把用户给的创意提炼为竖屏漫剧的故事骨架。只输出 JSON:
{"title":"剧集名(≤12字)","premise":"一句话核心冲突(≤50字)","direction":"故事走向:开头-发展-转折-高潮-结局,250-400字","characters":[{"name":"角色名","desc":"外观:发型发色/瞳色/服装/年龄气质,≤40字"}]}
characters 列出贯穿全剧的 1-4 个主角。`,
  arcs: `把故事走向拆成大章节(幕)。只输出 JSON:
{"arcs":[{"title":"章节名(≤10字)","purpose":"本章在全局的作用(≤40字)","summary":"本章概要:事件与转折(≤120字)"}]}
章节数量按用户要求,情感曲线要有起伏。`,
  beats: `把章节拆成小情节(节拍)。只输出 JSON:
{"beats":[{"title":"节拍名(≤10字)","intent":"这个节拍要推进什么(≤30字)","emotion":"情绪基调,2-4字","summary":"发生什么(≤70字)"}]}
节拍数量按用户要求,节拍之间要有因果推进。`,
  scenes: `把节拍落成可拍摄的场景。只输出 JSON:
{"scenes":[{"title":"场景名(≤12字)","location":"地点","time":"时间/时段","cast":["出场角色名"],"description":"场景内容:人物在做什么、画面氛围、戏剧任务(≤110字)"}]}
场景数量按用户要求;cast 只用给定角色名;description 必须可视化。`,
};

// ctx: { idea?, premise?, direction?, arc?, beat?, cast?, count? }
async function draft(creds, chatModel, kind, ctx = {}) {
  const rule = DRAFT_PROMPTS[kind];
  if (!rule) throw new ark.ArkError('BadKind', '未知草稿类型:' + kind);
  const user = [`创意/背景:${ctx.idea || ctx.premise || ''}`,
    ctx.direction ? `故事走向:${ctx.direction}` : '',
    ctx.arc ? `所在章节:${ctx.arc.title} — ${ctx.arc.summary}` : '',
    ctx.beat ? `所在节拍:${ctx.beat.title} — ${ctx.beat.summary}` : '',
    ctx.cast ? `可用角色:${ctx.cast}` : '',
    `数量:${ctx.count || 3}`,
    '只输出 JSON。'].filter(Boolean).join('\n');
  const text = await ark.chat(creds.key, chatModel, [
    { role: 'system', content: DRAFT_SYSTEM + '\n' + rule },
    { role: 'user', content: user },
  ], { temperature: 0.95, max_tokens: 4096, base: creds.base });
  return extractJSON(text);
}

// 逐场景分镜:只为一场景产出镜头(纯文本),上下文带全剧走向+章节+节拍
function sceneShotsSystem(styleKey, count) {
  const st = STYLES[styleKey] || STYLES['韩系条漫'];
  return `你是顶级AI漫剧分镜师。为"指定场景"设计分镜(此前已有故事脉络,不要改写故事)。
要求:
- 共 ${count} 个镜头,每镜头 3-6 秒,只画这个场景内发生的事,承接给定的上下文
- 风格:${st.llm}
- visual 给AI绘图:单画面,含人物外观要点(发型/服装/表情)、动作、景别(远景/中景/近景/特写),≤70字,不指代其他镜头
- dialogue 本镜头台词(≤25字,可空);内心独白加"(内心)"前缀
- speaker 只能是出场角色名或"旁白";camera:固定/缓推/拉远/摇镜/特写
只输出 JSON:
{"characters":[{"name":"本场景出场角色","desc":"完整外观描述≤40字"}],"shots":[{"visual":"…","dialogue":"…","speaker":"…","camera":"缓推","duration":5}]}`;
}

async function sceneShots(creds, chatModel, styleKey, ctx) {
  const ctxLines = [
    ctx.premise ? `全剧核心:${ctx.premise}` : '',
    ctx.direction ? `故事走向:${ctx.direction}` : '',
    ctx.arc ? `所在章节:${ctx.arc.title} — ${ctx.arc.summary}` : '',
    ctx.beat ? `所在节拍:${ctx.beat.title} — ${ctx.beat.summary}(${ctx.beat.emotion || ''})` : '',
    `场景:${ctx.scene.title} | 地点:${ctx.scene.location || '-'} | 时间:${ctx.scene.time || '-'}`,
    `场景内容:${ctx.scene.description}`,
    ctx.cast ? `角色外观设定:${ctx.cast}` : '',
  ].filter(Boolean).join('\n');
  const text = await ark.chat(creds.key, chatModel, [
    { role: 'system', content: sceneShotsSystem(styleKey, ctx.count || 5) },
    { role: 'user', content: ctxLines + '\n只输出 JSON。' },
  ], { temperature: 0.9, max_tokens: 4096, base: creds.base });
  const data = extractJSON(text);
  if (!data.shots || !data.shots.length) throw new ark.ArkError('LLM', 'LLM 未返回有效分镜');
  data.shots = data.shots.slice(0, 8).map(s => ({
    visual: String(s.visual || '').slice(0, 120),
    dialogue: String(s.dialogue || '').slice(0, 60),
    speaker: s.speaker || '旁白',
    camera: s.camera || '固定',
    duration: Math.min(6, Math.max(3, Number(s.duration) || 5)),
  }));
  data.characters = (data.characters || []).slice(0, 5).map(c => ({ name: c.name || '角色', desc: String(c.desc || '').slice(0, 80) }));
  return data;
}

/* ---------- 借鉴 LumenX:两阶段提示词润色(草稿 → 多参考图引用式) ---------- */

// 编辑距离相似度(提示词几百字,O(n²) 可接受)
function similarity(a, b) {
  a = String(a || '').replace(/\s+/g, '');
  b = String(b || '').replace(/\s+/g, '');
  if (!a.length && !b.length) return 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0], tmp;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// 把草稿提示词润色为多参考图引用式提示词;echo(相似度≥0.93)视为未润色,退回草稿
// ctx: { refLines: ['图1:角色名', ...], kind: 'panel'|'cover' }
async function polishPrompt(creds, chatModel, draft, ctx = {}) {
  const refNote = (ctx.refLines && ctx.refLines.length)
    ? `可用参考图(在提示词中用"图1""图2"精确引用):${ctx.refLines.join(';')}`
    : '本次无参考图,纯文生图,不要提及任何参考图';
  const kindNote = ctx.kind === 'cover'
    ? '这是一张剧集封面海报,必须保留标题艺术字要求。'
    : '这是一格漫画分镜。';
  const sys = `你是资深漫剧分镜师与提示词工程师,专精多参考图(multi-reference)图像生成工作流。
任务:把草稿提示词改写成高质量图像生成提示词。${kindNote}
${refNote}。
规则:
- 保留草稿的画面主体、动作、构图与风格;把对角色的泛称改写为对参考图的精确引用(如"图1中的少年侧脸",而非只写角色名)
- 只补充光影、镜头景别、材质与氛围细节,不得新增草稿没有的人物、道具或剧情
- 只输出改写后的中文提示词全文,不要解释、不要 JSON、不要引号;若草稿已足够好,原样输出`;
  const text = await ark.chat(creds.key, chatModel, [
    { role: 'system', content: sys },
    { role: 'user', content: '草稿提示词:\n' + draft },
  ], { temperature: 0.4, max_tokens: 900, base: creds.base });
  const out = String(text || '').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
  if (!out) throw new Error('润色返回为空');
  if (similarity(out, draft) >= 0.93) return { prompt: draft, polished: false };
  return { prompt: out, polished: true };
}

module.exports = {
  STYLES, generate, fallbackStoryboard, panelPrompt, characterPrompt, videoPrompt,
  extractJSON, draft, sceneShots, DRAFT_PROMPTS, polishPrompt, similarity,
};
