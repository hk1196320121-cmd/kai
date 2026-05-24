import { describe, test, expect, beforeEach } from "bun:test";
import { setNoColor } from "../../../src/cli/format";
import {
  renderWorkspaceStatus,
  renderWorkspaceList,
} from "../../../src/cli/renderers/workspace";
import type { Workspace } from "../../../src/workspace/types";

beforeEach(() => {
  setNoColor(true);
});

// Helper factories

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "my-project",
    description: "A test workspace",
    status: "active",
    context: "{}",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

interface WorkspaceWithProgress extends Workspace {
  taskCount: number;
  completedTasks: number;
  eventCount: number;
}

function makeWorkspaceWithProgress(
  overrides: Partial<WorkspaceWithProgress> = {},
): WorkspaceWithProgress {
  return {
    ...makeWorkspace(),
    taskCount: 0,
    completedTasks: 0,
    eventCount: 0,
    ...overrides,
  };
}

describe("workspace renderer", () => {
  describe("renderWorkspaceStatus", () => {
    test("renders empty state", () => {
      const output = renderWorkspaceStatus([]);
      expect(output).toContain("No active workspaces");
    });

    test("renders empty state with next steps", () => {
      const output = renderWorkspaceStatus([]);
      expect(output).toContain("kai work");
    });

    test("renders workspace with progress", () => {
      const output = renderWorkspaceStatus([
        makeWorkspaceWithProgress({
          id: "ws-1",
          name: "my-project",
          description: "Building cool stuff",
          status: "active",
          taskCount: 5,
          completedTasks: 3,
          eventCount: 12,
        }),
      ]);
      expect(output).toContain("my-project");
      expect(output).toContain("3/5 tasks");
    });

    test("renders workspace with no tasks", () => {
      const output = renderWorkspaceStatus([
        makeWorkspaceWithProgress({
          name: "empty-ws",
          taskCount: 0,
          completedTasks: 0,
          eventCount: 5,
        }),
      ]);
      expect(output).toContain("no tasks");
    });

    test("renders workspace description", () => {
      const output = renderWorkspaceStatus([
        makeWorkspaceWithProgress({
          name: "ws-desc",
          description: "A specific description",
          taskCount: 1,
          completedTasks: 0,
          eventCount: 0,
        }),
      ]);
      expect(output).toContain("A specific description");
    });

    test("renders workspace event count", () => {
      const output = renderWorkspaceStatus([
        makeWorkspaceWithProgress({
          name: "ws-events",
          taskCount: 2,
          completedTasks: 1,
          eventCount: 42,
        }),
      ]);
      expect(output).toContain("42");
    });

    test("renders workspace created date", () => {
      const output = renderWorkspaceStatus([
        makeWorkspaceWithProgress({
          name: "ws-date",
          created_at: "2024-03-15T10:30:00Z",
          taskCount: 1,
          completedTasks: 0,
          eventCount: 0,
        }),
      ]);
      expect(output).toContain("2024-03-15");
    });

    test("renders multiple workspaces", () => {
      const output = renderWorkspaceStatus([
        makeWorkspaceWithProgress({ name: "ws-alpha" }),
        makeWorkspaceWithProgress({
          name: "ws-beta",
          taskCount: 3,
          completedTasks: 1,
          eventCount: 5,
        }),
      ]);
      expect(output).toContain("ws-alpha");
      expect(output).toContain("ws-beta");
    });

    test("renders archived workspace with dimmed name", () => {
      const output = renderWorkspaceStatus([
        makeWorkspaceWithProgress({
          name: "archived-ws",
          status: "archived",
        }),
      ]);
      expect(output).toContain("archived-ws");
    });
  });

  describe("renderWorkspaceList", () => {
    test("renders empty list", () => {
      const output = renderWorkspaceList([]);
      expect(output).toContain("No workspaces found");
    });

    test("renders workspace list with status", () => {
      const output = renderWorkspaceList([
        makeWorkspace({
          id: "ws-1",
          name: "project-a",
          description: "",
          status: "active",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        }),
        makeWorkspace({
          id: "ws-2",
          name: "project-b",
          description: "",
          status: "archived",
          created_at: "2024-01-15T00:00:00Z",
          updated_at: "2024-01-15T00:00:00Z",
        }),
      ]);
      expect(output).toContain("project-a");
      expect(output).toContain("project-b");
      expect(output).toContain("active");
      expect(output).toContain("archived");
    });

    test("renders workspace count in header", () => {
      const output = renderWorkspaceList([
        makeWorkspace({ name: "a" }),
        makeWorkspace({ name: "b" }),
        makeWorkspace({ name: "c" }),
      ]);
      expect(output).toContain("3");
    });

    test("renders active bullet for active workspaces", () => {
      const output = renderWorkspaceList([
        makeWorkspace({ name: "active-one", status: "active" }),
      ]);
      expect(output).toContain("●"); // ● bullet for active
    });

    test("renders hollow bullet for non-active workspaces", () => {
      const output = renderWorkspaceList([
        makeWorkspace({ name: "inactive-one", status: "archived" }),
      ]);
      expect(output).toContain("○"); // ○ bullet for non-active
    });

    test("renders created date for each workspace", () => {
      const output = renderWorkspaceList([
        makeWorkspace({
          name: "dated-ws",
          created_at: "2024-06-15T12:00:00Z",
        }),
      ]);
      expect(output).toContain("2024-06-15");
    });
  });
});
