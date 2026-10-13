import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page
      .locator("[data-fixture]")
      .screenshot({ path: `${dir}/${name}.png`, animations: "disabled" });
}

test("notification settings can mute every Mono's input banners", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.goto("/tests/browser/notification-settings.html");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText("Project notifications")).toBeVisible();
  await proof(page, "settings", browser);

  const monos = page.getByRole("button", {
    name: "Notification categories for Monos",
  });
  await monos.click();
  // Monos only send approvals, questions and decision cards.
  const switches = page.getByRole("switch", { name: / for Monos$/ });
  await expect(switches).toHaveCount(1);
  await expect(switches).toHaveAccessibleName(
    "Agent approvals and questions for Monos",
  );
  await proof(page, "settings-monos-open", browser);

  // The switch itself is visually hidden; its row is what a person clicks.
  await page.getByRole("group", { name: "Monos" }).locator("label").click();
  await expect(switches).not.toBeChecked();
  await expect(page.getByText("0 of 1 enabled")).toBeVisible();
  await proof(page, "settings-monos-off", browser);
});
