import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/errors";

/**
 * For server pages: turns the domain's NOT_FOUND (also what someone else's id produces) into the
 * framework's 404 page. Anything else is a real error and keeps propagating.
 */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
