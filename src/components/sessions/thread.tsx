"use client";

import type { MessageDto } from "@/domain/sessions/sessions";
import { APPLY_COPY } from "@/lib/copy-sessions";
import { STAGE_LABELS } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { PlainWithCode, TutorMarkdown } from "./markdown";

const t = APPLY_COPY.session;

/** The tutor conversation. New messages are announced politely to screen readers. */
export function Thread({ messages }: { messages: MessageDto[] }) {
  return (
    <section aria-label={t.thread}>
      {messages.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          {t.emptyThread}
        </p>
      ) : (
        <ol className="space-y-3" aria-live="polite" aria-relevant="additions">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "rounded-2xl border px-4 py-3",
                message.role === "ASSISTANT" ? "bg-apply-soft/50 border-apply/20" : "bg-card sm:ml-10",
              )}
            >
              <p className="text-muted-foreground mb-1 text-xs font-semibold">
                {message.role === "ASSISTANT" ? t.tutor : t.you}
              </p>
              {message.role === "ASSISTANT" ? (
                <TutorMessage message={message} />
              ) : (
                <PlainWithCode text={message.content} />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TutorMessage({ message }: { message: MessageDto }) {
  const meta = message.tutor;
  const question = meta?.nextQuestion?.trim();
  return (
    <div className="space-y-2">
      <TutorMarkdown>{message.content}</TutorMarkdown>
      {question && !message.content.includes(question) && (
        <p className="text-sm">
          <span className="text-apply-ink font-medium">{t.nextQuestion}: </span>
          {question}
        </p>
      )}
      {meta?.suggestedProgress && (
        <p className="text-muted-foreground border-t pt-2 text-xs">
          {t.suggestion(STAGE_LABELS[meta.suggestedProgress.stage], meta.suggestedProgress.reason)}
        </p>
      )}
      {meta?.fallback && <p className="text-muted-foreground text-xs italic">{t.fallbackNote}</p>}
    </div>
  );
}
