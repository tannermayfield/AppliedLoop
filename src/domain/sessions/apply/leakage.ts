// LEARNING CHECKPOINT 2: the solution-leak heuristic (SPEC_REVIEW R-05, IMPLEMENTATION_PLAN §7).
//
// Every tutor reply passes through this check before the student sees it. It is deliberately
// cheap and deterministic: count code, compare it with what the student's hint level allows, and
// look for fixture-defined "signature" snippets of a reference solution.
//
// The trade-off: a false positive only annoys the student (the tutor is asked to rewrite, then a
// safe fallback is shown); a false negative hands over the implementation and defeats the
// product. So when in doubt this errs toward "leaked". Thresholds are tuned with the eval
// fixtures (tests/ai-evals/apply), not by intuition.
//
// Rules:
//   - A "block" is a fenced code block (``` or ~~~; an unclosed fence runs to the end), or a run
//     of 4+ consecutive code-looking lines outside fences (blank lines neither count nor break a
//     run). Shorter unfenced runs are ignored: prose quotes a line or two of code all the time.
//   - Leak when one block has more non-blank lines than the level allows, or when all blocks
//     together exceed twice that (a solution split into small pieces is still a solution).
//   - Leak when any forbidden substring appears (case and whitespace are ignored).

export interface LeakCheck {
  reply: string;
  /** The SERVER-held hint level (sessions.hint_level), never the level the model claims. */
  hintLevel: number;
  /** Signature snippets of a reference solution (eval fixtures). */
  forbiddenSubstrings?: string[];
}

export interface LeakVerdict {
  leaked: boolean;
  reasons: string[];
}

/** Lines of code allowed in one block, by hint level (0 = nothing unlocked yet). */
export const CODE_LINES_ALLOWED = [3, 3, 8, 15] as const;

const MIN_UNFENCED_RUN = 4;
const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const CODE_LOOKING = [
  /[;{}]\s*$/, // ends like a statement or a block
  /^\s*[)}\]]+[;,)]*\s*$/, // nothing but closing brackets
  /^\s*(?:const|let|var|function|class|import|export|return|async|await|def|elif|public|private|static)\b/,
  /^\s*(?:if|for|while|switch|catch)\s*\(/,
  /^\s*(?:SELECT|WITH|FROM|WHERE|JOIN|LEFT JOIN|INNER JOIN|GROUP BY|ORDER BY|HAVING|INSERT INTO|UPDATE|DELETE FROM|CREATE|ALTER|VALUES|UNION|LIMIT)\b/,
  /=>|===|!==|&&|\|\|/,
  /^\s*[\w.$[\]]+\s*[-+*/]?=\s*\S/, // assignment
  /^\s*[\w.$]+\([^)]*\)\s*;?\s*$/, // a bare call
  /^\s*<\/?[A-Za-z][\w.-]*(?:\s|>|\/>)/, // markup / JSX
];

export function looksLikeSolutionLeak({
  reply,
  hintLevel,
  forbiddenSubstrings = [],
}: LeakCheck): LeakVerdict {
  const level = Math.min(Math.max(Math.trunc(hintLevel) || 0, 0), CODE_LINES_ALLOWED.length - 1);
  const allowed = CODE_LINES_ALLOWED[level];
  const reasons: string[] = [];

  const { fenced, unfenced } = codeBlocks(reply);
  for (const lines of fenced.filter((size) => size > allowed)) {
    reasons.push(`A code block has ${lines} lines; hint level ${level} allows ${allowed}.`);
  }
  for (const lines of unfenced.filter((size) => size > allowed)) {
    reasons.push(
      `${lines} code-like lines in a row outside a code block; hint level ${level} allows ${allowed}.`,
    );
  }
  const total = [...fenced, ...unfenced].reduce((sum, size) => sum + size, 0);
  if (total > allowed * 2) {
    reasons.push(`${total} lines of code in total; hint level ${level} allows ${allowed * 2}.`);
  }

  const haystack = squash(reply);
  for (const snippet of forbiddenSubstrings) {
    if (snippet.trim() && haystack.includes(squash(snippet))) {
      reasons.push(`Contains a forbidden solution snippet: "${snippet}".`);
    }
  }
  return { leaked: reasons.length > 0, reasons };
}

/** Sizes (non-blank lines) of fenced blocks and of long code-looking runs outside fences. */
function codeBlocks(text: string): { fenced: number[]; unfenced: number[] } {
  const fenced: number[] = [];
  const unfenced: number[] = [];
  let inFence = false;
  let fenceSize = 0;
  let run = 0;
  const endRun = () => {
    if (run >= MIN_UNFENCED_RUN) unfenced.push(run);
    run = 0;
  };

  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      if (inFence) fenced.push(fenceSize);
      else endRun();
      inFence = !inFence;
      fenceSize = 0;
    } else if (inFence) {
      if (line.trim()) fenceSize += 1;
    } else if (!line.trim()) {
      continue;
    } else if (isCodeLooking(line)) {
      run += 1;
    } else {
      endRun();
    }
  }
  if (inFence) fenced.push(fenceSize);
  endRun();
  return { fenced, unfenced };
}

function isCodeLooking(line: string): boolean {
  const content = line.replace(LIST_MARKER, "");
  return CODE_LOOKING.some((pattern) => pattern.test(content));
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
