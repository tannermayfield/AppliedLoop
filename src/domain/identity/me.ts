import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inTransaction, type AppContext } from "@/lib/context";
import { userProfiles, users } from "@/lib/db/schema";
import { NotFoundError, parseOrThrow } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import {
  DEFAULT_TIME_ZONE,
  canonicalTimeZone,
  detectedTimeZoneToAdopt,
  isValidTimeZone,
} from "@/lib/time-zone";

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
    /**
     * True once the student saved a time zone themselves. The browser's zone is never adopted over
     * one they chose (see `detectedTimezone` on `updateProfile`).
     */
    timezoneChosen: boolean;
    onboardingCompleted: boolean;
  };
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
  /** The student's own choice: always applied, and from then on the browser's zone never replaces it. */
  timezone: z
    .string()
    .refine(isValidTimeZone, "Not a recognized time zone (e.g. America/Denver)")
    .optional(),
  /**
   * The browser's time zone, sent once by the app so Today's greeting and every date match where
   * the student is. Only a first guess: adopted while the profile still has the default and the
   * student never chose a zone, otherwise ignored (200, nothing changes). Never marks the zone as
   * chosen. Ignored when `timezone` is sent in the same request.
   */
  detectedTimezone: z
    .string()
    .refine((value) => canonicalTimeZone(value) !== null, "Not a recognized time zone")
    .optional(),
});
export type UpdateProfileInput = z.input<typeof updateProfileInput>;

function selectMe(c: AppContext) {
  return c.db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      image: users.image,
      program: userProfiles.program,
      cohort: userProfiles.cohort,
      timezone: userProfiles.timezone,
      timezoneChosen: userProfiles.timezoneChosen,
      onboardingCompleted: userProfiles.onboardingCompleted,
    })
    .from(users)
    .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, c.auth.userId))
    .limit(1);
}

/**
 * The signed-in student and their profile. This runs on every authenticated page, so it reads
 * first: the sign-up hook already created the profile, and only an account that somehow lacks one
 * pays for creating it (it used to write on every call).
 */
export async function getMe(c: AppContext): Promise<Me> {
  let [row] = await selectMe(c);
  if (!row) {
    await c.db.insert(userProfiles).values({ userId: c.auth.userId }).onConflictDoNothing();
    [row] = await selectMe(c);
  }
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
      timezoneChosen: row.timezoneChosen,
      onboardingCompleted: row.onboardingCompleted,
    },
  };
}

export async function updateProfile(c: AppContext, raw: UpdateProfileInput): Promise<Me> {
  const input = parseOrThrow(updateProfileInput, raw);
  const current = await getMe(c); // also makes sure the profile row exists

  await inTransaction(c, async (tx) => {
    if (input.displayName !== undefined) {
      await tx.db
        .update(users)
        .set({ name: input.displayName, updatedAt: tx.now() })
        .where(eq(users.id, tx.auth.userId));
    }

    const profileChanges = {
      ...(input.program !== undefined && { program: input.program }),
      ...(input.cohort !== undefined && { cohort: input.cohort }),
      // Sending a zone IS the student's choice, even if it equals the current one.
      ...(input.timezone !== undefined && { timezone: input.timezone, timezoneChosen: true }),
    };
    if (Object.keys(profileChanges).length > 0) {
      await tx.db
        .update(userProfiles)
        .set(profileChanges)
        .where(ownedBy(userProfiles.userId, tx.auth));
    }

    // The browser's zone is a first guess, never a choice. The conditional UPDATE repeats the rule
    // in SQL, so two tabs adopting at once, or an adoption racing a student's save, cannot
    // overwrite a zone the student just chose.
    const adopt =
      input.timezone === undefined
        ? detectedTimeZoneToAdopt(current.profile, input.detectedTimezone)
        : null;
    if (adopt) {
      await tx.db
        .update(userProfiles)
        .set({ timezone: adopt })
        .where(
          and(
            ownedBy(userProfiles.userId, tx.auth),
            eq(userProfiles.timezone, DEFAULT_TIME_ZONE),
            eq(userProfiles.timezoneChosen, false),
          ),
        );
    }
  });
  return getMe(c);
}
