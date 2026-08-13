# syntax=docker/dockerfile:1
# =============================================================================
# DeepSeek Harness (dsh) — 源码构建镜像（多阶段）
#
# 构建（在 workspace 根目录执行，context = workspace 根）:
#   docker build -f deploy/Dockerfile \
#     -t dsh:0.1.0-rc.5-$(git -C repo rev-parse --short HEAD) .
#
# 设计说明:
# - dsh web 只绑定容器内 127.0.0.1:3080（官方安全设计，禁止 --host 0.0.0.0），
#   由 relay.mjs 绑定容器 eth0 IP 中继，供 docker -p 端口映射接入
#   （0.0.0.0 绑定会与 dsh 的 127.0.0.1 冲突，Linux 下 EADDRINUSE）。
# - landlock 原生模块有 linux-arm64/x64 预编译产物；node-pty 需本地编译，
#   故 build 阶段经镜像源安装 python3/make/g++。
# - 不安装 curl/apt 包（运行时镜像），健康检查用 node 内置 fetch。
# - developer preview，必须按 git SHA 打标签，禁用 latest。
# =============================================================================

FROM node:24-bookworm-slim AS build
WORKDIR /app
# pnpm 版本由 repo/package.json 的 packageManager 字段锁定 (pnpm@11.7.0)
RUN corepack enable
# 网络受限环境: --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=
# Debian 源切镜像 + 编译工具链（仅 build 阶段，不进运行时镜像）
# musl-tools 用于编译 landlock-run 原生沙箱二进制（native/landlock-run，C 源）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ musl-tools gcc \
 && rm -rf /var/lib/apt/lists/*
RUN if [ -n "$NPM_REGISTRY" ]; then corepack pnpm config set registry "$NPM_REGISTRY"; fi
COPY repo/ /app/
RUN pnpm install --frozen-lockfile
# 编译 landlock-run 二进制到 packages/linux-*/bin/（发布包自带预编译产物，源码构建必须显式执行）
RUN pnpm --dir native/landlock-run run build:native
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DSH_HOME=/data \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app
# 构建时预装 pnpm 11.7.0（corepack 运行时下载走 npmjs，容器网络不可达）
RUN corepack enable \
 && corepack prepare pnpm@11.7.0 --activate \
 && useradd -r -u 10001 -d /data dsh \
 && mkdir -p /data /workspace \
 && chown -R dsh:dsh /data /workspace
COPY --from=build --chown=dsh:dsh /app /app
COPY deploy/files/relay.mjs deploy/files/entrypoint.sh /opt/dsh/
RUN chmod +x /opt/dsh/entrypoint.sh && chown -R dsh:dsh /opt/dsh
USER dsh
WORKDIR /app
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/opt/dsh/entrypoint.sh", "pnpm", "dsh", "web"]
CMD ["--port", "3080", "--trusted-host", "127.0.0.1:3080", "localhost:3080"]
