"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { NativeSelect } from "@/components/learning/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestCopy } from "@/lib/copy-learning";
import { settingsCopy } from "@/lib/copy-settings";
import { SettingsSection } from "./settings-section";

const t = settingsCopy.profile;

interface Props {
  name: string;
  email: string;
  timezone: string;
  /** Built on the server so the list is identical during hydration. */
  timeZones: string[];
}

type Message = { kind: "saved" } | { kind: "error"; text: string };

/** Name and time zone, through `PATCH /me/profile`. The email is shown, not editable. */
export function ProfileForm({ name, email, timezone, timeZones }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name);
  const [zone, setZone] = useState(timezone);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const dirty = displayName.trim() !== name || zone !== timezone;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setFieldErrors({});
    try {
      const me = await apiRequest<{ name: string; profile: { timezone: string } }>(
        "/api/v1/me/profile",
        {
          method: "PATCH",
          // Sending a zone records it as the student's own choice (the browser's zone is never
          // adopted over it), so send it only when they changed it: saving just a new name must
          // not turn an automatically detected zone into a "chosen" one.
          body: { displayName, ...(zone !== timezone ? { timezone: zone } : {}) },
        },
      );
      setDisplayName(me.name);
      setZone(me.profile.timezone);
      setMessage({ kind: "saved" });
      router.refresh(); // the shell shows the name too
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors();
        setFieldErrors(fields);
        // A field message says what to fix; anything else gets the server's own sentence.
        setMessage({
          kind: "error",
          text: Object.keys(fields).length > 0 ? t.failed : caught.message,
        });
      } else {
        setMessage({ kind: "error", text: requestCopy.unexpected });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection id="settings-profile" title={t.heading} description={t.description}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="settings-name">{t.nameLabel}</Label>
          <Input
            id="settings-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t.namePlaceholder}
            maxLength={80}
            autoComplete="name"
            aria-invalid={fieldErrors.displayName ? true : undefined}
            aria-describedby={fieldErrors.displayName ? "settings-name-error" : undefined}
            className="h-10"
          />
          {fieldErrors.displayName && (
            <p id="settings-name-error" className="text-destructive text-sm">
              {fieldErrors.displayName}
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <p className="text-sm font-medium">{t.emailLabel}</p>
          <p className="text-sm break-all">{email}</p>
          <p className="text-muted-foreground text-xs">{t.emailHint}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="settings-timezone">{t.timezoneLabel}</Label>
          <NativeSelect
            id="settings-timezone"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            aria-invalid={fieldErrors.timezone ? true : undefined}
            aria-describedby="settings-timezone-hint"
            className="h-10"
          >
            {timeZones.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
          <p
            id="settings-timezone-hint"
            className={
              fieldErrors.timezone ? "text-destructive text-sm" : "text-muted-foreground text-xs"
            }
          >
            {fieldErrors.timezone ?? t.timezoneHint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || !dirty} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? t.saving : t.save}
          </Button>
          <div aria-live="polite" className="text-sm">
            {message?.kind === "saved" && <p className="text-success">{t.saved}</p>}
            {message?.kind === "error" && (
              <p role="alert" className="text-destructive">
                {message.text}
              </p>
            )}
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}
