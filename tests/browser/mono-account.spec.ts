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

const trigger = (page: Page) =>
  page.locator("[data-mono-model] button[aria-keyshortcuts]");
const settingsTrigger = (page: Page) =>
  page.locator("[data-mono-settings] button[aria-keyshortcuts]");
const accounts = (page: Page) =>
  page.getByRole("radiogroup", { name: "Account" });
const radios = (page: Page) => accounts(page).getByRole("radio");

test("with one account (or a provider without profiles) the selector shows no account", async ({
  page,
}, info) => {
  await open(page, "?accounts=one");
  await trigger(page).click();
  await expect(page.getByRole("dialog", { name: "Models" })).toBeVisible();
  await expect(radios(page)).toHaveCount(0);
  await proof(page, "before-one-account", info.project.name);
  await page.keyboard.press("Escape");
  await open(page, "?harness=devin");
  await trigger(page).click();
  await expect(radios(page)).toHaveCount(0);
});

test("each Mono picks its account in the model selector and its chat is handed over", async ({
  page,
}, info) => {
  await open(page);
  await expect(trigger(page)).not.toContainText("·");
  await trigger(page).click();
  await expect(radios(page)).toHaveText(["Default account", "Work"]);
  await proof(page, "after-selector-default", info.project.name);
  await accounts(page).getByRole("radio", { name: "Work" }).click();
  await expect(accounts(page).getByRole("radio", { name: "Work" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(trigger(page)).toContainText("· Work");
  await proof(page, "after-selector-work", info.project.name);
  await page.keyboard.press("Escape");
  // The chip at the bottom follows, and only this Mono's chat moved.
  await expect(page.getByRole("contentinfo")).toContainText("Work");
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
  await expect(trigger(page)).not.toContainText("·");
  await expect(page.getByRole("contentinfo")).not.toContainText("Work");
  await proof(page, "after-nova-on-default", info.project.name);
});

test("the usage chip picks the Mono's account too", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /usage details/ }).click();
  await page.getByRole("button", { name: /^Switch .* account$/ }).click();
  await page.getByRole("button", { name: "Work" }).click();
  await expect(trigger(page)).toContainText("· Work");
  await expect.poll(() => log(page)).toMatchObject([
    { id: "chat-pixi", account: "account-work" },
    { id: "chat-nova", account: "default" },
  ]);
});

test("a Mono whose account was removed uses the default and says so", async ({
  page,
}, info) => {
  await open(page, "?removed=1&settings=1");
  await settingsTrigger(page).click();
  await expect(page.locator("[data-model-account-notice]")).toHaveText(
    "Its account was removed, so it uses the default account.",
  );
  await expect(
    accounts(page).getByRole("radio", { name: "Default account" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => log(page)).toMatchObject([
    { id: "chat-pixi", account: "default", handOver: true },
    { id: "chat-nova", account: "default", handOver: false },
  ]);
  await proof(page, "after-removed-account", info.project.name);
});

test("a normal chat's selector offers the same choice and asks the app", async ({
  page,
}, info) => {
  await open(page, "?chat=1");
  const composer = page.locator("[data-chat]");
  const chatTrigger = composer.locator('button[aria-haspopup="menu"]');
  await expect(chatTrigger).not.toContainText("·");
  await chatTrigger.click();
  await page.getByRole("menuitem", { name: /^Model/ }).hover();
  await accounts(page).getByRole("radio", { name: "Work" }).click();
  await expect(chatTrigger).toContainText("· Work");
  await expect(page.locator("[data-chat-account]")).toHaveText("account-work");
  await proof(page, "after-chat-selector", info.project.name);
});
