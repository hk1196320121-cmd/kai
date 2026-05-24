import { createInterface } from "node:readline";
import type { Command } from "commander";
import { DecayEngine } from "../core/profile/decay";
import { Derivator } from "../core/profile/derivator";
import { ProvenanceEngine } from "../core/profile/provenance";
import type { Trait } from "../core/profile/types";
import { WorkspaceStore } from "../workspace/store";
import { dim, status } from "./format";
import {
  renderDiff,
  renderProfile,
  renderProvenance,
} from "./renderers/profile";
import { getEngine } from "./utils";

export interface TraitChange {
  dimension: string;
  before: { value: number; confidence: number };
  after: { value: number; confidence: number };
  reasoning: string;
}

export interface ProfileDiff {
  workspaceName: string;
  coldstartDate: string;
  changed: TraitChange[];
  stable: TraitChange[];
  newTraits: Trait[];
  removed: TraitChange[];
}

export function computeProfileDiff(
  engine: import("../core/profile/engine").ProfileEngine,
  store: WorkspaceStore,
): ProfileDiff | null {
  const workspaces = store.listWorkspaces();
  let snapshotWs: import("../workspace/types").Workspace | null = null;
  let snapshot:
    | { dimension: string; value: number; confidence: number }[]
    | null = null;
  let snapshotCtx: Record<string, unknown> | null = null;

  for (const ws of workspaces) {
    try {
      const ctx = JSON.parse(ws.context);
      if (ctx.profile_snapshot) {
        snapshotWs = ws;
        snapshot = ctx.profile_snapshot;
        snapshotCtx = ctx;
        break;
      }
    } catch {
      // Workspace context JSON parse failure — non-critical, skip
    }
  }

  if (!snapshotWs || !snapshot || !snapshotCtx) return null;

  const currentTraits = engine.getTraits();
  const snapshotMap = new Map(snapshot.map((t) => [t.dimension, t]));
  const currentMap = new Map(currentTraits.map((t) => [t.dimension, t]));

  const changed: TraitChange[] = [];
  const stable: TraitChange[] = [];
  const removed: TraitChange[] = [];

  for (const snap of snapshot) {
    const curr = currentMap.get(snap.dimension);
    if (!curr) {
      removed.push({
        dimension: snap.dimension,
        before: { value: snap.value, confidence: snap.confidence },
        after: { value: 0, confidence: 0 },
        reasoning: "Trait removed",
      });
    } else if (Math.abs(curr.value - snap.value) > 0.01) {
      changed.push({
        dimension: snap.dimension,
        before: { value: snap.value, confidence: snap.confidence },
        after: { value: curr.value, confidence: curr.confidence },
        reasoning: curr.reasoning,
      });
    } else {
      stable.push({
        dimension: snap.dimension,
        before: { value: snap.value, confidence: snap.confidence },
        after: { value: curr.value, confidence: curr.confidence },
        reasoning: curr.reasoning,
      });
    }
  }

  const newTraits = currentTraits.filter((t) => !snapshotMap.has(t.dimension));

  return {
    workspaceName: snapshotWs.name,
    coldstartDate:
      (snapshotCtx?.coldstart_completed_at as string) ?? snapshotWs.created_at,
    changed,
    stable,
    newTraits,
    removed,
  };
}

