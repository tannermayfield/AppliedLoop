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
// The ladder (SPEC §5): level 0 asks questions, level 1 gives a nudge, level 2 an explicit
// strategy, level 3 "pseudocode, structure, or small illustrative fragments". Code is not part of
// levels 0 and 1 at all, a strategy may carry a three-line illustration, and "small" at level 3 is
// the point: a complete, copy-paste answer to a practice challenge is 6 to 20 lines, so level 3
// stops at 6 per block and 9 in total (the first version allowed 15, which let a finished solution
// through; the journeys audit of 2026-10-06 proved it).
//
// Rules:
//   - A "block" is a fenced code block (``` or ~~~; an unclosed fence runs to the end), or a run
//     of 4+ consecutive code-looking lines outside fences (blank lines neither count nor break a
//     run). Shorter unfenced runs are ignored: prose quotes a line or two of code all the time.
//   - "Code-looking" covers statements and blocks in C-like languages, SQL in any letter case,
//     Python block openers, JSON/YAML keys, markup, and any indented line that is not a list item
//     (prose is not indented; code and config usually are). A line of prose that merely starts
//     with a SQL word ("From there, select only the rows you need.") is not code.
//   - Leak when one block has more non-blank lines than the level allows, or when all blocks
//     together exceed `totalCodeLinesAllowed(level)` (a solution split into pieces is still a
//     solution).
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
export const CODE_LINES_ALLOWED = [0, 0, 3, 6] as const;

/**
 * Lines of code allowed across ALL blocks of one reply: one block's allowance plus half again
 * (0→0, 3→5, 6→9). The Apply prompt states the same rule to the model, so keep them in step.
 */
export function totalCodeLinesAllowed(level: number): number {
  const allowed = CODE_LINES_ALLOWED[clampLevel(level)];
  return allowed + Math.ceil(allowed / 2);
}

const MIN_UNFENCED_RUN = 4;
const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const INDENTED = /^(?: {2,}|\t)\S/;
const CODE_LOOKING = [
  /[;{}]\s*$/, // ends like a statement or a block
  /^\s*[)}\]]+[;,)]*\s*$/, // nothing but closing brackets
  /^\s*(?:const|let|var|function|class|import|export|return|async|await|def|elif|public|private|static)\b/,
  /^\s*(?:if|for|while|switch|catch)\s*\(/,
  /^\s*(?:if|elif|else|for|while|try|except|finally|with|def|class)\b[^.?!]*:\s*$/, // Python openers
  /^\s*(?:SELECT|WITH|FROM|WHERE|JOIN|LEFT JOIN|INNER JOIN|GROUP BY|ORDER BY|HAVING|INSERT INTO|UPDATE|DELETE FROM|CREATE|ALTER|VALUES|UNION|LIMIT)\b/,
  /=>|===|!==|&&|\|\|/,
  /^\s*[\w.$[\]]+\s*[-+*/]?=\s*\S/, // assignment
  /^\s*[\w.$]+\([^)]*\)\s*;?\s*$/, // a bare call
  /^\s*<\/?[A-Za-z][\w.-]*(?:\s|>|\/>)/, // markup / JSX
  /^\s*"[^"\n]+"\s*:/, // a JSON key
  /^\s*[\w.-]+:\s*$/, // a YAML/config key that opens a block
];
// SQL typed in lower case reads like prose unless the line also has SQL structure.
const SQL_KEYWORD_LINE =
  /^\s*(?:select|with|from|where|join|left join|inner join|group by|order by|having|insert into|update|delete from|create|alter|values|union|limit)\b/i;
const SQL_STRUCTURE = /[(),*=<>]|\w\.\w|\b[a-z]+_[a-z_]+\b/;
const SENTENCE_END = /[.?!:]\s*$/;
// An indented list item that is really a YAML entry ("  - name: build"): lowercase key, then a value.
const YAML_LIST_ITEM = /^[a-z][\w.-]*:(?:\s|$)/;

export function looksLikeSolutionLeak({
  reply,
  hintLevel,
  forbiddenSubstrings = [],
}: LeakCheck): LeakVerdict {
  const level = clampLevel(hintLevel);
  const allowed = CODE_LINES_ALLOWED[level];
  const allowedTotal = totalCodeLinesAllowed(level);
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
  if (total > allowedTotal) {
    reasons.push(`${total} lines of code in total; hint level ${level} allows ${allowedTotal}.`);
  }

  const haystack = squash(reply);
  for (const snippet of forbiddenSubstrings) {
    if (snippet.trim() && haystack.includes(squash(snippet))) {
      reasons.push(`Contains a forbidden solution snippet: "${snippet}".`);
    }
  }
  return { leaked: reasons.length > 0, reasons };
}

function clampLevel(hintLevel: number): number {
  return Math.min(Math.max(Math.trunc(hintLevel) || 0, 0), CODE_LINES_ALLOWED.length - 1);
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
  if (CODE_LOOKING.some((pattern) => pattern.test(content))) return true;
  if (LIST_MARKER.test(line)) {
    // A list item is prose, except an indented one that is a YAML entry.
    return INDENTED.test(line) && YAML_LIST_ITEM.test(content);
  }
  if (INDENTED.test(line)) return true;
  return (
    SQL_KEYWORD_LINE.test(content) && SQL_STRUCTURE.test(content) && !SENTENCE_END.test(content)
  );
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
