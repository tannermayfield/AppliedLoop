"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth client (sign in with a provider, sign out). Same-origin, no secrets. */
export const authClient = createAuthClient();
