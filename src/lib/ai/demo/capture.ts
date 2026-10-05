import type { CaptureOutput, CapturePromptInput } from "../../../prompts/capture/v1";
import type { DemoHandler } from "./types";

// Demo concept extractor: a dictionary of common CS/IS terms plus a "learned / covered / about"
// fallback. Deterministic, no network. It obeys the same rules as the real prompt: only concepts
// that are in the text, one entry per concept, skills only from the student's list, never a stage
// beyond Learned, and a confidence that is about extraction, not about the student.

const MAX_CANDIDATES = 8;

export interface DemoTerm {
  /** The name offered to the student. Unique within the dictionary. */
  name: string;
  /** One neutral sentence about the concept. Never about the student. */
  description: string;
  /** Matches every way the text might refer to it. Must not use the `g` flag. */
  pattern: RegExp;
  /** A shared-catalog skill name, attached only if the student's skill list contains it. */
  skill?: string;
}

export const DEMO_TERMS: readonly DemoTerm[] = [
  // SQL and data
  {
    name: "Common Table Expressions",
    description: "Named temporary result sets that break a complex query into readable steps.",
    pattern: /\bctes?\b|\bcommon table expressions?\b/i,
    skill: "SQL",
  },
  {
    name: "Window functions",
    description: "Functions that compute over a set of related rows without collapsing them.",
    pattern: /\bwindow functions?\b/i,
    skill: "SQL",
  },
  {
    name: "Subqueries",
    description: "A query nested inside another query to supply values or rows.",
    pattern: /\bsub-?quer(?:y|ies)\b/i,
    skill: "SQL",
  },
  {
    name: "SQL joins",
    description: "Combining rows from two or more tables based on a related column.",
    pattern: /\bjoins?\b/i,
    skill: "SQL",
  },
  {
    name: "GROUP BY and aggregates",
    description: "Summarizing rows into groups with functions such as COUNT, SUM and AVG.",
    pattern: /\bgroup by\b|\baggregate functions?\b|\baggregat(?:e|es|ion)\b/i,
    skill: "SQL",
  },
  {
    name: "Database transactions",
    description: "A group of operations that succeed or fail together, keeping data consistent.",
    pattern: /\btransactions?\b|\bACID\b/i,
    skill: "Database Design",
  },
  {
    name: "Indexes",
    description: "Data structures that let a database find rows without scanning a whole table.",
    pattern: /\bindex(?:es|ing)?\b|\bindices\b/i,
    skill: "Query Optimization",
  },
  {
    name: "Database normalization",
    description: "Organizing tables to reduce duplication and keep related data consistent.",
    pattern: /\bnormali[sz]ation\b|\bnormal forms?\b/i,
    skill: "Database Design",
  },
  {
    name: "Foreign keys",
    description: "Columns that reference another table's key to enforce a relationship.",
    pattern: /\bforeign keys?\b/i,
    skill: "Database Design",
  },
  {
    name: "Primary keys",
    description: "The column or columns that uniquely identify each row in a table.",
    pattern: /\bprimary keys?\b/i,
    skill: "Database Design",
  },
  {
    name: "Entity-relationship diagrams",
    description: "Diagrams that show the entities in a system and how they relate.",
    pattern: /\b(?:er|erd|entity[- ]relationship) diagrams?\b|\berds?\b/i,
    skill: "Data Modeling",
  },
  {
    name: "ORMs",
    description: "Libraries that map database rows to objects in application code.",
    pattern: /\bORMs?\b|\b[Oo]bject[- ]relational mapp(?:er|ing)\b/,
    skill: "Database Design",
  },
  // JavaScript
  {
    name: "Array.map()",
    description: "Builds a new array by applying a function to every item of an array.",
    pattern: /(?<!hash[ -])\bmap\b/i,
    skill: "JavaScript",
  },
  {
    name: "Array.filter()",
    description: "Builds a new array containing only the items that pass a test function.",
    pattern: /\bfilter\b/i,
    skill: "JavaScript",
  },
  {
    name: "Array.reduce()",
    description: "Folds an array into a single value by running an accumulator function.",
    pattern: /\breduce\b/i,
    skill: "JavaScript",
  },
  {
    name: "Promises",
    description: "Objects that represent a value that will be available later.",
    pattern: /\bpromises?\b/i,
    skill: "JavaScript",
  },
  {
    name: "async/await",
    description: "Syntax for writing asynchronous code that reads like synchronous code.",
    pattern: /\basync\b|\bawait\b/i,
    skill: "JavaScript",
  },
  {
    name: "Closures",
    description: "Functions that keep access to the variables of the scope they were created in.",
    pattern: /\bclosures?\b/i,
    skill: "JavaScript",
  },
  {
    name: "Callbacks",
    description: "Functions passed to other code to be called later.",
    pattern: /\bcall-?backs?\b/i,
    skill: "JavaScript",
  },
  {
    name: "Destructuring",
    description: "Unpacking values from arrays or objects into separate variables.",
    pattern: /\bdestructur(?:e|ing)\b/i,
    skill: "JavaScript",
  },
  {
    name: "Spread and rest operators",
    description: "The ... syntax for expanding or collecting values in arrays, objects and calls.",
    pattern: /\bspread (?:operator|syntax)\b|\brest (?:operator|parameters?)\b/i,
    skill: "JavaScript",
  },
  {
    name: "The event loop",
    description: "How JavaScript schedules asynchronous work on a single thread.",
    pattern: /\bevent loop\b/i,
    skill: "JavaScript",
  },
  {
    name: "The DOM",
    description: "The browser's tree of objects that represents a web page.",
    pattern: /\bDOM\b/,
    skill: "JavaScript",
  },
  {
    name: "Recursion",
    description: "A function that solves a problem by calling itself on smaller versions of it.",
    pattern: /\brecurs(?:ion|ive|ively)\b/i,
  },
  // Web
  {
    name: "REST APIs",
    description: "An HTTP API style built around resources, URLs and standard methods.",
    pattern: /\bREST(?:ful)?\b|\brestful\b/,
    skill: "API Design",
  },
  {
    name: "HTTP methods and status codes",
    description: "The verbs and numeric results that clients and servers use to talk over HTTP.",
    pattern: /\bhttp (?:methods?|verbs?|status codes?)\b|\bstatus codes?\b/i,
    skill: "API Design",
  },
  {
    name: "GraphQL",
    description: "A query language where the client asks for exactly the fields it needs.",
    pattern: /\bgraphql\b/i,
    skill: "API Design",
  },
  {
    name: "Webhooks",
    description: "HTTP callbacks that one service sends to another when an event happens.",
    pattern: /\bweb-?hooks?\b/i,
    skill: "API Design",
  },
  {
    name: "CORS",
    description: "Browser rules about which origins may call a server from a web page.",
    pattern: /\bCORS\b|\bcross-origin\b/i,
    skill: "Security",
  },
  {
    name: "JSON Web Tokens (JWT)",
    description: "Signed tokens that carry claims about a user between a client and a server.",
    pattern: /\bjwts?\b|\bjson web tokens?\b/i,
    skill: "Authentication & Authorization",
  },
  {
    name: "OAuth",
    description: "A standard for letting an app act on a user's behalf without their password.",
    pattern: /\boauth\b/i,
    skill: "Authentication & Authorization",
  },
  {
    name: "Sessions and cookies",
    description: "How a server remembers who a browser is between requests.",
    pattern: /\bcookies?\b|\bsession (?:ids?|cookies?|storage)\b/i,
    skill: "Authentication & Authorization",
  },
  {
    name: "Password hashing",
    description: "Storing a one-way hash of a password instead of the password itself.",
    pattern: /\bpassword hash(?:ing|es)?\b|\bbcrypt\b|\bsalting\b/i,
    skill: "Security",
  },
  {
    name: "Middleware",
    description: "Functions that run between receiving a request and sending the response.",
    pattern: /\bmiddleware\b/i,
    skill: "Node.js",
  },
  {
    name: "React hooks",
    description:
      "Functions such as useState and useEffect that add state and effects to components.",
    pattern:
      /\b[Rr]eact hooks?\b|\buse(?:State|Effect|Memo|Callback|Ref|Context|Reducer)\b|\bhooks\b/,
    skill: "React",
  },
  {
    name: "React components and props",
    description: "Reusable pieces of UI that receive data through props.",
    pattern: /\bprops\b|\breact components?\b/i,
    skill: "React",
  },
  {
    name: "Server components",
    description: "Components that render on the server and send finished HTML to the browser.",
    pattern: /\bserver components?\b/i,
    skill: "Next.js",
  },
  // Security
  {
    name: "SQL injection",
    description: "An attack that smuggles SQL into a query through unvalidated input.",
    pattern: /\bsql injection\b/i,
    skill: "Security",
  },
  {
    name: "Cross-site scripting (XSS)",
    description: "An attack that runs a script in other users' browsers through unescaped content.",
    pattern: /\bxss\b|\bcross-site scripting\b/i,
    skill: "Security",
  },
  {
    name: "Encryption",
    description: "Turning data into a form that only holders of a key can read.",
    pattern: /\bencrypt(?:ion|ed|ing)?\b/i,
    skill: "Security",
  },
  // Practices and tooling
  {
    name: "Unit testing",
    description: "Testing a small piece of code in isolation from the rest of the system.",
    pattern: /\bunit tests?\b|\bunit testing\b/i,
    skill: "Testing",
  },
  {
    name: "Mocking",
    description: "Replacing a real dependency with a stand-in so a test controls its behavior.",
    pattern: /\bmock(?:s|ing|ed)?\b|\bstubs?\b/i,
    skill: "Testing",
  },
  {
    name: "Test-driven development",
    description: "Writing a failing test first, then the code that makes it pass.",
    pattern: /\btdd\b|\btest[- ]driven\b/i,
    skill: "Testing",
  },
  {
    name: "Git branching",
    description: "Working on a separate line of commits and bringing it back later.",
    pattern: /\bbranch(?:es|ing)\b|\bgit branch\b/i,
    skill: "Git",
  },
  {
    name: "Merge conflicts",
    description: "Overlapping changes that Git cannot combine on its own.",
    pattern: /\bmerge conflicts?\b/i,
    skill: "Git",
  },
  {
    name: "Pull requests",
    description: "A proposal to merge a branch, reviewed by others before it lands.",
    pattern: /\bpull requests?\b|\bPRs?\b/,
    skill: "Code Review",
  },
  {
    name: "CI/CD",
    description: "Automatically building, testing and deploying code on every change.",
    pattern: /\bci\/cd\b|\bcontinuous (?:integration|delivery|deployment)\b/i,
    skill: "CI/CD",
  },
  {
    name: "Docker containers",
    description: "Packaging an app with its dependencies so it runs the same everywhere.",
    pattern: /\bdocker(?:file)?\b|\bcontainer(?:s|ization|ized)\b/i,
    skill: "Docker",
  },
  {
    name: "Debugging",
    description: "Finding and fixing the cause of unexpected behavior in code.",
    pattern: /\bdebugg(?:er|ing)\b|\bbreakpoints?\b/i,
    skill: "Debugging",
  },
  {
    name: "Regular expressions",
    description: "Patterns for matching and extracting text.",
    pattern: /\bregex(?:es)?\b|\bregular expressions?\b/i,
  },
  // Computer science
  {
    name: "Big O notation",
    description: "A way to describe how an algorithm's cost grows with the size of its input.",
    pattern: /\bbig[- ]o\b|\btime complexity\b/i,
  },
  {
    name: "Hash maps",
    description: "Key-value structures that find a value by hashing its key.",
    pattern: /\bhash ?(?:maps?|tables?)\b|\bdictionar(?:y|ies)\b/i,
  },
  {
    name: "Linked lists",
    description: "Sequences of nodes where each node points to the next one.",
    pattern: /\blinked lists?\b/i,
  },
  {
    name: "Stacks and queues",
    description: "Collections that remove items last-in-first-out or first-in-first-out.",
    pattern: /\bqueues?\b|\bLIFO\b|\bFIFO\b|\bstacks? (?:data structure|and queues?)\b/i,
  },
  {
    name: "Binary search",
    description: "Finding an item in sorted data by repeatedly halving the search range.",
    pattern: /\bbinary search\b/i,
  },
  {
    name: "Sorting algorithms",
    description: "Procedures that put items in order, such as quicksort and merge sort.",
    pattern: /\bsorting\b|\bquick ?sort\b|\bmerge sort\b|\bbubble sort\b/i,
  },
  {
    name: "Object-oriented programming",
    description: "Organizing code around objects that combine data and behavior.",
    pattern: /\bobject[- ]oriented\b|\boop\b|\binheritance\b|\bpolymorphism\b/i,
  },
  // Process and design
  {
    name: "Agile and Scrum",
    description: "Iterative ways of working in short cycles with regular review.",
    pattern: /\bagile\b|\bscrum\b|\bsprints?\b/i,
    skill: "Agile",
  },
  {
    name: "User stories",
    description:
      "Short descriptions of a feature from the point of view of the person who wants it.",
    pattern: /\buser stor(?:y|ies)\b/i,
    skill: "Requirements Analysis",
  },
  {
    name: "Use cases",
    description: "Descriptions of how an actor interacts with a system to reach a goal.",
    pattern: /\buse cases?\b/i,
    skill: "Systems Analysis & Design",
  },
  {
    name: "UML diagrams",
    description: "Standard diagrams for modeling the structure and behavior of software.",
    pattern: /\buml\b|\bclass diagrams?\b|\bsequence diagrams?\b/i,
    skill: "Systems Analysis & Design",
  },
  {
    name: "Wireframing",
    description: "Sketching the layout of a screen before designing or building it.",
    pattern: /\bwireframes?\b|\bwireframing\b/i,
    skill: "UX Design",
  },
  {
    name: "Prompt engineering",
    description: "Writing instructions and examples that steer a language model's output.",
    pattern: /\bprompt engineering\b|\bprompting\b/i,
    skill: "Prompt Engineering",
  },
  {
    name: "Embeddings",
    description: "Vectors that capture meaning so similar text lands close together.",
    pattern: /\bembeddings?\b/i,
    skill: "AI Engineering",
  },
  {
    name: "Retrieval-augmented generation",
    description: "Giving a model relevant documents to read before it answers.",
    pattern: /\brag\b|\bretrieval[- ]augmented\b/i,
    skill: "AI Engineering",
  },
];

