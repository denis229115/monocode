import { expect, test, type Page } from "@playwright/test";

// Set PROOF_DIR to keep a screenshot of each step, as pull request evidence.
async function proof(page: Page, name: string, browser: string) {
  const dir = process.env.PROOF_DIR;
  if (dir && browser === "chromium")
    await page.screenshot({ path: `${dir}/${name}.png` });
}

const sent = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { sent: { sessionId: string; text: string }[] })
      .sent,
  );

test("waiting decision cards page, answer to the agent that asked, and settle", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/tests/browser/decision-cards.html");
  await page.evaluate(() => document.fonts.ready);
  const pane = page.locator('[data-pane="session"]');
  const panel = pane.locator("[data-decision-card]");

  // The card: its question, option descriptions, recommended mark and links.
  await expect(panel).toContainText(
    "Merge PR #12 now, or wait for the Windows check?",
  );
  await expect(panel).toContainText(
    "Windows is flaky on main too; nothing in this PR touches it.",
  );
  await expect(
    panel.getByRole("button", { name: /Merge now.*Recommended/ }),
  ).toBeVisible();
  await expect(panel.locator("[data-decision-pager]")).toHaveText(
    "Card 1 of 2",
  );
  const pr = panel.locator('[data-github-work-item-chip="pr"]');
  await expect(pr).toHaveText("PR #12");
  await expect(panel.locator("[data-question-link]")).toHaveText(
    "github.com/denis229115/monocode/actions/runs/4411",
  );
  await proof(page, "card", browser);

  // A PR link shows as a PR card and opens the PR.
  await pr.hover();
  const popover = page.locator("[data-github-work-item-popover]");
  await expect(popover).toContainText(
    "Ask decision cards that wait without blocking",
  );
  await proof(page, "pr-card", browser);
  await pr.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { opened: string[] }).opened),
    )
    .toEqual(["https://github.com/denis229115/monocode/pull/12"]);
  await page.mouse.move(0, 0);
  await panel.locator("[data-question-link]").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { opened: string[] }).opened),
    )
    .toHaveLength(2);

  // Two waiting cards page one at a time.
  await panel.getByRole("button", { name: "Next card" }).click();
  await expect(panel.locator("[data-decision-pager]")).toHaveText(
    "Card 2 of 2",
  );
  await expect(panel).toContainText("Which changes go in the release notes?");
  await panel.getByRole("button", { name: /Decision cards/ }).click();
  await panel.getByRole("button", { name: /Finder paste fix/ }).click();
  await proof(page, "paging", browser);
  await panel.getByRole("button", { name: "Continue" }).click();

  // The answer goes to the session that asked, and the card settles.
  await expect.poll(() => sent(page)).toEqual([
    {
      sessionId: "session",
      text: "Which changes go in the release notes?\nDecision cards, Finder paste fix",
    },
  ]);
  await expect(panel.locator("[data-decision-pager]")).toHaveCount(0);
  await expect(panel).toContainText("Merge PR #12 now");
  const answered = pane.locator('[data-decision-summary="notes"]');
  await expect(answered).toHaveAttribute("data-status", "answered");
  await expect(answered).toContainText(
    "Which changes go in the release notes? → Decision cards, Finder paste fix",
  );

  // The Mono's cards answer to the Mono only. Its first card was asked in a
  // turn outside the loaded history and is answerable all the same.
  const mono = page.locator('[data-pane="mono"] [data-decision-card]');
  await expect(mono).toContainText("Keep the Monday CI check?");
  await expect(mono.locator("[data-decision-pager]")).toHaveText("Card 1 of 2");
  await expect(
    page.locator('[data-pane="mono"] [data-decision-summary="old-habit"]'),
  ).toHaveCount(0);
  await proof(page, "older-mono-card", browser);
  await mono.getByRole("button", { name: /Keep it/ }).click();
  await mono.getByRole("button", { name: "Continue" }).click();
  await expect.poll(async () => (await sent(page))[1]).toEqual({
    sessionId: "mono",
    text: "Keep the Monday CI check?\nKeep it",
  });
  await expect(mono).toContainText("What should I put first?");
  await mono.getByRole("button", { name: /Ship #12/ }).click();
  await mono.getByRole("button", { name: "Continue" }).click();
  await expect.poll(async () => (await sent(page))[2]).toEqual({
    sessionId: "mono",
    text: "What should I put first?\nShip #12",
  });
  await expect(mono).toHaveCount(0);

  // Answer the last card with the recommended option.
  await panel.getByRole("button", { name: /Merge now/ }).click();
  await panel.getByRole("button", { name: "Continue" }).click();
  await expect.poll(async () => (await sent(page))[3]).toEqual({
    sessionId: "session",
    text: "Merge PR #12 now, or wait for the Windows check?\nmerge",
  });
  await expect(pane.locator("[data-decision-card]")).toHaveCount(0);
  await expect(
    pane.locator('[data-decision-summary="merge"]'),
  ).toHaveAttribute("data-status", "answered");
  await proof(page, "answered", browser);
});

