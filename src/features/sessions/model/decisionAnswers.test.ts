import { describe, expect, it, vi } from "vitest";
import { decisionAnswerer, type DecisionAnswerHost } from "./decisionAnswers";
import {
  parseDecisionQuestions,
  type DecisionCard,
  type DecisionOutcome,
} from "./decisionCard";

/** Cards as storage keeps them, settled once, as the Rust store does. */
function fixture(accept: boolean | Promise<boolean> = true) {
  const stored = new Map<string, DecisionCard>([
    [
      "old",
      {
        id: "old",
        // A Mono turn far older than the loaded transcript.
        turnId: "turn-from-last-month",
        askedAt: 1,
        questions: parseDecisionQuestions([
          { question: "Merge now?", options: [{ label: "Yes", value: "yes" }] },
        ]),
      },
    ],
  ]);
  const shown: DecisionCard[] = [];
  const host: DecisionAnswerHost = {
    card: (_sessionId, cardId) => stored.get(cardId),
    send: vi.fn(() => accept),
    settle: vi.fn(async (_s: string, cardId: string, outcome: DecisionOutcome) => {
      const card = stored.get(cardId);
      if (!card) return undefined;
      if (!card.outcome) stored.set(cardId, { ...card, outcome });
      return stored.get(cardId);
    }),
    show: (_sessionId, card) => shown.push(card),
    now: () => 7,
  };
  return { host, stored, shown, answer: decisionAnswerer(host) };
}

const yes = { kind: "answered" as const, answers: { q1: ["yes"] } };

describe("answering a decision card", () => {
  it("sends the answer to the asking session, then saves and shows the card as answered", async () => {
    const { host, stored, shown, answer } = fixture();
    await answer("mono", "old", yes);
    expect(host.send).toHaveBeenCalledWith("mono", "Merge now?\nyes");
    expect(stored.get("old")?.outcome).toEqual({
      kind: "answered",
      at: 7,
      reply: yes,
    });
    expect(shown.map((card) => card.outcome?.kind)).toEqual(["answered"]);
  });

  it("sends once when Continue is clicked again before the first answer lands", async () => {
    let release!: (accepted: boolean) => void;
    const { host, answer } = fixture(
      new Promise<boolean>((resolve) => (release = resolve)),
    );
    const first = answer("mono", "old", yes);
    await answer("mono", "old", yes);
    release(true);
    await first;
    await answer("mono", "old", yes);
    expect(host.send).toHaveBeenCalledTimes(1);
    expect(host.settle).toHaveBeenCalledTimes(1);
  });

  it("leaves the card waiting when the session refuses the message", async () => {
    const { host, stored, answer } = fixture(false);
    await answer("mono", "old", yes);
    expect(host.settle).not.toHaveBeenCalled();
    expect(stored.get("old")?.outcome).toBeUndefined();
  });

  it("dismisses a card whose questions were all skipped, without sending", async () => {
    const { host, stored, answer } = fixture();
    await answer("mono", "old", { kind: "skipped" });
    expect(host.send).not.toHaveBeenCalled();
    expect(stored.get("old")?.outcome).toEqual({ kind: "dismissed", at: 7 });
  });
});
