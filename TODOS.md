# TODOS — Kai

## Completed

### MCP Server 设计 (TODO 1)
- **What**: 为 Kai 设计 MCP Server 接口，暴露画像/上下文为 MCP tools/resources
- **Completed**: v0.2.0.0 (2026-05-19) — 5 tools (profile.read, profile.why, observe.submit, observe.batch, derive.trigger), 6 resources (kai://profile/*), stdio transport, persistent corrections, 152 tests

## TODO 2: Pattern Intelligence 设计
- **What**: 设计观察数据的主动模式发现引擎
- **Why**: CEO review 接受，核心差异化能力——从被动记录到主动洞察。让 Kai 不只是记录观察，而是发现用户自己没注意到的行为模式
- **Pros**: 核心差异化，让 Kai 从"记录器"变成"洞察引擎"
- **Cons**: 算法复杂度，需要足够的数据量才能发现有意义的模式
- **Context**: 设计文档无此设计。CEO review 将其列为 ACCEPTED (M effort)。需要定义模式类型（频率模式、关联模式、异常检测）、发现算法（统计 vs ML）、和输出格式。Phase 1 的 observation 数据是这个引擎的输入
- **Depends on**: Phase 1 积累足够的 observation 数据（建议 >1000 条后启动设计）
- **Added**: 2026-05-18 by /plan-eng-review

## TODO 3: CI/CD 流水线
- **What**: 设置 GitHub Actions 自动测试 + 发布流程
- **Why**: Phase 2+ 需要可靠发布。初期建立比后期补更便宜——测试基础设施已经存在（bun:test），CI 只是自动化它
- **Pros**: 每次 push 自动验证，发布流程标准化
- **Cons**: 初始设置时间（约 2 小时）
- **Context**: bun test + npm publish / GitHub Releases。设计文档提到但未包含在任何 Phase 中。Phase 1 是本地 CLI 工具不需要发布，但 Phase 2 开始需要
- **Depends on**: Phase 1 基本功能可用 + 100% 测试覆盖
- **Added**: 2026-05-18 by /plan-eng-review

## TODO 4: LLM Prompt 演化策略
- **What**: 为 profile-derive.md 建立 prompt 版本管理和回归测试
- **Why**: Prompt 会迭代，需要确保改动不降低推导质量。没有版本管理的 prompt 就像没有测试的代码
- **Pros**: Prompt 变更可追溯，质量可回归验证
- **Cons**: 需要定义 eval 基准数据集和评分标准
- **Context**: eval 测试框架需要 prompt 版本绑定。profile-derive.md 是核心 prompt——它决定 Kai 如何从观察推导特质。每次修改 prompt 都应该跑 eval 确保不退化
- **Depends on**: Phase 1 profile derive 可运行，有足够的测试 observation 数据
- **Added**: 2026-05-18 by /plan-eng-review

## TODO 5: 画像同步机制
- **What**: 设计 git-based 多机器画像同步
- **Why**: 用户可能在多台机器上使用 Kai，画像数据需要跨机器一致
- **Cons**: 合并冲突处理、大 observation 表的同步效率
- **Context**: 参考 gstack brain sync 模式（~/.gstack/.git pull/push）。kai.db 的同步需要考虑 SQLite 文件的二进制合并 vs 导出 JSON 再合并
- **Depends on**: Phase 1 画像数据模型稳定，至少在一个环境运行 1 个月
- **Added**: 2026-05-18 by /plan-eng-review
