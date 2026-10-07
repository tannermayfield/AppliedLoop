import { receiveGitHubWebhook } from "@/domain/integrations/github/webhooks";
import { webhookRoute } from "@/lib/api";

// GitHub → AppliedLoop, server to server. Authenticated by `X-Hub-Signature-256` over the raw body
// (checked by the domain function before anything else), never by a session: see `webhookRoute`.
// 200 = applied (or a duplicate delivery), 202 = acknowledged and ignored, 401 = bad signature.
export const POST = webhookRoute(async ({ s, req, rawBody }) => {
  const outcome = await receiveGitHubWebhook(s, {
    rawBody,
    signature: req.headers.get("x-hub-signature-256"),
    event: req.headers.get("x-github-event"),
    deliveryId: req.headers.get("x-github-delivery"),
  });
  return Response.json({ data: outcome }, { status: outcome.status === "ignored" ? 202 : 200 });
});
