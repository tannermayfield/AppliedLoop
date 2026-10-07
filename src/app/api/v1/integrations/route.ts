import { getIntegrations } from "@/domain/integrations/github/integration";
import { apiRoute } from "@/lib/api";

// Connection status only (no tokens, ever). `{ github: { configured: false, connected: false } }`
// when the GitHub App is not set up on this deployment.
export const GET = apiRoute(async ({ c }) => getIntegrations(c));
