import { getAuth } from "@/lib/auth/server";

// Better Auth's own endpoints (OAuth callbacks, sign-out, session). Everything else under
// /api/v1 uses `apiRoute`.
async function handler(request: Request): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(request);
}

export const GET = handler;
export const POST = handler;
