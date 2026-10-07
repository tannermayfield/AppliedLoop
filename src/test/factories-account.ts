import { eq } from "drizzle-orm";
import {
  aiRuns,
  authAccounts,
  authSessions,
  authVerifications,
  eventLog,
  githubConnectStates,
  skills,
  userProfiles,
} from "../lib/db/schema";
import type { TestApp, TestUser } from "./app";
import {
  insertConcept,
  insertProject,
  insertSession,
  insertSkill,
  insertSource,
} from "./factories";
import { insertEvidence } from "./factories-evidence";
import {
  insertGitHubArtifact,
  insertGitHubRepository,
  insertIntegration,
  linkProjectRepository,
} from "./factories-github";
import { insertDebt, insertExtraction, insertExtractionItem } from "./factories-extraction";
import { insertProgressEvent } from "./factories-learning";
import {
  insertContextSnapshot,
  insertMessage,
  insertOpportunity,
  linkConceptSkill,
  linkProjectSkill,
} from "./factories-sessions";

// A student with at least one row in EVERY user-owned table, built from raw inserts so the account
// deletion, data export and privacy tests do not depend on any one slice's domain code. Text
// fields carry a `marker` unique to the student, and the Better Auth rows carry obvious secrets, so
// a test can prove what is (and is not) present in an export or left behind after a deletion.

export interface RichAccount {
  user: TestUser;
  /** Appears in this student's text fields. Another student's export must never contain it. */
  marker: string;
  /** Values that must NEVER appear in an export. */
  secrets: {
    sessionToken: string;
    ipAddress: string;
    accessToken: string;
    refreshToken: string;
    idToken: string;
    passwordHash: string;
    resetToken: string;
    emailVerificationValue: string;
    promptHash: string;
  };
  ids: {
    source: string;
    customSkill: string;
    sharedSkill: string;
    conceptA: string;
    conceptB: string;
    project: string;
    applySession: string;
    buildSession: string;
    evidence: string;
    extraction: string;
    extractionItem: string;
    debt: string;
    integration: string;
    repository: string;
    githubArtifact: string;
  };
}

