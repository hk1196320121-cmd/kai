# How CLI Output Rendering Works

The CLI rendering layer gives every `kai` command a consistent look: headers, key-value pairs, bar charts, tables, and next-step hints. Before v0.8, each command built its output with ad-hoc `console.log` calls and inline string concatenation. The rendering layer replaces that with shared primitives and typed renderers.

## The problem

When every command formats output its own way, small inconsistencies multiply. One command uses bold labels, another doesn't. One indents nested data with 4 spaces, another with 2. Error messages look different depending on which command prints them. Adding a new output element (like a confidence indicator or a progress bar) means touching every command file.

Worse: color handling was scattered. Some commands used picocolors directly, others had no color at all, and non-TTY output (piped to a file or another command) would leak ANSI escape codes because nothing checked `isTTY`.

## The approach: two layers

The rendering system has two layers: **format primitives** and **typed renderers**.

### Format primitives (`format.ts`)

16 functions that produce formatted strings. Every function is pure (no side effects, no `console.log`) and color-aware (gated through `shouldUseColor()`).

| Primitive | What it does |
|-----------|--------------|
| `header` | Bold text for section titles |
| `subheader` | Dim text for subtitles |
| `kv` | Key-value pair with aligned label (min 14 chars) |
| `bar` | Horizontal bar chart with color thresholds (green >= 0.7, yellow >= 0.4, red below) |
| `section` | Title + indented rows |
| `status` | Icon + text: green check, red X, yellow warning, cyan arrow |
| `table` | ANSI-aware column alignment — padding counts visible width, not bytes |
| `list` | Numbered list |
| `dim` | Dim (low-brightness) text |
| `emphasis` | Bold text |
| `renderError` | Red error message with optional recovery hint |
| `divider` | Horizontal rule, capped at terminal width (max 60) |
| `nextSteps` | "Next" header with indented action items |
| `shouldUseColor` | Returns false when `NO_COLOR` is set, `--no-color` flag is passed, or stdout is not a TTY |
| `getTerminalWidth` | Returns `stdout.columns` (floor 40, default 80) |

### Typed renderers (`renderers/*.ts`)

6 renderer modules, one per CLI domain. Each receives typed data structures and returns formatted strings.

| Renderer | Functions | Domain |
|----------|-----------|--------|
| `profile` | `renderProfile`, `renderTraitBar`, `renderDiff`, `renderProvenance` | Profile display, trait bars, diffs, provenance chains |
| `workspace` | `renderWorkspaceStatus`, `renderWorkspaceList` | Workspace detail and compact list |
| `recommendations` | `renderRecommendations` | Scored recommendation cards with optional hint suppression |
| `prompt` | `renderChampion`, `renderGeneList`, `renderTournamentResults` | Prompt genome display |
| `telemetry` | `renderHealthReport`, `renderTrace`, `renderErrorList` | Telemetry dashboards, nested spans, error tables |

Command files import their renderer and call `console.log(renderX(data))`. The command handles business logic and error flow; the renderer handles formatting.

```
CLI command file          Renderer              Format primitives
─────────────────         ────────              ─────────────────
profile.ts  ───────────►  profile.ts  ────────►  header, kv, bar,
                                                    section, dim
```

## Color policy

Color is controlled by three signals, checked in priority order:

1. **`--no-color` CLI flag** — sets `noColorOverride = true` via `setNoColor(true)`
2. **`NO_COLOR` environment variable** — any value disables color
3. **Non-TTY stdout** — `process.stdout.isTTY === false` disables color

The format primitives build ANSI escape codes directly instead of using picocolors at runtime. Why: picocolors caches `isColorSupported` at import time, so a test that calls `setNoColor(true)` mid-process would have no effect. Building ANSI strings manually and gating them through `shouldUseColor()` on every call means color can be toggled at any point.

## Bar chart edge cases

The `bar()` function handles three edge cases that would otherwise crash or produce garbage output:

- **`max <= 0`** — returns an empty bar (`░░░░░░░░░░  0.00`) instead of dividing by zero
- **`NaN`, `Infinity`, negative values** — clamped to valid range: NaN and negatives become 0, +Infinity becomes max
- **Color thresholds** — the bar itself turns green (ratio >= 0.7), yellow (>= 0.4), or red (below), giving a quick visual read on trait confidence or health scores

## Nested span rendering with cycle detection

The telemetry renderer (`renderTrace`) builds a tree from flat span data using `parent_span_id`. Three passes ensure every span appears exactly once:

1. **Root spans** — those with no `parent_span_id`
2. **Orphaned spans** — have a parent ID that doesn't exist in the span set
3. **Cyclic spans** — remaining unvisited spans (part of a reference cycle)

Without the `visited` set, a circular span reference (A -> B -> A) would cause infinite recursion. The fix: track visited IDs and skip already-rendered spans.

## ANSI-aware table alignment

Tables use `visibleLen()` to measure column widths. This strips ANSI escape codes before counting characters, so a bold or colored header doesn't break alignment. The companion `ansiPadEnd()` pads based on visible width, not byte length.

This matters because `"\x1b[1mHeader\x1b[22m".length` is 18 (with escape codes) but the visible width is 6. Without ANSI-aware padding, tables misalign whenever colored text appears in a column.

## Hint suppression in recommendations

`renderRecommendations` accepts `{ showHint: boolean }` (default `true`). When `kai work start` runs the cold start flow, it passes `showHint: false` because the interactive prompt that follows already tells the user how to select. Without this flag, users would see the same instruction twice.

## Trade-offs

- **No streaming** — renderers return complete strings, not streams. This is fine for CLI output (usually under 100 lines) but would need rethinking for very large datasets.
- **No i18n** — all labels are English strings baked into the format functions. Adding translations would require passing label maps through every renderer call.
- **Manual ANSI instead of a library** — more code to maintain, but avoids the import-time caching problem and keeps the dependency tree small.

## Related

- [CLI Reference](reference-cli.md) — every command that uses these renderers
- [How to Configure Kai](howto-configure.md) — `NO_COLOR` environment variable
