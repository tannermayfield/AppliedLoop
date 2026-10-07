import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

// Needs Review close-out, Learn / Project / Today polish and search (journeys audit F-07, F-08,
// F-13 to F-16). Records are seeded through the public API (the signed-in browser's own cookie), so
// each test spends its time on what the student sees. Runs against the deterministic demo AI.

async function startFresh(page: Page, prefix: string) {
  await signIn(page, uniqueEmail(prefix), "Needs Review Student");
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Skip setup and go to Today" }).click();
  await expect(page).toHaveURL(/\/today/);
}

async function api<T>(
  page: Page,
  method: "POST" | "PATCH",
  path: string,
  data: unknown,
  statuses: number[] = [200, 201],
): Promise<T> {
  const response = await page.request.fetch(path, { method, data });
  expect(statuses, `${method} ${path}: ${await response.text()}`).toContain(response.status());
  return (await response.json()).data as T;
}

async function list<T>(page: Page, path: string): Promise<T[]> {
  const response = await page.request.get(path);
  expect(response.status(), path).toBe(200);
  return (await response.json()).data as T[];
}

/**
 * Errors the BROWSER logs: a hydration mismatch, a duplicate React key or an uncaught exception
 * does not fail a click-through by itself, but it means a server/client rendering mistake (for
 * example a function passed from a server component to a client one). Each test ends by asserting
 * this list is empty.
 */
function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(scrollWidth, "page scrolls horizontally").toBeLessThanOrEqual(clientWidth);
}

type Id = { id: string };

