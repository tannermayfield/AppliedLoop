// `pnpm env:check`: "would this environment be accepted in production?" Prints every problem and
// warning (names and rules, never values) and exits 1 if there are problems.
//
// It reads the process environment plus .env.local. To check what is configured in Vercel, pull it
// into a file and point this at that file:
//     vercel env pull .env.production.local --environment=production
//     pnpm exec tsx --env-file=.env.production.local scripts/check-env.ts
import { validateEnv } from "../src/lib/env";

const check = validateEnv({ ...process.env, NODE_ENV: "production" });

for (const warning of check.warnings) console.warn(`warning: ${warning}`);
if (check.ok) {
  console.log("Environment is valid for production.");
} else {
  console.error(`Environment is NOT valid for production (${check.problems.length} problem(s)):`);
  for (const problem of check.problems)
    console.error(`  - ${problem.variable}: ${problem.message}`);
  process.exit(1);
}
