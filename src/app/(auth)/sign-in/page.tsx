import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BadgeCheck, BookOpen, Hammer, ScanSearch, Target } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { copy } from "@/lib/copy";
import { getEnv } from "@/lib/env";
import { SignInPanel } from "./sign-in-panel";

export const metadata: Metadata = { title: "Sign in" };
// Depends on the visitor's cookies and on server-only configuration, so never prerender it.
export const dynamic = "force-dynamic";

const LOOP = [
  { icon: BookOpen, label: "Learn", text: "Capture what you just learned." },
  { icon: Target, label: "Apply", text: "Practice it inside a real project, with a tutor." },
  { icon: Hammer, label: "Build", text: "Ship fast with whatever AI you like." },
  { icon: ScanSearch, label: "Extract", text: "See what the build introduced." },
  { icon: BadgeCheck, label: "Evidence", text: "Keep proof of work you can explain." },
] as const;

export default async function SignInPage() {
  if (await getAuthContext()) redirect("/today");
  const env = getEnv();

  return (
    <main className="mx-auto grid min-h-svh w-full max-w-5xl items-center gap-12 px-6 py-12 md:grid-cols-[1.1fr_1fr]">
      <section className="space-y-8">
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
            {copy.brand.name}
          </p>
          <h1 className="font-display text-4xl leading-tight font-semibold text-balance sm:text-5xl">
            Ship with AI.
            <br />
            Understand what you shipped.
          </h1>
          <p className="text-muted-foreground max-w-md text-lg text-pretty">
            A learning loop around real software projects, so your understanding keeps up with what
            you build.
          </p>
        </div>
        <ol className="space-y-3">
          {LOOP.map(({ icon: Icon, label, text }, index) => (
            <li key={label} className="flex items-start gap-3">
              <span className="bg-secondary text-secondary-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm leading-snug">
                <span className="font-medium">
                  {index + 1}. {label}
                </span>{" "}
                <span className="text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-card rounded-2xl border p-6 shadow-sm sm:p-8">
        <h2 className="font-display mb-1 text-2xl font-semibold">Welcome</h2>
        <p className="text-muted-foreground mb-6 text-sm">Sign in to pick up your loop.</p>
        <SignInPanel
          providers={{ github: Boolean(env.oauth.github), google: Boolean(env.oauth.google) }}
          devLogin={env.devLoginEnabled}
        />
      </section>
    </main>
  );
}
