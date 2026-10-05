import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Repeat2 } from "lucide-react";
import { getMe } from "@/domain/identity/me";
import { getPageContext } from "@/lib/app-context";
import { copy } from "@/lib/copy";
import { onboardingCopy } from "@/lib/copy-learning";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Welcome" };

/** Outside the app shell: a short, skippable setup. Finished students go straight to Today. */
export default async function OnboardingPage() {
  const me = await getMe(await getPageContext());
  if (me.profile.onboardingCompleted) redirect("/today");
  const firstName = me.name.trim().split(/\s+/)[0] ?? "";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10 sm:px-6">
      <p className="font-display text-muted-foreground flex items-center gap-2 text-lg font-semibold">
        <Repeat2 className="text-apply size-5" aria-hidden />
        {copy.brand.name}
      </p>
      <h1 className="sr-only">{onboardingCopy.welcome(firstName)}</h1>
      <OnboardingFlow greeting={onboardingCopy.welcome(firstName)} />
    </main>
  );
}
