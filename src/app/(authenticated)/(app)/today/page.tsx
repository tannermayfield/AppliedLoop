import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Today" };

// Placeholder. The "Capture & Today" slice replaces this with the deterministic action feed.
export default function TodayPage() {
  return (
    <>
      <PageHeader title="Today" description="What would move you forward today?" />
      <EmptyState
        icon={Compass}
        title="Nothing here yet"
        description="Once you add what you're learning and a project you're building, Today suggests your next step."
      />
    </>
  );
}
