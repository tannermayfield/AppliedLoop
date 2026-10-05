# ADR-0003: AI provider and model configuration

- **Status:** Accepted, 2026-10-05 (owner chose the AI Gateway route; starting models are picked at T07)
- **Date:** 2026-10-05
- **Related:** SPEC §5 · ACCEPTANCE_TESTS (AI eval suite) · IMPLEMENTATION_PLAN T07

## Context

The spec leaves the AI provider and model UNSPECIFIED, recommends OpenAI initially, and requires the model ID to be configuration rather than hard-coded. There are four distinct AI tasks (Capture, Match/Recommend, Tutor, Extract), each needing its own prompt, schema, fixtures, model configuration and prompt version. Every output the application consumes must be schema-validated. The Apply guardrail is the product's keystone, and which model honors it best is an empirical question the eval suite should answer.

## Options considered

| Option | Notes |
|---|---|
| **Vercel AI SDK + AI Gateway** | One API key; models addressed as `"provider/model"` strings; swap OpenAI, Anthropic or others per task through environment config; structured output with Zod schemas |
| AI SDK + a direct provider key (OpenAI per the spec, or Anthropic) | Same code path with one provider and no gateway |
| Raw provider SDK (OpenAI Responses API) | Fewest abstractions; ties every call site to one vendor's API |

## Decision

Use the AI SDK through the **AI Gateway**, with the model chosen per task from environment variables — `AI_MODEL_CAPTURE`, `AI_MODEL_OPPORTUNITY`, `AI_MODEL_TUTOR`, `AI_MODEL_EXTRACTION` — validated at boot. A direct provider key remains a drop-in fallback because call sites don't change. **No model ID appears in application code.**

Rules for `lib/ai`:

1. Server-side only. Credentials never reach the browser.
2. One entry point, `runAi({ ctx, purpose, promptVersion, input, schema })`: build the prompt from the registry → call the provider → Zod-validate → write an `ai_runs` row (purpose, provider, model, prompt_version, input_hash, output_json, latency_ms, tokens, status) → return a typed result or a typed failure (`AiUnavailable`, `InvalidOutput`).
3. Prompts live in `src/prompts/<task>/vN.ts`. A prompt change bumps the version, and the eval fixtures must pass before release.
4. A `FakeProvider` (scripted or recorded outputs) backs unit, integration and E2E tests. Real-model evals run on demand (`pnpm eval`), not in default CI, because they cost money.
5. Per-user rate limit and provider spend alerts from day one (NFR "Cost control").
6. Callers degrade gracefully: capture falls back to manual entry; a tutor timeout leaves the session resumable.
7. Send only the context an operation needs. No whole-repository dumps.

## Consequences

- Models can be compared on identical fixtures and then assigned per task on evidence (leakage rate, extraction quality, cost).
- A gateway adds one hop and one account.
- Whichever provider ends up configured, its data-retention and training terms must be checked and disclosed to users (SPEC §6, AI data privacy).

## Open questions

- **Owner action before any live AI call (not before Day 1):** an AI Gateway key, which needs a Vercel account. Everything before T07's live smoke test runs on the fake provider.
- Starting model per task, decided at T07. The obvious first split is a stronger model for Tutor and Extraction and a cheaper one for Capture, then the eval report adjusts it.
