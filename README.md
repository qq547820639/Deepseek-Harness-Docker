# DeepSeek Harness Docker

将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 容器化部署的封装仓库。

本仓库把官方 `repo/` 源码与 `deploy/` 部署配置打包在一起，提供开箱即用的 Docker 镜像构建与本地容器运行方案（已在 macOS + Colima vz 实测通过：Web UI 可达、Landlock 沙箱强制生效、mock 模型驱动 agent 经沙箱成功执行命令）。

## 仓库结构

```
.
├── deploy/            # 部署配置（详见 deploy/README.md）
│   ├── Dockerfile          # 源码多阶段构建（build 阶段含编译工具链 + landlock-run 原生编译）
│   ├── Dockerfile.npm      # 快速路径：npm 装 @deepseek-ai/dsh
│   ├── docker-compose.yml  # 单机编排（context = 仓库根）
│   ├── files/              # 容器内运行期文件：entrypoint.sh + relay.mjs（中继）
│   └── verify/             # 端到端验证套件：mock-llm.mjs / settings.mock.yaml / verify.sh
└── repo/               # DeepSeek Harness 官方源码（作为构建上下文被 COPY 进镜像）
```

> `repo/` 为官方源码快照，作为普通目录提交（非 submodule），clone 即用、构建简单。

## 快速开始

```sh
# 快速路径（推荐起步）
docker build -f deploy/Dockerfile.npm -t dsh:0.1.0-rc.6-npm .

# 启动
export DSH_WORKSPACE=/path/to/your-project
docker compose -f deploy/docker-compose.yml up -d --build

# 验证 Web 可达
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/   # 200
```

浏览器打开 http://127.0.0.1:3080 → Settings → Models 填 DeepSeek API Key。

## 文档

- [部署 Runbook（实测验证版）](deploy/README.md) — 镜像构建、本地容器运行时、配置与数据、升级回滚、沙箱兜底、风险清单。
- 端到端验证（无需真实 API Key）：`./deploy/verify/verify.sh`

## 许可

本仓库部署配置（`deploy/`、`README.md`、`.gitignore`）以 [MIT License](LICENSE) 发布；
`repo/` 内上游源码沿用其原有 MIT 许可（Copyright (c) 2026 DeepSeek）。

## 本地运行产物

`.workbuddy/`、`.verify-data/`、`.cache/` 等本机运行产物不入库（见 `.gitignore`）。
