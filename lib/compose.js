'use strict';
// 合成:分镜图 Ken Burns 动态漫(免费兜底)/ AI 视频片段 → 统一 864x1536@25fps → 台词字幕烧录 → 拼接成片
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findFont } = require('./util');

const W = 864, H = 1536, FPS = 25;

function run(args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg 超时')); }, timeoutMs);
    p.on('error', e => { clearTimeout(timer); reject(new Error('ffmpeg 不存在:' + e.message)); });
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.slice(-500))); });
  });
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('close', () => resolve(parseFloat(out.trim()) || 0));
    p.on('error', reject);
  });
}

function wrapText(t, n = 13) {
  // 去掉字体缺字形的 emoji/符号区段;ASS 模式下行内不再手工换行
  const clean = String(t || '').replace(/\(内心\)/g, '').replace(/["“”]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '').trim();
  const lines = [];
  for (let i = 0; i < clean.length; i += n) lines.push(clean.slice(i, i + n));
  return lines.join('\n');
}

// 台词字幕(单镜):生成 ASS,交给 libass 渲染(ffmpeg 8 drawtext 多行 textfile 有 tofu 缺陷)
function assTime(sec) {
  const cs = Math.round(Math.max(0, sec) * 100);
  const h = String(Math.floor(cs / 360000)).padStart(1, '0');
  const m = String(Math.floor(cs / 6000) % 60).padStart(2, '0');
  const s = String(Math.floor(cs / 100) % 60).padStart(2, '0');
  const c = String(cs % 100).padStart(2, '0');
  return `${h}:${m}:${s}.${c}`;
}
function writeAss(text, dur, dest) {
  const line = String(text).replace(/\(内心\)/g, '').replace(/["“”]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\\/g, '').replace(/\r?\n/g, '\\N').trim();
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, Scale, Aspect, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Noto Sans CJK SC,52,&H00FFFFFF,&H00FFFFFF,&H00101218,&H78000000,0,0,0,0,100,100,1,3,1,2,56,56,215,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${assTime(0)},${assTime(dur)},Sub,,0,0,0,,${line}
`;
  fs.writeFileSync(dest, ass);
  return dest;
}

// 无 API Key 时的占位分镜图(本地 ffmpeg 直绘,保证零成本演示)
// 注意:ffmpeg 8 drawtext 多行 textfile 会在行尾渲染 tofu,故用内联单行文本
function escDrawtext(s) { return String(s).replace(/[\\:'",%]/g, m => '\\' + m); }
async function mockPanel(text, idx, dest) {
  const font = findFont();
  const oneLine = wrapText(text, 11).replace(/\n/g, ' ');
  const draw = font
    ? `drawtext=fontfile=${font}:text=${escDrawtext(oneLine)}:fontcolor=0xEDEDED:fontsize=44:x=(w-tw)/2:y=(h-th)/2:line_spacing=16:box=1:boxcolor=0x16213E@0.55:boxborderw=28`
    : 'drawtext=text=' + idx;
  await run(['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x1B1B3A:c1=0x4A2C6B:x0=0:y0=0:x1=${W}:y1=${H}`,
    '-vf', draw, '-frames:v', '1', '-q:v', '3', dest]);
  return dest;
}

// 分镜图 → 缓推变焦动态片段(动画漫模式,零视频成本)
async function kenburns(panel, dur, dest) {
  const frames = Math.max(2, Math.round(dur * FPS));
  await run([
    '-loop', '1', '-i', panel, '-t', String(dur),
    '-filter_complex',
    `scale=${W * 2}:${H * 2},zoompan=z='min(1.14,1+0.12*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', dest,
  ]);
  return dest;
}

// 单镜头片段:视频源(clip 或 kenburns)对齐时长 + 台词配音 + 字幕烧录
async function buildSegment(shot, files, dir) {
  const { clip, panel, audio, audioDur, clipDur } = files;
  const dur = Math.max(clipDur || 0, audioDur || 0, shot.duration || 5, 2.5);
  const vonly = path.join(dir, `v_${shot.idx}.mp4`);
  const aonly = path.join(dir, `a_${shot.idx}.m4a`);
  const seg = path.join(dir, `seg_${shot.idx}.mp4`);

  if (clip && fs.existsSync(clip)) {
    const pad = Math.max(0, dur - clipDur).toFixed(2);
    await run(['-i', clip,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},tpad=stop_mode=clone:stop_duration=${pad},trim=duration=${dur},setpts=PTS-STARTPTS`,
      '-an', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', vonly]);
  } else if (panel && fs.existsSync(panel)) {
    await kenburns(panel, dur, vonly);
  } else {
    throw new Error(`镜头${shot.idx} 缺少分镜图与视频片段`);
  }

  if (audio && fs.existsSync(audio)) {
    await run(['-i', audio, '-af', `apad,atrim=0:${dur},aresample=44100`, '-c:a', 'aac', '-b:a', '128k', aonly]);
  } else {
    await run(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(dur), '-c:a', 'aac', '-b:a', '64k', aonly]);
  }

  // 字幕烧录(libass)
  let vf = 'setsar=1';
  if (shot.dialogue && String(shot.dialogue).trim()) {
    const assFile = path.join(dir, `sub_${shot.idx}.ass`);
    writeAss(shot.dialogue, dur, assFile);
    const subbed = path.join(dir, `vs_${shot.idx}.mp4`);
    await run(['-i', vonly, '-vf', `ass=${assFile}`, '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', subbed]);
    fs.rmSync(assFile, { force: true });
    await run(['-i', subbed, '-i', aonly, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', seg]);
    fs.rmSync(subbed, { force: true });
  } else {
    await run(['-i', vonly, '-i', aonly, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', seg]);
  }
  fs.rmSync(vonly, { force: true });
  fs.rmSync(aonly, { force: true });
  return { seg, dur };
}

// 拼接全部镜头 → 成片
async function concatSegments(segs, dest) {
  const list = path.join(path.dirname(dest), 'concat.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
  await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', dest]);
  fs.rmSync(list, { force: true });
  return dest;
}

module.exports = { W, H, FPS, run, probeDuration, mockPanel, kenburns, buildSegment, concatSegments, wrapText };
