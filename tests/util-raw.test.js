"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { readRawTo } = require("../lib/util");

function fakeReq(chunks) {
  const req = new EventEmitter();
  req.destroy = () => {};
  queueMicrotask(() => {
    for (const c of chunks)
      req.emit("data", Buffer.isBuffer(c) ? c : Buffer.from(c));
    req.emit("end");
  });
  return req;
}

test("readRawTo:分块流式落盘", async () => {
  const dest = path.join(
    os.tmpdir(),
    `mj_raw_${Math.random().toString(36).slice(2)}.bin`,
  );
  await readRawTo(fakeReq(["hello ", "manju"]), dest, 1024);
  assert.strictEqual(fs.readFileSync(dest, "utf8"), "hello manju");
  fs.rmSync(dest, { force: true });
});

test("readRawTo:超限拒绝并清理半截文件", async () => {
  const dest = path.join(
    os.tmpdir(),
    `mj_raw_${Math.random().toString(36).slice(2)}.bin`,
  );
  await assert.rejects(
    () =>
      readRawTo(fakeReq([Buffer.alloc(60, 1), Buffer.alloc(60, 2)]), dest, 100),
    /超过/,
  );
  assert.strictEqual(fs.existsSync(dest), false);
});
