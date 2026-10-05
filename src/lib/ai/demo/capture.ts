import { AiUnavailableError } from "../../errors";
import type { DemoHandler } from "./types";

// Slice "Capture & Today" replaces this stub with a keyword-based concept extractor.
export const demoCapture: DemoHandler = () => {
  throw new AiUnavailableError("Demo AI for concept capture is not implemented yet.");
};
