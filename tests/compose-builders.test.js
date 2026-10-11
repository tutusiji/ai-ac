"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const compose = require("../lib/compose");

test("kenburnsFilter:固定 无 zoompan,其余经 cameraExpr", () => {
  assert.strictEqual(compose.kenburnsFilter("固定", 50), "scale=864:1536");
  assert.strictEqual(
    compose.kenburnsFilter("缓推", 50),
    "scale=1728:3072,zoompan=z='min(1.14,1+0.12*on/50)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=50:s=864x1536:fps=25",
  );
  assert.match(compose.kenburnsFilter("摇镜", 50), /z='1\.15'/);
  assert.match(compose.kenburnsFilter("特写", 2), /on\/2/);
});

test("fadeVf/fadeAf:首尾各 0.12s", () => {
  assert.strictEqual(
    compose.fadeVf(5),
    "fade=t=in:st=0:d=0.12,fade=t=out:st=4.88:d=0.12",
  );
  assert.strictEqual(
    compose.fadeAf(5),
    "afade=t=in:st=0:d=0.12,afade=t=out:st=4.88:d=0.12",
  );
});

test("ASS 字幕三档字号:小44/中52/大62,非法回落52", () => {
  for (const [tier, want] of [
    ["小", 44],
    ["中", 52],
    ["大", 62],
    [undefined, 52],
    ["巨大", 52],
  ]) {
    const dest = path.join(
      os.tmpdir(),
      `mj_ass_${want}_${Math.random().toString(36).slice(2)}.ass`,
    );
    compose.writeAss("台词测试", 3, dest, tier);
    const ass = fs.readFileSync(dest, "utf8");
    assert.match(
      ass,
      new RegExp(`Style: Sub,Noto Sans CJK SC,${want},&H00FFFFFF`),
    );
    fs.rmSync(dest, { force: true });
  }
});

test("buildAudioFilter:有语音 → sidechaincompress ducking + amix", () => {
  const r = compose.buildAudioFilter({ hasVoice: true, vol: 0.25, dur: 30 });
  assert.match(
    r.filter,
    /sidechaincompress=threshold=0\.03:ratio=6:attack=120:release=500/,
  );
  assert.match(r.filter, /volume=0\.25/);
  assert.match(r.filter, /amix=inputs=2:duration=first/);
  assert.strictEqual(r.mapAudio, "[aout]");
});

test("buildAudioFilter:无语音 → 单轨 volume + 尾部 2s 淡出", () => {
  const r = compose.buildAudioFilter({ hasVoice: false, vol: 0.25, dur: 30 });
  assert.match(r.filter, /volume=0\.25,afade=t=out:st=28\.00:d=2/);
  assert.ok(!r.filter.includes("sidechaincompress"));
  assert.strictEqual(r.mapAudio, "[aout]");
});

test("buildAudioFilter:dur<2 时淡出起点夹 0", () => {
  const r = compose.buildAudioFilter({ hasVoice: false, vol: 0.5, dur: 1 });
  assert.match(r.filter, /afade=t=out:st=0\.00:d=2/);
});
