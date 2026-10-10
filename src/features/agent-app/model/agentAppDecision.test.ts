// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import {
  findDecisionCard,
  recordDecisionCard,
  settleDecisionCard,
  waitingDecisionCards,
  type DecisionCard,
} from "../../sessions/model/decisionCard";
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

/** A host that keeps cards on the session, as the app does. */
function fixture(kind: "mono" | "session" | "habit" = "session") {
  let session: Session = {
    ...newSession("codex", "/tmp/project", "codex:test"),
    id: "asker",
  };
  session.blocks = [{ id: "turn", role: "user", text: "Ship it" }];
  const askDecision = vi.fn((_id: string, card: DecisionCard) => {
    const existing = findDecisionCard(session.blocks, card.id);
    if (existing) return existing;
    session = recordDecisionCard(session, "turn", card);
    return card;
  });
  const host = {
    isMono: () => kind === "mono",
    isHabitRun: () => kind === "habit",
    askDecision,
    now: () => new Date(1_000),
  } as unknown as AgentAppHost;
  return {
    source: session,
    host,
    askDecision,
    session: () => session,
    settle: (id: string) => {
      session = settleDecisionCard(session, id, { kind: "dismissed", at: 2 });
    },
  };
}

it.each(["session", "mono"] as const)(
  "a %s leaves a waiting card and the call returns without waiting",
  async (kind) => {
    const { source, host, session } = fixture(kind);
    await expect(
      handleAgentApp(source, "ask-1", "chat.ask", ask, host),
    ).resolves.toMatchObject({ cardId: "ask-1", status: "waiting" });
    const [card] = waitingDecisionCards(session().blocks);
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

it("returns the same card for a repeated request ID instead of posting another", async () => {
  const { source, host, session, settle } = fixture();
  await handleAgentApp(source, "ask-1", "chat.ask", ask, host);
  await expect(
    handleAgentApp(source, "ask-1", "chat.ask", ask, host),
  ).resolves.toMatchObject({ cardId: "ask-1", status: "waiting" });
  expect(session().blocks[0].decisionCards).toHaveLength(1);
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
  expect(session().blocks[0].decisionCards).toHaveLength(1);
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
