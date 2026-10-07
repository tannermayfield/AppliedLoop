// Runs on Vercel before `next build` (package.json "vercel-build", pinned in vercel.json):
// check the configuration, then migrate the database. Any failure exits non-zero, which stops the
// build, so a bad deploy never goes live and the previous deployment keeps serving.
// What runs where is decided in scripts/lib/predeploy-plan.ts. Locally it does nothing.
import { validateEnv } from "../src/lib/env";
import { resolveDbTarget } from "../src/lib/db/target";
import { migrateDatabase } from "./lib/migrate-database";
import { planPredeploy } from "./lib/predeploy-plan";
import { banner, failAndExit } from "./lib/report";

async function main() {
  const plan = planPredeploy(process.env);
  console.log(`Predeploy (${plan.target}):`);
  for (const note of plan.notes) console.log(`  ${note}`);

  if (plan.validate !== "skip") {
    // The runtime will see NODE_ENV=production whatever the build step's own value is.
    const check = validateEnv({ ...process.env, NODE_ENV: "production" });
    for (const warning of check.warnings) console.warn(`  warning: ${warning}`);
    if (!check.ok) {
      const lines = check.problems.map((problem) => `  - ${problem.variable}: ${problem.message}`);
      if (plan.validate === "strict") {
        console.error(banner("INVALID PRODUCTION CONFIGURATION"));
        console.error(lines.join("\n"));
        console.error(
          "\nValues are never printed. Fix these in Vercel (Project Settings -> Environment Variables)\n" +
            "and redeploy. See docs/DEPLOY.md.",
        );
        process.exit(1);
      }
      console.warn("  configuration problems (this preview will not work until fixed):");
      console.warn(lines.join("\n"));
    } else {
      console.log("  configuration: ok");
    }
  }

  if (plan.migrate) {
    const target = resolveDbTarget(process.env, { preferUnpooled: true });
    console.log(
      `  migrating ${target.description} (from ${target.kind === "postgres" ? target.variable : "PGLITE_DATA_DIR"})…`,
    );
    const report = await migrateDatabase(target);
    console.log(
      `  migrations: ${report.applied} applied now; the database has ${report.total} of ${report.expected} (${report.ms} ms)`,
    );
  }
}

main().catch((error) =>
  failAndExit(
    "PREDEPLOY FAILED",
    error,
    "The build stops here, so nothing new goes live. Fix the cause above and redeploy.",
  ),
);
