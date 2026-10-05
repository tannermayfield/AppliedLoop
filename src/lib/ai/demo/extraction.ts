import { AiUnavailableError } from "../../errors";
import type { DemoHandler } from "./types";

// Slice "Build & Extract" replaces this stub with a keyword-based candidate finder.
export const demoExtraction: DemoHandler = () => {
  throw new AiUnavailableError("Demo AI for extraction is not implemented yet.");
};
