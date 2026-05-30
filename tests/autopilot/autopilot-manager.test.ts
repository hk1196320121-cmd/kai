import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AutopilotManager,
  type AutopilotSession,
  type HookInput,
} from "../../src/autopilot";
import { KaiDB } from "../../src/db/client";

describe("AutopilotManager", () => {
  let tmpDir: string;
  let hooksDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kai-mgr-test-"));
    hooksDir = join(tmpDir, "hooks");
    settingsPath = join(tmpDir, "settings.json");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // --- Type interface tests ---

  test("HookInput parses session_id from stdin JSON", () => {
    const input: HookInput = {
      session_id: "abc-123",
      tool_name: "Edit",
      tool_input: { file_path: "/tmp/test.ts" },
    };
    expect(input.session_id).toBe("abc-123");
    expect(input.tool_name).toBe("Edit");
    expect(input.tool_input?.file_path).toBe("/tmp/test.ts");
  });

  test("HookInput allows extra properties", () => {
    const input: HookInput = {
      session_id: "xyz",
      custom_field: "value",
    };
    expect(input.session_id).toBe("xyz");
    expect((input as Record<string, unknown>).custom_field).toBe("value");
  });

  test("HookInput all fields optional", () => {
    const input: HookInput = {};
    expect(input.session_id).toBeUndefined();
    expect(input.tool_name).toBeUndefined();
    expect(input.cwd).toBeUndefined();
  });

  test("AutopilotSession derivation_status union type", () => {
    const statuses: AutopilotSession["derivation_status"][] = [
      "pending",
      "completed",
      "failed",
      "skipped",
    ];
    expect(statuses).toHaveLength(4);
  });

  // --- Behavioral tests ---

  describe("install()", () => {
    test("writes 3 hook scripts to hooksDir", () => {
      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);

      expect(existsSync(join(hooksDir, "kai-session-start.cjs"))).toBe(true);
      expect(existsSync(join(hooksDir, "kai-auto-observe.cjs"))).toBe(true);
      expect(existsSync(join(hooksDir, "kai-stop.cjs"))).toBe(true);
    });

    test("creates hooksDir if it does not exist", () => {
      expect(existsSync(hooksDir)).toBe(false);
      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);
      expect(existsSync(hooksDir)).toBe(true);
    });

    test("merges SessionStart, PostToolUse, and Stop hooks into settings.json", () => {
      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.PostToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toHaveLength(1);
      expect(settings.hooks.Stop).toBeDefined();
      expect(settings.hooks.Stop).toHaveLength(1);
    });

    test("PostToolUse hook has matcher for allowlisted tools", () => {
      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const postToolUse = settings.hooks.PostToolUse[0];
      expect(postToolUse.matcher).toContain("Bash");
      expect(postToolUse.matcher).toContain("Edit");
      expect(postToolUse.matcher).toContain("Grep");
    });

    test("creates settings.json if it does not exist", () => {
      expect(existsSync(settingsPath)).toBe(false);
      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);
      expect(existsSync(settingsPath)).toBe(true);
    });

    test("idempotent — running install twice produces same settings", () => {
      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);
      mgr.install(settingsPath);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.PostToolUse).toHaveLength(1);
      expect(settings.hooks.Stop).toHaveLength(1);
    });

    test("preserves existing non-Kai hooks in settings.json", () => {
      writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Grep",
                hooks: [
                  { type: "command", command: "some-other-hook.sh", timeout: 5 },
                ],
              },
            ],
          },
        }),
      );

      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(
        "some-other-hook.sh",
      );
    });
  });

  describe("uninstall()", () => {
    test("removes all Kai hooks from settings.json", () => {
      const mgr = new AutopilotManager(hooksDir);
      mgr.install(settingsPath);
      mgr.uninstall(settingsPath);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const allHooks = Object.values(settings.hooks || {})
        .flat()
        .flatMap((g: any) => g.hooks || []);
      const kaiHooks = allHooks.filter((h: any) =>
        /kai-(session-start|auto-observe|stop)/.test(h.command),
      );
      expect(kaiHooks).toHaveLength(0);
    });

    test("no-ops if settings.json does not exist", () => {
      const mgr = new AutopilotManager(hooksDir);
      expect(() => mgr.uninstall(settingsPath)).not.toThrow();
    });
  });

  describe("status()", () => {
    let dbPath: string;

    beforeEach(() => {
      dbPath = join(tmpDir, "kai.db");
    });

    test("returns empty when DB does not exist", () => {
      const mgr = new AutopilotManager(hooksDir);
      const result = mgr.status(dbPath);
      expect(result.sessions).toEqual([]);
      expect(result.activeSession).toBeNull();
    });

    test("returns empty sessions when DB exists but has no sessions", () => {
      const kai = new KaiDB(dbPath);
      kai.close();

      const mgr = new AutopilotManager(hooksDir);
      const result = mgr.status(dbPath);
      expect(result.sessions).toEqual([]);
      expect(result.activeSession).toBeNull();
    });

    test("returns sessions from DB", () => {
      const kai = new KaiDB(dbPath);
      const db = kai.getDatabase();
      db.query(
        "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'completed')",
      ).run("test-session-1");
      kai.close();

      const mgr = new AutopilotManager(hooksDir);
      const result = mgr.status(dbPath);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].session_id).toBe("test-session-1");
    });

    test("identifies active session (stopped_at IS NULL)", () => {
      const kai = new KaiDB(dbPath);
      const db = kai.getDatabase();
      db.query(
        "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')",
      ).run("active-session");
      db.query(
        "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status, stopped_at) VALUES (?, datetime('now'), 'completed', datetime('now'))",
      ).run("closed-session");
      kai.close();

      const mgr = new AutopilotManager(hooksDir);
      const result = mgr.status(dbPath);
      expect(result.activeSession).not.toBeNull();
      expect(result.activeSession!.session_id).toBe("active-session");
    });
  });
});
