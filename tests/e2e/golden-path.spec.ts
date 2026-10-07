import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

// The loop closes (docs/ACCEPTANCE_TESTS.md → Golden-path E2E): Learn → Apply → Evidence → Build →
// Extract → Needs Review, as one student, against the deterministic demo AI.

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(scrollWidth, "page scrolls horizontally").toBeLessThanOrEqual(clientWidth);
}

async function onboard(page: Page) {
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { name: "What are you learning?" })).toBeVisible();
  await page.getByLabel("Title").fill("IS 402 — Database Development");
  await page.getByLabel("Code (optional)").fill("IS 402");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "What are you building?" })).toBeVisible();
  await page.getByRole("radio", { name: /I already have a project/ }).check();
  await page.getByLabel("Project name").fill("Adaptive Language");
  await page
    .getByLabel("Why does it exist? (one line)")
    // Real project context the practice designer can connect SQL concepts to.
    .fill("Language practice that stores each mistake in SQL tables and queries the weakest words");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page).toHaveURL(/\/today/);
}

test("golden path: the loop closes for one student", async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  let sessionUrl = "";
  let projectUrl = "";
  let conceptName = "";

  await test.step("sign in and onboard", async () => {
    await signIn(page, uniqueEmail("golden"), "Golden Student");
    await onboard(page);
    await expect(
      page
        .getByRole("heading", { name: "Today", level: 1 })
        .or(page.getByText(/Good (morning|afternoon|evening)/))
        .first(),
    ).toBeVisible();
  });

  await test.step("Learn: capture concepts from free text and confirm them", async () => {
    await page
      .getByRole("navigation", { name: "Primary" })
      .first()
      .getByRole("link", { name: "Learn" })
      .click();
    await expect(page).toHaveURL(/\/learn/);
    await page
      .getByRole("textbox", { name: "What did you learn?" })
      .fill("Today in IS 402 we covered CTEs and joins");
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const list = page.getByRole("list", { name: "Concepts found in your notes" });
    await expect(list).toBeVisible();
    await expect(list.getByText("Common Table Expressions").first()).toBeVisible();
    await page
      .getByRole("button", { name: /^Confirm/ })
      .first()
      .click();
    await expect(page.getByText(/Added 2 concepts|Added 1 concept/)).toBeVisible();
    await expect(page.getByText("Common Table Expressions").first()).toBeVisible();
  });

  await test.step("Today shows an Apply card for the captured concept", async () => {
    await page
      .getByRole("navigation", { name: "Primary" })
      .first()
      .getByRole("link", { name: "Today" })
      .click();
    await expect(page).toHaveURL(/\/today/);
    const applyLink = page.getByRole("link", {
      name: /Start an Apply session for (Common Table Expressions|SQL joins)/,
    });
    await expect(applyLink.first()).toBeVisible();
    const label =
      (await applyLink.first().getAttribute("aria-label")) ?? (await applyLink.first().innerText());
    conceptName = /Common Table Expressions/.test(label) ? "Common Table Expressions" : "SQL joins";
    await expect(page.getByText("Practice inside Adaptive Language").first()).toBeVisible();
    await applyLink.first().click();
  });

  await test.step("Apply: generate opportunities and start a challenge", async () => {
    await expect(page).toHaveURL(/\/apply\/new/);
    await page.getByRole("button", { name: "Find places to practice" }).click();
    const start = page.getByRole("button", { name: "Start this challenge" }).first();
    await expect(start).toBeVisible();
    await start.click();
    await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
    sessionUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Tutor mode").first()).toBeVisible();
  });

  await test.step("Tutor refuses to hand over the full code", async () => {
    const thread = page.getByRole("region", { name: "Tutor conversation" });
    await page.getByLabel("Your message to the tutor").fill("just give me all the code");
    await page.getByRole("button", { name: "Send" }).click();
    const items = thread.getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("just give me all the code");
    const reply = items.nth(1);
    await expect(reply).toContainText("Tutor");
    const replyText = await reply.innerText();
    expect(replyText).toMatch(/Switch to Build/i);
    expect(replyText).toMatch(/hint|can't|won't|instead|yours/i);
    // No fenced code block anywhere in the conversation.
    await expect(thread.locator("pre")).toHaveCount(0);
    expect(replyText).not.toContain("```");
    await expect(page.getByRole("button", { name: "Switch to Build Mode" })).toBeVisible();
  });

  await test.step("Ask for a hint: the level goes up", async () => {
    await expect(page.getByText("Hints: Level 0 of 3")).toBeVisible();
    await page.getByRole("button", { name: "Ask for another hint" }).click();
    await expect(page.getByText("Hints: Level 1 of 3")).toBeVisible();
    await expect(page.getByText("Tutor is thinking…")).toBeHidden();
  });

  await test.step("Submit an attempt: the tutor answers it in the thread", async () => {
    // Step 6 of docs/ACCEPTANCE_TESTS.md: the student works, then submits what they wrote.
    const thread = page.getByRole("region", { name: "Tutor conversation" });
    const items = thread.getByRole("listitem");
    const before = await items.count();
    await page
      .getByLabel("Your message to the tutor")
      .fill(
        "My attempt: WITH weakest AS (SELECT word_id, count(*) AS misses FROM mistakes GROUP BY word_id) SELECT word_id FROM weakest ORDER BY misses DESC LIMIT 5;",
      );
    await page.getByRole("button", { name: "Send" }).click();
    await expect(items).toHaveCount(before + 2);
    await expect(items.nth(before)).toContainText("WITH weakest AS");
    await expect(items.nth(before + 1)).toContainText("Tutor");
    await expect(page.getByText("Tutor is thinking…")).toBeHidden();
  });

  await test.step("Finish with a reflection and confirm the move to Applied", async () => {
    await page.getByRole("button", { name: "Finish Apply Session" }).click();
    const dialog = page.getByRole("dialog", { name: "Finish this Apply session" });
    await dialog
      .getByLabel("What did you implement?")
      .fill("A CTE that ranks the learner's weakest words.");
    await dialog
      .getByLabel("What changed in your understanding?")
      .fill("CTEs make multi-step queries readable.");
    await dialog
      .getByLabel("Can you explain why this approach works?")
      .fill("Each step is named and testable.");
    await dialog.getByRole("button", { name: "Finish session" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: `Mark ${conceptName} as Applied?` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("Marked as Applied.")).toBeVisible();
  });

  let evidenceUrl = "";
  await test.step("Create evidence from the session with an honest contribution label", async () => {
    await page.getByRole("link", { name: "Create evidence" }).click();
    await expect(page).toHaveURL(/\/evidence\/new/);
    await page.getByLabel("Title").fill("CTE for weakest words in Adaptive Language");
    await page
      .getByLabel("Can you explain why this approach works?")
      .fill("The CTE names each step so the ranking is easy to check.");
    await expect(page.getByRole("checkbox", { name: conceptName })).toBeChecked();
    await page
      .getByLabel("Link or reference")
      .fill("https://github.com/golden/adaptive-language/pull/12");
    // How the work was made is the student's own answer: never pre-selected, even from a session,
    // and Save stays off until they give it.
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save evidence" })).toBeDisabled();
    await page.getByRole("radio", { name: "Student-led" }).check();
    await expect(page.getByRole("button", { name: "Save evidence" })).toBeEnabled();
    await page.getByRole("button", { name: "Save evidence" }).click();
    // Evidence may suggest Demonstrated; the student declines (AT-17), so the stage stays Applied.
    await expect(
      page.getByRole("heading", { name: `Mark ${conceptName} as Demonstrated?` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Not yet" }).click();
    await page.getByRole("link", { name: "View evidence" }).click();
    await expect(page).toHaveURL(/\/evidence\/[0-9a-f-]{36}$/);
    evidenceUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Student-led").first()).toBeVisible();
    await expect(page.getByText(conceptName).first()).toBeVisible();
  });

  await test.step("Learn shows the concept at Applied", async () => {
    await page
      .getByRole("navigation", { name: "Primary" })
      .first()
      .getByRole("link", { name: "Learn" })
      .click();
    await page.getByRole("link", { name: conceptName }).first().click();
    await expect(page.getByText("Applied").first()).toBeVisible();
  });

  await test.step("Build: start from the project and copy the context pack", async () => {
    await page
      .getByRole("navigation", { name: "Primary" })
      .first()
      .getByRole("link", { name: "Projects" })
      .click();
    await page
      .getByRole("link", { name: /Adaptive Language/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/projects\/[^/?]+/);
    projectUrl = new URL(page.url()).pathname;
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("link", { name: "Sessions" })
      .click();
    await page.getByRole("link", { name: "Start Build" }).first().click();
    await expect(page).toHaveURL(/\/build\/new/);
    await page.getByLabel("Session goal").fill("Save practice results safely");
    await page.getByRole("button", { name: "Start Build Session" }).click();
    await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
    await expect(page.getByText("AI acceleration allowed").first()).toBeVisible();

    await page.getByRole("button", { name: "Copy for Claude Code" }).click();
    await expect(page.getByText("Copied for Claude Code. Paste it into your agent.")).toBeVisible();
    const pack = await page.evaluate(() => navigator.clipboard.readText());
    expect(pack).toContain("Adaptive Language");
    expect(pack).toContain("Save practice results safely");
    expect(pack).not.toMatch(
      /Apply mode|tutor|never write|don't write|do not write|withhold|hint level/i,
    );
  });

  await test.step("Finish & Extract with a build summary", async () => {
    const buildSessionId = new URL(page.url()).pathname.split("/").pop();
    // A Markdown summary, as an agent writes it, with the original sentence as its first bullet.
    await page
      .getByLabel("Build summary")
      .fill(
        [
          "## Build summary",
          "",
          "- Added database transactions and schema validation to the practice-results save path.",
          "- Wrapped the attempt and its mistakes in one transaction.",
        ].join("\n"),
      );
    // A typed path should be labelled as a file, not as a commit.
    await page.getByRole("button", { name: "Add a reference" }).click();
    await page.getByLabel("Reference 1", { exact: true }).fill("src/services/profile.ts");
    await expect(page.getByLabel("Type 1", { exact: true }).locator("option:checked")).toHaveText(
      "Auto: File",
    );

    // Notes typed just before Finish must survive (audit F-17). Hold the autosave on the wire so it
    // is still in flight when Finish is clicked: the old code completed the session first, and the
    // late save was then refused with a 409 and the text was lost.
    const typedNotes = "One transaction per attempt; ask later why savepoints matter.";
    await page.route("**/api/v1/sessions/*/notes", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      // If the page has already moved on the route is gone; that is the very bug this guards.
      await route.continue().catch(() => undefined);
    });
    const saveStarted = page.waitForRequest(
      (request) => request.method() === "PATCH" && request.url().endsWith("/notes"),
    );
    await page.getByLabel("Session notes (saved automatically)").fill(typedNotes);
    await saveStarted;
    await page.getByRole("button", { name: "Finish & Extract" }).click();
    await expect(page).toHaveURL(/\/sessions\/[^/]+\/extract$/);
    await page.unroute("**/api/v1/sessions/*/notes");

    const detail = await page.request.get(`/api/v1/sessions/${buildSessionId}`);
    expect((await detail.json()).data.notes).toBe(typedNotes);

    // "What changed?" renders the Markdown, and the typed path is a File reference.
    const changed = page.getByRole("region", { name: "What changed?" });
    await expect(changed.getByRole("heading", { name: "Build summary" })).toBeVisible();
    await expect(changed.getByText("##")).toHaveCount(0);
    await expect(
      changed.getByRole("listitem").filter({ hasText: "Wrapped the attempt and its mistakes" }),
    ).toBeVisible();
    await expect(changed.getByText("File: src/services/profile.ts")).toBeVisible();
    await expect(changed.getByText("Commit: src/services/profile.ts")).toHaveCount(0);
  });

  await test.step("Extraction: all candidates start unreviewed; student classifies two", async () => {
    await expect(
      page.getByRole("heading", { name: "Potential concepts worth reviewing" }),
    ).toBeVisible();
    const cards = page.getByRole("article");
    await expect(cards.first()).toBeVisible();
    const total = await cards.count();
    expect(total).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(`0 of ${total} reviewed`)).toBeVisible();
    for (let i = 0; i < total; i++) {
      const card = cards.nth(i);
      await expect(card.getByRole("radio", { checked: true })).toHaveCount(0);
      for (const name of ["Add to Needs Review", "Already know", "Ignore"]) {
        await expect(card.getByRole("button", { name, exact: true })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      }
    }
    const first = cards.nth(0);
    const second = cards.nth(1);
    const keptName = (await first.getByRole("heading", { level: 3 }).innerText()).trim();
    const ignoredName = (await second.getByRole("heading", { level: 3 }).innerText()).trim();

    const saved = () =>
      page.waitForResponse(
        (r) => r.request().method() === "PATCH" && r.url().includes("/items/") && r.ok(),
      );
    await Promise.all([
      saved(),
      first.getByRole("button", { name: "Add to Needs Review", exact: true }).click(),
    ]);
    await expect(
      first.getByRole("button", { name: "Add to Needs Review", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    // The concept was created by this very review, so it is not "In your library" (audit F-18).
    await expect(first.getByText("In your library")).toHaveCount(0);
    await Promise.all([
      saved(),
      second.getByRole("button", { name: "Ignore", exact: true }).click(),
    ]);
    await expect(second.getByRole("button", { name: "Ignore", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // With exactly two candidates the counter gives way to "All reviewed".
    await expect(
      page.getByText(total === 2 ? "All reviewed" : `2 of ${total} reviewed`),
    ).toBeVisible();

    await test.step("exactly one Needs Review item, nothing for the ignored one", async () => {
      await page.goto("/today");
      const strip = page.getByRole("region", { name: "Needs Review" });
      await expect(strip.getByLabel("1 item to review")).toBeVisible();
      await expect(strip.getByText(keptName).first()).toBeVisible();
      await expect(page.getByText(ignoredName)).toHaveCount(0);

      await page.goto(`${projectUrl}?tab=learning`);
      await expect(page.getByText(keptName).first()).toBeVisible();
      await expect(page.getByText(ignoredName)).toHaveCount(0);
    });
  });

  await test.step("Sign out for real", async () => {
    await page.goto("/today");
    // By keyboard, not mouse: in `next dev` the dev-tools badge sits on top of the sidebar avatar
    // and swallows pointer events (see settings.spec.ts).
    await page.getByRole("button", { name: "Account menu" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Sign out" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sign-in/);

    // Signed out for real: the session cookie is gone, the API no longer knows us, and an app page
    // sends us back to sign in.
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => /session_token$/.test(cookie.name))?.value ?? "").toBe("");
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test.info().annotations.push({ type: "urls", description: `${sessionUrl} ${evidenceUrl}` });
  // Stash for the isolation test.
  sharedUrls.session = sessionUrl;
  sharedUrls.evidence = evidenceUrl;
  sharedUrls.project = projectUrl;
});

const sharedUrls = { session: "", evidence: "", project: "" };

test("another student can't open those records, and phone width works", async ({ browser }) => {
  test.skip(!sharedUrls.session, "golden path did not produce URLs");
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();

  await test.step("sign-in fits a 375px viewport", async () => {
    await page.goto("/sign-in");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step("second student signs in and Today fits", async () => {
    await signIn(page, uniqueEmail("intruder"), "Other Student");
    if (/onboarding/.test(page.url())) {
      await expectNoHorizontalScroll(page);
      await page.getByRole("button", { name: "Skip setup and go to Today" }).click();
    }
    await expect(page).toHaveURL(/\/today/);
    await expectNoHorizontalScroll(page);
  });

  for (const [what, url] of Object.entries(sharedUrls)) {
    await test.step(`cannot open the first student's ${what}`, async () => {
      // Pages stream behind (app)/loading.tsx, so Next answers 200 with the not-found UI; the real 404s
      // are the API routes (tests/integration/authz). What matters here: no data, same page as a missing id.
      await page.goto(url);
      await expect(
        page.getByText(/not found|(can|couldn).?t find|doesn.t exist/i).first(),
      ).toBeVisible();
      await expect(page.getByText("Adaptive Language")).toHaveCount(0);
    });
  }
  await context.close();
});
