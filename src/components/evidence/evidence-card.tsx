import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/components/learning/format";
import type { EvidenceDto } from "@/domain/evidence/evidence";
import { CONTRIBUTION_LABELS } from "@/lib/copy";
import { ARTIFACT_LABELS, evidenceCopy } from "@/lib/copy-evidence";
import { webHref } from "@/lib/safe-url";
import { excerpt } from "./group";

const copy = evidenceCopy.list;

/** The artifact as a link when it is a web address, otherwise as plain text (a sha or a path). */
export function ArtifactRef({
  type,
  value,
}: {
  type: EvidenceDto["artifactType"];
  value: string | null;
}) {
  if (type === "NOTE" || !value) return <span>{ARTIFACT_LABELS.NOTE}</span>;
  const href = webHref(value);
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex max-w-full items-center gap-1 underline underline-offset-4"
      >
        <span className="truncate">
          {ARTIFACT_LABELS[type]}: {value}
        </span>
        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }
  return (
    <span className="break-all">
      {ARTIFACT_LABELS[type]}: <code className="text-xs">{value}</code>
    </span>
  );
}

export function EvidenceCard({ item, timeZone }: { item: EvidenceDto; timeZone: string }) {
  return (
    <li className="bg-card space-y-3 rounded-2xl border p-4">
      <div className="space-y-1">
        <h3 className="font-medium text-pretty">{item.title}</h3>
        <p className="text-muted-foreground text-sm">
          {copy.inProject(item.projectName)} · {formatDate(item.createdAt, { timeZone })}
          {item.concepts.length > 0 && ` · ${item.concepts.map((c) => c.name).join(", ")}`}
        </p>
      </div>

      <p className="text-sm">
        <ArtifactRef type={item.artifactType} value={item.artifactUrl} />
      </p>

      <div className="space-y-0.5 text-sm">
        <p className="text-muted-foreground text-xs font-medium">{copy.explanationLabel}</p>
        {item.explanation.trim() ? (
          <p className="text-pretty">{excerpt(item.explanation)}</p>
        ) : (
          <p className="text-muted-foreground">{copy.noExplanation}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
          {CONTRIBUTION_LABELS[item.contributionType]}
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/evidence/${item.id}`}>
            {copy.view}
            <span className="sr-only">: {item.title}</span>
          </Link>
        </Button>
      </div>
    </li>
  );
}
