# How to Manage Workspaces

Creating, tracking, and cleaning up workspaces, tasks, and events.

## Prerequisites

- Kai installed and on PATH
- A profile database (run `kai work start` if you haven't yet)

## List workspaces

```bash
kai work list
```

Shows all workspaces with status, task counts, and creation date:

```
Workspaces (2):

  ● Cold Start - 2026-05-20 (abc12345)
    Status: active | Tasks: 1/3 | Created: 2026-05-20
  ○ Cold Start - 2026-05-18 (def67890)
    Status: completed | Tasks: 2/2 | Created: 2026-05-18
```

Active workspaces show a filled dot (`●`). Inactive ones show an empty dot (`○`).

## Check workspace status

```bash
kai work status
```

Shows detailed info for all active workspaces:

```
=== Cold Start - 2026-05-20 (abc12345-def456-...) ===
  Status: active
  Tasks: 3 (1 completed)
  Events: 7
  Created: 2026-05-20T10:30:00Z
```

## How workspaces connect to your profile

Each `kai work start` run creates a workspace. The workspace stores:

- **Events** — every answer you gave, every task created or completed
- **Context** — a profile snapshot taken when you confirm the cold start
- **Tasks** — if you add tasks to track work within the workspace

When tasks are completed, the event bus converts those events into profile observations. This means your profile evolves as you complete work, not just during cold starts.

## Workspace data model

```
Workspace
  ├── name, description, status
  ├── context (JSON: profile_snapshot, coldstart_completed_at)
  ├── Tasks (0..N)
  │     ├── title, description, status
  │     └── metadata (JSON)
  └── Events (0..N)
        ├── event_type (workspace_created, task_created, task_completed, ...)
        └── payload (JSON)
```

## Status values

| Entity | Statuses |
|--------|----------|
| Workspace | `active`, `archived`, `completed` |
| Task | `pending`, `in_progress`, `completed`, `cancelled` |

## Troubleshooting

**"No active workspaces"** — Run `kai work start` to create one, or check `kai work list` to see if your workspace was archived or completed.

**"No workspaces found"** — You haven't run `kai work start` yet. The workspace system only creates workspaces through the cold start flow.

## Related

- [Cold Start Tutorial](tutorial-cold-start.md) — creating your first workspace
- [Event Bus](explanation-event-bus.md) — how workspace events become profile observations
- [How to Use Cold Start](howto-cold-start.md) — the flow that creates workspaces
