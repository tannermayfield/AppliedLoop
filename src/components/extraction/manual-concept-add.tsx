"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EXTRACTION_COPY } from "@/lib/copy-extraction";
import { requestCopy } from "@/lib/copy-learning";
import { needsReviewFlow } from "@/lib/copy-needs-review";

const t = needsReviewFlow.add;

interface AddedItem {
  conceptId: string;
  name: string;
}

/**
 * The manual way into Needs Review, for when AI is off, unavailable or found nothing (and still
 * there under a populated review: "Add another concept"). The student names a concept; the server
 * finds or creates it and opens its Needs Review item in one transaction (POST /learning-debt).
 * Nothing is added unless the student submits this form.
 */
export function ManualConceptAdd({
  projectId,
  hasCandidates,
}: {
  projectId: string;
  hasCandidates: boolean;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [added, setAdded] = useState<AddedItem[]>([]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage({ ok: false, text: t.needsName });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        debt: { conceptId: string; conceptName: string };
        created: boolean;
      }>("/api/v1/learning-debt", { method: "POST", body: { conceptName: trimmed, projectId } });
      const item = { conceptId: result.debt.conceptId, name: result.debt.conceptName };
      setName("");
      setAdded((current) =>
        current.some((entry) => entry.conceptId === item.conceptId) ? current : [...current, item],
      );
      setMessage({
        ok: true,
        text: result.created ? t.added(item.name) : t.alreadyThere(item.name),
      });
    } catch (error) {
      setMessage({
        ok: false,
        text:
          error instanceof ApiError
            ? (error.fieldErrors().conceptName ?? error.message)
            : requestCopy.unexpected,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 id={`${id}-heading`} className="font-display text-lg font-semibold">
          {hasCandidates ? t.headingMore : t.headingFirst}
        </h2>
        <p className="text-muted-foreground text-sm">{t.description}</p>
      </div>
      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={id}>{t.nameLabel}</Label>
          <Input
            id={id}
            value={name}
            maxLength={120}
            placeholder={t.namePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending}>
          <Plus aria-hidden />
          {pending ? t.submitting : t.submit}
        </Button>
      </form>
      <p
        role="status"
        aria-live="polite"
        className={message?.ok === false ? "text-destructive text-sm" : "text-sm"}
      >
        {message?.text}
      </p>

      {added.length > 0 && (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t.addedHeading}</h3>
            <ul className="text-sm">
              {added.map((item) => (
                <li key={item.conceptId}>
                  <Link
                    href={`/learn/concepts/${item.conceptId}`}
                    className="underline underline-offset-4"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-sm">{t.nextBody}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/today">{EXTRACTION_COPY.goToday}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}?tab=learning`}>{EXTRACTION_COPY.backToProject}</Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
