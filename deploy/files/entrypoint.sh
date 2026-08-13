#!/bin/bash
# dsh 容器入口：启动 dsh（容器内绑定 127.0.0.1:3080），就绪后启动端口中继。
# 用法: entrypoint.sh <dsh 启动命令...>   （后续参数全部透传给 dsh）
set -euo pipefail

DSH_PORT="${DSH_PORT:-3080}"

echo "[entrypoint] starting: $*"
"$@" &
DSH_PID=$!

echo "[entrypoint] waiting for dsh on 127.0.0.1:${DSH_PORT} ..."
for i in $(seq 1 120); do
  if node -e "fetch('http://127.0.0.1:${DSH_PORT}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "[entrypoint] dsh is up"
    break
  fi
  if ! kill -0 "$DSH_PID" 2>/dev/null; then
    echo "[entrypoint] dsh exited during startup" >&2
    exit 1
  fi
  sleep 1
  if [ "$i" = "120" ]; then
    echo "[entrypoint] timeout waiting for dsh" >&2
    exit 1
  fi
done

echo "[entrypoint] starting relay"
node /opt/dsh/relay.mjs "${DSH_PORT}" 127.0.0.1 "${DSH_PORT}" &
RELAY_PID=$!

cleanup() {
  kill "$DSH_PID" "$RELAY_PID" 2>/dev/null || true
  wait "$DSH_PID" "$RELAY_PID" 2>/dev/null || true
}
trap cleanup TERM INT

wait -n "$DSH_PID" "$RELAY_PID" || true
echo "[entrypoint] one process exited; shutting down"
cleanup
