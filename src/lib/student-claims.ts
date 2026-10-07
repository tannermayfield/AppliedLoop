// "Never claim to know what the student does or does not understand" (CLAUDE.md; SPEC §2 and the
// §5 guardrail matrix: "Infer student mastery: Never"). Text a model writes for the student is
// screened with this before it is shown or stored. It is a cheap backstop for the prompts, not a
// proof: it catches the common phrasings of a claim in either direction, and nothing else.
//
// What it does NOT flag, on purpose: questions ("Do you understand why this works?"),
// conditionals ("once you understand the shape, write it yourself"), recommendations ("you may
// need to review joins") and descriptions of what the student wrote or did ("you haven't run the
// query yet"). Those say nothing about the student's understanding.

const ADV =
  "(?:(?:probably|likely|clearly|obviously|still|just|simply|possibly|maybe|really|actually|yet|fully|quite|properly)\\s+)*";
const NEG =
  "(?:do not|don't|dont|did not|didn't|have not|haven't|never|can't|cannot|fail to|failed to|aren't|are not)";
const KNOW = "(?:understand|know|grasp|get it|get this|learn(?:ed|t)?|master(?:ed)?)";
const SUBJECT = "(?:the )?(?:student|user|learner)";

const patterns = (sources: string[]) => sources.map((source) => new RegExp(source, "i"));

/** Claims that the student lacks understanding, knowledge or skill. */
const DEFICIT_CLAIMS = patterns([
  `\\byou(?:'re| are)?\\s+${ADV}${NEG}\\s+${ADV}${KNOW}`, // you don't (yet) understand / haven't learned
  `\\byou\\s+(?:may|might|could|probably|likely)\\s+${ADV}(?:not|never)\\s+${ADV}(?:be\\s+(?:familiar|comfortable|aware)|${KNOW}|have\\s+learn(?:ed|t))`,
  `\\byou(?:'re| are)\\s+${ADV}(?:unfamiliar|confused|struggling|weak|new to|lost|behind|shaky|a beginner|a novice|not (?:familiar|comfortable|ready))`,
  `\\byou\\s+(?:struggle|have\\s+(?:trouble|difficulty|a hard time))\\b`,
  `\\byou(?:'re| are)\\s+having\\s+(?:trouble|difficulty|a hard time)`,
  `\\bunfamiliar to you\\b`,
  `\\b(?:this|that|it)(?: is|'s)?\\s+${ADV}new to you\\b`,
  `\\byou lack\\b`,
  `\\byour\\s+(?:lack of|gaps?|weakness(?:es)?|misunderstanding|confusion|unfamiliarity)\\b`,
  `\\bgap in your (?:knowledge|understanding)\\b`,
  `\\b${SUBJECT}\\s+${ADV}(?:does not|doesn't|did not|didn't|lacks?|may not|might not)\\s+(?:fully\\s+)?(?:understand|know)`,
  `\\b${SUBJECT}\\s+(?:is|seems|appears)\\s+${ADV}(?:confused|unfamiliar|struggling|weak|a beginner|a novice)`,
]);

/** Claims that the student has understood or mastered something (inferred from output). */
const MASTERY_CLAIMS = patterns([
  `\\byou(?:'ve| have)?\\s+(?:clearly|obviously|definitely|certainly|really|fully|now|already)\\s+(?:understand|know|get|grasp|mastered|learned)\\b`,
  `\\byou(?:'ve| have)\\s+(?:mastered|nailed it|got (?:it|this) down)\\b`,
  `\\byou(?:'ve| have)\\s+a\\s+(?:solid|good|firm|strong|clear|deep)\\s+(?:grasp|understanding|handle|command)\\b`,
  `\\byou(?:'re| are)\\s+(?:clearly |obviously |now |already )?(?:comfortable with|proficient|fluent|an expert|skilled|competent)\\b`,
  `\\b(?:shows|proves|demonstrates|means|suggests|indicates)\\s+(?:that\\s+)?you\\s+(?:understand|know|get|grasp)\\b`,
]);

export function claimsStudentLacksUnderstanding(text: string): boolean {
  return DEFICIT_CLAIMS.some((pattern) => pattern.test(text));
}

export function claimsStudentHasMastered(text: string): boolean {
  return MASTERY_CLAIMS.some((pattern) => pattern.test(text));
}

/** True when the text says, in either direction, what the student does or doesn't understand. */
export function claimsAboutStudent(text: string): boolean {
  return claimsStudentLacksUnderstanding(text) || claimsStudentHasMastered(text);
}
