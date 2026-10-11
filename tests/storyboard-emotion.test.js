"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const sb = require("../lib/storyboard");

test("systemPrompt 的 schema 与要求含 emotion 枚举", () => {
  const p = sb.systemPrompt("韩系条漫", 6);
  assert.match(
    p,
    /emotion 是台词情绪,只能取:平静\/严肃\/激动\/低沉\/惊讶\/悲伤;缺省 平静/,
  );
  assert.match(p, /"emotion":"平静"/);
});

test("sceneShotsSystem 含 emotion 指令", () => {
  const p = sb.sceneShotsSystem("韩系条漫", 5);
  assert.match(p, /emotion:平静\/严肃\/激动\/低沉\/惊讶\/悲伤\(缺省 平静\)/);
  assert.match(p, /"emotion":"平静"/);
});

test("normalizeShot:缺失/非法 emotion 回落平静,合法值保留", () => {
  assert.strictEqual(sb.normalizeShot({}).emotion, "平静");
  assert.strictEqual(sb.normalizeShot({ emotion: "狂喜" }).emotion, "平静");
  assert.strictEqual(sb.normalizeShot({ emotion: "悲伤" }).emotion, "悲伤");
});

test("normalizeShot 沿用既有字段规则(camera/duration/截断)", () => {
  assert.strictEqual(sb.normalizeShot({}).camera, "固定");
  assert.strictEqual(sb.normalizeShot({ duration: 99 }).duration, 6);
  assert.strictEqual(sb.normalizeShot({ duration: 1 }).duration, 3);
  assert.strictEqual(
    sb.normalizeShot({ visual: "x".repeat(200) }).visual.length,
    120,
  );
  assert.strictEqual(sb.normalizeShot({}).speaker, "旁白");
});

test("fallbackStoryboard 每镜带 emotion=平静(零迁移形态)", () => {
  const d = sb.fallbackStoryboard("一句。两句。", 4);
  assert.strictEqual(d.shots.length, 4);
  assert.ok(d.shots.every((s) => s.emotion === "平静"));
});
