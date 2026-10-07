'use strict';
// 火山方舟(Ark)数据面适配:对话 / 生图(Seedream) / 视频(Seedance, 异步任务)
const { sleep, downloadTo, toDataUrl } = require('./util');

const BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/plan/v3';

class ArkError extends Error {
  constructor(code, message, hint) { super(message); this.code = code; this.hint = hint || ''; }
}

const HINTS = {
  ModelNotOpen: '该模型未在火山方舟控制台开通:控制台 → 模型广场/开通管理中开通,或在平台「设置」里换成已开通的模型。',
  AuthenticationError: 'API Key 无效或已过期,请在「设置」里更新 Key。',
  InvalidEndpointOrModel: '模型 ID 不存在或当前账号无权访问,请在「设置」里更换模型。',
  NotFound: '资源不存在或任务已被清理。',
  NoKey: '未配置方舟 API Key:在「设置」里填入,或设置环境变量 VOLCENGINE_ARK_API_KEY。',
};

async function arkFetch(key, apiPath, body, method = 'POST', base = BASE) {
  if (!key) throw new ArkError('NoKey', HINTS.NoKey, HINTS.NoKey);
  let res;
  try {
    res = await fetch(base + apiPath, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ArkError('Network', '网络请求失败:' + e.message, '检查本机网络 / 代理是否可达 ark.cn-beijing.volces.com');
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new ArkError('BadResponse', '非 JSON 响应:' + text.slice(0, 200)); }
  if (!res.ok || data.error) {
    const err = data.error || {};
    const code = err.code || 'HTTP' + res.status;
    throw new ArkError(code, err.message || `HTTP ${res.status} ${text.slice(0, 160)}`, HINTS[code] || '');
  }
  return data;
}

async function chat(key, model, messages, opts = {}) {
  const data = await arkFetch(key, '/chat/completions', {
    model, messages,
    max_tokens: opts.max_tokens || 4096,
    temperature: opts.temperature ?? 0.8,
  }, 'POST', opts.base || BASE);
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

// opts: { size, refs: [本地图片路径...], base } → 返回生成图 URL
async function image(key, model, prompt, opts = {}) {
  const body = { model, prompt, response_format: 'url', watermark: false };
  if (opts.size) body.size = opts.size;
  if (opts.refs && opts.refs.length) body.image = opts.refs.map(toDataUrl);
  const data = await arkFetch(key, '/images/generations', body, 'POST', opts.base || BASE);
  const url = data.data && data.data[0] && data.data[0].url;
  if (!url) throw new ArkError('NoImage', '生图返回缺少 URL:' + JSON.stringify(data).slice(0, 200));
  return url;
}

async function imageToFile(key, model, prompt, dest, opts) {
  const url = await image(key, model, prompt, opts);
  return downloadTo(url, dest);
}

// 视频任务:I2V(传 imagePath 首帧)或 T2V;参数以行内 --key 形式拼进 prompt
async function videoSubmit(key, model, prompt, opts = {}) {
  const line = ` --resolution ${opts.resolution || '720p'} --duration ${opts.duration || 5} --ratio ${opts.ratio || '9:16'} --watermark false`;
  const content = [{ type: 'text', text: prompt + line }];
  if (opts.imagePath) content.push({ type: 'image_url', image_url: { url: toDataUrl(opts.imagePath) } });
  const data = await arkFetch(key, '/contents/generations/tasks', { model, content }, 'POST', opts.base || BASE);
  return data.id;
}

async function videoQuery(key, taskId, base) { return arkFetch(key, `/contents/generations/tasks/${taskId}`, null, 'GET', base || BASE); }

async function videoWait(key, taskId, { timeoutMs = 15 * 60 * 1000, onTick, base } = {}) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    const d = await videoQuery(key, taskId, base);
    if (onTick && d.status !== last) { last = d.status; onTick(d.status, d); }
    if (d.status === 'succeeded') return d.content && d.content.video_url;
    if (d.status === 'failed' || d.status === 'cancelled') {
      const e = d.error || {};
      throw new ArkError(e.code || 'VideoFailed', e.message || '视频任务失败:' + d.status);
    }
    await sleep(5000);
  }
  throw new ArkError('Timeout', '视频生成超时(15 分钟)');
}

async function listModels(key, base) {
  const d = await arkFetch(key, '/models', null, 'GET', base || BASE);
  return (d.data || []).filter(m => m.status && m.status !== 'Shutdown').map(m => ({ id: m.id, status: m.status }));
}

module.exports = { ArkError, HINTS, BASE, PLAN_BASE, chat, image, imageToFile, videoSubmit, videoQuery, videoWait, listModels };
