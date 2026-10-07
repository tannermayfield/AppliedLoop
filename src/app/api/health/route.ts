import { createHealthHandler } from "@/lib/health";

// Liveness and readiness for uptime monitors and for whoever just deployed: docs/API.md →
// "Operational endpoints", docs/RUNBOOK.md.
//
// PUBLIC on purpose, so it is NOT built with `apiRoute` (that requires a signed-in student) and it
// must stay outside any proxy/middleware that redirects signed-out visitors to /sign-in. It answers
// with coarse facts only: no secrets, no variable names, no user data.
//
// Node runtime (the default): the database driver needs it.
export const dynamic = "force-dynamic";

export const GET = createHealthHandler();
