#!/usr/bin/env bash
# 启动平板前端开发服务器（http://localhost:3000）
# 用法: pnpm frontend   （或 bash scripts/start-frontend.sh）
# 热更新：改 apps/tablet 下的代码保存即生效，无需重启。
set -euo pipefail
cd "$(dirname "$0")/.."

# 3000 端口被残留的旧 dev server 占用时自动清理
pids=$(ss -tlnp 2> /dev/null | grep ":3000 " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | tr '\n' ' ' || true)
if [ -n "${pids// /}" ]; then
  echo "端口 3000 被残留的旧 dev server 占用（PID: ${pids}），自动清理…"
  kill ${pids} 2> /dev/null || true
  sleep 1
  kill -9 ${pids} 2> /dev/null || true
fi

pnpm --filter @shearer/contracts build > /dev/null
pnpm --filter @shearer/tablet dev
