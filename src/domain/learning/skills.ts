import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppContext, AuthContext } from "@/lib/context";
import { skills } from "@/lib/db/schema";
import { ConflictError, NotFoundError, parseOrThrow } from "@/lib/errors";
import { slugify } from "@/lib/normalize";

// Skills: the shared catalog (owner_user_id IS NULL) plus each student's own custom skills. A skill
// is visible to a student when it is shared or theirs. Concepts, projects and evidence link to
// skills, so every module that accepts a skill id calls `assertSkillsAccessible` first.

export interface SkillDto {
  id: string;
  name: string;
  slug: string;
  category: string;
  /** True for a skill the student created; false for the shared catalog. */
  custom: boolean;
}

// Small helpers shared by the Learning and Projects modules. They live here because this file
// depends on none of them.

const guid = z.guid();

/**
 * An id from a URL or request body, or NOT_FOUND. A malformed id cannot exist, so it must never
 * reach the database (which would answer with a 500 instead of a 404).
 */
export function idOrNotFound(raw: string, entity: string): string {
  if (!guid.safeParse(raw).success) throw new NotFoundError(entity);
  return raw;
}

/** Escape `\`, `%` and `_` so user text is matched literally inside LIKE / ILIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/** The rows of `skills` a student may see: the shared catalog and their own. */
export function skillVisibleTo(auth: AuthContext): SQL {
  return or(isNull(skills.ownerUserId), eq(skills.ownerUserId, auth.userId))!;
}

export const skillColumns = {
  id: skills.id,
  name: skills.name,
  slug: skills.slug,
  category: skills.category,
  ownerUserId: skills.ownerUserId,
};

export function toSkillDto(row: {
  id: string;
  name: string;
  slug: string;
  category: string;
  ownerUserId: string | null;
}): SkillDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    custom: row.ownerUserId !== null,
  };
}

const optionalFilter = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const listSkillsQuery = z.object({
  /** Part of the skill name, case-insensitive. */
  search: optionalFilter(80),
  category: optionalFilter(60),
});
export type ListSkillsQuery = z.input<typeof listSkillsQuery>;

export const createSkillInput = z
  .object({
    name: z.string().trim().min(1, "Give the skill a name").max(60),
    category: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((value) => value || "General"),
  })
  // (An empty name already has its own message.)
  .refine((input) => input.name === "" || slugify(input.name) !== "", {
    path: ["name"],
    message: "Use letters or numbers in the skill name",
  });
export type CreateSkillInput = z.input<typeof createSkillInput>;

/** Shared catalog plus the caller's custom skills, by category then name. */
export async function listSkills(c: AppContext, raw: ListSkillsQuery = {}): Promise<SkillDto[]> {
  const query = parseOrThrow(listSkillsQuery, raw);

  const conditions = [skillVisibleTo(c.auth)];
  if (query.search) conditions.push(ilike(skills.name, `%${escapeLike(query.search)}%`));
  if (query.category) conditions.push(sql`lower(${skills.category}) = lower(${query.category})`);

  const rows = await c.db
    .select(skillColumns)
    .from(skills)
    .where(and(...conditions))
    .orderBy(sql`lower(${skills.category})`, sql`lower(${skills.name})`, asc(skills.id));
  return rows.map(toSkillDto);
}

/**
 * A custom skill for the caller. Conflicts when the name (as a slug) already exists in the shared
 * catalog or among the caller's own skills; the existing skill is returned in the error details.
 */
export async function createSkill(c: AppContext, raw: CreateSkillInput): Promise<SkillDto> {
  const input = parseOrThrow(createSkillInput, raw);
  const slug = slugify(input.name);

  const conflict = async () => {
    const [existing] = await c.db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.slug, slug), skillVisibleTo(c.auth)))
      .limit(1);
    return existing
      ? new ConflictError(`A skill called "${input.name}" already exists.`, {
          existingSkillId: existing.id,
        })
      : null;
  };

  // The unique indexes only stop two shared skills or two of one student's skills from sharing a
  // slug, so a custom skill that repeats a shared one has to be caught here.
  const existing = await conflict();
  if (existing) throw existing;

  const [row] = await c.db
    .insert(skills)
    .values({
      name: input.name,
      slug,
      category: input.category,
      ownerUserId: c.auth.userId,
      createdAt: c.now(),
    })
    .onConflictDoNothing()
    .returning(skillColumns);
  if (!row) {
    // Lost a race with the same student creating the same skill.
    throw (await conflict()) ?? new ConflictError(`A skill called "${input.name}" already exists.`);
  }
  return toSkillDto(row);
}

/** Every id must be a shared skill or one the caller owns; otherwise NOT_FOUND (nothing leaks). */
export async function assertSkillsAccessible(c: AppContext, skillIds: string[]): Promise<void> {
  const unique = [...new Set(skillIds)];
  if (unique.length === 0) return;
  for (const id of unique) idOrNotFound(id, "Skill");

  const rows = await c.db
    .select({ id: skills.id })
    .from(skills)
    .where(and(inArray(skills.id, unique), skillVisibleTo(c.auth)));
  if (rows.length !== unique.length) throw new NotFoundError("Skill");
}
