"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hammer, Lightbulb, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type { MessageDto, SessionDto } from "@/domain/sessions/sessions";
import type { TutorReplyResult } from "@/domain/sessions/apply/tutor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { APPLY_COPY, SESSION_LIMITS } from "@/lib/copy-sessions";
import { AI_FAILURE_CODES, api } from "./api";
import { Thread } from "./thread";

const t = APPLY_COPY.session;

interface Props {
  sessionId: string;
  initialMessages: MessageDto[];
  initialHintLevel: number;
  /** Null when the tutor can't be used (project or app AI off); the reason is shown instead. */
  tutorUnavailable: string | null;
}

export function ApplyWorkspace({ sessionId, initialMessages, initialHintLevel, tutorUnavailable }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [hintLevel, setHintLevel] = useState(initialHintLevel);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; retry: string | null } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const last = messages.at(-1);
  const unanswered = !pending && !notice && last?.role === "USER" ? last.content : null;

  function append(result: TutorReplyResult) {
    setMessages((current) => [
      ...current.filter((m) => m.id !== result.userMessage.id && m.id !== result.reply.id),
      result.userMessage,
      result.reply,
    ]);
  }

  async function send(text: string, { clearDraft }: { clearDraft: boolean }) {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    setNotice(null);
    const result = await api<TutorReplyResult>(`/api/v1/sessions/${sessionId}/messages`, {
      body: { message },
    });
    setPending(false);
    if (result.ok) {
      append(result.data);
      if (clearDraft) setDraft("");
      textarea.current?.focus();
      return;
    }
    // The message was saved before the model call failed: keep the text and offer a retry.
    setNotice(
      AI_FAILURE_CODES.has(result.code)
        ? { text: `${t.savedNotice} ${result.message}`, retry: message }
        : { text: result.message, retry: null },
    );
  }

  async function askForHint() {
    if (pending) return;
    setPending(true);
    const result = await api<SessionDto>(`/api/v1/sessions/${sessionId}/hints`, { body: {} });
    setPending(false);
    if (!result.ok) {
      setNotice({ text: result.message, retry: null });
      return;
    }
    setHintLevel(result.data.hintLevel);
    await send(t.hintMessage, { clearDraft: false });
  }

  async function switchToBuild() {
    const result = await api<SessionDto>(`/api/v1/sessions/${sessionId}/switch-to-build`, { body: {} });
    if (!result.ok) return toast.error(result.message);
    router.push(`/sessions/${result.data.id}`);
  }

  async function setAside() {
    const result = await api<SessionDto>(`/api/v1/sessions/${sessionId}/abandon`, { body: {} });
    if (!result.ok) return toast.error(result.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Thread messages={messages} />

      <div aria-live="polite" className="space-y-2">
        {pending && (
          <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> {t.thinking}
          </p>
        )}
        {notice && (
          <div role="alert" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm">
            <span className="flex-1">{notice.text}</span>
            {notice.retry && (
              <Button size="sm" variant="outline" onClick={() => send(notice.retry!, { clearDraft: true })}>
                {t.tryAgain}
              </Button>
            )}
          </div>
        )}
        {unanswered && !tutorUnavailable && (
          <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm">
            <span className="flex-1">{t.unanswered}</span>
            <Button size="sm" variant="outline" onClick={() => send(unanswered, { clearDraft: false })}>
              {t.tryAgain}
            </Button>
          </div>
        )}
      </div>

      {tutorUnavailable ? (
        <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm">{tutorUnavailable}</p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft, { clearDraft: true });
          }}
        >
          <Label htmlFor="tutor-message">{t.composerLabel}</Label>
          <Textarea
            id="tutor-message"
            ref={textarea}
            value={draft}
            maxLength={SESSION_LIMITS.maxMessageChars}
            rows={4}
            placeholder={messages.length === 0 ? t.firstPlaceholder : t.placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void send(draft, { clearDraft: true });
              }
            }}
            aria-describedby="tutor-message-hint"
          />
          <div className="flex items-center justify-between gap-2">
            <span id="tutor-message-hint" className="text-muted-foreground text-xs">
              {t.sendHint}
            </span>
            <Button type="submit" disabled={pending || !draft.trim()}>
              <Send aria-hidden /> {t.send}
            </Button>
          </div>
        </form>
      )}

      <div className="bg-apply-soft/60 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-apply-ink text-sm font-medium">{t.hints(hintLevel)}</p>
          <p className="text-muted-foreground text-xs">{t.hintNext[Math.min(hintLevel, 3)]}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={askForHint}
          disabled={pending || hintLevel >= SESSION_LIMITS.maxHintLevel || Boolean(tutorUnavailable)}
        >
          <Lightbulb aria-hidden /> {t.askHint}
        </Button>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <Hammer aria-hidden /> {t.switch}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.switchTitle}</AlertDialogTitle>
                <AlertDialogDescription>{t.switchBody}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={switchToBuild}>{t.switchConfirm}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost">{t.setAside}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.setAsideTitle}</AlertDialogTitle>
                <AlertDialogDescription>{t.setAsideBody}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={setAside}>{t.setAside}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <FinishDialog sessionId={sessionId} />
      </div>
    </div>
  );
}

function FinishDialog({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState({ implemented: "", understandingChange: "", explanation: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = [
    ["implemented", t.qImplemented],
    ["understandingChange", t.qUnderstanding],
    ["explanation", t.qExplain],
  ] as const;

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await api(`/api/v1/sessions/${sessionId}/complete`, { body: { reflection: answers } });
    setPending(false);
    if (!result.ok) return setError(result.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-apply hover:bg-apply/90 text-white dark:text-black">{t.finish}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={finish} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t.finishTitle}</DialogTitle>
            <DialogDescription>{t.finishBody}</DialogDescription>
          </DialogHeader>
          {fields.map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`reflection-${key}`}>{label}</Label>
              <Textarea
                id={`reflection-${key}`}
                rows={3}
                maxLength={SESSION_LIMITS.maxReflectionChars}
                value={answers[key]}
                onChange={(e) => setAnswers((current) => ({ ...current, [key]: e.target.value }))}
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />} {t.finishConfirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
