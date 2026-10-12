import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page
      .locator("[data-fixture]")
      .screenshot({ path: `${dir}/${name}.png` });
}

const open = async (page: Page, monos: string) => {
  await page.goto(`/tests/browser/inbox-send-to-mono.html?monos=${monos}`);
  await page.evaluate(() => document.fonts.ready);
};

const log = async (page: Page): Promise<string[]> =>
  JSON.parse((await page.locator("[data-log]").textContent()) ?? "[]");

const sendToAgent = (page: Page) =>
  page.getByRole("button", { name: "Send to agent" });
const chevron = (page: Page) =>
  page.getByRole("button", { name: "Send options" });

test("without Monos the Send to agent button stays as it was", async ({
  page,
}, info) => {
  await open(page, "none");
  await expect(chevron(page)).toHaveCount(0);
  await proof(page, "before-no-chevron", info.project.name);
  await sendToAgent(page).click();
  await expect.poll(() => log(page)).toEqual(["agent"]);
});

test("one Mono: the chevron sends straight to it", async ({ page }, info) => {
  await open(page, "Pixi");
  await chevron(page).click();
  await expect(
    page.getByRole("menuitem", { name: /Send to Mono/ }),
  ).toBeVisible();
  await expect(page.getByRole("menu")).toContainText("Pixi");
  await proof(page, "after-one-mono-menu", info.project.name);
  await page.getByRole("menuitem", { name: /Send to Mono/ }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  // The same text and link a new agent chat starts with.
  await expect
    .poll(() => log(page))
    .toEqual([
      "mono:Pixi:Work on this GitHub issue:\n\n#157 Crash when saving a note\nhttps://github.com/acme/web/issues/157",
    ]);
});

test("several Monos are listed by name and the pick receives it", async ({
  page,
}, info) => {
  await open(page, "Pixi,Nova");
  await chevron(page).click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText(["Pixi", "Nova"]);
  await proof(page, "after-two-monos-menu", info.project.name);
  await items.nth(1).click();
  await expect
    .poll(async () => (await log(page)).map((e) => e.slice(0, 10)))
    .toEqual(["mono:Nova:"]);
});

test("with no Mono the item is disabled and says why", async ({
  page,
}, info) => {
  await open(page, "");
  await chevron(page).click();
  await expect(
    page.getByRole("menuitem", { name: "Send to Mono" }),
  ).toBeDisabled();
  await expect(page.getByRole("menu")).toContainText("No Mono yet");
  await proof(page, "after-no-mono-menu", info.project.name);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  // The main button is still today's.
  await sendToAgent(page).click();
  await expect.poll(() => log(page)).toEqual(["agent"]);
});
