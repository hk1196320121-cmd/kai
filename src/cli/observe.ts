import { Command } from "commander";
import { KaiDB } from "../db/client";
import { ProfileEngine } from "../core/profile/engine";
import { ProfileCollector } from "../core/profile/collector";
import { HermesBridge } from "../bridge/hermes";
import { getDbPath, getHermesDir } from "./utils";
import { readFileSync, existsSync } from "fs";

export function registerObserveCommands(program: Command): void {
  const observe = program.command("observe").description("Collect observations from sources");

  observe.command("from-cron <file>")
    .description("Extract observations from a cron output file")
    .action((file: string) => {
      if (!existsSync(file)) {
        console.error(`File not found: ${file}`);
        process.exit(1);
      }
      if (!file.endsWith(".md")) {
        console.error(`Only .md files are supported. Got: ${file}`);
        process.exit(1);
      }
      const content = readFileSync(file, "utf-8");
      const db = new KaiDB(getDbPath());
      const engine = new ProfileEngine(db);
      const bridge = new HermesBridge(getHermesDir());
      const collector = new ProfileCollector(engine, bridge);
      const count = collector.collectFromCronOutput("manual", content);
      db.close();
      console.log(`Collected ${count} observation(s) from ${file}.`);
    });

  observe.command("daily")
    .description("Scan all Hermes cron outputs and collect observations")
    .action(() => {
      const db = new KaiDB(getDbPath());
      const engine = new ProfileEngine(db);
      const bridge = new HermesBridge(getHermesDir());
      const collector = new ProfileCollector(engine, bridge);
      const count = collector.collectDaily();
      db.close();
      console.log(`Daily collection: ${count} new observation(s).`);
    });
}
