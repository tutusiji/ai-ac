'use strict';
// 配音:edge-tts(免费,微软 Edge 朗读接口),经项目自带 .venv 里的 edge-tts 调用
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const VENV = path.join(ROOT, '.venv', 'bin', 'python');

const VOICES = {
  旁白: 'zh-CN-YunyangNeural',
  '男-青年': 'zh-CN-YunxiNeural',
  '男-成熟': 'zh-CN-YunjianNeural',
  '女-青年': 'zh-CN-XiaoxiaoNeural',
  '女-少女': 'zh-CN-YunxiaNeural',
  '女-活泼': 'zh-CN-XiaoyiNeural',
  长者: 'zh-CN-YunyeNeural',
};

// 情绪枚举(spec §5.1):storyboard prompt 与镜头面板共用本清单
const EMOTIONS = ['平静', '严肃', '激动', '低沉', '惊讶', '悲伤'];
// edge-tts 无原生情绪 style,用 rate/pitch/volume 三参近似(spec §5.2;披露:韵律近似,非情绪克隆)
function emotionProsody(emotion) {
  const M = {
    平静: ['+0%', '+0Hz', '+0%'],
    严肃: ['-8%', '-10Hz', '+0%'],
    激动: ['+10%', '+15Hz', '+10%'],
    低沉: ['-12%', '-20Hz', '-5%'],
    惊讶: ['+8%', '+25Hz', '+10%'],
    悲伤: ['-15%', '-8Hz', '-10%'],
  };
  return M[emotion] || M['平静'];
}

function available() {
  return fs.existsSync(VENV);
}

function pickVoice(speaker, override) {
  if (override && VOICES[override]) return VOICES[override];
  const s = String(speaker || '旁白');
  if (VOICES[s]) return VOICES[s];
  if (/老|爷爷|奶奶|师傅|掌柜/.test(s)) return VOICES['长者'];
  if (/妈|姨|婶|姐|婆|女士/.test(s)) return VOICES['女-青年'];
  if (/爸|叔|哥|弟|先生|男/.test(s)) return VOICES['男-成熟'];
  if (/女|妹|丫/.test(s)) return VOICES['女-青年'];
  return VOICES['旁白'];
}

function synthOnce(text, voice, dest, opts) {
  const { rate = '+8%', pitch, volume } = opts;
  const full = pitch != null && volume != null;
  // pitch/volume 为 edge-tts 扩参(韵律近似);老版本不识别时由 synthesize 降级重试
  const script = [
    'import asyncio, sys',
    'import edge_tts',
    'async def main():',
    full
      ? '    c = edge_tts.Communicate(sys.argv[1], sys.argv[2], rate=sys.argv[3], pitch=sys.argv[4], volume=sys.argv[5])'
      : '    c = edge_tts.Communicate(sys.argv[1], sys.argv[2], rate=sys.argv[3])',
    `    await c.save(sys.argv[${full ? 6 : 4}])`,
    'asyncio.run(main())',
  ].join('\n');
  const argv = full
    ? [String(text), voice, rate, pitch, volume, dest]
    : [String(text), voice, rate, dest];
  return new Promise((resolve, reject) => {
    const p = spawn(VENV, ['-c', script, ...argv], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => {
      err += d.toString();
    });
    p.on('error', (e) =>
      reject(new Error('无法启动 .venv 中的 edge-tts:' + e.message)),
    );
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 200)
        resolve();
      else reject(new Error('edge-tts 合成失败:' + err.slice(-300)));
    });
  });
}

// 带 pitch/volume 合成失败(如老版本 edge-tts 不识别扩参)→ 以仅 rate 重试一次(spec §9)
async function synthesize(text, voice, dest, opts = {}) {
  try {
    return await synthOnce(text, voice, dest, opts);
  } catch (e) {
    if (opts.pitch != null || opts.volume != null)
      return synthOnce(text, voice, dest, { rate: opts.rate });
    throw e;
  }
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        file,
      ],
      (e, out) =>
        e ? reject(e) : resolve(parseFloat(String(out).trim()) || 0),
    );
  });
}

module.exports = {
  VOICES,
  EMOTIONS,
  emotionProsody,
  available,
  pickVoice,
  synthesize,
  probeDuration,
};
