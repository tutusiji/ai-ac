'use strict';
// 阿里云百炼(DashScope)适配器:通义文本(OpenAI 兼容)/ 万相生图 / Wan 图生视频 / Qwen-TTS
// Key:标准 sk- 开头(Token Plan 团队版 sk-sp- 不能用于这些端点)
const fs = require('fs');
const path = require('path');
const { downloadTo } = require('./util');

const BASE = 'https://dashscope.aliyuncs.com';
const COMPAT = BASE + '/compatible-mode/v1';   // 文本:OpenAI 兼容
const NATIVE = BASE + '/api/v1';              // 生图/视频/上传/TTS 原生端点

class AliyunError extends Error {
  constructor(code, message, hint) { super(message); this.code = code; this.hint = hint || ''; }
}

const HINTS = {
  InvalidApiKey: '阿里百炼 API Key 无效(sk-sp- 团队版 Key 不能用于本平台,需要标准 sk- Key)',
  Arrearage: '阿里云账户欠费,请充值后重试',
  'product not activated': '该模型未在百炼控制台开通(模型广场启用后重试)',
  DataInsufficientFreeQuota: '该模型免费额度已用尽',
};

async function aliyunFetch(url, key, body, method = 'POST', extraHeaders = {}) {
  if (!key) throw new AliyunError('NoKey', '未配置阿里百炼 Key', '在「设置」里填入标准 sk- Key(QIANWEN_API_KEY)');
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new AliyunError('Network', '网络请求失败:' + e.message, '检查本机网络是否可达 dashscope.aliyuncs.com'); }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new AliyunError('BadResponse', '非 JSON 响应:' + text.slice(0, 200)); }
  // DashScope 兼容端点对部分错误返回 HTTP 200 + error body,必须双重检查
  if (!res.ok || data.error || (data.code && data.message && !data.output && !data.choices && !data.data)) {
    const err = data.error || data;
    const code = err.code || 'HTTP' + res.status;
    throw new AliyunError(code, err.message || `HTTP ${res.status}`, HINTS[code] || (res.status === 401 || /api.?key/i.test(code) ? HINTS.InvalidApiKey : ''));
  }
  return data;
}

