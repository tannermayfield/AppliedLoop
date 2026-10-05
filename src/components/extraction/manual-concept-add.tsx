"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/components/sessions/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EXTRACTION_COPY } from "@/lib/copy-extraction";

const t = EXTRACTION_COPY;

/**
 * The manual path when AI is off, unavailable, or found nothing: create a concept through the
 * Learning slice's POST /api/v1/concepts (stage Exposed). Not part of the extraction.
 */
export function ManualConceptAdd() {
  const id = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    const result = await api("/api/v1/concepts", { body: { name: trimmed, stage: "EXPOSED" } });
    setPending(false);
    if (result.ok) {
      setName("");
      setMessage({ ok: true, text: t.manualAdded(trimmed) });
    } else {
      setMessage({ ok: false, text: result.message });
    }
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5"
    >
      <h2 id={`${id}-heading`} className="font-display text-lg font-semibold">
        {t.manualHeading}
      </h2>
      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={id}>{t.manualName}</Label>
          <Input
            id={id}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          <Plus aria-hidden />
          {pending ? t.manualAdding : t.manualAdd}
        </Button>
      </form>
      <p
        role="status"
        aria-live="polite"
        className={message?.ok === false ? "text-destructive text-sm" : "text-sm"}
      >
        {message?.text}
      </p>
    </section>
  );
}
