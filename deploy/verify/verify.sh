#!/bin/bash
# DeepSeek Harness 容器端到端验证脚本
# 覆盖: 镜像构建 → Web 可达 → landlock 探针 → mock 模型驱动 headless 任务(沙箱执行命令)
# 前置: colima 已启动; PATH 含 ~/.local/bin (docker)
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
WS="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="dsh:0.1.0-rc.6-npm"
NET="dsh-verify-net"
DATA="$WS/.verify-data"
HOST_PORT="${VERIFY_HOST_PORT:-13080}"

echo "== [1/7] 构建 npm 快速镜像 =="
docker build -f "$WS/deploy/Dockerfile.npm" -t "$IMAGE" "$WS"

echo "== [2/7] 准备验证网络与 mock LLM =="
docker network create "$NET" 2>/dev/null || true
docker rm -f mock-llm dsh-verify 2>/dev/null || true
docker run -d --name mock-llm --network "$NET" \
  -v "$WS/deploy/verify/mock-llm.mjs:/opt/mock-llm.mjs:ro" \
  node:24-bookworm-slim node /opt/mock-llm.mjs 18765

echo "== [3/7] 注入 mock 模型配置并启动 dsh =="
mkdir -p "$DATA"
cp "$WS/deploy/verify/settings.mock.yaml" "$DATA/settings.yaml"
docker run -d --name dsh-verify --network "$NET" \
  -p "127.0.0.1:$HOST_PORT:3080" \
  -v "$DATA:/data" \
  -e MOCK_API_KEY=test-key \
  "$IMAGE"

echo "== [4/7] 等待 Web UI 就绪 =="
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$HOST_PORT/" >/dev/null 2>&1; then echo "web up (${i}s)"; break; fi
  if [ "$i" = "90" ]; then echo "FAIL: web not reachable"; docker logs dsh-verify | tail -30; exit 1; fi
  sleep 1
done
curl -sS -o /dev/null -w "GET /            -> %{http_code}\n" "http://127.0.0.1:$HOST_PORT/"
curl -sS -o /dev/null -w "GET / (localhost)-> %{http_code}\n" -H "Host: localhost:$HOST_PORT" "http://127.0.0.1:$HOST_PORT/"
docker inspect --format '{{.State.Health.Status}}' dsh-verify | xargs echo "healthcheck      ->"

echo "== [5/7] landlock 直接探针 =="
docker exec dsh-verify sh -c 'BIN=$(find /usr/local/lib/node_modules -path "*landlock-run*/bin/landlock-run" 2>/dev/null | head -1); echo "probe bin: ${BIN:-NOT FOUND}"; [ -n "$BIN" ] && "$BIN" --probe; echo "probe exit: $?"'

echo "== [6/7] mock 模型驱动 headless 任务（agent 经沙箱执行命令）=="
set +e
OUTPUT=$(docker exec dsh-verify dsh --profile headless "run the sandbox verification command" 2>&1)
RC=$?
set -e
echo "$OUTPUT"
echo "headless exit: $RC"
if echo "$OUTPUT" | grep -q "sandbox-ok"; then
  echo "PASS: 沙箱执行成功，工具输出含 sandbox-ok"
else
  echo "FAIL: 未在输出中发现 sandbox-ok（详见上方输出）"
fi

echo "== [7/7] 完成 =="
echo "容器保留用于排查: mock-llm, dsh-verify"
echo "清理: docker rm -f dsh-verify mock-llm && docker network rm $NET"
