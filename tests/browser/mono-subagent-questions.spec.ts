import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page.screenshot({ path: `${dir}/${name}.png` });
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { opened: string[] }).opened);

const launchCard = (page: Page, id: string) =>
  page.locator(`[data-launched-session="${id}"]`);
const row = (page: Page, id: string) =>
  page.locator(`[data-mono-session="${id}"]`);

test("a waiting sub-agent shows on its launch card, which opens it; nothing is answered in the chat", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/tests/browser/mono-subagent-questions.html");
  await page.evaluate(() => document.fonts.ready);

  // Running, waiting while open, and waiting while only saved.
  await expect(launchCard(page, "app-tests")).toHaveAttribute(
    "data-state",
    "working",
  );
  for (const id of ["app-login", "app-docs"]) {
    await expect(launchCard(page, id)).toHaveAttribute("data-state", "input");
    await expect(launchCard(page, id)).toContainText("Needs input");
    await expect(
      page.locator(`[data-launched-session-open="${id}"]`),
    ).toHaveText("Open session");
  }
  // A card that is not waiting has no such action.
  await expect(
    page.locator('[data-launched-session-open="app-tests"]'),
  ).toHaveCount(0);

  // The question is not shown, let alone answerable, in the Mono's chat.
  await expect(page.locator("[data-question-form]")).toHaveCount(0);
  await expect(page.locator("[data-decision-card]")).toHaveCount(0);
  await expect(page.getByText("redirect go back")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await proof(page, "1-launch-cards-and-sessions-panel", info.project.name);

  // Sessions panel rows, including the one whose session is not open.
  await expect(row(page, "app-login")).toHaveAttribute(
    "data-needs-input",
    "true",
  );
  await expect(row(page, "app-docs")).toHaveAttribute(
    "data-needs-input",
    "true",
  );
  await expect(row(page, "app-docs")).toContainText("Needs input");
  await expect(row(page, "app-tests")).not.toHaveAttribute(
    "data-needs-input",
    "true",
  );

  // Open session does what clicking the card does.
  await page.locator('[data-launched-session-open="app-login"]').click();
  await expect.poll(() => opened(page)).toEqual(["app-login"]);
  await launchCard(page, "app-docs").click();
  await expect.poll(() => opened(page)).toEqual(["app-login", "app-docs"]);
  await page.locator('[data-launched-session-open="app-docs"]').click();
  await expect
    .poll(() => opened(page))
    .toEqual(["app-login", "app-docs", "app-docs"]);
  await launchCard(page, "app-tests").click();
  await expect
    .poll(() => opened(page))
    .toEqual(["app-login", "app-docs", "app-docs", "app-tests"]);
});

test("the folded Sessions tab is dotted while a sub-agent waits", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/mono-subagent-questions.html?tab=documents");
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.locator('[role="tab"][aria-label="Sessions"] [data-needs-input-dot]'),
  ).toHaveCount(1);
  await proof(page, "2-folded-sessions-tab-dot", info.project.name);
});
