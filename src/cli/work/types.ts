import type { Database } from "bun:sqlite";
import type { KaiDB } from "../../db/client";
import type { ProfileEngine } from "../../core/profile/engine";
import type { WorkspaceStore } from "../../workspace/store";
import type { Workspace } from "../../workspace/types";
import type { GitScanResult } from "./git-scan";

export interface WorkStartOptions {
  reset?: boolean;
}

export interface WorkStartContext {
  db: KaiDB;
  engine: ProfileEngine;
  store?: WorkspaceStore;
  workspace?: Workspace;
  gitResult?: GitScanResult;
  identity?: { name: string; role: string };
  answers?: { slug: string; text: string }[];
  previewTraits?: import("../../core/profile/derivator").DerivedTrait[];
  completed: boolean;
}

export type PhaseResult = {
  status: "continue" | "abort";
  context?: Partial<WorkStartContext>;
};