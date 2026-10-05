import { redirect } from "next/navigation";
import { getMe } from "@/domain/identity/me";
import { AppShell } from "@/components/shell/app-shell";
import { getPageContext } from "@/lib/app-context";
import { getEnv } from "@/lib/env";

/** The main frame (sidebar / tab bar). Focused flows such as onboarding live outside this group. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await getPageContext();
  const me = await getMe(c);
  // New students answer the two onboarding questions (both skippable) before the app itself.
  if (!me.profile.onboardingCompleted) redirect("/onboarding");

  return (
    <AppShell user={{ name: me.name, email: me.email }} demoAi={getEnv().aiMode === "demo"}>
      {children}
    </AppShell>
  );
}
