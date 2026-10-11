"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { cameraExpr } = require("../lib/camera");

test("固定 返回 null(不加 zoompan)", () => {
  assert.strictEqual(cameraExpr("固定", 50, 864, 1536, 25), null);
});

test("缓推 = 现行 kenburns 表达式", () => {
  assert.strictEqual(
    cameraExpr("缓推", 50, 864, 1536, 25),
    "zoompan=z='min(1.14,1+0.12*on/50)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=50:s=864x1536:fps=25",
  );
});

test("未知值与缺省回落缓推(旧数据兼容)", () => {
  assert.strictEqual(
    cameraExpr("环绕", 50, 864, 1536, 25),
    cameraExpr("缓推", 50, 864, 1536, 25),
  );
  assert.strictEqual(
    cameraExpr(undefined, 50, 864, 1536, 25),
    cameraExpr("缓推", 50, 864, 1536, 25),
  );
});

test("拉远 从 1.14 缩回,表达式夹 max(1,…)", () => {
  assert.match(
    cameraExpr("拉远", 50, 864, 1536, 25),
    /z='max\(1,1\.14-0\.12\*on\/50\)'/,
  );
});

test("摇镜 z=1.15 水平扫过", () => {
  const e = cameraExpr("摇镜", 50, 864, 1536, 25);
  assert.match(e, /z='1\.15'/);
  assert.match(e, /x='\(iw-iw\/zoom\)\*on\/50'/);
});

test("特写 最深推到 1.3", () => {
  assert.match(
    cameraExpr("特写", 50, 864, 1536, 25),
    /z='min\(1\.3,1\+0\.28\*on\/50\)'/,
  );
});

test("frames=1 边界无除零(d 分段与 on 分母正确)", () => {
  for (const c of ["固定", "缓推", "拉远", "摇镜", "特写", "x"]) {
    const e = cameraExpr(c, 1, 864, 1536, 25);
    if (e) {
      assert.ok(!e.includes("/0"), e);
      assert.match(e, /on\/1/);
    }
  }
});
