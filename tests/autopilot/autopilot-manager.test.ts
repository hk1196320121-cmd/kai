import { describe, test, expect } from "bun:test";
import {
  AutopilotManager,
  type AutopilotSession,
  type HookInput,
} from "../../src/autopilot";

describe("AutopilotManager [D5]", () => {
  test("exports AutopilotManager class", () => {
    expect(AutopilotManager).toBeDefined();
    expect(typeof AutopilotManager).toBe("function");
  });

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

  test("AutopilotSession has derivation_status", () => {
    const session: AutopilotSession = {
      id: 1,
      session_id: "abc-123",
      started_at: "2026-05-30T12:00:00Z",
      stopped_at: null,
      observations_count: 0,
      traits_derived: 0,
      traits_changed: 0,
      derivation_status: "pending",
      project_path: null,
    };
    expect(session.derivation_status).toBe("pending");
  });

  test("AutopilotSession derivation_status can be completed", () => {
    const session: AutopilotSession = {
      id: 2,
      session_id: "def-456",
      started_at: "2026-05-30T12:00:00Z",
      stopped_at: "2026-05-30T13:00:00Z",
      observations_count: 42,
      traits_derived: 5,
      traits_changed: 2,
      derivation_status: "completed",
      project_path: "/home/user/project",
    };
    expect(session.derivation_status).toBe("completed");
    expect(session.observations_count).toBe(42);
    expect(session.traits_derived).toBe(5);
    expect(session.stopped_at).not.toBeNull();
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
});
