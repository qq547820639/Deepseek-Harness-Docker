# DeepSeek Harness 本地容器化部署 Runbook（实测验证版）

> 本目录为仓库的部署配置。构建上下文（build context）为**仓库根目录**（即 `deploy/` 的上一级），
> 因此 `Dockerfile` 中 `COPY repo/ /app/` 能正确取到 `../repo` 源码。
> 根目录说明见 [../README.md](../README.md)。

> 结论：**可以**。本方案已在 macOS + Colima（vz 虚拟化）上端到端实测通过：
> Web UI 可达、Landlock 沙箱强制生效、mock 模型驱动 agent 经沙箱成功执行命令。
> 验证时间：2026-08-13；仓库 HEAD：`47f9438`；npm 包版本：`0.1.0-rc.6`。

## 1. 实测结论（重要）

| 项目 | 结论 |
|---|---|
| 官方容器支持 | 无 Dockerfile / 无官方镜像，需自建 |
| web 绑定行为 | **只绑容器内 127.0.0.1:3080**（socket 表实证）；官方刻意禁止 `--host 0.0.0.0` |
| 端口接入方案 | 容器内 relay 中继：dsh(127.0.0.1:3080) ← relay(容器 eth0 IP:3080) ← docker -p |
| relay 注意点 | **不能绑 0.0.0.0**，与 dsh 的 127.0.0.1:3080 冲突（Linux EADDRINUSE），必须绑容器 eth0 IP |
| 信任栅栏 | `--trusted-host 127.0.0.1:3080 localhost:3080` 后两种 Host 头均可访问（实测 200） |
| 沙箱 | Landlock 在 Colima vz VM 内核生效，探针 exit 0，报告 `partial enforcement (older ABI)`（仍具强制力，官方定义的可接受状态） |
| 健康检查 | 镜像内置 HEALTHCHECK 用 node fetch 打 127.0.0.1:3080（**不要装 curl**，Debian 源被墙） |
| 模型配置 | `$DSH_HOME/settings.yaml`（providers + agent-default-model），密钥经 `apiKeyEnv` 引用环境变量 |
| 状态 | developer preview，接口破坏性变更频繁，**锁版本 + 按 git SHA 打标签** |

## 2. 镜像（deploy/ 目录，构建上下文 = workspace 根）

| 文件 | 说明 |
|---|---|
| `Dockerfile.npm` | 快速路径：npm 装 `@deepseek-ai/dsh`，推荐起步（实测验证通过） |
| `Dockerfile` | 源码多阶段构建（build 阶段含编译工具链 + landlock-run 原生编译，实测验证通过） |
| `docker-compose.yml` | 单机编排（`context: ..` = workspace 根；`name: deepseek-harness` 固定项目名；另有 verify profile 的 mock-llm 服务） |
| `docker-compose.npm.yml` | 覆盖文件：复用已构建的 npm 镜像、跳过源码构建（`build: !reset null`） |
| `verify/` | 端到端验证套件（mock-llm.mjs / settings.mock.yaml / verify.sh） |
| `files/` | entrypoint.sh + relay.mjs（容器内中继） |

构建（网络受限环境加 `--build-arg NPM_REGISTRY=https://registry.npmmirror.com`）：

```sh
# 快速路径
docker build -f deploy/Dockerfile.npm -t dsh:0.1.0-rc.6-npm .
# 源码路径（按 git SHA 打标签，勿用 latest）
docker build -f deploy/Dockerfile -t dsh:0.1.0-rc.5-$(git -C repo rev-parse --short HEAD) .
```

## 3. 本地容器运行时（macOS 无 Docker Desktop 时，实测步骤）

本机没有 Homebrew/任何容器运行时时的完整安装路径（本方案实测使用）：

```sh
# 1. 安装到 ~/.local/bin（无 brew 依赖；下载走 gh-proxy 加速）
#    - docker CLI: https://download.docker.com/mac/static/stable/aarch64/docker-29.7.2.tgz
#    - colima v0.10.3 (colima-Darwin-arm64)
#    - lima 2.2.0（实测与 colima 0.10.3 配套可用；1.2.3 缺 `limactl sudo` 不可用）
#    - lima 安装要点（缺一不可）:
#      a) bin/limactl + bin/lima（真实包装脚本，勿用 limactl 符号链接替代）
#      b) share/ 全部（templates + lima-guestagent.Linux-aarch64.gz）放入 ~/.local/share/lima/
# 2. colima 磁盘镜像被墙时：手动下载到缓存后启动
#    curl -L "https://gh-proxy.com/https://github.com/abiosoft/colima-core/releases/download/v0.10.4/ubuntu-24.04-minimal-cloudimg-arm64-docker.raw.gz" \
#      -o ~/Library/Caches/colima/caches/<sha256(url)>
#    （文件名 = sha256 下载 URL；多路分段下载可提速 8 倍）
# 3. 必须挂载工作卷（否则容器 -v 绑定是空目录！）
colima start --vm-type vz --cpu 4 --memory 6 --disk 60 --mount "/Volumes/Extra:w"
```

