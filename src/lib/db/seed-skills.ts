import { slugify } from "../normalize";
import { skills } from "./schema";
import type { Db } from "./types";

// Shared skills (owner_user_id = NULL). Students can add their own custom skills on top.
export const SHARED_SKILLS: ReadonlyArray<{ name: string; category: string }> = [
  // Languages
  { name: "SQL", category: "Languages" },
  { name: "JavaScript", category: "Languages" },
  { name: "TypeScript", category: "Languages" },
  { name: "Python", category: "Languages" },
  { name: "Java", category: "Languages" },
  { name: "C#", category: "Languages" },
  { name: "HTML & CSS", category: "Languages" },
  { name: "Bash & Shell", category: "Languages" },
  // Web
  { name: "React", category: "Web" },
  { name: "Next.js", category: "Web" },
  { name: "Node.js", category: "Web" },
  { name: "API Design", category: "Web" },
  { name: "Authentication & Authorization", category: "Web" },
  { name: "Web Accessibility", category: "Web" },
  // Data
  { name: "Database Design", category: "Data" },
  { name: "Data Modeling", category: "Data" },
  { name: "Query Optimization", category: "Data" },
  { name: "Data Analysis", category: "Data" },
  { name: "Data Visualization", category: "Data" },
  // Cloud & infrastructure
  { name: "AWS", category: "Cloud & Infrastructure" },
  { name: "Azure", category: "Cloud & Infrastructure" },
  { name: "Docker", category: "Cloud & Infrastructure" },
  { name: "Linux", category: "Cloud & Infrastructure" },
  { name: "Networking", category: "Cloud & Infrastructure" },
  { name: "CI/CD", category: "Cloud & Infrastructure" },
  // Practices
  { name: "Git", category: "Practices" },
  { name: "Testing", category: "Practices" },
  { name: "Debugging", category: "Practices" },
  { name: "Security", category: "Practices" },
  { name: "Software Architecture", category: "Practices" },
  { name: "Code Review", category: "Practices" },
  // AI
  { name: "AI Engineering", category: "AI" },
  { name: "Prompt Engineering", category: "AI" },
  { name: "Machine Learning", category: "AI" },
  // Process
  { name: "Systems Analysis & Design", category: "Process" },
  { name: "Requirements Analysis", category: "Process" },
  { name: "Project Management", category: "Process" },
  { name: "Agile", category: "Process" },
  { name: "UX Design", category: "Process" },
];

/** Idempotent: safe to run on every start and in every deploy. Returns how many skills were new. */
export async function seedSharedSkills(db: Db): Promise<number> {
  const inserted = await db
    .insert(skills)
    .values(
      SHARED_SKILLS.map((skill) => ({
        name: skill.name,
        slug: slugify(skill.name),
        category: skill.category,
        ownerUserId: null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: skills.id });
  return inserted.length;
}
