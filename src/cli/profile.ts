import { createInterface } from "node:readline";
import type { Command } from "commander";
import { DecayEngine } from "../core/profile/decay";
import { Derivator } from "../core/profile/derivator";
import { ProvenanceEngine } from "../core/profile/provenance";
import { getEngine } from "./utils";

export function registerProfileCommands(program: Command): void {
  const profile = program.command("profile").description("Manage user profile");

  profile
    .command("bootstrap")
    .description(
      "Interactive cold start: build your initial profile through questions",
    )
    .action(async () => {
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

      if (snapshot.identity) {
        console.log(
          `\n=== ${snapshot.identity.name} (${snapshot.identity.role}) ===`,
        );
        console.log(`Goals: ${snapshot.identity.goals}`);
        console.log(`Expertise: ${snapshot.identity.expertise_areas}`);
        console.log(`Interests: ${snapshot.identity.learning_interests}`);
      } else {
        console.log("\n=== Profile (no identity set) ===");
      }
      console.log(`\nTraits (${snapshot.traits.length}):`);
      for (const t of snapshot.traits) {
        console.log(
          `  ${t.dimension}: ${t.value.toFixed(2)} (confidence: ${t.confidence}/10, source: ${t.source})`,
        );
      }
      console.log(`\nObservations: ${snapshot.observationCount}`);
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
        console.log(`Updated ${opts.field}`);
      } catch (e) {
        console.error((e as Error).message);
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
        console.log("No observations to derive traits from.");
      } else {
        console.log(`Derived ${results.length} traits:`);
        for (const t of results) {
          console.log(
            `  ${t.dimension}: ${t.value.toFixed(2)} (confidence: ${t.confidence}/10)`,
          );
        }
      }
    });

  profile
    .command("why <dimension>")
    .description("Explain why a trait has its value (provenance)")
    .action((dimension: string) => {
      const { db, engine } = getEngine();
      const prov = new ProvenanceEngine(engine);
      const explanation = prov.why(dimension);
      db.close();

      if (!explanation) {
        console.log(`No trait '${dimension}' found.`);
        return;
      }

      console.log(`\n=== Why: ${explanation.dimension} ===`);
      console.log(`Value: ${explanation.traitValue.toFixed(2)}`);
      console.log(`Confidence: ${explanation.traitConfidence}/10`);
      console.log(`Source: ${explanation.traitSource}`);
      console.log(`Reasoning: ${explanation.traitReasoning}`);
      if (explanation.relatedObservations.length > 0) {
        console.log(
          `\nRelated observations (${explanation.relatedObservations.length}):`,
        );
        for (const obs of explanation.relatedObservations.slice(0, 5)) {
          console.log(
            `  [${obs.id}] ${obs.key} (confidence: ${obs.confidence})`,
          );
        }
      }
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
        console.log(`Trait '${dimension}' corrected and removed.`);
      } else {
        console.log(`No trait '${dimension}' found to correct.`);
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
        `Decayed ${result.decayed} traits, skipped ${result.skipped}.`,
      );
    });
}
