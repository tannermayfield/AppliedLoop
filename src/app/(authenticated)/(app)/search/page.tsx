import type { Metadata } from "next";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SearchForm } from "@/components/search/search-form";
import { SearchResults } from "@/components/search/search-results";
import { searchAll } from "@/domain/search/search";
import { getPageContext } from "@/lib/app-context";
import { SEARCH_LIMITS, searchCopy } from "@/lib/copy-search";

export const metadata: Metadata = { title: searchCopy.title };

/**
 * `/search?q=`: the student's own concepts, projects, evidence and sessions, grouped, rendered on
 * the server. A blank query is not an error: it is the prompt to type one.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : (raw ?? "")).trim().slice(0, SEARCH_LIMITS.maxQueryChars);

  const c = await getPageContext();
  const results = query ? await searchAll(c, { q: query }) : null;

  return (
    <>
      <PageHeader title={searchCopy.title} description={searchCopy.description} />
      <div className="space-y-8">
        <SearchForm query={query} />
        {results ? (
          <SearchResults results={results} />
        ) : (
          <EmptyState
            icon={Search}
            title={searchCopy.prompt.title}
            description={searchCopy.prompt.body}
          />
        )}
      </div>
    </>
  );
}
