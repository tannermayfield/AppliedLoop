import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Projects" };

// Placeholder. The "Learning & Projects" slice replaces this.
export default function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" description="Real projects are where learning sticks." />
      <EmptyState icon={Layers} title="No projects yet" />
    </>
  );
}
