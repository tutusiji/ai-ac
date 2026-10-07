'use strict';
// 配音:edge-tts(免费,微软 Edge 朗读接口),经项目自带 .venv 里的 edge-tts 调用
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const VENV = path.join(ROOT, '.venv', 'bin', 'python');

const VOICES = {
  '旁白': 'zh-CN-YunyangNeural',
  '男-青年': 'zh-CN-YunxiNeural',
  '男-成熟': 'zh-CN-YunjianNeural',
  '女-青年': 'zh-CN-XiaoxiaoNeural',
  '女-少女': 'zh-CN-YunxiaNeural',
  '女-活泼': 'zh-CN-XiaoyiNeural',
  '长者': 'zh-CN-YunyeNeural',
};

function available() { return fs.existsSync(VENV); }

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

async function synthesize(text, voice, dest, { rate = '+8%' } = {}) {
  const script = [
    'import asyncio, sys',
    'import edge_tts',
    'async def main():',
    '    c = edge_tts.Communicate(sys.argv[1], sys.argv[2], rate=sys.argv[3])',
    '    await c.save(sys.argv[4])',
    'asyncio.run(main())',
  ].join('\n');
  await new Promise((resolve, reject) => {
    const p = spawn(VENV, ['-c', script, String(text), voice, rate, dest], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', e => reject(new Error('无法启动 .venv 中的 edge-tts:' + e.message)));
    p.on('close', code => {
      if (code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 200) resolve();
      else reject(new Error('edge-tts 合成失败:' + err.slice(-300)));
    });
  });
  return dest;
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      (e, out) => e ? reject(e) : resolve(parseFloat(String(out).trim()) || 0));
  });
}

module.exports = { VOICES, available, pickVoice, synthesize, probeDuration };
