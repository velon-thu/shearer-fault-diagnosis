#!/usr/bin/env bash
# 启动平板前端开发服务器（http://localhost:3000）
# 用法: pnpm frontend   （或 bash scripts/start-frontend.sh）
# 热更新：改 apps/tablet 下的代码保存即生效，无需重启。
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm --filter @shearer/contracts build > /dev/null
pnpm --filter @shearer/tablet dev
