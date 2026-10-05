import { and, desc, ne } from "drizzle-orm";
import type { AppContext } from "@/lib/context";
import { projects } from "@/lib/db/schema";
import { ownedBy } from "@/lib/ownership";

// Build mode helpers. A Build session itself is created by Slice 3's `createSession` (type BUILD);
// its only AI call is Extraction (domain/extraction). There is no in-app Build chat (ADR-0009).

export interface BuildProjectChoice {
  id: string;
  name: string;
  /** Prefills the session goal. */
  currentMilestone: string;
  aiEnabled: boolean;
}

/** Projects a Build session can start in: the caller's, not archived, most recently active first. */
export async function listBuildProjects(c: AppContext): Promise<BuildProjectChoice[]> {
  return c.db
    .select({
      id: projects.id,
      name: projects.name,
      currentMilestone: projects.currentMilestone,
      aiEnabled: projects.aiEnabled,
    })
    .from(projects)
    .where(and(ownedBy(projects.userId, c.auth), ne(projects.status, "ARCHIVED")))
    .orderBy(desc(projects.updatedAt));
}
