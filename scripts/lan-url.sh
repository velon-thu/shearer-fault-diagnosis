#!/usr/bin/env bash
# 打印平板该访问的地址，并自检两个端口是否已放行。
# 用法：bash scripts/lan-url.sh
set -uo pipefail

FRONT_PORT=3000
API_PORT=18080

ip=$(ip -4 -o addr show scope global \
  | awk '{print $4}' | cut -d/ -f1 \
  | grep -Ev '^(172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.|10\.255\.)' \
  | head -1)

if [ -z "$ip" ]; then
  echo "没取到局域网 IP，先确认电脑已连上 Wi-Fi。"
  exit 1
fi

echo "本机局域网地址：$ip"
echo
echo "平板浏览器打开：  http://$ip:$FRONT_PORT"
echo

for port in $FRONT_PORT $API_PORT; do
  if ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN; then
    echo "  端口 $port  服务已启动"
  else
    echo "  端口 $port  服务没起（前端跑 pnpm frontend，数据服务跑 pnpm services）"
    continue
  fi
  # 用自己的局域网 IP 回连，能通说明防火墙已放行
  if curl -s -o /dev/null -m 3 "http://$ip:$port" 2>/dev/null; then
    echo "           局域网可达"
  else
    echo "           局域网不可达 —— Windows 防火墙未放行该端口"
  fi
done

echo
echo "若提示不可达，在 Windows 上以【管理员】身份运行 PowerShell 执行一次："
echo "  New-NetFirewallRule -DisplayName '诊断仪-前端' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $FRONT_PORT -Profile Any"
echo "  New-NetFirewallRule -DisplayName '诊断仪-数据服务' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $API_PORT -Profile Any"
