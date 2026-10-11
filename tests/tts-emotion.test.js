"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { EMOTIONS, emotionProsody } = require("../lib/tts");

test("情绪枚举恰为六项", () => {
  assert.deepStrictEqual(EMOTIONS, [
    "平静",
    "严肃",
    "激动",
    "低沉",
    "惊讶",
    "悲伤",
  ]);
});

test("六枚举各自映射(spec §5.2 表)", () => {
  assert.deepStrictEqual(emotionProsody("平静"), ["+0%", "+0Hz", "+0%"]);
  assert.deepStrictEqual(emotionProsody("严肃"), ["-8%", "-10Hz", "+0%"]);
  assert.deepStrictEqual(emotionProsody("激动"), ["+10%", "+15Hz", "+10%"]);
  assert.deepStrictEqual(emotionProsody("低沉"), ["-12%", "-20Hz", "-5%"]);
  assert.deepStrictEqual(emotionProsody("惊讶"), ["+8%", "+25Hz", "+10%"]);
  assert.deepStrictEqual(emotionProsody("悲伤"), ["-15%", "-8Hz", "-10%"]);
});

test("未知/缺省情绪回落平静元组", () => {
  assert.deepStrictEqual(emotionProsody("狂喜"), emotionProsody("平静"));
  assert.deepStrictEqual(emotionProsody(undefined), emotionProsody("平静"));
});
