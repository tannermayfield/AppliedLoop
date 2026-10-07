import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, signIn, uniqueEmail } from "./helpers";

// Evidence on a phone (audit F-05) and the honest contribution label (audit gap 7).
//
// F-05: the Evidence list and the project Evidence tab used to scroll sideways at 375 px when an
// item had a long pasted link or a title typed without spaces. Fixtures are made through the API
// (this spec is about layout and the form, not about the creation journey: the golden path
// walks that), as a student who signs in with the development login.

test.use({ viewport: { width: 375, height: 812 } });

// 139 characters, no spaces: the title field allows 140 and a student can paste one.
const LONG_TITLE = `Rank-weak-words-with-named-CTEs-${"and-readable-views-".repeat(5)}done`;
// A real-shaped GitHub "files changed" link, far wider than a phone.
const LONG_LINK =
  "https://github.com/an-organization-with-a-long-name/adaptive-language-practice-platform" +
  "/pull/1234/files?diff=split&w=1#diff-9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
// An explanation that quotes a URL: one unbroken run of text.
const EXPLANATION = `I moved the ranking into named CTEs. Reference: ${LONG_LINK} and it reads top down.`;

async function createStudentWithLongEvidence(page: Page) {
  await signIn(page, uniqueEmail("evidence-phone"), "Phone Student");
  const onboarded = await page.request.post("/api/v1/onboarding", {
    data: {
      project: {
        name: "Adaptive Language",
        problemStatement: "Language practice that stores each mistake in SQL tables",
      },
      startMode: "HAVE_PROJECT",
    },
  });
  expect(onboarded.status()).toBe(201);
  const { projectId } = (await onboarded.json()).data as { projectId: string };

  expect(LONG_TITLE.length).toBeLessThanOrEqual(140);
  expect(LONG_TITLE).not.toContain(" ");
  const created = await page.request.post("/api/v1/evidence", {
    data: {
      projectId,
      title: LONG_TITLE,
      explanation: EXPLANATION,
      artifactType: "PR",
      artifactUrl: LONG_LINK,
      contributionType: "AI_ASSISTED",
    },
  });
  expect(created.status()).toBe(201);
  const { evidence } = (await created.json()).data as { evidence: { id: string } };
  return { projectId, evidenceId: evidence.id };
}

test("evidence screens fit a phone even with a very long title and link", async ({ page }) => {
  test.setTimeout(180_000);
  const { projectId, evidenceId } = await createStudentWithLongEvidence(page);

  await test.step("the Evidence list", async () => {
    await page.goto("/evidence");
    await expect(page.getByRole("heading", { name: LONG_TITLE })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Pull request: https:\/\/github\.com/ }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, "/evidence");
  });

  await test.step("the project's Evidence tab", async () => {
    await page.goto(`/projects/${projectId}?tab=evidence`);
    await expect(page.getByRole("heading", { name: LONG_TITLE })).toBeVisible();
    await expectNoHorizontalScroll(page, "the project Evidence tab");
  });

  await test.step("the evidence detail page", async () => {
    await page.goto(`/evidence/${evidenceId}`);
    await expect(page.getByRole("heading", { level: 1, name: LONG_TITLE })).toBeVisible();
    await expectNoHorizontalScroll(page, "the evidence detail page");
  });

  await test.step("the edit form keeps the long link inside the screen", async () => {
    await page.goto(`/evidence/${evidenceId}/edit`);
    await expect(page.getByLabel("Link or reference")).toHaveValue(LONG_LINK);
    await expectNoHorizontalScroll(page, "the evidence edit form");
  });
});

test("the evidence form never pre-selects how the work was made", async ({ page }) => {
  test.setTimeout(180_000);
  const { projectId } = await createStudentWithLongEvidence(page);

  await page.goto(`/evidence/new?projectId=${projectId}`);
  await page.getByLabel("Title").fill("Window function for the weekly ranking");
  await page.getByLabel("Link or reference").fill("https://github.com/golden/adaptive/pull/7");

  const save = page.getByRole("button", { name: "Save evidence" });
  const radios = page.getByRole("radiogroup").getByRole("radio");
  await expect(radios).toHaveCount(4);

  await test.step("nothing is chosen and Save is off, with honest helper text", async () => {
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(
      page.getByText("Be honest: this is more useful than pretending AI wasn't involved."),
    ).toBeVisible();
    await expect(page.getByText(/Choose one to save this evidence/)).toBeVisible();
    await expectNoHorizontalScroll(page, "the evidence form");
  });

  await test.step("choosing one turns Save on; the choice is saved as given", async () => {
    await page.getByRole("radio", { name: "Primarily AI-generated" }).check();
    await expect(save).toBeEnabled();
    await expect(page.getByText(/Choose one to save this evidence/)).toBeHidden();
    await save.click();
    await expect(page).toHaveURL(/\/evidence\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Primarily AI-generated").first()).toBeVisible();
  });
});
