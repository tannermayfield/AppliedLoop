import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "../db/client";
import { authAccounts, authSessions, authVerifications, userProfiles, users } from "../db/schema";
import { getEnv } from "../env";

// Better Auth lives ONLY in lib/auth. Domain code receives an AuthContext and never imports this
// library (ADR-0002). Sign-in is OAuth (GitHub / Google). A passwordless-looking "dev login" exists
// for local development only: it is compiled out of production by `loadEnv`, which refuses to boot
// with AUTH_DEV_LOGIN=1 when NODE_ENV=production.

async function buildAuth() {
  const env = getEnv();
  const db = await getDb();

  return betterAuth({
    secret: env.authSecret,
    baseURL: env.appUrl,
    database: drizzleAdapter(db, {
      provider: "pg",
      // Our tables are named differently from Better Auth's model names; map them.
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    advanced: { database: { generateId: "uuid" } },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Provider tokens are encrypted at rest (SPEC §6: provider tokens never stored in plaintext).
    account: { encryptOAuthTokens: true },
    socialProviders: {
      ...(env.oauth.github ? { github: env.oauth.github } : {}),
      ...(env.oauth.google ? { google: env.oauth.google } : {}),
    },
    emailAndPassword: {
      enabled: env.devLoginEnabled,
      minPasswordLength: 8,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    databaseHooks: {
      user: {
        create: {
          // Optional pilot gate: only invited emails may create an account.
          before: async (user) => {
            const allowed = env.allowedEmails;
            if (allowed.length > 0 && !allowed.includes(user.email.toLowerCase())) {
              throw new APIError("FORBIDDEN", {
                message: "This pilot is invite-only, and that email isn't on the list yet.",
              });
            }
            return { data: user };
          },
          after: async (user) => {
            await db.insert(userProfiles).values({ userId: user.id }).onConflictDoNothing();
          },
        },
      },
    },
    plugins: [nextCookies()], // must be last
  });
}

export type Auth = Awaited<ReturnType<typeof buildAuth>>;

const globalForAuth = globalThis as unknown as { __appliedloopAuth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  globalForAuth.__appliedloopAuth ??= buildAuth().catch((error) => {
    globalForAuth.__appliedloopAuth = undefined;
    throw error;
  });
  return globalForAuth.__appliedloopAuth;
}
