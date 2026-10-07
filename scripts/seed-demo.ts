// `pnpm db:seed:demo [--reset] [--force]`: create the demo student ("Demo Student",
// demo@appliedloop.example) with a populated Today, Learn, project, Apply session with evidence,
// and a Build session whose extraction was classified. See scripts/lib/demo-seed.ts.
//
//   (no flag)  idempotent: if the demo student exists, nothing changes
//   --reset    delete the demo student and everything they own, then seed again (fresh dates)
//   --force    needed to seed when NODE_ENV=production or DATABASE_URL points at a Postgres server
//
// Stop `pnpm dev` first when seeding the local PGlite directory: PGlite allows one process.
import { loadEnv } from "../src/lib/env";
import { schemaStatus } from "../src/lib/db/migrations";
import { openDbTarget, resolveDbTarget } from "../src/lib/db/target";
import { assertSeedAllowed, DEMO_EMAIL, seedDemo } from "./lib/demo-seed";
import { failAndExit } from "./lib/report";

const FLAGS = new Set(["--reset", "--force"]);

async function main() {
  // The seed makes a handful of (demo) AI calls; their log lines would bury the summary below.
  process.env.LOG_LEVEL ??= "warn";

  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !FLAGS.has(arg));
  if (unknown.length > 0) {
    console.error(
      `Unknown option(s): ${unknown.join(" ")}\nUsage: pnpm db:seed:demo [--reset] [--force]`,
    );
    process.exit(2);
  }
  const force = args.includes("--force");
  const reset = args.includes("--reset");

  assertSeedAllowed({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    force,
  });

  const target = resolveDbTarget(process.env);
  console.log(`Seeding the demo student into ${target.description}…`);
  const handle = await openDbTarget(target);
  try {
    if (target.kind === "pglite") {
      await handle.migrate(); // a fresh local directory has no tables yet
    } else if ((await schemaStatus(handle.db)) !== "current") {
      throw new Error("The database is not migrated to this version. Run `pnpm db:migrate` first.");
    }

    // The email-only dev sign-in exists only when explicitly enabled outside production.
    let devLogin: { authSecret: string } | undefined;
    try {
      const env = loadEnv();
      if (env.devLoginEnabled) devLogin = { authSecret: env.authSecret };
    } catch {
      // No usable BETTER_AUTH_SECRET in this shell: the data is seeded, just without a sign-in.
    }

    const result = await seedDemo(handle.db, { devLogin, reset });
    console.log(
      result.seeded
        ? "Seeded."
        : "The demo student already exists: nothing changed (use --reset for fresh dates).",
    );
    console.table(result.counts);

    if (devLogin) {
      console.log(`Sign in with the local dev sign-in as ${DEMO_EMAIL} (pnpm dev).`);
    } else if (target.kind === "pglite") {
      console.log(
        "To sign in as the demo student, set BETTER_AUTH_SECRET and AUTH_DEV_LOGIN=1 in .env.local, " +
          `run this again, then use the dev sign-in with ${DEMO_EMAIL}.`,
      );
    } else {
      console.log(
        "This database signs in with OAuth only, so nobody can sign in as the demo student here.",
      );
    }
  } finally {
    await handle.close();
  }
}

main().catch((error) =>
  failAndExit(error?.name === "SeedRefusedError" ? "DEMO SEED REFUSED" : "DEMO SEED FAILED", error),
);
