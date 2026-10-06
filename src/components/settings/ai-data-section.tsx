import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AI_MODE_COPY, settingsCopy } from "@/lib/copy-settings";
import type { AiMode } from "@/lib/env";
import { SettingsSection } from "./settings-section";

const t = settingsCopy.ai;

/**
 * "AI and your data" (docs/SPEC.md §6 AI data privacy, ADR-0008): what the AI steps send, what
 * stays here, what is kept, and how to turn AI off. The mode comes from server configuration only;
 * nothing a browser sends can change it. The lists are checked against the real prompts by
 * tests/integration/privacy/persistence-audit.test.ts ("the AI disclosure on /settings is true").
 */
export function AiDataSection({ mode }: { mode: AiMode }) {
  const modeCopy = AI_MODE_COPY[mode];

  return (
    <SettingsSection id="settings-ai" title={t.heading} description={t.description}>
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t.modeLabel}</span>
          <Badge variant="secondary" data-testid="ai-mode">
            {modeCopy.label}
          </Badge>
        </p>
        <p className="text-muted-foreground text-sm text-pretty">{modeCopy.summary}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.sentHeading}</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty">
          {t.sent.map((item) => (
            <li key={item.step}>
              <span className="font-medium">{item.step}:</span> {item.detail}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm text-pretty">{t.providerTerms}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.notSentHeading}</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty">
          {t.notSent.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.keptHeading}</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty">
          {t.kept.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t.offHeading}</h3>
        <p className="text-sm text-pretty">
          {t.offBody}{" "}
          <Link
            href="/projects"
            className="focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3"
          >
            {t.offLink}
          </Link>
        </p>
      </div>
    </SettingsSection>
  );
}
