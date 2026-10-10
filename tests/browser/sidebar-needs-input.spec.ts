import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page.locator("[data-fixture]").screenshot({ path: `${dir}/${name}.png` });
}

const row = (page: Page, id: string) =>
  page.locator(`[data-session-card="${id}"]`);

const monoStatuses = (page: Page) =>
  page.locator("[data-mono-status]").evaluateAll((monos) =>
    monos.map((mono) => mono.getAttribute("data-mono-status")),
  );

test("a waiting decision card marks its chat and Mono until it is answered", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.goto("/tests/browser/sidebar-needs-input.html");
  await page.evaluate(() => document.fonts.ready);

  // The same mark a blocking question gets, loaded or known only from storage.
  for (const id of ["question", "card", "closed"])
    await expect(row(page, id)).toContainText("Need approval");
  await expect(row(page, "settled")).not.toContainText("Need approval");
  // Pixi's card is loaded, Nova's is only saved, Idle has none.
  await expect.poll(() => monoStatuses(page)).toEqual([
    "needs-you",
    "needs-you",
    "idle",
  ]);
  await proof(page, "after-waiting", browser);

  // Answering clears the chat; the closed chat waits until it is opened.
  await page.locator("[data-answer]").click();
  await expect(row(page, "card")).not.toContainText("Need approval");
  await expect(row(page, "question")).toContainText("Need approval");
  await expect(row(page, "closed")).toContainText("Need approval");
  await expect.poll(() => monoStatuses(page)).toEqual([
    "idle",
    "needs-you",
    "idle",
  ]);
  await proof(page, "after-answered", browser);
});
