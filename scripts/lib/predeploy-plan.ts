// What the Vercel build does BEFORE `next build`, decided from the environment alone (pure, so it
// is tested without a database). The rules, and why:
//
//   production deploy  validate STRICTLY, then migrate. A misconfigured production build fails here,
//                      so the last good deployment keeps serving. This is the only place migrations
//                      run automatically.
//   preview deploy     validate and only WARN; migrate ONLY if MIGRATE_ON_PREVIEW=1 and a database
//                      URL is set. A preview must never touch the production database by accident
//                      (the classic mistake is giving Production and Preview the same DATABASE_URL).
//   anything else      (a laptop, CI) do nothing. `pnpm build` there is just a build.

type EnvSource = Record<string, string | undefined>;

export type DeployTarget = "production" | "preview" | "other";

export interface PredeployPlan {
  target: DeployTarget;
  /** `strict`: any problem fails the build. `warn`: print and carry on. `skip`: do not check. */
  validate: "strict" | "warn" | "skip";
  migrate: boolean;
  /** Plain-language lines for the build log: what will happen and why. */
  notes: string[];
}

const truthy = (value: string | undefined) => value === "1" || value?.toLowerCase() === "true";

export function planPredeploy(source: EnvSource): PredeployPlan {
  if (source.VERCEL !== "1") {
    return {
      target: "other",
      validate: "skip",
      migrate: false,
      notes: ["Not a Vercel build (VERCEL is not set): no checks and no migrations."],
    };
  }

  if (source.VERCEL_ENV === "production") {
    return {
      target: "production",
      validate: "strict",
      migrate: true,
      notes: [
        "Production deploy: the configuration is checked strictly, then the database is migrated.",
        "If either fails, this deployment is not created and the current one keeps serving.",
      ],
    };
  }

  if (source.VERCEL_ENV === "preview") {
    const hasDatabase = Boolean(
      source.DATABASE_URL?.trim() || source.DATABASE_URL_UNPOOLED?.trim(),
    );
    const optedIn = truthy(source.MIGRATE_ON_PREVIEW);
    const notes = ["Preview deploy: configuration problems are printed as warnings only."];
    if (optedIn && hasDatabase) {
      notes.push("MIGRATE_ON_PREVIEW is set: migrating the Preview database.");
    } else if (optedIn) {
      notes.push("MIGRATE_ON_PREVIEW is set but no DATABASE_URL is: migrations skipped.");
    } else {
      notes.push(
        "Migrations skipped: previews never migrate unless MIGRATE_ON_PREVIEW=1 (and then only " +
          "their own Preview-scoped DATABASE_URL, never the production one).",
      );
    }
    return { target: "preview", validate: "warn", migrate: optedIn && hasDatabase, notes };
  }

  return {
    target: "other",
    validate: "skip",
    migrate: false,
    notes: [`Vercel environment "${source.VERCEL_ENV ?? "unknown"}": no checks and no migrations.`],
  };
}
