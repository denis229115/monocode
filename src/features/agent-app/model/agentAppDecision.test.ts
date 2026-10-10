// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import type { DecisionCard } from "../../sessions/model/decisionCard";
import { handleAgentApp, type AgentAppHost } from "./agentApp";

const ask = {
  questions: [
    {
      header: "Release",
      question: "Merge PR #12 now?",
      options: [
        { label: "Merge now", description: "CI is green", recommended: true },
        { label: "Wait", value: "wait-for-windows" },
      ],
      links: ["https://github.com/denis229115/monocode/pull/12"],
    },
  ],
};

/**
 * A host whose storage, like the app's, knows every card the session ever
 * asked, including ones from turns no longer loaded.
 */
function fixture(kind: "mono" | "session" | "habit" = "session") {
  const source = {
    ...newSession("codex", "/tmp/project", "codex:test"),
    id: "asker",
  };
  const storage = new Map<string, DecisionCard>();
  const askDecision = vi.fn(
    (_id: string, card: Omit<DecisionCard, "turnId" | "outcome">) => {
      const existing = storage.get(card.id);
      if (existing) return existing;
      storage.set(card.id, { ...card, turnId: "turn" });
      return storage.get(card.id)!;
    },
  );
  const host = {
    isMono: () => kind === "mono",
    isHabitRun: () => kind === "habit",
    askDecision,
    now: () => new Date(1_000),
  } as unknown as AgentAppHost;
  return {
    source,
    host,
    askDecision,
    storage,
    settle: (id: string) => {
      storage.set(id, {
        ...storage.get(id)!,
        outcome: { kind: "dismissed", at: 2 },
      });
    },
  };
}

it.each(["session", "mono"] as const)(
  "a %s leaves a waiting card and the call returns without waiting",
  async (kind) => {
    const { source, host, storage } = fixture(kind);
    await expect(
      handleAgentApp(source, "ask-1", "chat.ask", ask, host),
    ).resolves.toMatchObject({ cardId: "ask-1", status: "waiting" });
    const card = storage.get("ask-1")!;
    expect(card).toMatchObject({ id: "ask-1", askedAt: 1_000 });
    expect(card.questions[0]).toMatchObject({
      id: "q1",
      header: "Release",
      prompt: "Merge PR #12 now?",
      multiSelect: false,
      allowCustom: true,
      links: ["https://github.com/denis229115/monocode/pull/12"],
      options: [
        {
          id: "Merge now",
          label: "Merge now",
          description: "CI is green",
          recommended: true,
        },
        { id: "wait-for-windows", label: "Wait" },
      ],
    });
  },
);

it("returns the stored card for a repeated request ID, from any point in history", async () => {
  const { source, host, storage, settle } = fixture();
  await handleAgentApp(source, "ask-1", "chat.ask", ask, host);
  await expect(
    handleAgentApp(source, "ask-1", "chat.ask", ask, host),
  ).resolves.toMatchObject({ cardId: "ask-1", status: "waiting" });
  expect(storage.size).toBe(1);
  // Answered or dismissed later, a retry reports what is stored now.
  settle("ask-1");
  await expect(
    handleAgentApp(source, "ask-1", "chat.ask", ask, host),
  ).resolves.toMatchObject({ status: "dismissed" });
  await expect(
    handleAgentApp(
      source,
      "ask-1",
      "chat.ask",
      { questions: [{ question: "Something else?" }] },
      host,
    ),
  ).rejects.toThrow("already used for another card");
  expect(storage.size).toBe(1);
});

it("matches a stored card whose keys came back in another order", async () => {
  const { source, host, storage } = fixture();
  await handleAgentApp(source, "ask-1", "chat.ask", ask, host);
  const stored = storage.get("ask-1")!;
  storage.set("ask-1", JSON.parse(JSON.stringify(stored, Object.keys(stored).sort())));
  storage.set("ask-1", {
    ...storage.get("ask-1")!,
    questions: stored.questions.map((question) =>
      Object.fromEntries(Object.entries(question).reverse()),
    ) as DecisionCard["questions"],
  });
  await expect(
    handleAgentApp(source, "ask-1", "chat.ask", ask, host),
  ).resolves.toMatchObject({ status: "waiting" });
});

it("keeps habit runs from asking", async () => {
  const { source, host, askDecision } = fixture("habit");
  await expect(
    handleAgentApp(source, "ask-1", "chat.ask", ask, host),
  ).rejects.toThrow("habit run cannot ask");
  expect(askDecision).not.toHaveBeenCalled();
});

it.each([
  [{}, "questions must be a list of 1 to 4"],
  [{ questions: [] }, "questions must be a list of 1 to 4"],
  [{ questions: Array(5).fill({ question: "Q?" }) }, "1 to 4"],
  [{ questions: [{ question: "" }] }, "question must be text"],
  [{ questions: [{ question: "Q?", extra: 1 }] }, "does not take extra"],
  [
    { questions: [{ question: "Q?" }, { question: "Q2?" }], extra: true },
    "Unknown chat.ask fields: extra",
  ],
  [
    { questions: [{ id: "a", question: "Q?" }, { id: "a", question: "R?" }] },
    "its own id",
  ],
  [
    {
      questions: [
        { question: "Q?", options: [{ label: "A" }, { label: "B", value: "A" }] },
      ],
    },
    "send the same answer",
  ],
  [
    {
      questions: [
        {
          question: "Q?",
          options: [
            { label: "A", recommended: true },
            { label: "B", recommended: true },
          ],
        },
      ],
    },
    "recommend one option at most",
  ],
  [
    { questions: [{ question: "Q?", allowCustom: false }] },
    "no options and no typed answer",
  ],
  [
    { questions: [{ question: "Q?", links: ["javascript:alert(1)"] }] },
    "http or https",
  ],
  [
    { questions: [{ question: "Q?", links: Array(5).fill("https://a.b") }] },
    "at most 4 URLs",
  ],
  [
    { questions: [{ question: "Q?", options: Array(10).fill({ label: "A" }) }] },
    "at most 9",
  ],
  [{ questions: [{ question: "Q?", multiSelect: "yes" }] }, "true or false"],
  [{ questions: [{ id: "constructor", question: "Q?" }] }, "reserved name"],
  [
    { questions: [{ question: "Q?", options: [{ label: "A", value: "__custom__" }] }] },
    "__custom__ is reserved",
  ],
])("rejects a card that cannot be answered cleanly: %j", async (input, error) => {
  const { source, host, askDecision } = fixture();
  await expect(
    handleAgentApp(source, "ask-1", "chat.ask", input, host),
  ).rejects.toThrow(error);
  expect(askDecision).not.toHaveBeenCalled();
});

it("rejects request IDs that cannot name a card", async () => {
  const { source, host } = fixture();
  await expect(
    handleAgentApp(source, "bad id!", "chat.ask", ask, host),
  ).rejects.toThrow("Invalid request ID");
});