/** Words that say the student only encountered a concept; "learned" language wins over them. */
const EXPOSED_WORDS =
  /\b(?:saw|seen|heard|shown|showed|introduced|exposed|briefly|skimmed|mentioned|glimpse|touched on|demo(?:ed|nstrated)?)\b/i;
const LEARNED_WORDS = /\b(?:learn(?:ed|t)?|cover(?:ed)?|studied|practiced|practised|understand)\b/i;

/** Phrases the fallback treats as "the student is naming what they learned". */
const LEAD_IN =
  /\b(?:learned|learnt|covered|studied|reviewed|went over|introduced to|about)\b\s*(?:about\s+)?([^.;!?\n]+)/gi;

const STOP_PIECES = new Set([
  "it",
  "this",
  "that",
  "things",
  "stuff",
  "everything",
  "anything",
  "something",
  "a lot",
  "a few things",
  "more",
  "lots",
  "today",
]);

interface Match {
  index: number;
  term: DemoTerm;
}

export const demoCapture: DemoHandler = (raw): CaptureOutput => {
  const input = raw as CapturePromptInput;
  const text = input.text;

  const found = findTerms(text);
  const candidates =
    found.length > 0
      ? found.map(({ index, term }) => ({
          name: term.name,
          description: term.description,
          suggestedSkillNames: skillNames(term.skill, input.knownSkills),
          suggestedStage: stageAt(text, index),
          confidence: 0.9,
        }))
      : fallbackPhrases(text).map(({ index, phrase }) => ({
          name: phrase,
          description: `A topic from your notes: ${phrase.toLowerCase()}.`,
          suggestedSkillNames: [],
          suggestedStage: stageAt(text, index),
          confidence: 0.5,
        }));

  return { candidates: candidates.slice(0, MAX_CANDIDATES) };
};