export function registerProfileCommands(program: Command): void {
  const profile = program.command("profile").description("Manage user profile");

  profile
    .command("bootstrap")
    .description(
      "Interactive cold start: build your initial profile through questions",
    )
    .action(async () => {
      console.log(
        "(Note: `kai profile bootstrap` is deprecated. Use `kai work start` instead.)\n",
      );
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ask = (q: string): Promise<string> =>
        new Promise((r) => rl.question(q, r));

      console.log("Kai Profile Bootstrap\n");
      const name = await ask("What's your name? ");
      const role = await ask("What's your role? ");
      const goals = await ask(
        "What are your current goals? (comma separated) ",
      );
      const expertise = await ask("What are you good at? (comma separated) ");
      const interests = await ask(
        "What do you want to learn? (comma separated) ",
      );

      const { db, engine } = getEngine();
      engine.createIdentity({
        name: name.trim(),
        role: role.trim(),
        goals: JSON.stringify(
          goals
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
        expertise_areas: JSON.stringify(
          expertise
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
        learning_interests: JSON.stringify(
          interests
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      });
      db.close();
      rl.close();

      console.log("\nProfile created! Run `kai profile read` to see it.");
    });

  profile
    .command("read")
    .option("--json", "Output as JSON")
    .option("--field <field>", "Show specific field")
    .description("Read current profile")
    .action((opts) => {
      const { db, engine } = getEngine();
      const snapshot = engine.getProfile();
      db.close();

      if (
        !snapshot.identity &&
        snapshot.traits.length === 0 &&
        snapshot.observationCount === 0
      ) {
        console.log("No profile found. Run `kai profile bootstrap` first.");
        return;
      }

      if (opts.field) {
        if (!snapshot.identity) {
          console.log(
            `Field '${opts.field}' not found (no identity set). Run \`kai profile bootstrap\` first.`,
          );
          return;
        }
        const value = (snapshot.identity as unknown as Record<string, unknown>)[
          opts.field
        ];
        console.log(value ?? `Field '${opts.field}' not found.`);
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      console.log(renderProfile(snapshot));
    });

  profile
    .command("update")
    .requiredOption("--field <field>", "Field to update")
    .requiredOption("--value <value>", "New value")
    .description("Update a specific profile field")
    .action((opts) => {
      const { db, engine } = getEngine();
      try {
        engine.updateIdentity({ [opts.field]: opts.value });
        console.log(status("success", `Updated ${opts.field}`));
      } catch (e) {
        console.error(status("error", (e as Error).message));
      }
      db.close();
    });

  profile
    .command("derive")
    .description("Derive traits from observations (rules + LLM)")
    .action(async () => {
      const { db, engine } = getEngine();
      const derivator = new Derivator(engine);
      const results = derivator.deriveFromRules();
      db.close();

      if (results.length === 0) {
        console.log(status("info", "No observations to derive traits from."));
      } else {
        console.log(status("success", `Derived ${results.length} traits:`));
        for (const t of results) {
          console.log(
            dim(
              `  ${t.dimension}: ${t.value.toFixed(2)} (confidence: ${t.confidence}/10)`,
            ),
          );
        }
      }
    });

  profile
    .command("why <dimension>")
    .option("--json", "Output as JSON")
    .description("Explain why a trait has its value (provenance)")
    .action((dimension: string, cmdOpts: { json?: boolean }) => {
      const { db, engine } = getEngine();
      const prov = new ProvenanceEngine(engine);
      const explanation = prov.why(dimension);
      db.close();

      if (!explanation) {
        if (cmdOpts.json) {
          console.log(
            JSON.stringify({ error: `No trait '${dimension}' found.` }),
          );
        } else {
          console.error(status("error", `No trait '${dimension}' found.`));
        }
        return;
      }

      if (cmdOpts.json) {
        console.log(JSON.stringify(explanation, null, 2));
        return;
      }

      console.log(renderProvenance(explanation));
    });

  profile
    .command("correct <dimension>")
    .description("Remove an incorrect trait and log the correction")
    .action((dimension: string) => {
      const { db, engine } = getEngine();
      const prov = new ProvenanceEngine(engine);
      const result = prov.correct(
        dimension,
        `User correction via CLI at ${new Date().toISOString()}`,
      );
      db.close();

      if (result) {
        console.log(
          status("success", `Trait '${dimension}' corrected and removed.`),
        );
      } else {
        console.log(
          status("error", `No trait '${dimension}' found to correct.`),
        );
      }
    });

  profile
    .command("decay")
    .description("Apply confidence decay to observed/inferred traits")
    .action(() => {
      const { db, engine } = getEngine();
      const decay = new DecayEngine(engine);
      const result = decay.apply();
      db.close();
      console.log(
        status(
          "success",
          `Decayed ${result.decayed} traits, skipped ${result.skipped}.`,
        ),
      );
    });

  profile
    .command("diff")
    .option("--last", "Compare current profile vs cold start snapshot")
    .description("Show profile changes over time")
    .action((opts) => {
      if (!opts.last) {
        console.log(
          "Use --last to compare against cold start snapshot. Other modes coming soon.",
        );
        return;
      }

      const { db, engine } = getEngine();
      const store = new WorkspaceStore(db);
      const diff = computeProfileDiff(engine, store);

      if (!diff) {
        console.log(
          status(
            "error",
            "No cold start snapshot found. Run `kai work start` first.",
          ),
        );
      } else {
        console.log(renderDiff(diff));
      }

      db.close();
    });
}
