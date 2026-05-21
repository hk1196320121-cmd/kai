# TODOS — Kai

## Completed

### MCP Server 设计 (TODO 1)
- **What**: 为 Kai 设计 MCP Server 接口，暴露画像/上下文为 MCP tools/resources
- **Completed**: v0.2.0.0 (2026-05-19) — 5 tools (profile.read, profile.why, observe.submit, observe.batch, derive.trigger), 6 resources (kai://profile/*), stdio transport, persistent corrections, 152 tests

### CI/CD 流水线 (TODO 3)
- **What**: 设置 GitHub Actions 自动测试 + 发布流程
- **Completed**: 2026-05-19 — ci.yml (typecheck + lint + test, Bun 1.3.13), dependabot.yml (actions + npm weekly)

### Orchestrator Idea-to-Execution Engine
- **What**: Complete orchestrator pipeline — ideas, planning, scheduling, dispatching, observation, closed-loop re-planning
- **Completed**: v0.4.0.0 (2026-05-20) — 7 MCP tools, profile-aware planner, agent bridge, observer pipeline, idea clustering, closed loop engine, V5 migration, 319 tests

### LLM Prompt 演化策略 (TODO 4)
- **What**: 为 profile-derive.md 建立 prompt 版本管理和回归测试
- **Completed**: v0.5.0.0 (2026-05-21) — Prompt Genome system with GeneStore, PromptCompiler, SegmentMatcher, JudgeEngine, TournamentRunner, PromptEvolver, 3 MCP tools, 3 MCP resources, 8 DB tables (V6 migration), 402 tests across 53 files

## TODO 2: Pattern Intelligence 设计
- **What**: 设计观察数据的主动模式发现引擎
- **Why**: CEO review 接受，核心差异化能力——从被动记录到主动洞察。让 Kai 不只是记录观察，而是发现用户自己没注意到的行为模式
- **Pros**: 核心差异化，让 Kai 从"记录器"变成"洞察引擎"
- **Cons**: 算法复杂度，需要足够的数据量才能发现有意义的模式
- **Context**: 设计文档无此设计。CEO review 将其列为 ACCEPTED (M effort)。需要定义模式类型（频率模式、关联模式、异常检测）、发现算法（统计 vs ML）、和输出格式。Phase 1 的 observation 数据是这个引擎的输入
- **Depends on**: Phase 1 积累足够的 observation 数据（建议 >1000 条后启动设计）
- **Added**: 2026-05-18 by /plan-eng-review

## TODO 6: CD 发布流程 (changesets + npm publish)
- **What**: 设置 GitHub Actions 自动发布流程——release.yml、changesets 版本管理、npm publish
- **Why**: CI 基线 (TODO 3) 只覆盖测试验证，不覆盖发布。Phase 2 开始需要将 Kai 作为 npm 包分发，用户通过 `bunx kai` 或 `npx kai` 安装使用
- **Pros**: 版本发布标准化，changesets 自动生成 CHANGELOG，npm publish 自动化
- **Cons**: 需要配置 NPM_TOKEN secret、解决包名占用问题、bun build 打包策略
- **Context**: CEO plan Phase 2 scope。Bun-only runtime (bin 入口 src/cli/index.ts)，需要 `bun build` 编译为可分发格式。涉及：release.yml、.changeset/config.json、npm package name resolution (kai-mcp)、NPM_TOKEN secret、build/packaging 策略、version migration 0.2.0.0 → 0.3.0
- **Depends on**: TODO 3 (CI 流水线) 稳定运行 + Phase 2 功能就绪
- **Added**: 2026-05-19 by /plan-eng-review

## TODO 5: 画像同步机制
- **What**: 设计 git-based 多机器画像同步
- **Why**: 用户可能在多台机器上使用 Kai，画像数据需要跨机器一致
- **Cons**: 合并冲突处理、大 observation 表的同步效率
- **Context**: 参考 gstack brain sync 模式（~/.gstack/.git pull/push）。kai.db 的同步需要考虑 SQLite 文件的二进制合并 vs 导出 JSON 再合并
- **Depends on**: Phase 1 画像数据模型稳定，至少在一个环境运行 1 个月
- **Added**: 2026-05-18 by /plan-eng-review
