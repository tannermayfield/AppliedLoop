import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { learnCopy } from "@/lib/copy-learning";

const t = learnCopy.search;

/**
 * Filters the concept list by name, description or notes. A plain GET form to /learn?q=: it works
 * without JavaScript, the filtered page is shareable, and the server does the matching.
 */
export function ConceptFilter({ query }: { query: string }) {
  return (
    <form method="get" action="/learn" role="search" className="space-y-1.5">
      <Label htmlFor="learn-search">{t.label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="learn-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t.placeholder}
          maxLength={80}
          className="h-10 max-w-sm min-w-0 flex-1 sm:h-8"
        />
        <Button type="submit" variant="outline" className="h-10 sm:h-8">
          <Search aria-hidden />
          {t.submit}
        </Button>
        {query && (
          <Button asChild variant="ghost" className="h-10 sm:h-8">
            <Link href="/learn">{t.clear}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
