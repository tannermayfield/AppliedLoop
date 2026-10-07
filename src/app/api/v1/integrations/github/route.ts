import { disconnectGitHub } from "@/domain/integrations/github/integration";
import { apiRoute } from "@/lib/api";

// Disconnect: immediate, idempotent, and it never calls GitHub (AT-19).
export const DELETE = apiRoute(
  async ({ c }) => {
    await disconnectGitHub(c);
  },
  { status: 204 },
);
