import { describe, test, expect } from "bun:test";
import {
  generateSessionStartHook,
  generateAutoObserveHook,
  mergeHookIntoSettings,
  removeHookFromSettings,
} from "../../../src/cli/skills/hooks";

describe("HookGenerator", () => {
  describe("generateSessionStartHook", () => {
    test("returns a non-empty CJS script string", () => {
      const script = generateSessionStartHook();
      expect(script).toContain("#!/usr/bin/env node");
      expect(script).toContain("require(");
      expect(script.length).toBeGreaterThan(200);
    });
  });

  describe("generateAutoObserveHook", () => {
    test("returns a non-empty CJS script string", () => {
      const script = generateAutoObserveHook();
      expect(script).toContain("#!/usr/bin/env node");
      expect(script).toContain("kai-auto-observe");
      expect(script.length).toBeGreaterThan(200);
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
      expect(result.hooks.SessionStart[0].hooks[0].command).toContain("kai-session-start");
    });

    test("adds PostToolUse hook with matcher", () => {
      const settings = {};
      const result = mergeHookIntoSettings(settings, {
        eventType: "PostToolUse",
        matcher: "Bash|Read|Edit|Write",
        command: 'node "/home/user/.claude/hooks/kai/kai-auto-observe.cjs"',
        hookId: "kai-auto-observe",
        timeout: 10,
      });
      expect(result.hooks.PostToolUse).toHaveLength(1);
      expect(result.hooks.PostToolUse[0].matcher).toBe("Bash|Read|Edit|Write");
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
                { type: "command", command: 'node "/home/user/.claude/hooks/kai/kai-session-start.cjs" --old' },
              ],
            },
          ],
        },
      };
      const result = mergeHookIntoSettings(settings, {
        eventType: "SessionStart",
        command: 'node "/home/user/.claude/hooks/kai/kai-session-start.cjs" --updated',
        hookId: "kai-session-start",
      });
      expect(result.hooks.SessionStart).toHaveLength(1);
      expect(result.hooks.SessionStart[0].hooks[0].command).toContain("--updated");
    });

    test("preserves non-Kai hooks", () => {
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: "Grep|Glob|Bash",
              hooks: [
                { type: "command", command: 'node "/home/user/.claude/hooks/gitnexus/gitnexus-hook.cjs"', timeout: 10 },
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
      expect(result.hooks.PreToolUse[0].hooks[0].command).toContain("gitnexus");
    });
  });

  describe("removeHookFromSettings", () => {
    test("removes Kai hook by ID", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: "command", command: 'node "/home/user/.claude/hooks/kai/kai-session-start.cjs"' },
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
                { type: "command", command: 'node "/home/user/.claude/hooks/gitnexus/gitnexus-hook.cjs"' },
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
  });
});