// 文本:OpenAI 兼容端点(base 传入 COMPAT 即可复用 ark.chat 的调用形态)
async function chat(key, model, messages, opts = {}) {
  const data = await aliyunFetch(`${COMPAT}/chat/completions`, key, {
    model, messages, max_tokens: opts.max_tokens || 4096, temperature: opts.temperature ?? 0.8,
  });
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

// DashScope 临时文件上传:本地文件 → oss:// URL(参考图/视频首帧用,48h 有效)
async function upload(key, filePath, model) {
  const r = await fetch(`${NATIVE}/uploads?action=getPolicy&model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new AliyunError('UploadPolicy', '获取上传策略失败:' + text.slice(0, 150)); }
  const pol = j.data;
  if (!pol || !pol.upload_host) throw new AliyunError('UploadPolicy', '获取上传策略失败:' + text.slice(0, 150));
  const keyName = `${pol.upload_dir}/${path.basename(filePath)}`;
  const fd = new FormData();
  fd.append('OSSAccessKeyId', pol.oss_access_key_id);
  fd.append('Signature', pol.signature);
  fd.append('policy', pol.policy);
  fd.append('x-oss-object-acl', pol.x_oss_object_acl);
  fd.append('x-oss-forbid-overwrite', pol.x_oss_forbid_overwrite);
  fd.append('key', keyName);
  fd.append('success_action_status', '200');
  fd.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const up = await fetch(pol.upload_host, { method: 'POST', body: fd });
  if (!up.ok) throw new AliyunError('UploadFailed', 'DashScope 文件上传失败 HTTP ' + up.status);
  return `oss://${keyName}`;
}

// 从多模态响应提取图片 URL(兼容 content 为数组或对象)
function pickImage(data) {
  const c = data.output && data.output.choices && data.output.choices[0] && data.output.choices[0].message && data.output.choices[0].message.content;
  const arr = Array.isArray(c) ? c : (c ? [c] : []);
  const hit = arr.find(x => x && x.image);
  return hit && hit.image;
}

// 生图:无参考图 → 万相 t2i(sync);有参考图 → 万相 image-edit(messages 格式,本地参考图自动上传)
// 尺寸映射:ark 风格 864x1536 → 万相 1080*1920(9:16);最终仍由 compose 归一裁切
async function imageToFile(key, model, prompt, dest, opts = {}) {
  const { refs = [] } = opts;
  let url;
  if (refs.length) {
    const editModel = /t2i/.test(model) ? 'wan2.6-image' : model;
    const content = [];
    for (const r of refs) content.push({ image: await upload(key, r, editModel) });
    content.push({ text: prompt });
    let lastErr;
    for (const size of ['1152*2048', '1K']) {
      try {
        const data = await aliyunFetch(`${NATIVE}/services/aigc/multimodal-generation/generation`, key, {
          model: editModel,
          input: { messages: [{ role: 'user', content }] },
          parameters: { size, n: 1, watermark: false },
        }, 'POST', { 'X-DashScope-OssResourceResolve': 'enable' });
        url = pickImage(data);
        if (url) break;
        throw new AliyunError('NoImage', '生图返回缺少 URL:' + JSON.stringify(data).slice(0, 200));
      } catch (e) { lastErr = e; }
    }
    if (!url) throw lastErr;
  } else {
    const t2iModel = /image/.test(model) && !/t2i/.test(model) ? 'wan2.6-t2i' : model;
    let lastErr;
    for (const size of ['1080*1920', '1280*1280']) {
      try {
        const data = await aliyunFetch(`${NATIVE}/services/aigc/multimodal-generation/generation`, key, {
          model: t2iModel, input: { prompt, size }, parameters: { watermark: false },
        });
        url = pickImage(data);
        if (url) break;
        throw new AliyunError('NoImage', '生图返回缺少 URL');
      } catch (e) { lastErr = e; }
    }
    if (!url) throw lastErr;
  }
  return downloadTo(url, dest);
}

// 图生视频:异步任务;本地首帧自动上传为 oss://
async function videoSubmit(key, model, prompt, opts = {}) {
  let imgUrl = opts.imageUrl;
  if (!imgUrl && opts.imagePath) imgUrl = await upload(key, opts.imagePath, model);
  const body = {
    model: model || 'wan2.6-i2v-flash',
    input: { prompt, img_url: imgUrl },
    parameters: {
      resolution: (opts.resolution || '720p').toUpperCase(),
      duration: (opts.duration || 5) > 7 ? 10 : 5,
    },
  };
  const data = await aliyunFetch(`${NATIVE}/services/aigc/video-generation/video-synthesis`, key, body, 'POST', { 'X-DashScope-Async': 'enable' });
  return data.output && data.output.task_id;
}

async function videoQuery(key, taskId) { return aliyunFetch(`${NATIVE}/tasks/${taskId}`, key, null, 'GET'); }

async function videoWait(key, taskId, { timeoutMs = 15 * 60 * 1000, onTick } = {}) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    const d = await videoQuery(key, taskId);
    const st = d.output && d.output.task_status;
    if (onTick && st && st !== last) { last = st; onTick(st, d); }
    if (st === 'SUCCEEDED') return d.output.video_url;
    if (st === 'FAILED' || st === 'CANCELED' || st === 'UNKNOWN') {
      throw new AliyunError('VideoFailed', (d.output && d.output.message) || '视频任务失败:' + st);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new AliyunError('Timeout', '阿里视频生成超时(15 分钟)');
}

// Qwen-TTS:qwen3-tts-flash,返回音频 URL 下载为本地文件
async function tts(key, text, voice, dest, opts = {}) {
  const data = await aliyunFetch(`${NATIVE}/services/aigc/multimodal-generation/generation`, key, {
    model: opts.model || 'qwen3-tts-flash',
    input: { text: String(text), voice: voice || 'Cherry' },
  });
  const url = data.output && data.output.audio && data.output.audio.url;
  if (!url) throw new AliyunError('NoAudio', 'TTS 返回缺少 audio.url:' + JSON.stringify(data).slice(0, 160));
  return downloadTo(url, dest);
}

module.exports = { AliyunError, BASE, COMPAT, NATIVE, chat, upload, imageToFile, videoSubmit, videoQuery, videoWait, tts };
