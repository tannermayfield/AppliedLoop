"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, X } from "lucide-react";
import { NativeSelect } from "@/components/learning/native-select";
import { AI_FAILURE_CODES, api } from "@/components/sessions/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUILD_COPY, BUILD_LIMITS } from "@/lib/copy-build";
import { ARTIFACT_TYPES, type ArtifactType } from "@/lib/db/schema/enums";

const t = BUILD_COPY.session;

interface Row {
  key: number;
  type: ArtifactType;
  value: string;
}

/**
 * Build summary + optional artifact references → Finish & Extract (POST /api/v1/extractions),
 * which completes the session first. If the AI step fails the session is still finished and
 * saved: offer Try again (same input) and the manual path.
 */
export function FinishForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const id = useId();
  const [summary, setSummary] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setRows((current) => [...current, { key: nextKey, type: "COMMIT", value: "" }]);
    setNextKey((key) => key + 1);
  }
  function updateRow(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function finish(event?: React.FormEvent) {
    event?.preventDefault();
    setPending(true);
    setError(null);
    const result = await api<{ id: string }>("/api/v1/extractions", {
      body: {
        buildSessionId: sessionId,
        summary: summary.trim(),
        artifactRefs: rows
          .filter((row) => row.value.trim())
          .map((row) => ({ type: row.type, value: row.value.trim() })),
      },
    });
    if (result.ok) {
      router.push(`/sessions/${sessionId}/extract`);
      return;
    }
    setPending(false);
    if (result.code === "AI_DISABLED_FOR_PROJECT") setNotice(t.aiDisabled);
    else if (AI_FAILURE_CODES.has(result.code)) setNotice(t.savedButAiFailed);
    else setError(result.message);
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5"
    >
      <h2 id={`${id}-heading`} className="font-display text-lg font-semibold">
        {t.finishHeading}
      </h2>
      <form onSubmit={finish} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-summary`}>{t.summaryLabel}</Label>
          <p id={`${id}-summary-hint`} className="text-muted-foreground text-xs">
            {t.summaryHint}
          </p>
          <Textarea
            id={`${id}-summary`}
            value={summary}
            maxLength={BUILD_LIMITS.maxSummaryChars}
            onChange={(event) => setSummary(event.target.value)}
            aria-describedby={`${id}-summary-hint`}
            className="min-h-36"
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t.artifactsHeading}</legend>
          <p className="text-muted-foreground text-xs">{t.artifactsHint}</p>
          {rows.map((row, index) => (
            <div key={row.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="sr-only" htmlFor={`${id}-type-${row.key}`}>
                {`${t.artifactType} ${index + 1}`}
              </label>
              <NativeSelect
                id={`${id}-type-${row.key}`}
                value={row.type}
                onChange={(event) =>
                  updateRow(row.key, { type: event.target.value as ArtifactType })
                }
                className="h-9 sm:w-40"
              >
                {ARTIFACT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t.artifactTypes[type]}
                  </option>
                ))}
              </NativeSelect>
              <label className="sr-only" htmlFor={`${id}-value-${row.key}`}>
                {`${t.artifactValue} ${index + 1}`}
              </label>
              <Input
                id={`${id}-value-${row.key}`}
                value={row.value}
                maxLength={BUILD_LIMITS.maxArtifactValueChars}
                placeholder={t.artifactValuePlaceholder}
                onChange={(event) => updateRow(row.key, { value: event.target.value })}
                className="h-9 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.removeArtifact(index + 1)}
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
          {rows.length < BUILD_LIMITS.maxArtifactRefs && (
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus aria-hidden />
              {t.addArtifact}
            </Button>
          )}
        </fieldset>

        {!notice && (
          <Button type="submit" disabled={pending}>
            <Sparkles aria-hidden />
            {t.finish}
          </Button>
        )}
      </form>

      <div aria-live="polite" className="space-y-3">
        {pending && <p className="text-muted-foreground text-sm">{t.finishing}</p>}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {notice && (
          <Alert>
            <AlertDescription className="space-y-3">
              <p>{notice}</p>
              <div className="flex flex-wrap gap-2">
                {notice === t.savedButAiFailed && (
                  <Button type="button" onClick={() => finish()} disabled={pending}>
                    {t.tryAgain}
                  </Button>
                )}
                <Button asChild variant="outline">
                  <Link href={`/sessions/${sessionId}/extract`}>{t.addManually}</Link>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
}
