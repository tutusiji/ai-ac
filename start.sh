#!/usr/bin/env bash
# 漫剧工坊启动脚本:首次运行自动初始化 edge-tts 虚拟环境
set -e
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "[manju] 初始化 .venv(edge-tts 配音)…"
  python3 -m venv .venv
  .venv/bin/pip install --quiet edge-tts
fi

if ! command -v ffmpeg >/dev/null; then
  echo "[manju] ❌ 需要 ffmpeg,请先安装(apt install ffmpeg)"; exit 1
fi

exec node server.js
