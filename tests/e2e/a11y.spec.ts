import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Accessibility (docs/SPEC.md §6: WCAG 2.2 AA for the core flows). Every core screen of the
// demo-seeded app is checked with axe-core in a desktop light and a phone dark configuration:
// WCAG A/AA rules (contrast, names, labels, landmarks) plus axe's best-practice rules, and the page
// must not scroll sideways. The data comes from `pnpm db:seed:demo`, which scripts/dev-e2e.mjs runs
// before the server starts (E2E_SEED_DEMO=1 in playwright.config.ts).

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const DEMO_EMAIL = "demo@appliedloop.example";

type Json = { data: Record<string, unknown>[] };

async function list(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok(), `${path} should load`).toBe(true);
  return ((await response.json()) as Json).data;
}

async function routes(page: Page) {
  const [projects, concepts, sessions, evidence] = await Promise.all([
    list(page, "/api/v1/projects"),
    list(page, "/api/v1/concepts?limit=100"),
    list(page, "/api/v1/sessions?limit=50"),
    list(page, "/api/v1/evidence?limit=20"),
  ]);
  const projectId = projects[0].id as string;
  const cte = (concepts.find((c) => /common table/i.test(String(c.name))) ?? concepts[0]).id;
  const session = (type: string, status: string) =>
    sessions.find((s) => s.type === type && s.status === status)?.id as string;
  const applyDone = session("APPLY", "COMPLETED");
  const buildActive = session("BUILD", "ACTIVE");
  const buildDone = session("BUILD", "COMPLETED");
  expect([applyDone, buildActive, buildDone].every(Boolean), "the demo seed has the sessions").toBe(
    true,
  );

  return [
    ["Today", "/today"],
    ["Learn", "/learn"],
    ["Concept", `/learn/concepts/${cte}`],
    ["Projects", "/projects"],
    ["Project overview", `/projects/${projectId}`],
    ["Project learning", `/projects/${projectId}?tab=learning`],
    ["Project evidence", `/projects/${projectId}?tab=evidence`],
    ["Project sessions", `/projects/${projectId}?tab=sessions`],
    ["New project", "/projects/new"],
    ["Start Apply", `/apply/new?projectId=${projectId}&conceptId=${cte}`],
    ["Start Build", `/build/new?projectId=${projectId}`],
    ["Apply session", `/sessions/${applyDone}`],
    ["Build session", `/sessions/${buildActive}`],
    ["Extraction review", `/sessions/${buildDone}/extract`],
    ["Evidence", "/evidence"],
    ["Evidence detail", `/evidence/${evidence[0].id}`],
    ["New evidence", `/evidence/new?projectId=${projectId}`],
    ["Settings", "/settings"],
  ] as const;
}

async function checkAll(page: Page) {
  await signIn(page, DEMO_EMAIL, "Demo Student");
  const problems: string[] = [];
  for (const [name, path] of await routes(page)) {
    await page.goto(path, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    for (const violation of results.violations) {
      const where = violation.nodes
        .map((node) => node.target.join(" "))
        .slice(0, 3)
        .join(" | ");
      problems.push(`${name}: ${violation.id} (${violation.nodes.length}) at ${where}`);
    }
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    if (overflow > 0) problems.push(`${name}: the page scrolls sideways by ${overflow}px`);
  }
  expect(problems, "accessibility problems").toEqual([]);
}

test.describe("desktop, light theme", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  test("every core screen passes axe and fits the width", async ({ page }) => {
    test.setTimeout(240_000);
    await checkAll(page);
  });
});

test.describe("phone, dark theme", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  test("every core screen passes axe and fits the width", async ({ page }) => {
    test.setTimeout(240_000);
    await checkAll(page);
  });
});
