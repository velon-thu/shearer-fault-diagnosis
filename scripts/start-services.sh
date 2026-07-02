#!/usr/bin/env bash
# 一键启动数据侧全部服务：org回放器 + 共享内存采集器 + ipc-api
# 用法: pnpm services   （或 bash scripts/start-services.sh）
# Ctrl+C 一次性停掉三个服务。
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.local/go/bin:$PATH"

# 防止重复启动（两个回放器抢共享内存 / 两个采集器抢数据库都会出问题）
for name in "bin/replayer" "bin/collector"; do
  if pgrep -f "$name" > /dev/null 2>&1; then
    echo "错误: 检测到 $name 已在运行，请先停掉旧进程（pkill -f $name）"
    exit 1
  fi
done

DATAPLANE=services/dataplane
BIN=$DATAPLANE/bin
mkdir -p "$BIN" logs

echo "[1/4] 编译数据面程序…"
(cd "$DATAPLANE" && go build -o bin/ ./cmd/...)

echo "[2/4] 构建 contracts…"
pnpm --filter @shearer/contracts build > /dev/null

echo "[3/4] 启动 collector（清库+预载历史数据）…"
"$BIN/collector" -db "$DATAPLANE/data/shearer.db" -dir testdata > logs/collector.log 2>&1 &
COLLECTOR_PID=$!

# 等预载完成再起回放器，保证"历史→直播"无缝衔接
for _ in $(seq 1 90); do
  if grep -q "预载完成" logs/collector.log 2> /dev/null; then
    break
  fi
  if ! kill -0 "$COLLECTOR_PID" 2> /dev/null; then
    echo "错误: collector 提前退出，见 logs/collector.log"
    exit 1
  fi
  sleep 1
done

echo "      预载完成，启动 replayer（从同步点直播续灌）…"
"$BIN/replayer" -dir testdata -interval 100ms > logs/replayer.log 2>&1 &
REPLAYER_PID=$!

cleanup() {
  echo ""
  echo "停止 replayer / collector…"
  kill "$REPLAYER_PID" "$COLLECTOR_PID" 2> /dev/null || true
}
trap cleanup EXIT

echo "[4/4] 启动 ipc-api（http://localhost:18080，Ctrl+C 全部退出）"
echo "      回放器: logs/replayer.log   采集器: logs/collector.log"
pnpm --filter @shearer/ipc-api dev
