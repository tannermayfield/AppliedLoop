import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./catalog";
import { githubArtifactTypeEnum, integrationProviderEnum, integrationStatusEnum } from "./enums";
import { users } from "./identity";

// P1: the GitHub integration (docs/SPEC.md §5 "GitHub" and §6). What is stored is METADATA ONLY:
// ids, names, titles, links and timestamps. No token, key or repository content is ever stored:
// the installation id is the "secret reference" from which short-lived installation tokens are
// minted on demand with the App's private key, which lives only in the server environment.
// Tables with a `user_id` are user-owned and every query filters on it (docs/DATA_MODEL.md).

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    /** GitHub: the id of the account (user or organization) the App is installed on. */
    externalAccountId: text("external_account_id").notNull(),
    externalAccountLogin: text("external_account_login").notNull(),
    /** GitHub's account type: "User" or "Organization". */
    externalAccountType: text("external_account_type").notNull(),
    /**
     * The data model's "secret reference": the GitHub App installation id. Installation tokens
     * (valid one hour) are minted from it per request and never stored.
     */
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    status: integrationStatusEnum("status").notNull().default("CONNECTED"),
    /** The permissions the installation granted, e.g. { "contents": "read" }. */
    scopesJson: jsonb("scopes_json").$type<Record<string, string>>().notNull().default({}),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("integrations_user_installation_uq").on(t.userId, t.provider, t.installationId),
    // One live connection per provider per student. Disconnected rows stay as history.
    uniqueIndex("integrations_one_live_per_provider_uq")
      .on(t.userId, t.provider)
      .where(sql`${t.status} <> 'DISCONNECTED'`),
    // Webhooks find integrations by installation id.
    index("integrations_installation_idx").on(t.provider, t.installationId),
  ],
);

/** A repository the student linked to a project (only those are mirrored, not every repo). */
export const githubRepositories = pgTable(
  "github_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    /** Denormalized so every read can be scoped by user without a join. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    externalRepoId: bigint("external_repo_id", { mode: "number" }).notNull(),
    /** "owner/name" as GitHub reports it. Plain text in the UI, never markup. */
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    isPrivate: boolean("private").notNull(),
    /** Always https://github.com/<owner>/<name> (validated before it is stored). */
    htmlUrl: text("html_url").notNull(),
    /** Set when the repository stops being shared with the installation (webhook). */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("github_repositories_integration_repo_uq").on(t.integrationId, t.externalRepoId),
    index("github_repositories_user_idx").on(t.userId),
  ],
);

/**
 * Join table, reached only through an ownership-checked project. v1 links at most one repository
 * per project (it keeps `projects.repo_url` coherent); a repository may serve several projects.
 */
export const projectRepositories = pgTable(
  "project_repositories",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.repositoryId] }),
    uniqueIndex("project_repositories_one_per_project_uq").on(t.projectId),
    index("project_repositories_repository_idx").on(t.repositoryId),
  ],
);

/** A commit, pull request or file the student picked as evidence. Metadata only. */
export const githubArtifacts = pgTable(
  "github_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: githubArtifactTypeEnum("type").notNull(),
    /** COMMIT: the sha · PR: the number · FILE: "<commit sha>:<path>" (one row per version). */
    externalId: text("external_id").notNull(),
    sha: text("sha"),
    /** A https://github.com/… permalink. */
    url: text("url").notNull(),
    /** Commit headline, pull-request title or file path. Never a body, a diff or file contents. */
    title: text("title").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    /**
     * Set when GitHub access ended (disconnect, uninstall, repository unshared). The link and the
     * student's explanation stay; the app just can no longer vouch for it.
     */
    staleAt: timestamp("stale_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("github_artifacts_repository_type_external_uq").on(
      t.repositoryId,
      t.type,
      t.externalId,
    ),
    index("github_artifacts_user_idx").on(t.userId),
  ],
);

/** Single-use, short-lived records behind the signed `state` of the connect flow. */
export const githubConnectStates = pgTable(
  "github_connect_states",
  {
    /** SHA-256 of the state's random nonce. The nonce itself is never stored. */
    nonceHash: text("nonce_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("github_connect_states_user_idx").on(t.userId)],
);

/**
 * Webhook deliveries already handled (`X-GitHub-Delivery`), so a redelivery is not applied twice.
 * System table: no user data, pruned after 30 days.
 */
export const githubWebhookDeliveries = pgTable(
  "github_webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    event: text("event").notNull(),
    action: text("action").notNull().default(""),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("github_webhook_deliveries_received_idx").on(t.receivedAt)],
);
