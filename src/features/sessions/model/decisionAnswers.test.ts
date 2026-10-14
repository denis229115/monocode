import { describe, expect, it, vi } from "vitest";
import { decisionAnswerer, type DecisionAnswerHost } from "./decisionAnswers";
import {
  parseDecisionQuestions,
  type DecisionCard,
  type DecisionOutcome,
} from "./decisionCard";

const asked: DecisionCard = {
  id: "old",
  // A Mono turn far older than the loaded transcript.
  turnId: "turn-from-last-month",
  askedAt: 1,
  questions: parseDecisionQuestions([
    {
      question: "Merge now?",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    },
  ]),
};

/** The card table as the Rust store keeps it: the first claim wins. */
function store() {
  let card: DecisionCard = asked;
  const delivered: string[] = [];
  return {
    delivered,
    stored: () => card,
    claim: vi.fn(async (_s: string, _id: string, outcome: DecisionOutcome) => {
      if (card.outcome) return { card, claimed: false };
      card = { ...card, outcome };
      return { card, claimed: true };
    }),
    release: vi.fn(async (_s: string, _id: string, outcome: DecisionOutcome) => {
      if (card.outcome === outcome) card = asked;
      return card;
    }),
  };
}

/** One window: its own copy of the card, sending to the shared session. */
function window(
  shared: ReturnType<typeof store>,
  send: DecisionAnswerHost["send"] = (_s, text) => {
    shared.delivered.push(text);
    return true;
  },
) {
  let seen: DecisionCard = asked;
  const host: DecisionAnswerHost = {
    card: () => seen,
    claim: shared.claim,
    release: shared.release,
    send: vi.fn(send),
    show: (_s, card) => {
      seen = card;
    },
    now: () => 7,
  };
  return { host, seen: () => seen, answer: decisionAnswerer(host) };
}

const reply = (value: string) => ({
  kind: "answered" as const,
  answers: { q1: [value] },
});

describe("answering a decision card", () => {
  it("saves the answer first, then sends it to the asking session", async () => {
    const shared = store();
    const { answer, seen } = window(shared);
    await answer("mono", "old", reply("yes"));
    expect(shared.stored().outcome).toEqual({
      kind: "answered",
      at: 7,
      reply: reply("yes"),
    });
    expect(shared.delivered).toEqual(["Merge now?\nyes"]);
    expect(seen().outcome?.kind).toBe("answered");
  });

  it("sends only the first of two conflicting answers from different windows", async () => {
    const shared = store();
    const left = window(shared);
    const right = window(shared);
    await Promise.all([
      left.answer("mono", "old", reply("yes")),
      right.answer("mono", "old", reply("no")),
    ]);
    expect(shared.delivered).toEqual(["Merge now?\nyes"]);
    expect(right.host.send).not.toHaveBeenCalled();
    // The late window now shows the answer that won.
    expect(right.seen().outcome).toEqual(shared.stored().outcome);
  });

  it("sends once when Continue is clicked again before the first answer lands", async () => {
    const shared = store();
    let accept!: (accepted: boolean) => void;
    const { host, answer } = window(
      shared,
      () => new Promise<boolean>((resolve) => (accept = resolve)),
    );
    const first = answer("mono", "old", reply("yes"));
    await answer("mono", "old", reply("yes"));
    await vi.waitFor(() => expect(host.send).toHaveBeenCalled());
    accept(true);
    await first;
    await answer("mono", "old", reply("yes"));
    expect(host.send).toHaveBeenCalledTimes(1);
    expect(shared.claim).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when saving fails, and once when the user tries again", async () => {
    const shared = store();
    const { host, answer } = window(shared);
    shared.claim.mockRejectedValueOnce(new Error("database is locked"));
    await expect(answer("mono", "old", reply("yes"))).rejects.toThrow("locked");
    expect(host.send).not.toHaveBeenCalled();
    expect(shared.stored().outcome).toBeUndefined();
    await answer("mono", "old", reply("yes"));
    await answer("mono", "old", reply("yes"));
    expect(shared.delivered).toEqual(["Merge now?\nyes"]);
  });

  it("puts the card back to waiting when the session refuses the message", async () => {
    const shared = store();
    let refuse = true;
    const { answer, seen } = window(shared, (_s, text) => {
      if (refuse) return false;
      shared.delivered.push(text);
      return true;
    });
    // The caller is told, for a place that can show it was not sent.
    expect(await answer("mono", "old", reply("yes"))).toBe(false);
    expect(shared.stored().outcome).toBeUndefined();
    expect(seen().outcome).toBeUndefined();
    refuse = false;
    expect(await answer("mono", "old", reply("no"))).toBe(true);
    expect(shared.delivered).toEqual(["Merge now?\nno"]);
    expect(shared.stored().outcome?.kind).toBe("answered");
  });

  it("dismisses a card whose questions were all skipped, without sending", async () => {
    const shared = store();
    const { host, answer } = window(shared);
    expect(await answer("mono", "old", { kind: "skipped" })).toBe(true);
    expect(host.send).not.toHaveBeenCalled();
    expect(shared.stored().outcome).toEqual({ kind: "dismissed", at: 7 });
  });

  it("says so when the card is not held here", async () => {
    const shared = store();
    const { host, answer } = window(shared);
    host.card = () => undefined;
    expect(await answer("mono", "old", reply("yes"))).toBe(false);
    expect(shared.claim).not.toHaveBeenCalled();
  });
});
