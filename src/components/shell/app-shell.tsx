import Link from "next/link";
import { Repeat2 } from "lucide-react";
import { ShellSearch } from "@/components/search/shell-search";
import { copy } from "@/lib/copy";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";

interface Props {
  user: { name: string; email: string };
  /** Show the "Demo AI" notice (AI_MODE=demo). */
  demoAi: boolean;
  children: React.ReactNode;
}

/**
 * The authenticated frame: Today · Learn · Projects · Evidence. Sidebar on desktop, a top bar plus
 * a bottom tab bar on phones. Apply and Build are entered from pages, not from this navigation.
 */
export function AppShell({ user, demoAi, children }: Props) {
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="bg-sidebar sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r p-4 md:flex">
        <Link
          href="/today"
          className="font-display mb-6 flex items-center gap-2 px-2 text-xl font-semibold"
        >
          <Repeat2 className="text-apply size-5" aria-hidden />
          {copy.brand.name}
        </Link>
        <ShellSearch variant="sidebar" className="mb-4" />
        <NavLinks variant="sidebar" />
        <div className="mt-auto flex items-center gap-3 border-t pt-4">
          <UserMenu name={user.name} email={user.email} />
          <div className="min-w-0 text-sm leading-tight">
            <p className="truncate font-medium">{user.name}</p>
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/90 sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-2 backdrop-blur md:hidden">
          <Link
            href="/today"
            className="font-display flex shrink-0 items-center gap-2 text-lg font-semibold"
          >
            <Repeat2 className="text-apply size-5" aria-hidden />
            {/* The wordmark gives way to the icon on the narrowest phones so the search box fits. */}
            <span className="max-[400px]:sr-only">{copy.brand.name}</span>
          </Link>
          <ShellSearch variant="bar" className="flex-1" />
          <UserMenu name={user.name} email={user.email} />
        </header>

        {demoAi && (
          <div
            role="status"
            className="bg-build-soft text-build-ink border-b px-4 py-1.5 text-center text-xs font-medium"
          >
            {copy.ai.demoBanner}
          </div>
        )}

        <main
          id="main"
          className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-28 sm:px-6 md:px-8 md:py-10 md:pb-10"
        >
          {children}
        </main>

        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-2 backdrop-blur md:hidden">
          <NavLinks variant="tabs" />
        </div>
      </div>
    </div>
  );
}
