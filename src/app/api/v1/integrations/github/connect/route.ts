import { connectLocation, startGitHubConnect } from "@/domain/integrations/github/connect";
import { apiRoute } from "@/lib/api";
import { seeOther } from "@/lib/http";

// A browser navigation (plain link, never prefetched): 303 to GitHub's install page with a signed
// state, or back to `returnTo` with `?github=not_configured`.
export const GET = apiRoute(async ({ c, url }) =>
  seeOther(
    connectLocation(
      await startGitHubConnect(c, { returnTo: url.searchParams.get("returnTo") ?? undefined }),
    ),
  ),
);
