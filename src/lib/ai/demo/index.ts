import { AiUnavailableError } from "../../errors";
import type { AiProvider, AiPurpose, ModelRequest, ModelResponse } from "../types";
import { demoCapture } from "./capture";
import { demoExtraction } from "./extraction";
import { demoOpportunity } from "./opportunity";
import { demoTutor } from "./tutor";
import type { DemoHandler } from "./types";

export const DEMO_HANDLERS: Record<AiPurpose, DemoHandler> = {
  CAPTURE: demoCapture,
  OPPORTUNITY: demoOpportunity,
  TUTOR: demoTutor,
  EXTRACTION: demoExtraction,
};

/** Demo mode: canned, deterministic answers. No network, no key, clearly labelled in the UI. */
export class DemoAiProvider implements AiProvider {
  readonly mode = "demo" as const;
  readonly name = "demo";

  constructor(
    readonly rateLimitPerHour: number,
    private readonly handlers: Record<AiPurpose, DemoHandler> = DEMO_HANDLERS,
  ) {}

  modelFor(): string {
    return "demo";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    return { object: this.handlers[request.purpose](request.input, request), usage: {} };
  }
}

/** Off mode: every AI step reports "unavailable" so the manual flows are used. */
export class OffAiProvider implements AiProvider {
  readonly mode = "off" as const;
  readonly name = "off";

  constructor(readonly rateLimitPerHour: number) {}

  modelFor(): string {
    throw new AiUnavailableError(
      "AI is turned off for this deployment. You can do this step manually.",
    );
  }

  async generate(): Promise<ModelResponse> {
    throw new AiUnavailableError();
  }
}
