import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page.locator("[data-fixture]").screenshot({ path: `${dir}/${name}.png` });
}

// Tall enough to show the whole fixture, archived cards included.
test.use({ viewport: { width: 1000, height: 1100 } });

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

test("archiving a chat closes its waiting cards and clears every mark", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.goto("/tests/browser/sidebar-needs-input.html");
  await page.evaluate(() => document.fonts.ready);
  const dock = page.locator("[data-dock-count]");

  // The finished chat, the lead of the waiting worker, and Nova's saved card.
  for (const id of ["finished", "lead", "closed"])
    await expect(row(page, id)).toContainText("Need approval");
  await expect(dock).toHaveText("7");
  await expect.poll(() => monoStatuses(page)).toEqual([
    "needs-you",
    "needs-you",
    "idle",
  ]);
  await proof(page, "archive-before", browser);

  const commands = () =>
    page.evaluate(() => (window as unknown as { __commands: string[] }).__commands);
  await page.evaluate(() => {
    (window as unknown as { __commands: string[] }).__commands.length = 0;
  });
  await page.locator("[data-archive]").click();
  const summary = (chat: string, card: string) =>
    page.locator(`[data-archived="${chat}"] [data-decision-summary="${card}"]`);
  // The archived chats' cards read as dismissed; the settled one is unchanged.
  await expect(summary("finished", "deploy")).toHaveAttribute("data-status", "dismissed");
  await expect(summary("finished", "deploy")).toContainText("Dismissed");
  await expect(summary("worker", "review")).toHaveAttribute("data-status", "dismissed");
  await expect(summary("settled", "tag")).toHaveAttribute("data-status", "dismissed");
  await expect(dock).toHaveText("4");
  await expect(row(page, "lead")).not.toContainText("Need approval");
  await expect(page.locator("[data-needs-input]")).toHaveText(
    "card closed mono-loaded question",
  );
  await expect.poll(() => monoStatuses(page)).toEqual([
    "needs-you",
    "idle",
    "idle",
  ]);
  // Archiving sent nothing to an agent: it asked storage, and the sidebar
  // read its diff counts as it does on any change.
  const asked = new Set(await commands());
  asked.delete("git_diff_stats");
  expect(asked).toEqual(new Set(["session_set_archived", "decision_card_waiting_sessions"]));
  await proof(page, "archive-after", browser);
});
