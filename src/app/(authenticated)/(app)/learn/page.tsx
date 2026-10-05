import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Learn" };

// Placeholder. The "Learning & Projects" slice replaces this.
export default function LearnPage() {
  return (
    <>
      <PageHeader title="Learn" description="What did you learn?" />
      <EmptyState icon={BookOpen} title="Nothing captured yet" />
    </>
  );
}
