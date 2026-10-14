"use strict";
/* public/ 四个 <script> 共享浏览器全局作用域:任一顶层 const/let/class/函数重名
   = eval 时 SyntaxError = 整个应用不启动(静态 logo 白屏)。
   node --check 只查单文件,require 只走模块作用域,都看不见这类冲突;
   本测试把四文件按 index.html 的加载顺序拼接后做一次解析,永久钉死。 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const SCRIPT_ORDER = ["flow-graph.js", "flow.js", "flow-route.js", "app.js"];

test("public 脚本全局作用域无顶层重名声明(浏览器 eval 可启动)", () => {
  const src = SCRIPT_ORDER.map((f) =>
    fs.readFileSync(path.join(PUBLIC, f), "utf8"),
  ).join("\n;\n");
  assert.doesNotThrow(() => new Function(src), SyntaxError);
});
