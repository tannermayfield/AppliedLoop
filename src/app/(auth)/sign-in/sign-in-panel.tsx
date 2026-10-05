"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { GithubIcon } from "@/components/icons/github";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import { devSignIn, type DevSignInState } from "./actions";

interface Props {
  providers: { github: boolean; google: boolean };
  devLogin: boolean;
}

export function SignInPanel({ providers, devLogin }: Props) {
  const [pending, setPending] = useState<"github" | "google" | null>(null);
  const [state, formAction, devPending] = useActionState<DevSignInState, FormData>(devSignIn, {});
  const hasOAuth = providers.github || providers.google;

  async function oauth(provider: "github" | "google") {
    setPending(provider);
    await authClient.signIn.social({ provider, callbackURL: "/today" });
  }

  return (
    <div className="space-y-6">
      {hasOAuth && (
        <div className="space-y-2.5">
          {providers.github && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full justify-center"
              disabled={pending !== null}
              onClick={() => oauth("github")}
            >
              {pending === "github" ? <Loader2 className="animate-spin" /> : <GithubIcon />}
              Continue with GitHub
            </Button>
          )}
          {providers.google && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full justify-center"
              disabled={pending !== null}
              onClick={() => oauth("google")}
            >
              {pending === "google" ? <Loader2 className="animate-spin" /> : null}
              Continue with Google
            </Button>
          )}
        </div>
      )}

      {devLogin && (
        <form action={formAction} className="space-y-3 rounded-xl border border-dashed p-4">
          <div>
            <p className="text-sm font-medium">Local development sign-in</p>
            <p className="text-muted-foreground text-xs">
              Only available on your machine. No password; it never exists in production.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dev-email">Email</Label>
            <Input
              id="dev-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dev-name">Name (optional)</Label>
            <Input id="dev-name" name="name" placeholder="Tanner" autoComplete="name" />
          </div>
          {state.error && (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full justify-center" disabled={devPending}>
            {devPending && <Loader2 className="animate-spin" />}
            Continue
          </Button>
        </form>
      )}

      {!hasOAuth && !devLogin && (
        <p className="text-muted-foreground rounded-xl border p-4 text-sm">
          No sign-in method is configured. Set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET or
          GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the server environment.
        </p>
      )}
    </div>
  );
}
