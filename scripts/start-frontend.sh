#!/usr/bin/env bash
# 启动平板前端开发服务器（http://localhost:3000）
# 用法: pnpm frontend   （或 bash scripts/start-frontend.sh）
# 热更新：改 apps/tablet 下的代码保存即生效，无需重启。
set -euo pipefail
cd "$(dirname "$0")/.."

# 3000 端口被占（多半是残留的旧 dev server）时给出明确提示
if ss -tln 2> /dev/null | grep -q ":3000 "; then
  echo "错误: 3000 端口已被占用，请先清理旧进程："
  echo "  pkill -f 'next dev'"
  exit 1
fi

pnpm --filter @shearer/contracts build > /dev/null
pnpm --filter @shearer/tablet dev
