import { describe, test, expect } from "bun:test";
import {
  mergeHookIntoSettings,
  removeHookFromSettings,
  KAI_HOOK_IDS,
  KAI_HOOK_SCRIPTS,
} from "../../../src/cli/skills/hooks";
import { generateSessionStartHook } from "../../../src/cli/skills/hooks/session-start";
import { generateAutoObserveHook } from "../../../src/cli/skills/hooks/auto-observe";

describe("HookGenerator", () => {
  describe("generateSessionStartHook", () => {
    test("returns a non-empty CJS script string", () => {
      const script = generateSessionStartHook();
      expect(script).toContain("#!/usr/bin/env bun");
      expect(script).toContain("require(");
      expect(script.length).toBeGreaterThan(200);
    });

    test("redacts identity name to first initial", () => {
      const script = generateSessionStartHook();
      expect(script).toContain(".charAt(0).toUpperCase()");
      expect(script).not.toContain("identity.name + \")\"");
    });
  });

  describe("generateAutoObserveHook", () => {
    test("returns a non-empty CJS script string", () => {
      const script = generateAutoObserveHook();
      expect(script).toContain("#!/usr/bin/env bun");
      expect(script).toContain("kai-auto-observe");
      expect(script.length).toBeGreaterThan(200);
    });

    test("includes observation submission logic", () => {
      const script = generateAutoObserveHook();
      expect(script).toContain("INSERT INTO observations");
      expect(script).toContain('"tool_usage"');
    });

    test("validates tool name format", () => {
      const script = generateAutoObserveHook();
      expect(script).toContain("/^[a-zA-Z0-9_.]+$/");
    });

    test("uses tool category allowlist for privacy [D19]", () => {
      const script = generateAutoObserveHook();
      expect(script).toContain("ALLOWED_TOOLS");
      expect(script).toContain("Edit");
      expect(script).toContain("Bash");
    });
  });

  describe("KAI_HOOK_IDS and KAI_HOOK_SCRIPTS", () => {
    test("exports 3 hook IDs", () => {
      expect(KAI_HOOK_IDS).toHaveLength(3);
      expect(KAI_HOOK_IDS).toContain("kai-session-start");
      expect(KAI_HOOK_IDS).toContain("kai-auto-observe");
      expect(KAI_HOOK_IDS).toContain("kai-stop");
    });

    test("exports 3 hook script filenames", () => {
      expect(KAI_HOOK_SCRIPTS).toHaveLength(3);
      expect(KAI_HOOK_SCRIPTS[0]).toBe("kai-session-start.cjs");
      expect(KAI_HOOK_SCRIPTS[1]).toBe("kai-auto-observe.cjs");
      expect(KAI_HOOK_SCRIPTS[2]).toBe("kai-stop.cjs");
    });
  });

  describe("mergeHookIntoSettings", () => {
    test("adds SessionStart hook to empty settings", () => {
      const settings = {};
      const result = mergeHookIntoSettings(settings, {
        eventType: "SessionStart",
        command: 'node "/home/user/.claude/hooks/kai/kai-session-start.cjs"',
        hookId: "kai-session-start",
      });
      expect(result.hooks.SessionStart).toBeDefined();
      expect(result.hooks.SessionStart).toHaveLength(1);
      expect(result.hooks.SessionStart[0].hooks[0].command).toContain(
        "kai-session-start",
      );
    });

    test("adds PostToolUse hook with matcher for allowlisted tools", () => {
      const settings = {};
      const result = mergeHookIntoSettings(settings, {
        eventType: "PostToolUse",
        matcher:
          "Bash|Read|Edit|Write|MultiEdit|Grep|Glob|WebSearch|WebFetch|TodoRead|TodoWrite",
        command: 'node "/home/user/.claude/hooks/kai/kai-auto-observe.cjs"',
        hookId: "kai-auto-observe",
        timeout: 10,
      });
      expect(result.hooks.PostToolUse).toHaveLength(1);
      expect(result.hooks.PostToolUse[0].matcher).toContain("Bash");
      expect(result.hooks.PostToolUse[0].matcher).toContain("Edit");
    });

    test("merges into existing hooks without duplicating", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: "command", command: "bash /some/other/hook.sh" },
              ],
            },
          ],
        },
      };
      const result = mergeHookIntoSettings(settings, {
        eventType: "SessionStart",
        command: 'node "/home/user/.claude/hooks/kai/kai-session-start.cjs"',
        hookId: "kai-session-start",
      });
      expect(result.hooks.SessionStart).toHaveLength(2);
    });

    test("updates existing Kai hook in place (idempotent)", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'node "/home/user/.claude/hooks/kai/kai-session-start.cjs" --old',
                },
              ],
            },
          ],
        },
      };
      const result = mergeHookIntoSettings(settings, {
        eventType: "SessionStart",
        command:
          'node "/home/user/.claude/hooks/kai/kai-session-start.cjs" --updated',
        hookId: "kai-session-start",
      });
      expect(result.hooks.SessionStart).toHaveLength(1);
      expect(result.hooks.SessionStart[0].hooks[0].command).toContain(
        "--updated",
      );
    });

    test("preserves non-Kai hooks", () => {
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: "Grep|Glob|Bash",
              hooks: [
                {
                  type: "command",
                  command:
                    'node "/home/user/.claude/hooks/gitnexus/gitnexus-hook.cjs"',
                  timeout: 10,
                },
              ],
            },
          ],
        },
      };
      const result = mergeHookIntoSettings(settings, {
        eventType: "SessionStart",
        command: 'node "/home/user/.claude/hooks/kai/kai-session-start.cjs"',
        hookId: "kai-session-start",
      });
      expect(result.hooks.PreToolUse).toHaveLength(1);
      expect(result.hooks.PreToolUse[0].hooks[0].command).toContain(
        "gitnexus",
      );
    });

    test("does not match unrelated hooks containing kai as substring", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node /home/user/scripts/disable-kai-session-startup.sh",
                },
              ],
            },
          ],
        },
      };
      const result = mergeHookIntoSettings(settings, {
        eventType: "SessionStart",
        command: 'node "/home/user/.claude/hooks/kai/kai-session-start.cjs"',
        hookId: "kai-session-start",
      });
      // The unrelated hook should be preserved, and a new group added
      expect(result.hooks.SessionStart).toHaveLength(2);
      expect(result.hooks.SessionStart[0].hooks[0].command).toContain(
        "disable-kai-session-startup",
      );
    });
  });

  describe("removeHookFromSettings", () => {
    test("removes Kai hook", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'node "/home/user/.claude/hooks/kai/kai-session-start.cjs"',
                },
              ],
            },
          ],
        },
      };
      const result = removeHookFromSettings(settings, {
        eventType: "SessionStart",
        hookId: "kai-session-start",
      });
      expect(result.hooks.SessionStart).toHaveLength(0);
    });

    test("does not remove non-Kai hooks", () => {
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: "Grep|Glob",
              hooks: [
                {
                  type: "command",
                  command:
                    'node "/home/user/.claude/hooks/gitnexus/gitnexus-hook.cjs"',
                },
              ],
            },
          ],
        },
      };
      const result = removeHookFromSettings(settings, {
        eventType: "PreToolUse",
        hookId: "kai-session-start",
      });
      expect(result.hooks.PreToolUse).toHaveLength(1);
    });

    test("does not remove unrelated hooks with kai as substring", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node /home/user/scripts/disable-kai-session-startup.sh",
                },
              ],
            },
          ],
        },
      };
      const result = removeHookFromSettings(settings, {
        eventType: "SessionStart",
        hookId: "kai-session-start",
      });
      // The unrelated hook should survive
      expect(result.hooks.SessionStart).toHaveLength(1);
      expect(result.hooks.SessionStart[0].hooks[0].command).toContain(
        "disable-kai",
      );
    });
  });
});