**VM 内网络改造（一次性，被墙网络必做）**：

```sh
# apt 源换阿里云（否则 cloud-init 卡死导致 colima 起不来）
# /etc/apt/sources.list.d/ubuntu.sources: ports.ubuntu.com → mirrors.aliyun.com
# docker daemon 加 registry 镜像（Docker Hub 被墙）
printf '{\n  "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run"]\n}\n' \
  | sudo tee /etc/docker/daemon.json && sudo systemctl restart docker
```

## 4. 启动与验证

> 若 `docker compose` 不可用（静态安装的 docker CLI 无插件），安装插件二进制到 `~/.docker/cli-plugins/docker-compose`：
> `curl -fsSL https://gh-proxy.com/https://github.com/docker/compose/releases/download/v5.4.0/docker-compose-darwin-aarch64 -o ~/.docker/cli-plugins/docker-compose && chmod +x ~/.docker/cli-plugins/docker-compose`

```sh
# 启动（workspace 卷指向你要给 agent 用的项目目录）
export DSH_WORKSPACE=/path/to/your-project
# 快速路径：复用已验证 npm 镜像（不重新构建源码）
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.npm.yml up -d
# 源码路径：--build 走多阶段源码构建
docker compose -f deploy/docker-compose.yml up -d --build
# 或纯 docker（等价）：
docker run -d --name dsh -p 127.0.0.1:3080:3080 \
  -v dsh-data:/data -v "$DSH_WORKSPACE:/workspace" \
  dsh:0.1.0-rc.6-npm

# 验证
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/        # 200
docker inspect --format '{{.State.Health.Status}}' dsh                   # healthy
```

浏览器打开 http://127.0.0.1:3080 → Settings → Models 填 DeepSeek API Key。

**完整端到端验证（无需真实 API Key）**：

```sh
./deploy/verify/verify.sh
# 覆盖: 构建 → Web 200 → landlock 探针 → mock 模型驱动 headless 任务
# 期望输出: PASS: 沙箱执行成功，工具输出含 sandbox-ok
```

## 5. 配置与数据

- **模型**：`/data/settings.yaml`（`llm-pi-ai.providers.*` + `agent-default-model`）；密钥经 `apiKeyEnv` 指向容器环境变量，不落明文（UI 填写的密钥存 `$DSH_HOME/.credentials.yaml`）。
- **数据目录**：`/data` 为宿主机 bind 挂载（`${DSH_DATA:-/Volumes/Extra/CodeProj/dsh-data}`，可经环境变量改），存放 settings/凭据。**勿把 DSH_DATA 指向 agent 的 workspace 目录内**（凭据会被 agent 读到）。
- **上传目录**：工作目录内的 `attachments/` 文件夹 ↔ 容器 `/data/attachments/v1`（UI 上传的附件、宿主机要交给 agent 的文件都放这里，双向直通）。
- **权限策略**：`permission` 命名空间，预设 workspace-write（沙箱开+审批）与 danger-full-access（沙箱关+自动批准）。
- **备份**：`tar czf dsh-data.tgz -C /Volumes/Extra/CodeProj/dsh-data .`

## 6. 升级与回滚

```sh
# 升级：新 SHA 构建新标签，绝不覆盖旧标签
docker build -f deploy/Dockerfile -t dsh:<new-sha> .
# 回滚：compose image 指回旧标签重启（dsh-data 卷不动）
docker compose -f deploy/docker-compose.yml up -d
```

## 7. 沙箱失败兜底（按序）

| 方案 | 操作 | 代价 |
|---|---|---|
| 1. bwrap | 镜像加装 bubblewrap | 需 user namespace，Docker 默认 seccomp 常拦 unshare |
| 2. runnerCommand | 自定义 bwrap 兼容执行器 | 自行实现协议 |
| 3. E2B | 仓库内置 e2b 远端沙箱 | 外部服务+费用 |
| 4. 宿主机原生 | `npx @deepseek-ai/dsh web`（macOS 用 Seatbelt） | 失去容器隔离 |

> 预期无需兜底：Landlock 在 Colima/Docker Desktop 内核均可用；
> 若探针报 unusable 则 fail-closed（`SANDBOX_UNAVAILABLE`），不要绕过。

## 8. 风险清单

- ⚠️ developer preview：跨版本配置/插件不兼容，升级前备份 `dsh-data`。
- ⚠️ 容器内 agent 可执行代码，虽经沙箱隔离，仍建议仅对信任的 workspace 挂载读写，
  端口只映射到宿主 127.0.0.1。
- ⚠️ 本机实测环境：Colima + vz；Docker Desktop/OrbStack 用户仅需第 4 节步骤
  （镜像构建无需第 3 节）。
- ⚠️ 镜像未发布到任何 registry，多机部署请推送到私有 registry 并保持 SHA 标签。
