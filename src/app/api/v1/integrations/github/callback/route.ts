import { completeGitHubConnect, connectLocation } from "@/domain/integrations/github/connect";
import { apiRoute } from "@/lib/api";
import { seeOther } from "@/lib/http";

// GitHub's redirect after installing (the App's "Callback URL"). Always a 303: back into the app
// with `?github=<notice>`, or once more to GitHub when an authorization code is still needed.
export const GET = apiRoute(async ({ c, url }) =>
  seeOther(connectLocation(await completeGitHubConnect(c, Object.fromEntries(url.searchParams)))),
);
