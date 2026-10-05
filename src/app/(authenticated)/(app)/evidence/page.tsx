import type { Metadata } from "next";
import { BadgeCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Evidence" };

// Placeholder. The "Evidence & Measurement" slice replaces this.
export default function EvidencePage() {
  return (
    <>
      <PageHeader title="Evidence" description="Proof of work you can explain." />
      <EmptyState icon={BadgeCheck} title="No evidence yet" />
    </>
  );
}
