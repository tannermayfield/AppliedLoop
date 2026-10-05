import Link from "next/link";
import { NativeSelect } from "@/components/learning/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { evidenceCopy } from "@/lib/copy-evidence";
import { cn } from "@/lib/utils";

const copy = evidenceCopy.filters;

export interface EvidenceFilterState {
  skillId?: string;
  projectId?: string;
  conceptId?: string;
  search?: string;
}

interface Props {
  state: EvidenceFilterState;
  skills: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  concepts: { id: string; name: string }[];
}

function hrefFor(state: EvidenceFilterState) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `/evidence?${query}` : "/evidence";
}

/** Plain GET form plus link chips: works without JavaScript and is fully keyboard operable. */
export function EvidenceFilters({ state, skills, projects, concepts }: Props) {
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-8 items-center rounded-full border px-3 text-sm",
      active ? "bg-secondary border-ring font-medium" : "hover:bg-secondary/60",
    );
  const hasFilters = Boolean(state.skillId || state.projectId || state.conceptId || state.search);

  return (
    <div className="mb-6 space-y-4">
      {skills.length > 0 && (
        <nav aria-label={copy.skills}>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href={hrefFor({ ...state, skillId: undefined })}
                className={chip(!state.skillId)}
                aria-current={!state.skillId ? "true" : undefined}
              >
                {copy.all}
              </Link>
            </li>
            {skills.map((skill) => (
              <li key={skill.id}>
                <Link
                  href={hrefFor({ ...state, skillId: skill.id })}
                  className={chip(state.skillId === skill.id)}
                  aria-current={state.skillId === skill.id ? "true" : undefined}
                >
                  {skill.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <form method="get" action="/evidence" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {state.skillId && <input type="hidden" name="skillId" value={state.skillId} />}
        <div className="grid gap-1.5">
          <Label htmlFor="filter-project">{copy.project}</Label>
          <NativeSelect
            id="filter-project"
            name="projectId"
            defaultValue={state.projectId ?? ""}
            className="h-10 sm:h-8"
          >
            <option value="">{copy.anyProject}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-concept">{copy.concept}</Label>
          <NativeSelect
            id="filter-concept"
            name="conceptId"
            defaultValue={state.conceptId ?? ""}
            className="h-10 sm:h-8"
          >
            <option value="">{copy.anyConcept}</option>
            {concepts.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-search">{copy.search}</Label>
          <Input
            id="filter-search"
            name="search"
            type="search"
            defaultValue={state.search ?? ""}
            placeholder={copy.searchPlaceholder}
            maxLength={100}
            className="h-10 sm:h-8"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" className="h-10 sm:h-8">
            {copy.apply}
          </Button>
          {hasFilters && (
            <Button asChild variant="ghost" className="h-10 sm:h-8">
              <Link href="/evidence">{copy.clear}</Link>
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
