import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { AiDataSection } from "@/components/settings/ai-data-section";
import { DeleteAccount } from "@/components/settings/delete-account";
import { ExportData } from "@/components/settings/export-data";
import { ProfileForm } from "@/components/settings/profile-form";
import { listTimeZones } from "@/components/settings/time-zones";
import { getMe } from "@/domain/identity/me";
import { getPageContext } from "@/lib/app-context";
import { settingsCopy } from "@/lib/copy-settings";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

/**
 * Profile, "AI and your data", the data export and account deletion (docs/SPEC.md §6). Reached
 * from the account menu, not the primary navigation. The AI mode is read from server configuration
 * here and passed down as a plain string: no secret and no setting a browser could change.
 */
export default async function SettingsPage() {
  const c = await getPageContext();
  const me = await getMe(c);

  return (
    <>
      <PageHeader title={settingsCopy.title} description={settingsCopy.description} />
      <div className="max-w-2xl space-y-6">
        <ProfileForm
          name={me.name}
          email={me.email}
          timezone={me.profile.timezone}
          timeZones={listTimeZones(me.profile.timezone)}
        />
        {/* integrations slot */}
        {/* The coordinator adds <GithubConnectionCard /> here (src/components/integrations/github-connection-card.tsx). */}
        <AiDataSection mode={getEnv().aiMode} />
        <ExportData />
        <DeleteAccount email={me.email} />
      </div>
    </>
  );
}
