import type { GitHubArtifactType } from "./db/schema/enums";
import type { GitHubConnectNotice } from "./integrations/github/types";

// Product wording for integrations (P1: GitHub). Part of the "all product wording lives in
// lib/copy*" rule (docs/ENGINEERING.md). Calm and specific: say what AppliedLoop can and cannot
// see, never alarm, never imply anything about what the student knows.

const NOT_CONFIGURED =
  "GitHub linking isn't set up on this deployment. You can still paste a repository URL and artifact links.";
const LINK_EXPIRED =
  "That GitHub connection link expired or was already used. Start again with Connect GitHub.";
const SUSPENDED =
  "GitHub has paused AppliedLoop's access (the app is suspended on GitHub). Your links and evidence are safe.";

/** Messages the domain layer puts in API errors (`details.reason` tells the UI which one). */
export const integrationErrors = {
  notConfigured: NOT_CONFIGURED,
  notConnected:
    "Connect GitHub first. Until then you can paste a repository URL and artifact links.",
  suspended: SUSPENDED,
  noRepository:
    "No GitHub repository is linked to this project yet. Choose one in the project's Repository section.",
  linkStale:
    "This repository link is from an earlier GitHub connection. Choose the repository again, or unlink it.",
  repositoryRemoved:
    "This repository is no longer shared with AppliedLoop on GitHub. Share it again on GitHub, or choose another one.",
  accessDenied:
    "GitHub didn't let AppliedLoop read this. Check the app's repository access on GitHub, then try again.",
  moved:
    "This repository seems to have been renamed or moved on GitHub. Choose it again in the project's Repository section.",
  rateLimited: "GitHub is limiting requests right now. Try again in a minute.",
  artifactStale:
    "That GitHub item can't be checked anymore because GitHub access changed. Pick it again, or paste the link instead.",
  artifactNotInProject:
    "That GitHub item comes from a repository that isn't linked to this project.",
  repoUrlLinked:
    "This project's repository is linked through GitHub. Unlink it in the Repository section to use a different address.",
  refCommit: "Use a commit sha of at least 7 characters.",
  refPullRequest: "Use a pull request number, such as 12.",
  refFile: "Use a path inside the repository, such as src/db/learner.ts.",
} as const;

/** The `?github=` notice after a trip through GitHub. */
export const CONNECT_NOTICE_COPY: Record<
  GitHubConnectNotice,
  { tone: "success" | "info" | "error"; message: string }
> = {
  connected: {
    tone: "success",
    message: "GitHub is connected. Choose a repository for your project.",
  },
  requested: {
    tone: "info",
    message:
      "Your request went to the organization's owners on GitHub. Connect again once they approve it.",
  },
  denied: { tone: "info", message: "GitHub connection cancelled. Nothing changed." },
  not_configured: { tone: "info", message: NOT_CONFIGURED },
  invalid_request: { tone: "error", message: LINK_EXPIRED },
  state_missing: { tone: "error", message: LINK_EXPIRED },
  state_invalid: { tone: "error", message: LINK_EXPIRED },
  state_expired: { tone: "error", message: LINK_EXPIRED },
  state_other_user: { tone: "error", message: LINK_EXPIRED },
  state_used: { tone: "error", message: LINK_EXPIRED },
  code_rejected: { tone: "error", message: LINK_EXPIRED },
  missing_installation: {
    tone: "error",
    message: "GitHub didn't say which installation to connect. Start again with Connect GitHub.",
  },
  not_accessible: {
    tone: "error",
    message:
      "That GitHub installation isn't available to your GitHub account, so it wasn't connected.",
  },
  already_connected: {
    tone: "error",
    message:
      "GitHub is already connected to another account. Disconnect it first, then connect the new one.",
  },
  github_unavailable: {
    tone: "error",
    message: "GitHub didn't answer just now. Nothing was changed; try Connect GitHub again.",
  },
};

