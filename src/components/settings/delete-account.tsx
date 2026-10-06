"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { settingsCopy } from "@/lib/copy-settings";
import { SettingsSection } from "./settings-section";

const t = settingsCopy.delete;

type State =
  { kind: "idle" } | { kind: "pending" } | { kind: "removed" } | { kind: "error"; text: string };

/**
 * Account deletion: says exactly what goes, then asks for the account email in a dialog. The
 * server is the only judge of the email (`DELETE /me` answers 400 on a mismatch and deletes
 * nothing), so this component never decides on its own that a confirmation is right.
 */
export function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "pending" || state.kind === "removed";

  function onOpenChange(next: boolean) {
    if (busy) return; // never abandon a request in flight
    setOpen(next);
    if (!next) {
      setTyped("");
      setState({ kind: "idle" });
    }
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: "pending" });
    try {
      await apiRequest("/api/v1/me", { method: "DELETE", body: { confirmEmail: typed } });
      setState({ kind: "removed" });
      // The session cookie was cleared on the DELETE response; sign-in explains what happened.
      router.replace("/sign-in?deleted=1");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status > 0 && caught.status < 500) {
        // The server refused (wrong email, signed out): a refusal changes nothing.
        setState({
          kind: "error",
          text: caught.fieldErrors().confirmEmail ?? caught.message,
        });
      } else {
        // No answer, or a server error: we can't say for sure that nothing happened.
        setState({ kind: "error", text: t.unsure });
      }
    }
  }

  return (
    <SettingsSection
      id="settings-delete"
      title={t.heading}
      description={t.description}
      tone="danger"
    >
      <p className="text-sm font-medium text-pretty">{t.warning}</p>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.removesHeading}</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty">
          {t.removes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.keepsHeading}</h3>
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm text-pretty">
          {t.keeps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" className="h-10 px-4">
            <Trash2 aria-hidden /> {t.trigger}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="sm:max-w-md">
          <form onSubmit={remove} noValidate className="contents">
            <AlertDialogHeader>
              <AlertDialogTitle>{t.dialogTitle}</AlertDialogTitle>
              <AlertDialogDescription>{t.dialogBody}</AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-1.5">
              <Label htmlFor="settings-confirm-email">{t.confirmLabel(email)}</Label>
              <Input
                id="settings-confirm-email"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={t.confirmPlaceholder}
                inputMode="email"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={busy}
                aria-invalid={state.kind === "error" ? true : undefined}
                aria-describedby="settings-confirm-hint settings-confirm-status"
                className="h-10"
              />
              <p id="settings-confirm-hint" className="text-muted-foreground text-xs">
                {t.confirmHint}
              </p>
              <div id="settings-confirm-status" aria-live="polite" className="text-sm">
                {state.kind === "error" && (
                  <p role="alert" className="text-destructive">
                    {state.text}
                  </p>
                )}
                {state.kind === "removed" && <p className="text-success">{t.removed}</p>}
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy} type="button">
                {t.cancel}
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={busy || typed.trim() === ""}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                {busy ? t.deleting : t.action}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