test("skipping every question dismisses the card without sending", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/decision-cards.html");
  const mono = page.locator('[data-pane="mono"]');
  const panel = mono.locator("[data-decision-card]");
  // The card from older history dismisses like any other.
  await expect(panel).toContainText("Keep the Monday CI check?");
  await panel.getByRole("button", { name: "Skip" }).click();
  await expect(panel).toContainText("What should I put first?");
  await expect(panel.locator("[data-decision-pager]")).toHaveCount(0);
  await panel.getByRole("button", { name: "Skip" }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    mono.locator('[data-decision-summary="focus"]'),
  ).toHaveAttribute("data-status", "dismissed");
  await expect(mono.locator('[data-decision-summary="focus"]')).toContainText(
    "Decision · Dismissed",
  );
  expect(await sent(page)).toEqual([]);
  await proof(page, "dismissed", info.project.name);
});

test("a card reads link, then question, then options, and says each thing once", async ({
  page,
}, info) => {
  const browser = info.project.name;
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("/tests/browser/decision-cards.html?only=layout");
  await page.evaluate(() => document.fonts.ready);
  const pane = page.locator('[data-pane="layout"]');
  const panel = pane.locator("[data-decision-card]");
  const top = async (selector: string) =>
    (await panel.locator(selector).first().boundingBox())!.y;

  // The PR card comes first, then the question, then the options.
  await expect(panel).toContainText("Merge this now?");
  await proof(page, "layout-link", browser);
  const link = await top("[data-github-work-item-chip]");
  const question = await top("[data-question-prompt]");
  const options = await top('[role="group"]');
  expect(link).toBeLessThan(question);
  expect(question).toBeLessThan(options);

  // The header that only restated the PR number is gone; the chip says it.
  await expect(panel.locator("[data-github-work-item-chip]")).toHaveText(
    "PR #12",
  );
  await expect(panel.locator("[data-question-title]")).toHaveText("");

  // "Other" explains itself like the options do.
  const other = panel.getByRole("button", { name: /Other/ });
  await expect(other).toContainText("Type your own answer");

  // A long, multi-paragraph question wraps, keeps its paragraphs, and leaves
  // the options reachable.
  await panel.getByRole("button", { name: "Next card" }).click();
  await expect(panel).toContainText("Which one should I take first?");
  await proof(page, "layout-long", browser);
  const prompt = panel.locator("[data-question-prompt]");
  const box = (await prompt.boundingBox())!;
  const form = (await panel.locator("form").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(form.x + form.width);
  expect(
    await prompt.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(
    await prompt.evaluate((node) => getComputedStyle(node).whiteSpace),
  ).toBe("pre-line");
  expect(await prompt.innerText()).toContain("tonight.\n\nFirst,");
  // The whole card stays inside the window, with the options and Continue
  // reachable by scrolling the question if it is tall.
  const viewport = page.viewportSize()!;
  expect(form.height).toBeLessThan(viewport.height * 0.7);
  await prompt.evaluate((node) => (node.scrollTop = node.scrollHeight));
  await expect(
    panel.getByRole("button", { name: /Windows installer/ }),
  ).toBeInViewport();
  await expect(panel.getByRole("button", { name: "Continue" })).toBeInViewport();

  // The typed answer is labelled for what it is, not by the card header.
  await panel.getByRole("button", { name: "Next card" }).click();
  await expect(panel).toContainText("What should the PR comment say?");
  await proof(page, "layout-comment", browser);
  await expect(panel.getByRole("textbox", { name: "Your answer" })).toBeVisible();

  // The settled summary stays compact however long the question was.
  const settled = pane.locator('[data-decision-summary="settled-long"]');
  await expect(settled).toContainText("Windows first");
  expect((await settled.boundingBox())!.height).toBeLessThan(150);
  await proof(page, "layout-settled", browser);
});
