import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { userProfiles, users } from "@/lib/db/schema";
import { NotFoundError, parseOrThrow } from "@/lib/errors";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: "STUDENT" | "ADMIN";
  image: string | null;
  profile: {
    program: string | null;
    cohort: string | null;
    timezone: string;
    onboardingCompleted: boolean;
  };
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));

export const updateProfileInput = z.object({
  displayName: z.string().trim().min(1, "Name can't be empty").max(80).optional(),
  program: nullableText(120),
  cohort: nullableText(60),
  timezone: z
    .string()
    .refine(isValidTimeZone, "Not a recognized time zone (e.g. America/Denver)")
    .optional(),
});
export type UpdateProfileInput = z.input<typeof updateProfileInput>;

/** The signed-in student and their profile. Creates the profile row on first use. */
export async function getMe(c: AppContext): Promise<Me> {
  await c.db.insert(userProfiles).values({ userId: c.auth.userId }).onConflictDoNothing();

  const [row] = await c.db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      image: users.image,
      program: userProfiles.program,
      cohort: userProfiles.cohort,
      timezone: userProfiles.timezone,
      onboardingCompleted: userProfiles.onboardingCompleted,
    })
    .from(users)
    .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, c.auth.userId))
    .limit(1);
  if (!row) throw new NotFoundError("User");

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    image: row.image,
    profile: {
      program: row.program,
      cohort: row.cohort,
      timezone: row.timezone,
      onboardingCompleted: row.onboardingCompleted,
    },
  };
}

export async function updateProfile(c: AppContext, raw: UpdateProfileInput): Promise<Me> {
  const input = parseOrThrow(updateProfileInput, raw);
  await getMe(c); // ensures the profile row exists

  if (input.displayName !== undefined) {
    await c.db
      .update(users)
      .set({ name: input.displayName, updatedAt: c.now() })
      .where(eq(users.id, c.auth.userId));
  }

  const profileChanges = {
    ...(input.program !== undefined && { program: input.program }),
    ...(input.cohort !== undefined && { cohort: input.cohort }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
  };
  if (Object.keys(profileChanges).length > 0) {
    await c.db
      .update(userProfiles)
      .set(profileChanges)
      .where(eq(userProfiles.userId, c.auth.userId));
  }
  return getMe(c);
}
