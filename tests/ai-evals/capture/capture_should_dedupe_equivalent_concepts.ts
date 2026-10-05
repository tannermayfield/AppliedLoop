import { CAPTURE_PROMPT_VERSION } from "@/prompts/capture/v1";
import { KNOWN_SKILLS, type CaptureFixture } from "./shared";

// AT-03: the same concept written three ways is ONE candidate, and distinct concepts stay distinct.

const category = "capture_should_dedupe_equivalent_concepts";
const promptVersion = CAPTURE_PROMPT_VERSION;

const fixtures: CaptureFixture[] = [
  {
    category,
    name: "an abbreviation, its plural and its full name",
    promptVersion,
    input: {
      text: "Notes from IS 402: CTE basics. CTEs make long queries readable, and common table expressions can also be recursive.",
      source: { title: "IS 402 — Database Development", code: "IS 402" },
      knownSkills: KNOWN_SKILLS,
    },
    expect: {
      matching: [{ pattern: /cte|common table/i, exactly: 1 }],
      count: { min: 1, max: 2 },
      groundedInText: true,
    },
  },
  {
    category,
    name: "REST and RESTful APIs",
    promptVersion,
    input: {
      text: "We learned REST today, and then how to design RESTful APIs with resources and verbs.",
      source: null,
      knownSkills: KNOWN_SKILLS,
    },
    expect: {
      matching: [{ pattern: /rest/i, exactly: 1 }],
      groundedInText: true,
    },
  },
  {
    category,
    name: "a concept repeated in two sentences",
    promptVersion,
    input: {
      text: "We covered window functions. Window functions let you rank rows without collapsing them.",
      source: null,
      knownSkills: KNOWN_SKILLS,
    },
    expect: {
      matching: [{ pattern: /window function/i, exactly: 1 }],
      count: { min: 1, max: 2 },
    },
  },
  {
    category,
    name: "distinct concepts are not merged (spec example)",
    promptVersion,
    input: {
      text: "Today in IS 403 we covered map, filter, and reduce...",
      source: { title: "IS 403 — Front-end Development", code: "IS 403" },
      knownSkills: KNOWN_SKILLS,
    },
    expect: {
      count: { min: 3, max: 3 },
      mustInclude: [/map/i, /filter/i, /reduce/i],
      groundedInText: true,
    },
  },
];

export default fixtures;
