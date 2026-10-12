import { describe, expect, it } from "vitest";
import type { Mono } from "../../monos/model/mono";
import { composeInboxMessage, inboxComposerCard } from "./githubTasks";
import type { InboxItem } from "./githubTasks";
import { inboxMonoChoices, inboxMonoMessage } from "./inboxMono";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    kind: "issue",
    title: "Crash on save",
    url: "https://github.com/acme/web/issues/157",
    state: "open",
    updatedAt: "2026-09-11T08:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    number: 157,
    projectPath: "/tmp/web",
    provider: "github",
    ...overrides,
  };
}

function mono(id: string, overrides: Partial<Mono> = {}): Mono {
  return { id, mascot: "crab", color: "red", projects: [], ...overrides };
}

describe("inboxMonoChoices", () => {
  it("lists each Mono by the name the rail shows", () => {
    expect(
      inboxMonoChoices([
        mono("a", { name: " Pixi " }),
        mono("b"),
        mono("c", { mascot: "mushroom", name: "  " }),
      ]),
    ).toEqual([
      { id: "a", name: "Pixi" },
      { id: "b", name: "MonoCrab" },
      { id: "c", name: "MonoShroom" },
    ]);
  });

  it("offers nothing when there is no Mono", () => {
    expect(inboxMonoChoices([])).toEqual([]);
  });
});

describe("inboxMonoMessage", () => {
  it("is what a new chat from the item would send", () => {
    const github = item();
    expect(inboxMonoMessage(github)).toBe(
      composeInboxMessage(inboxComposerCard(github), ""),
    );
    expect(inboxMonoMessage(github)).toBe(
      "Work on this GitHub issue:\n\n#157 Crash on save\nhttps://github.com/acme/web/issues/157",
    );
  });

  it("carries the tracker description a new chat would get", () => {
    const linear = item({
      provider: "linear",
      identifier: "ENG-4",
      title: "Slow import",
      url: "https://linear.app/acme/issue/ENG-4",
    });
    const message = inboxMonoMessage(linear, "Imports take a minute.");
    expect(message).toBe(
      composeInboxMessage(
        inboxComposerCard(linear, "Imports take a minute."),
        "",
      ),
    );
    expect(message).toContain("https://linear.app/acme/issue/ENG-4");
    expect(message).toContain("Imports take a minute.");
  });
});