function findTerms(text: string): Match[] {
  const matches: Match[] = [];
  for (const term of DEMO_TERMS) {
    const hit = text.match(term.pattern);
    if (hit?.index !== undefined) matches.push({ index: hit.index, term });
  }
  return matches.sort((a, b) => a.index - b.index || a.term.name.localeCompare(b.term.name));
}

function skillNames(skill: string | undefined, known: CapturePromptInput["knownSkills"]): string[] {
  if (!skill) return [];
  const match = known.find((candidate) => candidate.name.toLowerCase() === skill.toLowerCase());
  return match ? [match.name] : [];
}

/** The sentence around `index` decides the stage: "only shown" is Exposed, otherwise Learned. */
function stageAt(text: string, index: number): "EXPOSED" | "LEARNED" {
  const before = text.slice(0, index);
  const start = Math.max(
    before.lastIndexOf(". "),
    before.lastIndexOf("! "),
    before.lastIndexOf("? "),
    before.lastIndexOf("\n"),
  );
  const end = text.slice(index).search(/[.!?]+(?:\s|$)|\n/);
  const sentence = text.slice(start + 1, end === -1 ? text.length : index + end);
  return EXPOSED_WORDS.test(sentence) && !LEARNED_WORDS.test(sentence) ? "EXPOSED" : "LEARNED";
}

function fallbackPhrases(text: string): { index: number; phrase: string }[] {
  const seen = new Set<string>();
  const phrases: { index: number; phrase: string }[] = [];
  for (const lead of text.matchAll(LEAD_IN)) {
    const tail = lead[1] ?? "";
    const tailStart = (lead.index ?? 0) + lead[0].length - tail.length;
    for (const piece of tail.split(/,|\band\b|&|\bplus\b/i)) {
      const phrase = clean(piece);
      const key = phrase.toLowerCase();
      if (!phrase || seen.has(key)) continue;
      seen.add(key);
      phrases.push({ index: tailStart, phrase });
    }
  }
  return phrases;
}

function clean(piece: string): string {
  const trimmed = piece
    .replace(/\.{2,}|…/g, " ")
    .replace(/^\s*(?:how to|how|the|a|an|some|our|about|what)\s+/i, "")
    .replace(/[^\p{L}\p{N}\s+#.()/'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = trimmed.split(" ");
  if (trimmed.length < 3 || words.length > 6 || STOP_PIECES.has(trimmed.toLowerCase())) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
