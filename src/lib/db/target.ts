import { connectPglite, connectPostgres, type DbHandle } from "./connect";

// Which database a script or the deploy should talk to, decided the same way everywhere:
//   DATABASE_URL set  -> that Postgres server (Neon when deployed)
//   otherwise         -> the local PGlite directory (PGLITE_DATA_DIR, default .data/pglite)
// Migrations prefer DATABASE_URL_UNPOOLED (Neon's direct endpoint) when it is set.

type EnvSource = Record<string, string | undefined>;

export type DbTarget =
  | {
      kind: "postgres";
      url: string;
      /** Safe to print: host and database name only, never the user or the password. */
      description: string;
      /** True for a Neon pooler endpoint (`-pooler` in the host name). */
      pooled: boolean;
      variable: "DATABASE_URL" | "DATABASE_URL_UNPOOLED";
    }
  | { kind: "pglite"; dataDir: string; description: string };

/** `ep-cool-123.us-east-1.aws.neon.tech/neondb`: where a URL points, without its credentials. */
export function describePostgresUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(a connection string that could not be read)";
  }
}

export function resolveDbTarget(
  source: EnvSource = process.env,
  options: { preferUnpooled?: boolean } = {},
): DbTarget {
  const unpooled = options.preferUnpooled ? source.DATABASE_URL_UNPOOLED?.trim() : undefined;
  const pooledOrOnly = source.DATABASE_URL?.trim();
  const url = unpooled || pooledOrOnly;
  if (url) {
    const description = describePostgresUrl(url);
    return {
      kind: "postgres",
      url,
      description: `Postgres ${description}`,
      pooled: /-pooler\b/i.test(description.split("/")[0]),
      variable: unpooled ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL",
    };
  }
  const dataDir = source.PGLITE_DATA_DIR?.trim() || ".data/pglite";
  return { kind: "pglite", dataDir, description: `PGlite (${dataDir})` };
}

export async function openDbTarget(target: DbTarget): Promise<DbHandle> {
  return target.kind === "postgres" ? connectPostgres(target.url) : connectPglite(target.dataDir);
}
