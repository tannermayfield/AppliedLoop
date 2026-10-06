"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { settingsCopy } from "@/lib/copy-settings";
import { filenameFromDisposition } from "./export-file";
import { SettingsSection } from "./settings-section";

const t = settingsCopy.data;

type State =
  { kind: "idle" } | { kind: "pending" } | { kind: "ready" } | { kind: "error"; text: string };

/** Hand a blob to the browser as a download, without leaving the page. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "Download my data": `GET /me/export`, saved as a JSON file. */
export function ExportData() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function download() {
    setState({ kind: "pending" });
    try {
      const response = await fetch("/api/v1/me/export");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setState({ kind: "error", text: payload?.error?.message ?? t.failed });
        return;
      }
      saveBlob(
        await response.blob(),
        filenameFromDisposition(response.headers.get("content-disposition")),
      );
      setState({ kind: "ready" });
    } catch {
      setState({ kind: "error", text: t.failed });
    }
  }

  return (
    <SettingsSection id="settings-data" title={t.heading} description={t.description}>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.includesHeading}</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty">
          {t.includes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm text-pretty">
          {t.excludes} {t.format}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void download()}
          disabled={state.kind === "pending"}
          className="h-10 px-4"
        >
          {state.kind === "pending" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
          {state.kind === "pending" ? t.preparing : t.button}
        </Button>
        <div aria-live="polite" className="text-sm">
          {state.kind === "ready" && <p className="text-success">{t.ready}</p>}
          {state.kind === "error" && (
            <p role="alert" className="text-destructive">
              {state.text}
            </p>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
