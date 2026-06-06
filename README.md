# Coding Agent Analysis

各家 coding agent 源码对照分析仓。vendor 以 git submodule 管理，只保留源码，不同步二进制和测试/营销大文件。

## Vendors

| 路径 | 上游 |
|------|------|
| `vendors/codex` | [openai/codex](https://github.com/openai/codex) |
| `vendors/kimi-code` | [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code) |
| `vendors/gemini-cli` | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| `vendors/opencode` | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| `vendors/claude-code-sourcemap` | [ChinaSiro/claude-code-sourcemap](https://github.com/ChinaSiro/claude-code-sourcemap) |

## 首次克隆

```bash
git clone --recurse-submodules --depth 1 <repo-url>
cd coding-agent
./scripts/sync-vendors.sh --no-remote   # 配置 sparse + 瘦身
```

## 日常同步

```bash
./scripts/sync-vendors.sh              # 拉最新 + 瘦身
./scripts/sync-vendors.sh --no-remote  # 不拉远程，只再瘦一遍
```

## 瘦身规则

- 配置：`scripts/vendor-prune.yaml`
- 逻辑：`scripts/prune_vendors.py` + `scripts/sync-vendors.sh`

机制：sparse-checkout 少检出无关目录，prune 删掉 ripgrep、`.node`、测试 fixture、视频等。子模块 `shallow = true` 控制历史体积。

改规则后执行 `./scripts/sync-vendors.sh --no-remote` 生效。
