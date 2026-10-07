import { listAuthorizedRepositories } from "@/domain/integrations/github/repositories";
import { apiRoute } from "@/lib/api";
import { Paged } from "@/lib/http";

// The repositories the student's installation shares with the App, live from GitHub.
export const GET = apiRoute(async ({ c }) => new Paged(await listAuthorizedRepositories(c)));
