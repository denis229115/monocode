import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page.screenshot({ path: `${dir}/${name}.png` });
}

const open = async (page: Page, query = "") => {
  await page.goto(`/tests/browser/mono-account.html${query}`);
  await page.evaluate(() => document.fonts.ready);
};

const log = async (page: Page) =>
  JSON.parse((await page.locator("[data-log]").textContent()) ?? "[]") as {
    id: string;
    account: string;
    thread: string | null;
    handOver: boolean;
  }[];

const modelTrigger = (page: Page) =>
  page.locator("button[aria-keyshortcuts]").first();
const chip = (page: Page) =>
  page.getByRole("button", { name: /usage details/ });
const switchAccount = (page: Page) =>
  page.getByRole("button", { name: /^Switch .* account$/ });

test("the model selector has no account row, even with several accounts", async ({
  page,
}, info) => {
  await open(page);
  await expect(modelTrigger(page)).not.toContainText("·");
  await modelTrigger(page).click();
  await expect(page.getByRole("dialog", { name: "Models" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Account" })).toHaveCount(0);
  await expect(page.getByText("Account", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(400); // let the popover finish fading in
  await proof(page, "model-selector-no-account", info.project.name);
});

test("a Mono picks its account in the composer's usage chips and its chat is handed over", async ({
  page,
}, info) => {
  await open(page);
  await expect(chip(page)).toContainText("20%");
  await chip(page).click();
  await switchAccount(page).click();
  await expect(page.getByRole("group", { name: /accounts$/ })).toBeVisible();
  await proof(page, "composer-chips-account-picker", info.project.name);
  await page.getByRole("button", { name: "Work" }).click();
  // The chip now reads the Work account's usage, and the selector gained nothing.
  await expect(chip(page)).toContainText("65%");
  await expect(modelTrigger(page)).not.toContainText("·");
  await proof(page, "composer-chips-after-pick", info.project.name);
  // Only this Mono's chat moved, and it carries its transcript over.
  await expect.poll(() => log(page)).toEqual([
    { id: "chat-pixi", account: "account-work", thread: null, handOver: true },
    {
      id: "chat-nova",
      account: "default",
      thread: "chat-nova-thread",
      handOver: false,
    },
  ]);
  await page.locator('[data-select="chat-nova"]').click();
  await expect(chip(page)).toContainText("20%");
  await proof(page, "other-mono-on-default", info.project.name);
});

test("without an account callback the chips show usage alone", async ({ page }) => {
  await open(page, "?picker=off");
  await chip(page).click();
  await expect(page.getByRole("dialog", { name: /usage details/ })).toBeVisible();
  await expect(switchAccount(page)).toHaveCount(0);
});

test("with one account the picker lists only it, and a provider without profiles has none", async ({
  page,
}) => {
  await open(page, "?accounts=one");
  await chip(page).click();
  await switchAccount(page).click();
  await expect(
    page.getByRole("group", { name: /accounts$/ }).getByRole("button"),
  ).toHaveCount(1);
  await open(page, "?harness=devin");
  await chip(page).click();
  await expect(switchAccount(page)).toHaveCount(0);
});

test("a Mono whose account was removed shows and uses the default account", async ({
  page,
}, info) => {
  await open(page, "?removed=1");
  await expect(chip(page)).toContainText("20%");
  await expect.poll(() => log(page)).toMatchObject([
    { id: "chat-pixi", account: "default", handOver: true },
    { id: "chat-nova", account: "default", handOver: false },
  ]);
  await proof(page, "removed-account-falls-back", info.project.name);
});
