import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page.screenshot({ path: `${dir}/${name}.png` });
}

const replies = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { replies: { pane: string; cardId: string; reply: unknown }[] })
        .replies,
  );

test("number keys answer a card without clicking, in the pane being used", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.setViewportSize({ width: 1000, height: 560 });
  await page.goto("/tests/browser/question-keys.html");
  await page.evaluate(() => document.fonts.ready);
  const alpha = page.locator('[data-pane="alpha"]');
  const beta = page.locator('[data-pane="beta"]');

  // Every option shows its number, the Other row too.
  const digits = alpha.locator("[data-question-digit]");
  await expect(digits).toHaveText(["1", "2", "3"]);
  await expect(digits.first()).toBeVisible();
  await expect(digits.first()).toHaveAttribute("aria-hidden", "true");
  await expect(
    alpha.getByRole("button", { name: /Wait for Windows/ }),
  ).toHaveAttribute("aria-keyshortcuts", "2");
  await proof(page, "badges", browser);

  // Two panes ask and none has been used: a digit guesses nothing.
  await page.keyboard.press("1");
  await expect(alpha).toContainText("Merge PR #12 now");
  await expect(beta).toContainText("Which changes go in the release notes?");

  // Work in the first pane by clicking its transcript; focus stays on the body.
  await alpha.locator("[data-transcript]").click();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");

  // Digits typed into the composer are text, not answers.
  await alpha.getByLabel("Message alpha").click();
  await page.keyboard.type("12");
  await expect(alpha.getByLabel("Message alpha")).toHaveValue("12");
  await expect(alpha).toContainText("Merge PR #12 now");
  await alpha.getByLabel("Message alpha").fill("");
  await alpha.locator("[data-transcript]").click();

  // 2 answers question 1 and moves to question 2.
  await page.keyboard.press("2");
  await expect(alpha).toContainText("Where should the release notes go?");
  await expect(alpha).toContainText("2 of 2");
  expect(await replies(page)).toEqual([]);
  await proof(page, "after-digit", browser);

  // The other pane did not hear it.
  await expect(beta).toContainText("Which changes go in the release notes?");
  expect(await replies(page)).toEqual([]);

  // 1 on the last question sends both answers.
  await page.keyboard.press("1");
  await expect.poll(() => replies(page)).toHaveLength(1);
  const [sent] = await replies(page);
  expect(sent.pane).toBe("alpha");
  expect(sent.cardId).toBe("release");
  // 2 picked "Wait for Windows" and 1 picked "Changelog".
  expect(sent.reply).toEqual({
    kind: "answered",
    answers: { q1: ["wait"], q2: ["changelog"] },
  });
  await expect(alpha.locator("[data-question-form]")).toHaveCount(0);

  // The second pane answers once it is the one in use; multi-select toggles.
  await beta.locator("[data-transcript]").click();
  await page.keyboard.press("1");
  await page.keyboard.press("3");
  const decision = beta.getByRole("button", { name: /Decision cards/ });
  const ci = beta.getByRole("button", { name: /CI fixture fix/ });
  await expect(decision).toHaveAttribute("aria-pressed", "true");
  await expect(ci).toHaveAttribute("aria-pressed", "true");
  await expect(beta).toContainText("Which changes go in the release notes?");
  expect(await replies(page)).toHaveLength(1);
  await page.keyboard.press("1");
  await expect(decision).toHaveAttribute("aria-pressed", "false");
  await proof(page, "multi-select", browser);
  await beta.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => replies(page)).toHaveLength(2);
  expect((await replies(page))[1].pane).toBe("beta");
});