test("Today, Learn, project and search: Needs Review is reachable, stage-aware and searchable", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const browserErrors = collectBrowserErrors(page);
  await startFresh(page, "nrlearn");

  const project = await api<Id>(page, "POST", "/api/v1/projects", {
    name: "Adaptive Language",
    currentMilestone: "Learner modeling",
  });
  const cte = await api<Id>(page, "POST", "/api/v1/concepts", {
    name: "Common Table Expressions",
    stage: "LEARNED",
    notes: "Remember: ROLLBACK undoes the whole unit of work",
  });
  const joins = await api<Id>(page, "POST", "/api/v1/concepts", { name: "Joins", stage: "LEARNED" });
  await api(page, "PATCH", `/api/v1/concepts/${joins.id}/progress`, {
    stage: "APPLIED",
    source: "USER",
  });
  // Four concepts the student puts into Needs Review by hand (the new POST /learning-debt).
  for (const name of ["Database transactions", "Schema validation", "JWT", "Caching"]) {
    const added = await api<{ created: boolean }>(page, "POST", "/api/v1/learning-debt", {
      conceptName: name,
      projectId: project.id,
    });
    expect(added.created).toBe(true);
  }

  await test.step("Today: the strip links to the whole queue", async () => {
    await page.goto("/today");
    const strip = page.getByRole("region", { name: "Needs Review" });
    await expect(strip.getByLabel("4 items to review")).toBeVisible();
    await strip.getByRole("link", { name: "See all Needs Review items" }).click();
    await expect(page).toHaveURL(/\/learn#needs-review$/);
    await expect(page.getByRole("heading", { name: "Needs Review", level: 2 })).toBeVisible();
  });

  await test.step("Learn: the queue is there on first paint, above the concept groups", async () => {
    await expect(page.getByText("Loading Needs Review")).toHaveCount(0);
    const queue = page.locator("#needs-review");
    await expect(queue.getByRole("link", { name: "Database transactions", exact: true })).toBeVisible();
    const queueTop = (await queue.boundingBox())!.y;
    const firstGroupTop = (await page.getByRole("heading", { name: "Not from a source" }).boundingBox())!.y;
    expect(queueTop).toBeLessThan(firstGroupTop);
    // One Needs Review landmark on the page, not two stacked blocks.
    await expect(page.getByRole("region", { name: "Needs Review" })).toHaveCount(1);
  });

  await test.step("Learn rows offer the step that fits the stage", async () => {
    // Below Applied: Apply. From Applied on: View evidence and Practice, no Apply.
    await expect(
      page.getByRole("link", { name: 'Apply "Common Table Expressions" in a project' }),
    ).toHaveAttribute("href", `/apply/new?conceptId=${cte.id}`);
    await expect(page.getByRole("link", { name: 'Apply "Joins" in a project' })).toHaveCount(0);
    await expect(page.getByRole("link", { name: 'View evidence for "Joins"' })).toHaveAttribute(
      "href",
      `/evidence?conceptId=${joins.id}`,
    );
    await expect(page.getByRole("link", { name: 'Practice "Joins" again in a project' })).toHaveAttribute(
      "href",
      `/apply/new?conceptId=${joins.id}`,
    );
  });

  await test.step("Learn filter: name, description or notes, and a calm no-match", async () => {
    await page.getByLabel("Search your concepts").fill("rollback");
    await page.getByLabel("Search your concepts").press("Enter");
    await expect(page).toHaveURL(/\/learn\?q=rollback/);
    await expect(page.getByText("1 concept matches “rollback”.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Common Table Expressions", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Joins", exact: true })).toHaveCount(0);

    await page.goto("/learn?q=zzzz-nothing");
    await expect(page.getByRole("heading", { name: "No concepts match “zzzz-nothing”" })).toBeVisible();
    await page.getByRole("link", { name: "Clear search" }).first().click();
    await expect(page.getByRole("link", { name: "Joins", exact: true })).toBeVisible();
  });

  await test.step("The search box in the app frame opens /search, grouped and literal", async () => {
    const box = page.getByRole("searchbox", { name: "Find in your work" });
    await box.fill("transactions");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=transactions/);
    await expect(page.getByRole("heading", { name: "Concepts", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open concept Database transactions" })).toBeVisible();
    // % is a character, not a wildcard: nothing contains it, so nothing matches.
    await page.goto("/search?q=%25");
    await expect(page.getByRole("heading", { name: "Nothing matches “%”" })).toBeVisible();
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "What are you looking for?" })).toBeVisible();
  });

  await test.step("Project overview: the recommended application and up to three Needs Review names", async () => {
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("heading", { name: "Recommended application" })).toBeVisible();
    const start = page.getByRole("link", {
      name: "Start an Apply session for Caching in Adaptive Language",
    });
    await expect(start).toHaveAttribute(
      "href",
      new RegExp(`^/apply/new\\?conceptId=[0-9a-f-]{36}&projectId=${project.id}$`),
    );
    const line = page.locator("p", { hasText: "Needs Review:" });
    // Three names, "and 1 more", and the link to the whole queue.
    await expect(line.getByRole("link")).toHaveCount(4);
    await expect(line).toContainText("and 1 more");

    await page.goto(`/projects/${project.id}?tab=learning`);
    await expect(page.getByRole("region", { name: "Needs Review" })).toHaveCount(1);
    await expect(page.getByText(/items? from this project's builds/)).toHaveCount(0);
  });

  await test.step("Concept page: a Needs Review badge and the one action that closes it", async () => {
    await page.goto("/learn");
    await page
      .locator("#needs-review")
      .getByRole("link", { name: "Database transactions", exact: true })
      .click();
    await expect(page).toHaveURL(/\/learn\/concepts\//);
    await expect(page.locator("[data-needs-review]")).toBeVisible();
    await page
      .getByRole("region", { name: "Needs Review" })
      .getByRole("button", { name: "Mark resolved" })
      .click();
    await expect(
      page.getByText("Database transactions is resolved and has left Needs Review."),
    ).toBeVisible();
    await expect(page.locator("[data-needs-review]")).toHaveCount(0);

    await page.goto("/today");
    await expect(
      page.getByRole("region", { name: "Needs Review" }).getByLabel("3 items to review"),
    ).toBeVisible();
  });

  await test.step("a phone: the search box fits in the top bar and nothing scrolls sideways", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/today");
    await expect(page.getByRole("searchbox", { name: "Find in your work" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto(`/search?q=joins`);
    await expect(page.getByRole("link", { name: "Open concept Joins" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  expect(browserErrors, "the browser logged errors").toEqual([]);
});

test("the student closes a Needs Review item after confirming Applied and after confirming Demonstrated", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const browserErrors = collectBrowserErrors(page);
  await startFresh(page, "nrresolve");

  const project = await api<Id>(page, "POST", "/api/v1/projects", { name: "Adaptive Language" });

  await test.step("Apply: confirm Applied, then say yes to resolving", async () => {
    const concept = await api<Id>(page, "POST", "/api/v1/concepts", {
      name: "Window functions",
      stage: "LEARNED",
    });
    await api(page, "POST", "/api/v1/learning-debt", {
      conceptName: "Window functions",
      projectId: project.id,
    });
    const opportunity = await api<Id>(page, "POST", "/api/v1/apply/opportunities/manual", {
      conceptId: concept.id,
      projectId: project.id,
      title: "Rank learners with a window function",
      task: "Rank each learner's attempts by recency.",
      successCriteria: ["I can explain the PARTITION BY"],
    });
    const session = await api<Id>(page, "POST", "/api/v1/sessions", {
      type: "APPLY",
      projectId: project.id,
      conceptId: concept.id,
      opportunityId: opportunity.id,
    });
    await api(page, "POST", `/api/v1/sessions/${session.id}/complete`, {
      reflection: {
        implemented: "A ranking query.",
        understandingChange: "Window functions keep the rows.",
        explanation: "PARTITION BY restarts the ranking per learner.",
      },
    });

    await page.goto(`/sessions/${session.id}`);
    // Only a question until the student answers: nothing about Needs Review yet.
    await expect(page.getByRole("heading", { name: "Mark Window functions as Applied?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mark Window functions as resolved?" })).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("Marked as Applied.")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Mark Window functions as resolved?" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByText("Window functions is resolved and has left Needs Review."),
    ).toBeVisible();

    expect(await list(page, "/api/v1/learning-debt")).toEqual([]);
    const resolved = await list<{ conceptName: string; status: string }>(
      page,
      "/api/v1/learning-debt?status=RESOLVED",
    );
    expect(resolved).toMatchObject([{ conceptName: "Window functions", status: "RESOLVED" }]);
  });

  await test.step("Apply: 'Not yet' leaves the item where it is", async () => {
    const concept = await api<Id>(page, "POST", "/api/v1/concepts", {
      name: "Recursion",
      stage: "LEARNED",
    });
    await api(page, "POST", "/api/v1/learning-debt", { conceptName: "Recursion", projectId: project.id });
    await api(page, "PATCH", `/api/v1/concepts/${concept.id}/progress`, {
      stage: "APPLIED",
      source: "USER",
    });
    const opportunity = await api<Id>(page, "POST", "/api/v1/apply/opportunities/manual", {
      conceptId: concept.id,
      projectId: project.id,
      title: "Walk a tree recursively",
      task: "Sum a nested structure.",
      successCriteria: ["I can name the base case"],
    });
    const session = await api<Id>(page, "POST", "/api/v1/sessions", {
      type: "APPLY",
      projectId: project.id,
      conceptId: concept.id,
      opportunityId: opportunity.id,
    });
    await api(page, "POST", `/api/v1/sessions/${session.id}/complete`, {});

    await page.goto(`/sessions/${session.id}`);
    // Already Applied by the student's own earlier move, so the only question is the resolve one.
    await expect(page.getByRole("heading", { name: "Mark Recursion as Applied?" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mark Recursion as resolved?" })).toBeVisible();
    await page.getByRole("button", { name: "Not yet" }).click();
    await expect(page.getByText("Recursion stays in Needs Review.")).toBeVisible();
    const open = await list<{ conceptName: string }>(page, "/api/v1/learning-debt");
    expect(open.map((item) => item.conceptName)).toEqual(["Recursion"]);
  });

  await test.step("Evidence: confirm Demonstrated, then say yes to resolving", async () => {
    const concept = await api<Id>(page, "POST", "/api/v1/concepts", {
      name: "Schema validation",
      stage: "LEARNED",
    });
    await api(page, "POST", "/api/v1/learning-debt", {
      conceptName: "Schema validation",
      projectId: project.id,
    });
    await api(page, "PATCH", `/api/v1/concepts/${concept.id}/progress`, {
      stage: "APPLIED",
      source: "USER",
    });

    await page.goto(`/evidence/new?projectId=${project.id}&conceptId=${concept.id}`);
    await page.getByLabel("Title").fill("Zod schemas on every route");
    await page
      .getByLabel("Can you explain why this approach works?")
      .fill("Each route parses its input first, so bad data never reaches the database.");
    await page.getByLabel("Link or reference").fill("https://github.com/example/app/pull/7");
    await page.getByRole("radio", { name: "Student-led" }).check();
    await page.getByRole("button", { name: "Save evidence" }).click();

    await expect(page.getByRole("heading", { name: "Mark Schema validation as Demonstrated?" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("Schema validation is now Demonstrated.")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Mark Schema validation as resolved?" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByText("Schema validation is resolved and has left Needs Review."),
    ).toBeVisible();
    const open = await list<{ conceptName: string }>(page, "/api/v1/learning-debt");
    expect(open.map((item) => item.conceptName)).toEqual(["Recursion"]);
  });

  expect(browserErrors, "the browser logged errors").toEqual([]);
});

test("the manual form on the extraction page puts a concept into Needs Review, with or without AI", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const browserErrors = collectBrowserErrors(page);
  await startFresh(page, "nrmanual");

  await test.step("AI off for the project: no candidates, the form is the way in", async () => {
    const project = await api<Id>(page, "POST", "/api/v1/projects", {
      name: "Offline Project",
      aiEnabled: false,
    });
    const session = await api<Id>(page, "POST", "/api/v1/sessions", {
      type: "BUILD",
      projectId: project.id,
      goal: "Save practice results",
    });
    // The session is finished and saved; no AI is called, so the answer is "AI is off here".
    await api(page, "POST", "/api/v1/extractions", { buildSessionId: session.id, summary: "Saved results." }, [409]);

    await page.goto(`/sessions/${session.id}/extract`);
    await expect(page.getByRole("heading", { name: "Add a concept to Needs Review" })).toBeVisible();
    await page.getByLabel("Concept name").fill("Database transactions");
    await page.getByRole("button", { name: "Add concept" }).click();
    await expect(page.getByText('Added "Database transactions" to Needs Review.')).toBeVisible();
    // A clear next step, and the form stays for another.
    await expect(page.getByRole("link", { name: "Go to Today" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the project" })).toHaveAttribute(
      "href",
      `/projects/${project.id}?tab=learning`,
    );
    await expect(page.getByLabel("Concept name")).toHaveValue("");

    // Asking for the same concept again is calm and adds nothing.
    await page.getByLabel("Concept name").fill("database TRANSACTIONS");
    await page.getByRole("button", { name: "Add concept" }).click();
    await expect(page.getByText('"Database transactions" is already in Needs Review.')).toBeVisible();

    const open = await list<{ conceptName: string; projectId: string; status: string }>(
      page,
      "/api/v1/learning-debt",
    );
    expect(open).toMatchObject([
      { conceptName: "Database transactions", projectId: project.id, status: "OPEN" },
    ]);
  });

  await test.step("with candidates: the same form, offered as 'Add another concept'", async () => {
    const project = await api<Id>(page, "POST", "/api/v1/projects", { name: "Adaptive Language" });
    const session = await api<Id>(page, "POST", "/api/v1/sessions", {
      type: "BUILD",
      projectId: project.id,
      goal: "Save practice results safely",
    });
    await api(page, "POST", "/api/v1/extractions", {
      buildSessionId: session.id,
      summary: "Added database transactions and schema validation to the practice-results save path.",
    });

    await page.goto(`/sessions/${session.id}/extract`);
    await expect(page.getByRole("heading", { name: "Potential concepts worth reviewing" })).toBeVisible();
    // Candidates exist and none is added by being listed.
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add another concept" })).toBeVisible();
    await page.getByLabel("Concept name").fill("Caching");
    await page.getByRole("button", { name: "Add concept" }).click();
    await expect(page.getByText('Added "Caching" to Needs Review.')).toBeVisible();

    await page.getByRole("link", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(
      page.getByRole("region", { name: "Needs Review" }).getByLabel("2 items to review"),
    ).toBeVisible();
  });

  expect(browserErrors, "the browser logged errors").toEqual([]);
});
