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

test("a waiting card in a chat drawn by PaneTree can be answered", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.goto("/tests/browser/decision-cards-panetree.html");
  await page.evaluate(() => document.fonts.ready);
  const pane = page.locator('[data-pane-id="alpha"]');
  const panel = pane.locator("[data-decision-card]");

  await expect(panel).toContainText("Merge alpha now?");
  await proof(page, "panetree-waiting", browser);
  await panel.getByRole("button", { name: /Merge now/ }).click();
  await panel.getByRole("button", { name: "Continue" }).click();

  // The answer reaches this chat's agent and the card settles.
  await expect
    .poll(() => sent(page))
    .toEqual([{ sessionId: "alpha", text: "Merge alpha now?\nMerge now" }]);
  await expect(panel).toHaveCount(0);
  await expect(
    pane.locator('[data-decision-summary="alpha-card"]'),
  ).toHaveAttribute("data-status", "answered");
  await proof(page, "panetree-answered", browser);
});

test("each split pane answers to its own chat", async ({ page }, info) => {
  const browser = info.project.name;
  await page.goto("/tests/browser/decision-cards-panetree.html?split=1");
  await page.evaluate(() => document.fonts.ready);
  const alpha = page.locator('[data-pane-id="alpha"] [data-decision-card]');
  const beta = page.locator('[data-pane-id="beta"] [data-decision-card]');

  await expect(alpha).toContainText("Merge alpha now?");
  await expect(beta).toContainText("Merge beta now?");
  await proof(page, "panetree-split", browser);

  await beta.getByRole("button", { name: /Wait/ }).click();
  await beta.getByRole("button", { name: "Continue" }).click();
  await expect
    .poll(() => sent(page))
    .toEqual([{ sessionId: "beta", text: "Merge beta now?\nWait" }]);
  await expect(beta).toHaveCount(0);
  await expect(alpha).toContainText("Merge alpha now?");

  await alpha.getByRole("button", { name: /Merge now/ }).click();
  await alpha.getByRole("button", { name: "Continue" }).click();
  await expect
    .poll(async () => (await sent(page))[1])
    .toEqual({
      sessionId: "alpha",
      text: "Merge alpha now?\nMerge now",
    });
  await expect(alpha).toHaveCount(0);
});