export const githubCopy = {
  notConfigured: NOT_CONFIGURED,
  opensInNewTab: "(opens in a new tab)",
  connection: {
    heading: "GitHub",
    description:
      "Link a repository to a project, then pick commits, pull requests and files as evidence. AppliedLoop reads names, titles and links, never your code.",
    connect: "Connect GitHub",
    connectHint:
      "On GitHub you choose which repositories AppliedLoop may see. You can change that any time.",
    connectedAs: (login: string, type: string) =>
      type === "Organization"
        ? `Connected to the ${login} organization on GitHub`
        : `Connected to ${login} on GitHub`,
    suspended: SUSPENDED,
    disconnectedNote:
      "GitHub is disconnected. Evidence you saved keeps its links and your explanations.",
    manage: "Manage repository access on GitHub",
    disconnect: "Disconnect GitHub",
    disconnectTitle: "Disconnect GitHub?",
    disconnectBody:
      "AppliedLoop stops reading from GitHub right away. Your evidence keeps its links and your explanations; links that came from GitHub are marked as no longer checked. To remove the app from GitHub as well, uninstall it in your GitHub settings.",
    disconnecting: "Disconnecting…",
    disconnected: "GitHub is disconnected.",
    cancel: "Cancel",
  },
  repository: {
    heading: "Repository",
    description:
      "Link the GitHub repository this project lives in, then pick commits, pull requests and files as evidence.",
    notConnected:
      "Connect GitHub to link this project's repository. You can always paste the address instead.",
    none: "No repository linked yet.",
    choose: "Choose repository",
    change: "Change repository",
    private: "Private",
    public: "Public",
    openOnGitHub: "Open on GitHub",
    linked: (name: string) => `Linked ${name}.`,
    unlink: "Unlink",
    unlinkTitle: "Unlink this repository?",
    unlinkBody:
      "The project stops using this repository. Evidence you already saved keeps its links and your explanations.",
    unlinked: "Repository unlinked.",
    cancel: "Cancel",
    removed:
      "This repository is no longer shared with AppliedLoop on GitHub. Share it again on GitHub, or choose another one.",
    stale:
      "This link is from an earlier GitHub connection, so AppliedLoop can't check it. Connect GitHub and choose the repository again, or unlink it.",
    suspended: SUSPENDED,
    linkedHint:
      "Linked through GitHub. To use a different address, unlink it in the Repository section.",
  },
  repositoryPicker: {
    title: "Choose a repository",
    description: "These are the repositories you shared with AppliedLoop on GitHub.",
    loading: "Loading your repositories…",
    empty:
      "No repositories are shared with AppliedLoop yet. Choose some on GitHub, then come back.",
    manage: "Choose repositories on GitHub",
    link: "Link",
    linkLabel: (name: string) => `Link ${name} to this project`,
    linkedHere: "Linked here",
    linking: "Linking…",
  },
  artifactPicker: {
    open: "Pick from GitHub",
    from: (repository: string) => `From ${repository}`,
    title: "Pick from GitHub",
    description: (repository: string) =>
      `From ${repository}. AppliedLoop keeps only the link and its title, never the code.`,
    tabs: { COMMIT: "Commits", PR: "Pull requests", FILE: "File" } satisfies Record<
      Exclude<GitHubArtifactType, "RELEASE">,
      string
    >,
    filterLabel: { COMMIT: "Filter by message or sha", PR: "Filter by title or number" },
    fileLabel: "File path",
    filePlaceholder: "src/db/learner.ts",
    fileStart: "Type a path to find the file's latest version on the default branch.",
    find: "Find",
    loading: "Loading from GitHub…",
    empty: {
      COMMIT: "No recent commits match.",
      PR: "No pull requests match.",
      FILE: "No file at that path on the default branch.",
    },
    use: "Use this",
    useLabel: (title: string) => `Use ${title}`,
    picking: "Saving…",
    picked: (title: string) => `Picked from GitHub: ${title}`,
    prState: { open: "Open", closed: "Closed", merged: "Merged" },
  },
  evidence: {
    fromGitHub: (repository: string) => `Picked from GitHub · ${repository}`,
    stale:
      "GitHub access for this link has ended, so AppliedLoop can no longer check it. Your explanation is unchanged.",
  },
} as const;
