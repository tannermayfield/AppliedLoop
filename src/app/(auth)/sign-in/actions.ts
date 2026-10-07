"use server";

import { APIError } from "better-auth/api";
import { redirect } from "next/navigation";
import { z } from "zod";
import { devLoginPassword } from "@/lib/auth/dev-login";
import { getAuth } from "@/lib/auth/server";
import { getEnv } from "@/lib/env";

export interface DevSignInState {
  error?: string;
}

const inputSchema = z.object({
  email: z.email(),
  name: z.string().trim().max(80).optional(),
});

/**
 * DEVELOPMENT ONLY. Signs in (or creates) a local account from just an email address so the app
 * can be tried without registering OAuth apps. The password is derived from the server secret,
 * so nobody types or stores one. `loadEnv` refuses to boot a production build with this enabled,
 * and the action re-checks.
 */
export async function devSignIn(
  _previous: DevSignInState,
  formData: FormData,
): Promise<DevSignInState> {
  const env = getEnv();
  if (!env.devLoginEnabled) return { error: "Dev sign-in is turned off." };

  const parsed = inputSchema.safeParse({
    email: String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
    name: String(formData.get("name") ?? "") || undefined,
  });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const { email } = parsed.data;
  const name = parsed.data.name || email.split("@")[0];
  const password = devLoginPassword(env.authSecret, email);

  const auth = await getAuth();
  try {
    await auth.api.signInEmail({ body: { email, password } });
  } catch {
    try {
      await auth.api.signUpEmail({ body: { email, password, name } });
    } catch (error) {
      return { error: error instanceof APIError ? error.message : "Could not sign in." };
    }
  }
  redirect("/today");
}
