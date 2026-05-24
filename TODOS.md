# TODOS — Kai

## Completed

### Flight Recorder Telemetry System
- **What**: Full causal chain telemetry — trace every MCP request through derivation, orchestration, and prompt genome with spans, events, state changes, and error records
- **Completed**: v0.6.0.0 (2026-05-22) — TelemetryStore, TelemetryRecorder, Sanitizer, Stats, LLM Explain, 3 MCP tools, 3 MCP resources, 5 CLI commands, V7 migration, orchestrator/prompt instrumentation, 545 tests across 74 files

### Personal OS Bootstrapper
- **What**: Deep interview engine (10 questions), enhanced trait derivation (7 new deriveFromValues rules), task template catalog (12 templates), recommendation engine, kai_work_recommend MCP tool, feedback loop, auto-execute
- **Completed**: v0.7.0.0 (2026-05-23) — InterviewEngine, Derivator deriveFromValues, TemplateCatalog, RecommendEngine, kai_work_recommend MCP tool, V8 migration, 613 tests across 83 files

### MCP Server 设计 (TODO 1)
- **What**: 为 Kai 设计 MCP Server 接口，暴露画像/上下文为 MCP tools/resources
- **Completed**: v0.2.0.0 (2026-05-19) — 5 tools (profile.read, profile.why, observe.submit, observe.batch, derive.trigger), 6 resources (kai://profile/*), stdio transport, persistent corrections, 152 tests

### CI/CD 流水线 (TODO 3)
- **What**: 设置 GitHub Actions 自动测试 + 发布流程
- **Completed**: 2026-05-19 — ci.yml (typecheck + lint + test, Bun 1.3.13), dependabot.yml (actions + npm weekly)

### CD 发布流程 (TODO 6)
- **What**: 设置 GitHub Actions 自动发布流程——release-please 版本管理 + npm publish + smoke test
- **Completed**: v0.9.0 (2026-05-25) — release.yml (release-please + npm publish + CI gate + smoke test), release-please-config.json, package name `kai-profile`, 3-part semver migration, build verification tests, supply chain hardening

### Orchestrator Idea-to-Execution Engine
- **What**: Complete orchestrator pipeline — ideas, planning, scheduling, dispatching, observation, closed-loop re-planning
- **Completed**: v0.4.0.0 (2026-05-20) — 7 MCP tools, profile-aware planner, agent bridge, observer pipeline, idea clustering, closed loop engine, V5 migration, 319 tests

### LLM Prompt 演化策略 (TODO 4)
- **What**: 为 profile-derive.md 建立 prompt 版本管理和回归测试
- **Completed**: v0.5.0.0 (2026-05-21) — Prompt Genome system with GeneStore, PromptCompiler, SegmentMatcher, JudgeEngine, TournamentRunner, PromptEvolver, 3 MCP tools, 3 MCP resources, 8 DB tables (V6 migration), 402 tests across 53 files

## Telemetry: Extend kai://system/health with telemetry stats
- **What**: The health resource (`src/mcp/resources.ts`) accepts `_telemetry` parameter but doesn't include telemetry statistics in its output body
- **Priority:** P1
- **Context:** Deferred from Flight Recorder plan (T13). Signature plumbing exists, body integration missing
- **Added**: 2026-05-22 by /ship

## TODO 2: Pattern Intelligence 设计
- **What**: 设计观察数据的主动模式发现引擎
- **Why**: CEO review 接受，核心差异化能力——从被动记录到主动洞察。让 Kai 不只是记录观察，而是发现用户自己没注意到的行为模式
- **Pros**: 核心差异化，让 Kai 从"记录器"变成"洞察引擎"
- **Cons**: 算法复杂度，需要足够的数据量才能发现有意义的模式
- **Context**: 设计文档无此设计。CEO review 将其列为 ACCEPTED (M effort)。需要定义模式类型（频率模式、关联模式、异常检测）、发现算法（统计 vs ML）、和输出格式。Phase 1 的 observation 数据是这个引擎的输入
- **Depends on**: Phase 1 积累足够的 observation 数据（建议 >1000 条后启动设计）
- **Added**: 2026-05-18 by /plan-eng-review

## TODO 5: 画像同步机制
- **What**: 设计 git-based 多机器画像同步
- **Why**: 用户可能在多台机器上使用 Kai，画像数据需要跨机器一致
- **Cons**: 合并冲突处理、大 observation 表的同步效率
- **Context**: 参考 gstack brain sync 模式（~/.gstack/.git pull/push）。kai.db 的同步需要考虑 SQLite 文件的二进制合并 vs 导出 JSON 再合并
- **Depends on**: Phase 1 画像数据模型稳定，至少在一个环境运行 1 个月
- **Added**: 2026-05-18 by /plan-eng-review

## TODO 7: PR Preview Packages (pkg-pr-new)
- **What**: 每条 PR 自动生成临时 npm 包 URL，评审者直接 `bunx` 测试
- **Why**: 现代开源项目标配，降低贡献门槛
- **Pros**: 零 checkout 测试，发布前验证包内容
- **Cons**: CI 增量 ~30s，需要 pkg-pr-new 配置
- **Context**: CEO review 推迟。pkg-pr-new 在 ci.yml 中添加一步。每次 PR 自动发布到临时 URL。
- **Effort**: S (human: ~30min / CC: ~5min)
- **Priority**: P2
- **Depends on**: CD pipeline 稳定运行
- **Added**: 2026-05-24 by /plan-ceo-review

## TODO 8: Binary Distribution (bun build --compile)
- **What**: 用 `bun build --compile` 生成单文件二进制，上传到 GitHub Release assets
- **Why**: 不是所有用户都有 Bun runtime，二进制分发降低安装门槛
- **Pros**: 零依赖安装，覆盖 macOS/Linux
- **Cons**: 跨平台编译矩阵（macOS ARM/x64, Linux x64），二进制体积 ~50MB
- **Context**: CEO review 推迟。需要在 release.yml 中添加 matrix build 步骤。bun build --compile 将 dist/ 编译为可执行文件。
- **Effort**: M (human: ~1h / CC: ~15min)
- **Priority**: P3
- **Depends on**: CD pipeline 稳定运行 + npm 发布验证
- **Added**: 2026-05-24 by /plan-ceo-review

## TODO 9: MCP Schema Snapshot in Releases
- **What**: 每次 release 自动提取 MCP tools/resources 列表，写入 GitHub Release body
- **Why**: AI agent 需要知道每个版本支持哪些工具——这是 MCP 项目的 "API contract"
- **Pros**: 独特差异化，agent 可读的发布说明
- **Cons**: 需要构建 schema 提取工具，需要 MCP server 代码的静态分析
- **Context**: Codex 在设计文档中提出的 "agent contract" 概念。从 src/mcp/*-schema.ts 文件提取工具定义。
- **Effort**: M (human: ~2h / CC: ~30min)
- **Priority**: P2
- **Depends on**: CD pipeline 稳定运行
- **Added**: 2026-05-24 by /plan-ceo-review

## TODO 10: MCP Breaking Change Detector
- **What**: 比较 MCP tools/resources 的前后版本签名，自动检测 breaking changes
- **Why**: MCP tools 是 AI agent 的 API，breaking changes 会导致 agent 静默失败
- **Pros**: 自动化版本兼容性检测
- **Cons**: 需要 schema diff 工具，依赖 TODO 9 的 schema snapshot
- **Context**: CEO review 推迟。与 MCP Schema snapshot (TODO 9) 一起做更合理。
- **Effort**: L (human: ~3h / CC: ~30min)
- **Priority**: P2
- **Depends on**: TODO 9 (MCP Schema snapshot)
- **Added**: 2026-05-24 by /plan-ceo-review

## TODO 11: Binary Name Strategy (kai vs kai-profile)
- **What**: 评估是否将 binary 名称从 `kai` 改为 `kai-profile`，或同时暴露两者
- **Why**: 包名是 `kai-profile` 但 binary 是 `kai`——不一致且 `kai` 过于通用，可能与其他工具冲突
- **Pros**: 命名一致性，避免命令冲突
- **Cons**: 现有用户（如果有）需要适应新命令名
- **Context**: Codex outside voice 提出。当前 `bin: { "kai": "dist/cli/index.js" }`。考虑添加 `kai-profile` 作为别名。
- **Effort**: S (human: ~15min / CC: ~5min)
- **Priority**: P3
- **Added**: 2026-05-24 by /plan-ceo-review
