import type { ExtractionOutput, ExtractionPromptInput } from "../../../prompts/extraction/v1";
import type { DemoHandler } from "./types";

// Demo extraction: a deterministic keyword finder over the build summary and notes. It obeys the
// same rules as the real prompt: evidence only from the input (matching artifact refs, else the
// matched phrase itself), nothing about the student's understanding, at most 6 candidates, and no
// trivial syntax (the keyword list simply has none).

interface Keyword {
  name: string;
  category: string;
  pattern: RegExp;
  why: string;
  question: string;
}

const KEYWORDS: Keyword[] = [
  {
    name: "Database transactions",
    category: "Database",
    pattern: /\btransactions?\b|\batomic(ally)?\b/i,
    why: "Several related writes are grouped so they succeed or fail together.",
    question: "What failure case is the transaction preventing?",
  },
  {
    name: "Schema validation",
    category: "Validation",
    pattern: /\bvalidat(e|es|ed|ion)\b|\bzod\b|\bschemas?\b/i,
    why: "Input is checked against a schema before the app uses it.",
    question: "What happens to a request that fails validation?",
  },
  {
    name: "Authentication and sessions",
    category: "Security",
    pattern: /\bauth(entication|orization)?\b|\bjwt\b|\bsessions? cookies?\b|\boauth\b/i,
    why: "The change decides who a request comes from and what it may do.",
    question: "Where is the user's identity checked, and what happens if it is missing?",
  },
  {
    name: "Database migrations",
    category: "Database",
    pattern: /\bmigrations?\b|\bmigrate[ds]?\b/i,
    why: "The database schema changed in a versioned, repeatable way.",
    question: "How would this migration be rolled out to an existing database?",
  },
  {
    name: "Database indexes",
    category: "Database",
    pattern: /\bindex(es|ed)?\b|\bindices\b/i,
    why: "An index changes how quickly certain queries can find rows.",
    question: "Which query does this index speed up, and what does it cost on writes?",
  },
  {
    name: "Caching",
    category: "Performance",
    pattern: /\bcach(e|es|ed|ing)\b|\bredis\b|\bmemoiz/i,
    why: "Results are reused instead of recomputed, which adds an invalidation question.",
    question: "When does the cached value become stale, and what clears it?",
  },
  {
    name: "Middleware",
    category: "Architecture",
    pattern: /\bmiddleware\b|\binterceptors?\b/i,
    why: "Logic now runs around every matching request rather than in one handler.",
    question: "Which requests pass through this middleware, and in what order?",
  },
  {
    name: "ORM queries",
    category: "Database",
    pattern: /\borm\b|\bdrizzle\b|\bprisma\b|\bsequelize\b|\btypeorm\b/i,
    why: "Database access goes through an ORM that generates the SQL.",
    question: "What SQL does this ORM call produce?",
  },
  {
    name: "API route handlers",
    category: "Architecture",
    pattern: /\bapi routes?\b|\broute handlers?\b|\bendpoints?\b|\brest api\b/i,
    why: "New HTTP endpoints define how clients talk to the server.",
    question: "What does this endpoint validate before calling the database?",
  },
  {
    name: "Environment variables and secrets",
    category: "Security",
    pattern: /\benv(ironment)? var(iable)?s?\b|\bsecrets?\b|\bapi keys?\b|\.env\b/i,
    why: "Configuration and credentials are read from the environment instead of the code.",
    question: "Where does this secret come from in production, and who can read it?",
  },
  {
    name: "Async/await and promises",
    category: "Language",
    pattern: /\basync\b|\bawait\b|\bpromises?\b/i,
    why: "The code waits on asynchronous work, which affects ordering and error flow.",
    question: "What happens if one of the awaited calls rejects?",
  },
  {
    name: "Error handling",
    category: "Reliability",
    pattern: /\berror handling\b|\btry\s*\/\s*catch\b|\bretr(y|ies)\b|\bfallbacks?\b/i,
    why: "Failure paths were added or changed.",
    question: "Which error does the user see when this fails?",
  },
  {
    name: "Test doubles and mocking",
    category: "Testing",
    pattern: /\bmock(s|ed|ing)?\b|\bstubs?\b|\bfixtures?\b|\bspies\b/i,
    why: "Tests replace real dependencies with controlled stand-ins.",
    question: "What does the mock hide that a real dependency would reveal?",
  },
  {
    name: "Background job queues",
    category: "Architecture",
    pattern: /\bqueues?\b|\bbackground jobs?\b|\bworkers?\b/i,
    why: "Work moved out of the request into a queue processed later.",
    question: "What happens to a job if the worker crashes halfway?",
  },
  {
    name: "Rate limiting",
    category: "Security",
    pattern: /\brate.?limit(s|ing|ed)?\b|\bthrottl(e|ing)\b/i,
    why: "Requests are capped per user or client over time.",
    question: "What does a client see when it hits the limit?",
  },
];

const MAX_CANDIDATES = 6;

export const demoExtraction: DemoHandler = (raw) => {
  const input = raw as ExtractionPromptInput;
  const text = `${input.summary}\n${input.notes}`;
  const candidates: ExtractionOutput["candidates"] = [];

  for (const keyword of KEYWORDS) {
    const match = text.match(keyword.pattern);
    if (!match) continue;
    const refs = input.artifactRefs
      .filter((ref) => keyword.pattern.test(ref.value))
      .map((ref) => ref.value);
    candidates.push({
      name: keyword.name,
      category: keyword.category,
      whyItMatters: keyword.why,
      evidence: refs.length > 0 ? refs : [match[0]],
      confidence: refs.length > 0 ? 0.8 : 0.6,
      selfAssessmentQuestion: keyword.question,
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return { candidates } satisfies ExtractionOutput;
};
