import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page.screenshot({ path: `${dir}/${name}.png` });
}

const sent = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { sent: { sessionId: string; text: string }[] })
        .sent,
  );

const launchCard = (page: Page, id: string) =>
  page.locator(`[data-launched-session="${id}"]`);
const row = (page: Page, id: string) =>
  page.locator(`[data-mono-session="${id}"]`);

test("a sub-agent's question shows in the Mono's chat and panel, and answering sends it to that sub-agent", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/tests/browser/mono-subagent-questions.html?hold=1");
  await page.evaluate(() => document.fonts.ready);
  const questions = page.locator("[data-subagent-questions]");

  // Only the open sub-agent's card is known; the one saved with a waiting
  // card still reads as needing input on its launch card and its row.
  await expect(launchCard(page, "app-tests")).toHaveAttribute(
    "data-state",
    "working",
  );
  await expect(launchCard(page, "app-login")).toHaveAttribute(
    "data-state",
    "input",
  );
  await expect(launchCard(page, "app-docs")).toHaveAttribute(
    "data-state",
    "input",
  );
  await expect(launchCard(page, "app-login")).toContainText("Needs input");
  await expect(row(page, "app-docs")).toHaveAttribute("data-needs-input", "true");
  await expect(row(page, "app-docs")).toContainText("Needs input");
  await expect(row(page, "app-login")).toHaveAttribute("data-needs-input", "true");
  await expect(row(page, "app-tests")).not.toHaveAttribute(
    "data-needs-input",
    "true",
  );
  await expect(
    page.locator('[role="tab"][aria-label="Sessions"] [data-needs-input-dot]'),
  ).toHaveCount(0); // open, so it names itself instead
  await expect(questions.locator("[data-subagent-heading]")).toContainText(
    "Fix the login redirect bug",
  );
  await expect(questions.locator("[data-decision-pager]")).toHaveCount(0);
  await proof(page, "1-before-the-saved-one-opens", browser);

  // The saved sub-agent opens, so its card joins the first, oldest first.
  await page.goto("/tests/browser/mono-subagent-questions.html");
  await page.evaluate(() => document.fonts.ready);
  await expect(questions.locator("[data-decision-pager]")).toHaveText(
    "Card 1 of 2",
  );
  await expect(questions.locator("[data-subagent-heading]")).toContainText(
    "Fix the login redirect bug",
  );
  await expect(questions).toContainText(
    "should the redirect go back to the page the user came from",
  );
  await proof(page, "2-mono-chat-card", browser);

  // Answering goes to the sub-agent that asked, and it is working again.
  await questions
    .getByRole("button", { name: /Back to where they were/ })
    .click();
  await questions.getByRole("button", { name: /Continue|Submit|Done/ }).click();
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  expect((await sent(page))[0]).toMatchObject({ sessionId: "app-login" });
  await expect(launchCard(page, "app-login")).toHaveAttribute(
    "data-state",
    "working",
  );
  await expect(row(page, "app-login")).not.toHaveAttribute(
    "data-needs-input",
    "true",
  );
  // The other card remains, now alone.
  await expect(questions.locator("[data-subagent-heading]")).toContainText(
    "Rewrite the install guide",
  );
  await expect(questions.locator("[data-decision-pager]")).toHaveCount(0);
  await proof(page, "3-after-answering-one", browser);
});

test("the folded Sessions tab is dotted while a sub-agent waits", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/mono-subagent-questions.html?tab=documents");
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.locator('[role="tab"][aria-label="Sessions"] [data-needs-input-dot]'),
  ).toHaveCount(1);
  await proof(page, "4-folded-sessions-tab-dot", info.project.name);
});

test("a refused answer is reported and the card stays to try again", async ({
  page,
}) => {
  await page.goto("/tests/browser/mono-subagent-questions.html");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => ((window as unknown as { failures: { send: boolean } }).failures.send = true),
  );
  const questions = page.locator("[data-subagent-questions]");
  await questions
    .getByRole("button", { name: /Back to where they were/ })
    .click();
  await questions.getByRole("button", { name: /Continue|Submit|Done/ }).click();
  await expect(questions.getByRole("alert")).toContainText("Try again");
  expect(await sent(page)).toEqual([]);
  await expect(questions).toContainText("redirect go back");
});
