"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Clock, Loader2, RefreshCw, Search } from "lucide-react";
import type { GeneratedOpportunities } from "@/domain/sessions/apply/opportunities";
import type { ConceptChoice, OpportunityDto, ProjectChoice } from "@/domain/sessions/loaders";
import type { SessionDto } from "@/domain/sessions/sessions";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APPLY_COPY } from "@/lib/copy-sessions";
import type { OpportunityDifficulty } from "@/lib/db/schema/enums";
import { api } from "./api";

const t = APPLY_COPY.picker;
const DIFFICULTIES: OpportunityDifficulty[] = ["EASY", "MODERATE", "HARD"];

interface Props {
  concepts: ConceptChoice[];
  projects: ProjectChoice[];
  conceptId: string;
  projectId: string;
  /** Open challenges already generated for the preselected pair. */
  existing: OpportunityDto[];
  aiOff: boolean;
}

export function ApplyPicker(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [difficulty, setDifficulty] = useState<OpportunityDifficulty>("MODERATE");

  // The pair lives in the URL so the server can show existing challenges for it.
  function choose(key: "conceptId" | "projectId", value: string) {
    const params = new URLSearchParams({ conceptId: props.conceptId, projectId: props.projectId });
    params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const project = props.projects.find((p) => p.id === props.projectId);

  return (
    <div className="space-y-6">
      <div className="bg-card grid gap-4 rounded-2xl border p-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="apply-concept">{t.concept}</Label>
          <Select value={props.conceptId} onValueChange={(value) => choose("conceptId", value)}>
            <SelectTrigger id="apply-concept" className="w-full">
              <SelectValue placeholder={t.conceptPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {props.concepts.map((concept) => (
                <SelectItem key={concept.id} value={concept.id}>
                  {concept.name}
                  <StageBadge stage={concept.stage} className="ml-1" />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apply-project">{t.project}</Label>
          <Select value={props.projectId} onValueChange={(value) => choose("projectId", value)}>
            <SelectTrigger id="apply-project" className="w-full">
              <SelectValue placeholder={t.projectPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {props.projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apply-difficulty">{t.difficulty}</Label>
          <Select value={difficulty} onValueChange={(value) => setDifficulty(value as OpportunityDifficulty)}>
            <SelectTrigger id="apply-difficulty" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIFFICULTIES.map((level) => (
                <SelectItem key={level} value={level}>
                  {t.difficulties[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {props.conceptId && project ? (
        <Results
          key={`${props.conceptId}:${props.projectId}`}
          conceptId={props.conceptId}
          project={project}
          difficulty={difficulty}
          existing={props.existing}
          aiOff={props.aiOff}
        />
      ) : (
        <p className="text-muted-foreground text-sm">{t.pickBoth}</p>
      )}
    </div>
  );
}

function Results({
  conceptId,
  project,
  difficulty,
  existing,
  aiOff,
}: {
  conceptId: string;
  project: ProjectChoice;
  difficulty: OpportunityDifficulty;
  existing: OpportunityDto[];
  aiOff: boolean;
}) {
  const router = useRouter();
  const manualReason = aiOff ? t.aiOff : !project.aiEnabled ? t.projectAiOff(project.name) : null;
  const [opportunities, setOpportunities] = useState(existing);
  const [noFit, setNoFit] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(manualReason);
  const [showManual, setShowManual] = useState(Boolean(manualReason));
  const [busy, setBusy] = useState<string | null>(null);

  async function find() {
    setBusy("find");
    setProblem(null);
    const result = await api<GeneratedOpportunities>("/api/v1/apply/opportunities", {
      body: { conceptId, projectId: project.id, desiredDifficulty: difficulty },
    });
    setBusy(null);
    if (!result.ok) {
      setProblem(result.status === 503 ? t.aiUnavailable : result.message);
      setShowManual(true);
      return;
    }
    setOpportunities(result.data.opportunities);
    setNoFit(result.data.opportunities.length === 0 ? (result.data.noGoodFitReason ?? "") : null);
    if (result.data.opportunities.length === 0) setShowManual(true);
  }

  async function start(opportunityId: string) {
    setBusy(opportunityId);
    const result = await api<SessionDto>("/api/v1/sessions", {
      body: { type: "APPLY", projectId: project.id, opportunityId },
    });
    if (!result.ok) {
      setBusy(null);
      setProblem(result.message);
      return;
    }
    router.push(`/sessions/${result.data.id}`);
  }

  async function discard(opportunityId: string) {
    setBusy(`discard:${opportunityId}`);
    const result = await api(`/api/v1/apply/opportunities/${opportunityId}`, {
      method: "PATCH",
      body: { status: "DISCARDED" },
    });
    setBusy(null);
    if (!result.ok) return setProblem(result.message);
    setOpportunities((current) => current.filter((o) => o.id !== opportunityId));
  }

  return (
    <div className="space-y-4" aria-live="polite">
      {!manualReason && (
        <Button onClick={find} disabled={busy !== null}>
          {busy === "find" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : opportunities.length > 0 ? (
            <RefreshCw aria-hidden />
          ) : (
            <Search aria-hidden />
          )}
          {busy === "find" ? t.finding : opportunities.length > 0 ? t.regenerate : t.find}
        </Button>
      )}
      {problem && (
        <p role="status" className="bg-muted rounded-xl px-3 py-2 text-sm">
          {problem}
        </p>
      )}
      {noFit !== null && (
        <div role="status" className="bg-card space-y-1 rounded-xl border px-3 py-2 text-sm">
          <p className="font-medium">{t.noGoodFit}</p>
          {noFit && <p className="text-muted-foreground">{noFit}</p>}
        </div>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {opportunities.map((opportunity) => (
          <li key={opportunity.id} className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="bg-apply-soft text-apply-ink rounded-full px-2 py-0.5 font-medium">
                {t.difficulties[opportunity.difficulty]}
              </span>
              {opportunity.estimatedMinutes && (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden /> {t.minutes(opportunity.estimatedMinutes)}
                </span>
              )}
            </div>
            <h2 className="font-display text-lg font-semibold text-balance">{opportunity.title}</h2>
            <p className="text-sm text-pretty">{opportunity.task}</p>
            {opportunity.rationale && (
              <div>
                <h3 className="text-muted-foreground text-xs font-semibold uppercase">{t.whyFits}</h3>
                <p className="text-muted-foreground text-sm text-pretty">{opportunity.rationale}</p>
              </div>
            )}
            <div>
              <h3 className="text-muted-foreground text-xs font-semibold uppercase">{t.successCriteria}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {opportunity.successCriteria.map((criterion, index) => (
                  <li key={index}>{criterion}</li>
                ))}
              </ul>
            </div>
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              <Button onClick={() => start(opportunity.id)} disabled={busy !== null}>
                {busy === opportunity.id && <Loader2 className="animate-spin" aria-hidden />}
                {busy === opportunity.id ? t.starting : t.start}
              </Button>
              <Button variant="ghost" onClick={() => discard(opportunity.id)} disabled={busy !== null}>
                {t.notThisOne}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {showManual ? (
        <ManualChallenge conceptId={conceptId} projectId={project.id} onProblem={setProblem} />
      ) : (
        <Button variant="link" className="px-0" onClick={() => setShowManual(true)}>
          {t.manualShow}
        </Button>
      )}
    </div>
  );
}

function ManualChallenge({
  conceptId,
  projectId,
  onProblem,
}: {
  conceptId: string;
  projectId: string;
  onProblem: (message: string) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [task, setTask] = useState("");
  const [rationale, setRationale] = useState("");
  const [criteria, setCriteria] = useState<string>(t.manualCriteriaDefault);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const created = await api<OpportunityDto>("/api/v1/apply/opportunities/manual", {
      body: {
        conceptId,
        projectId,
        title,
        task,
        rationale,
        successCriteria: criteria.split("\n").map((line) => line.trim()).filter(Boolean),
      },
    });
    if (!created.ok) {
      setPending(false);
      return onProblem(created.message);
    }
    const session = await api<SessionDto>("/api/v1/sessions", {
      body: { type: "APPLY", projectId, opportunityId: created.data.id },
    });
    if (!session.ok) {
      setPending(false);
      return onProblem(session.message);
    }
    router.push(`/sessions/${session.data.id}`);
  }

  return (
    <form onSubmit={submit} className="bg-card space-y-4 rounded-2xl border p-4">
      <h2 className="font-medium">{t.manualTitle}</h2>
      <div className="space-y-1.5">
        <Label htmlFor="manual-title">{t.manualChallengeTitle}</Label>
        <Input id="manual-title" value={title} required maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manual-task">{t.manualTask}</Label>
        <Textarea id="manual-task" value={task} required maxLength={2000} onChange={(e) => setTask(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manual-rationale">{t.manualRationale}</Label>
        <Textarea id="manual-rationale" value={rationale} maxLength={1200} onChange={(e) => setRationale(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manual-criteria">{t.manualCriteria}</Label>
        <Textarea id="manual-criteria" value={criteria} rows={3} onChange={(e) => setCriteria(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />} {t.manualStart}
      </Button>
    </form>
  );
}
