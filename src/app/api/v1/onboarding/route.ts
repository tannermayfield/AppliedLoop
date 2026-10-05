import { completeOnboarding, completeOnboardingInput } from "@/domain/identity/onboarding";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// 201 when this call completed onboarding, 200 when it had already been completed (nothing is
// created a second time). `apiRoute` passes a Response through and adds the request id.
export const POST = apiRoute(async ({ c, req }) => {
  const result = await completeOnboarding(c, await parseBody(req, completeOnboardingInput));
  return Response.json({ data: result }, { status: result.alreadyCompleted ? 200 : 201 });
});
