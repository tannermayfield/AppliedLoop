import "server-only";
import { getEnv, type Env } from "../env";
import { GatewayAiProvider } from "./gateway";
import { DemoAiProvider, OffAiProvider } from "./demo";
import type { AiProvider } from "./types";

export function createAiProvider(env: Env): AiProvider {
  switch (env.aiMode) {
    case "live":
      return new GatewayAiProvider({
        models: env.aiModels,
        rateLimitPerHour: env.aiRateLimitPerHour,
      });
    case "demo":
      return new DemoAiProvider(env.aiRateLimitPerHour);
    case "off":
      return new OffAiProvider(env.aiRateLimitPerHour);
  }
}

const globalForAi = globalThis as unknown as { __appliedloopAi?: AiProvider };

/** The provider for this server process, chosen from the environment (AI_MODE). */
export function getAi(): AiProvider {
  globalForAi.__appliedloopAi ??= createAiProvider(getEnv());
  return globalForAi.__appliedloopAi;
}
