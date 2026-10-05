"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeCheck, BookOpen, Compass, Layers, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/today", label: copy.nav.today, icon: Compass },
  { href: "/learn", label: copy.nav.learn, icon: BookOpen },
  { href: "/projects", label: copy.nav.projects, icon: Layers },
  { href: "/evidence", label: copy.nav.evidence, icon: BadgeCheck },
];

/** Sidebar on desktop, bottom tab bar on phones. The four primary destinations only. */
export function NavLinks({ variant }: { variant: "sidebar" | "tabs" }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className={variant === "sidebar" ? "flex flex-col gap-1" : "flex"}>
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 rounded-lg outline-none focus-visible:ring-3",
              variant === "sidebar"
                ? "flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors"
                : "flex flex-1 flex-col items-center gap-1 py-2 text-[0.7rem] font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <Icon className={variant === "sidebar" ? "size-4" : "size-5"} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
