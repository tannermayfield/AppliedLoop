import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ModeBadge } from "@/components/mode-badge";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import type { SearchGroup, SearchResults as Results } from "@/domain/search/search";
import {
  SEARCH_PROJECT_STATUS_LABELS,
  SEARCH_SESSION_LABELS,
  searchCopy,
} from "@/lib/copy-search";

const t = searchCopy;

function Group<T>({
  id,
  title,
  group,
  limit,
  children,
}: {
  id: string;
  title: string;
  group: SearchGroup<T>;
  limit: number;
  children: (item: T) => React.ReactNode;
}) {
  if (group.items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-display text-xl font-semibold">
        {title}{" "}
        <span className="text-muted-foreground text-base font-normal">
          ({group.hasMore ? `${group.items.length}+` : group.items.length})
        </span>
      </h2>
      <ul className="bg-card divide-y rounded-2xl border px-4 sm:px-5">
        {group.items.map((item, index) => (
          <li key={index} className="space-y-1 py-3">
            {children(item)}
          </li>
        ))}
      </ul>
      {group.hasMore && <p className="text-muted-foreground text-sm">{t.more(limit)}</p>}
    </section>
  );
}

const linkClass = "font-medium underline-offset-4 hover:underline";

/** The student's matches, grouped. Every link goes to a page that checks ownership again. */
export function SearchResults({ results }: { results: Results }) {
  const total =
    results.concepts.items.length +
    results.projects.items.length +
    results.evidence.items.length +
    results.sessions.items.length;

  if (total === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={t.none.title(results.query)}
        description={t.none.body}
        action={
          <Button asChild variant="outline">
            <Link href="/learn">{t.none.action}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <p role="status" className="text-muted-foreground text-sm">
        {t.results.heading(results.query)} · {t.results.total(total)}
      </p>

      <Group id="search-concepts" title={t.groups.concepts} group={results.concepts} limit={results.limit}>
        {(hit) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/learn/concepts/${hit.id}`}
                aria-label={t.hit.concept(hit.name)}
                className={linkClass}
              >
                {hit.name}
              </Link>
              <StageBadge stage={hit.stage} />
              {hit.sourceTitle && (
                <span className="text-muted-foreground text-sm">{hit.sourceTitle}</span>
              )}
            </div>
            {hit.snippet && <p className="text-muted-foreground text-sm text-pretty">{hit.snippet}</p>}
          </>
        )}
      </Group>

      <Group id="search-projects" title={t.groups.projects} group={results.projects} limit={results.limit}>
        {(hit) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/projects/${hit.id}`}
                aria-label={t.hit.project(hit.name)}
                className={linkClass}
              >
                {hit.name}
              </Link>
              {SEARCH_PROJECT_STATUS_LABELS[hit.status] && (
                <span className="text-muted-foreground text-sm">
                  {SEARCH_PROJECT_STATUS_LABELS[hit.status]}
                </span>
              )}
            </div>
            {hit.snippet && <p className="text-muted-foreground text-sm text-pretty">{hit.snippet}</p>}
          </>
        )}
      </Group>

      <Group id="search-evidence" title={t.groups.evidence} group={results.evidence} limit={results.limit}>
        {(hit) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/evidence/${hit.id}`}
                aria-label={t.hit.evidence(hit.title)}
                className={linkClass}
              >
                {hit.title}
              </Link>
              <span className="text-muted-foreground text-sm">{t.hit.inProject(hit.projectName)}</span>
            </div>
            {hit.snippet && <p className="text-muted-foreground text-sm text-pretty">{hit.snippet}</p>}
          </>
        )}
      </Group>

      <Group id="search-sessions" title={t.groups.sessions} group={results.sessions} limit={results.limit}>
        {(hit) => {
          const goal = hit.goal.trim() || t.hit.untitledSession;
          return (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/sessions/${hit.id}`}
                  aria-label={t.hit.session(goal)}
                  className={linkClass}
                >
                  {goal}
                </Link>
                <ModeBadge mode={hit.type} showLabel={false} />
              </div>
              <p className="text-muted-foreground text-sm">
                {SEARCH_SESSION_LABELS[hit.type]} · {t.hit.inProject(hit.projectName)}
                {hit.conceptName ? ` · ${hit.conceptName}` : ""}
              </p>
            </>
          );
        }}
      </Group>
    </div>
  );
}
