import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEARCH_LIMITS, searchCopy } from "@/lib/copy-search";

const t = searchCopy.form;

/** The box on the results page itself (pre-filled), so a search can be refined in place. */
export function SearchForm({ query }: { query: string }) {
  return (
    <form method="get" action="/search" role="search" aria-label={t.label} className="space-y-1.5">
      <Label htmlFor="search-page-q">{t.label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="search-page-q"
          name="q"
          type="search"
          autoComplete="off"
          defaultValue={query}
          maxLength={SEARCH_LIMITS.maxQueryChars}
          placeholder={t.placeholder}
          className="h-10 max-w-lg min-w-0 flex-1 sm:h-9"
        />
        <Button type="submit" className="h-10 sm:h-9">
          <Search aria-hidden />
          {t.submit}
        </Button>
      </div>
    </form>
  );
}
