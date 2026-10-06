import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { AUTH_COPY } from "../copy-auth";
import { getDb } from "../db/client";
import { authAccounts, authSessions, authVerifications, userProfiles, users } from "../db/schema";
import { getEnv } from "../env";
import { isEmailAllowed, signUpRefusal } from "./policy";

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
    // Built-in endpoints the browser never needs. /update-user takes any name or image (bypassing
    // PATCH /api/v1/me/profile validation); the other three would hand the provider's OAuth tokens
    // or account details to page scripts. Server-side `auth.api.*` calls are not affected.
    disabledPaths: ["/update-user", "/get-access-token", "/refresh-token", "/account-info"],
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
          // Only an invited (optional pilot gate), provider-verified address gets an account.
          before: async (user) => {
            const refusal = signUpRefusal(user, env);
            if (refusal) throw new APIError("FORBIDDEN", { message: refusal });
            return { data: user };
          },
          after: async (user) => {
            await db.insert(userProfiles).values({ userId: user.id }).onConflictDoNothing();
          },
        },
      },
      session: {
        create: {
          // The pilot gate holds on every sign-in, not only the first: an address removed from
          // AUTH_ALLOWED_EMAILS gets no new session (getAuthContext ends the existing ones).
          before: async (session) => {
            if (env.allowedEmails.length === 0) return;
            const [owner] = await db
              .select({ email: users.email })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1);
            if (!isEmailAllowed(owner?.email, env.allowedEmails)) {
              throw new APIError("FORBIDDEN", { message: AUTH_COPY.inviteOnly });
            }
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