export async function insertRichAccount(app: TestApp, user: TestUser): Promise<RichAccount> {
  const db = app.db;
  await app.seedSkills();
  const marker = `MARK-${user.id.slice(0, 8)}`;
  const secrets = {
    sessionToken: `SECRET-session-token-${marker}`,
    ipAddress: "203.0.113.77",
    accessToken: `SECRET-access-token-${marker}`,
    refreshToken: `SECRET-refresh-token-${marker}`,
    idToken: `SECRET-id-token-${marker}`,
    passwordHash: `SECRET-password-hash-${marker}`,
    resetToken: `reset-password:SECRET-reset-${marker}`,
    emailVerificationValue: `SECRET-verification-value-${marker}`,
    promptHash: `0123abcd${user.id.replace(/-/g, "")}`.slice(0, 64).padEnd(64, "0"),
  };
  const inOneHour = new Date(app.clock.now().getTime() + 60 * 60 * 1000);

  // Identity: profile, plus the three Better Auth tables that hold secrets.
  await db
    .update(userProfiles)
    .set({
      program: `Program ${marker}`,
      cohort: `Cohort ${marker}`,
      timezone: "America/Denver",
      onboardingCompleted: true,
      preferencesJson: { note: `prefs ${marker}` },
    })
    .where(eq(userProfiles.userId, user.id));
  await db.insert(authSessions).values({
    userId: user.id,
    token: secrets.sessionToken,
    expiresAt: inOneHour,
    ipAddress: secrets.ipAddress,
    userAgent: `Agent ${marker}`,
  });
  await db.insert(authAccounts).values({
    userId: user.id,
    accountId: `acct-${marker}`,
    providerId: "github",
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    idToken: secrets.idToken,
    password: secrets.passwordHash,
    scope: "read:user",
  });
  await db.insert(authVerifications).values([
    // `reset-password:<token>` rows carry the user id as their value.
    { identifier: secrets.resetToken, value: user.id, expiresAt: inOneHour },
    // Some flows key a token by the email address.
    { identifier: user.email, value: secrets.emailVerificationValue, expiresAt: inOneHour },
  ]);

  // Learning: a source, one custom skill and one shared skill, two concepts with progress history.
  const source = await insertSource(db, user.id, { title: `Course ${marker}` });
  const customSkill = await insertSkill(db, {
    name: `Custom skill ${marker}`,
    ownerUserId: user.id,
  });
  const [sharedSkill] = await db.select().from(skills).where(eq(skills.slug, "sql"));
  const conceptA = await insertConcept(db, user.id, {
    name: `CTEs ${marker}`,
    description: `About CTEs ${marker}`,
    notes: `Notes ${marker}`,
    learningSourceId: source.id,
  });
  const conceptB = await insertConcept(db, user.id, { name: `Joins ${marker}`, stage: "EXPOSED" });
  await linkConceptSkill(db, conceptA.id, sharedSkill.id);
  await linkConceptSkill(db, conceptA.id, customSkill.id);
  await insertProgressEvent(db, user.id, conceptA.id, { reason: `Moved ${marker}` });

  // A project with skills and two versions of its context.
  const project = await insertProject(db, user.id, { name: `Project ${marker}` });
  await linkProjectSkill(db, project.id, sharedSkill.id);
  await linkProjectSkill(db, project.id, customSkill.id);
  await insertContextSnapshot(db, user.id, project.id, {
    version: 1,
    summary: `Context v1 ${marker}`,
  });
  await insertContextSnapshot(db, user.id, project.id, {
    version: 2,
    summary: `Context v2 ${marker}`,
    architecture: `Architecture ${marker}`,
  });

  // An Apply session (challenge, thread, an AI run) and a Build session with an extraction.
  const opportunity = await insertOpportunity(db, user.id, conceptA.id, project.id, {
    title: `Challenge ${marker}`,
    status: "SELECTED",
  });
  const applySession = await insertSession(db, user.id, project.id, {
    type: "APPLY",
    conceptId: conceptA.id,
    opportunityId: opportunity.id,
    hintLevel: 1,
    goal: `Apply goal ${marker}`,
    notes: `Apply notes ${marker}`,
  });
  await insertMessage(db, user.id, applySession.id, {
    role: "USER",
    content: `My attempt ${marker}`,
  });
  await insertMessage(db, user.id, applySession.id, {
    role: "ASSISTANT",
    content: `Tutor reply ${marker}`,
    metadataJson: { hintLevel: 1, nextQuestion: `Question ${marker}` },
  });
  await db.insert(aiRuns).values({
    userId: user.id,
    sessionId: applySession.id,
    purpose: "TUTOR",
    provider: "scripted",
    model: "scripted-tutor",
    promptVersion: "apply/v2",
    inputHash: secrets.promptHash,
    outputJson: { note: `Parsed answer ${marker}` },
    inputTokens: 10,
    outputTokens: 20,
    status: "SUCCEEDED",
  });

  const buildSession = await insertSession(db, user.id, project.id, {
    type: "BUILD",
    status: "COMPLETED",
    summary: `Build summary ${marker}`,
    goal: `Build goal ${marker}`,
  });
  const extraction = await insertExtraction(db, user.id, buildSession.id, {
    summary: `Extraction summary ${marker}`,
    artifactRefsJson: [{ type: "COMMIT", value: `abc123 ${marker}` }],
  });
  const extractionItem = await insertExtractionItem(db, user.id, extraction.id, {
    name: `Transactions ${marker}`,
  });
  const debt = await insertDebt(db, user.id, conceptB.id, {
    projectId: project.id,
    sourceSessionId: buildSession.id,
    extractionItemId: extractionItem.id,
    notes: `Debt notes ${marker}`,
  });

  // Evidence linked to a concept and to both kinds of skill.
  const evidence = await insertEvidence(db, user.id, project.id, {
    title: `Evidence ${marker}`,
    explanation: `Explanation ${marker}`,
    sessionId: applySession.id,
    conceptIds: [conceptA.id],
    skillIds: [sharedSkill.id, customSkill.id],
  });

  // GitHub (P1): a connection, a repository linked to the project, a picked commit, a connect state.
  // Metadata only: no token or repository content exists to store.
  const integration = await insertIntegration(db, user.id, {
    externalAccountLogin: `octo-${marker}`.toLowerCase(),
    installationId: 7_000_000 + Math.floor(Math.random() * 1_000_000),
  });
  const repository = await insertGitHubRepository(db, user.id, integration.id, {
    fullName: `octo-${marker}/adaptive-language`.toLowerCase(),
    externalRepoId: 8_000_000 + Math.floor(Math.random() * 1_000_000),
  });
  await linkProjectRepository(db, project.id, repository);
  const githubArtifact = await insertGitHubArtifact(db, user.id, repository.id, {
    title: `Commit ${marker}`,
  });
  await db.insert(githubConnectStates).values({
    nonceHash: `nonce-${marker}`,
    userId: user.id,
    expiresAt: inOneHour,
  });

  // Telemetry.
  await db.insert(eventLog).values([
    { userId: user.id, eventName: "today_viewed", metadataJson: { note: marker } },
    {
      userId: user.id,
      eventName: "apply_session_started",
      entityType: "session",
      entityId: applySession.id,
      metadataJson: { concept_stage_at_start: "LEARNED" },
    },
  ]);

  return {
    user,
    marker,
    secrets,
    ids: {
      source: source.id,
      customSkill: customSkill.id,
      sharedSkill: sharedSkill.id,
      conceptA: conceptA.id,
      conceptB: conceptB.id,
      project: project.id,
      applySession: applySession.id,
      buildSession: buildSession.id,
      evidence: evidence.id,
      extraction: extraction.id,
      extractionItem: extractionItem.id,
      debt: debt.id,
      integration: integration.id,
      repository: repository.id,
      githubArtifact: githubArtifact.id,
    },
  };
}
