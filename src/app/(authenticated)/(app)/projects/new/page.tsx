import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import { projectsCopy } from "@/lib/copy-projects";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectPage() {
  return (
    <>
      <PageHeader title={projectsCopy.form.title} description={projectsCopy.form.description} />
      <ProjectForm />
    </>
  );
}
