import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CaptureBox } from "@/components/learning/capture-box";
import { groupConcepts } from "@/components/learning/concept-groups";
import { ConceptGroupsView } from "@/components/learning/concept-groups-view";
import { SourcesPanel, type SourceItem } from "@/components/learning/sources-panel";
import { NeedsReviewList } from "@/components/needs-review/needs-review-list";
import { listConcepts, type ConceptDto } from "@/domain/learning/concepts";
import { listSources } from "@/domain/learning/sources";
import { getMe } from "@/domain/identity/me";
import { getPageContext } from "@/lib/app-context";
import { learnCopy } from "@/lib/copy-learning";

export const metadata: Metadata = { title: "Learn" };

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

function pagesFrom(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : (value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_PAGES) : 1;
}

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = await getPageContext();
  const pages = pagesFrom((await searchParams).pages);

  const [me, sourcePage] = await Promise.all([
    getMe(c),
    listSources(c, { active: "all", limit: 100 }),
  ]);

  // Newest first, up to `pages` pages of 100; the page says so when there are more.
  const concepts: ConceptDto[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < pages; page++) {
    const result = await listConcepts(c, { limit: PAGE_SIZE, cursor });
    concepts.push(...result.items);
    cursor = result.nextCursor ?? undefined;
    if (!cursor) break;
  }

  const sources = sourcePage.items;
  const groups = groupConcepts(concepts, sources, c.now());
  const sourceItems: SourceItem[] = sources.map((source) => ({
    id: source.id,
    type: source.type,
    title: source.title,
    code: source.code,
    term: source.term,
    active: source.active,
    conceptCount: source.conceptCount,
  }));

  return (
    <>
      <PageHeader title={learnCopy.title} description={learnCopy.description} />

      <div className="space-y-10">
        <CaptureBox
          sources={sources
            .filter((source) => source.active)
            .map((source) => ({ id: source.id, title: source.title }))}
        />

        {concepts.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={learnCopy.empty.title}
            description={learnCopy.empty.description}
            action={
              <Button asChild>
                <a href="#capture-name">{learnCopy.empty.action}</a>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <ConceptGroupsView groups={groups} timeZone={me.profile.timezone} />
            {cursor &&
              (pages < MAX_PAGES ? (
                <Button asChild variant="outline">
                  <Link href={`/learn?pages=${pages + 1}`}>{learnCopy.groups.showMore}</Link>
                </Button>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {learnCopy.groups.capped(concepts.length)}
                </p>
              ))}
          </div>
        )}

        <NeedsReviewList />

        <SourcesPanel sources={sourceItems} />
      </div>
    </>
  );
}
