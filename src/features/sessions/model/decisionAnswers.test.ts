import { describe, expect, it, vi } from "vitest";
import {
  decisionAnswerer,
  withDecisionAnswer,
  withoutDecisionAnswer,
  type DecisionAnswerHost,
} from "./decisionAnswers";
import {
  parseDecisionQuestions,
  type DecisionCard,
  type DecisionOutcome,
} from "./decisionCard";
import { canDispatchQueuedHead } from "./messageQueue";
import { newSession, type Session } from "./session";

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

/**
 * Storage as the Rust store keeps it: the first claim wins, an answer stays
 * sending until a saved queue carries it, and only one caller in the running
 * app takes up a sending card.
 */
function store() {
  let card: DecisionCard = asked;
  let savedQueue: string[] = [];
  let delivering = false;
  return {
    stored: () => card,
    savedQueue: () => savedQueue,
    claim: vi.fn(
      async (
        _s: string,
        _id: string,
        outcome: DecisionOutcome,
        sending: boolean,
      ) => {
        if (card.outcome) return { card, claimed: false };
        card = { ...card, outcome, ...(sending ? { sending: true as const } : {}) };
        delivering = sending;
        return { card, claimed: true };
      },
    ),
    resume: vi.fn(async () => {
      if (!card.sending || delivering) return false;
      delivering = true;
      return true;
    }),
    release: vi.fn(async (_s: string, _id: string, outcome: DecisionOutcome) => {
      if (card.outcome === outcome) card = asked;
      delivering = false;
      return card;
    }),
    /** A session save: the queue and the cleared flag land together. */
    save(queue: string[]) {
      savedQueue = queue;
      if (card.sending && queue.includes(`decision-${card.id}`)) {
        const { sending: _, ...sent } = card;
        card = sent;
        delivering = false;
      }
    },
    /** What quitting MonoCode does to the store. */
    quit() {
      delivering = false;
    },
  };
}

type Shared = ReturnType<typeof store>;

/** One window: its own copy of the card and of the session's queue. */
function window(
  shared: Shared,
  save: (queue: string[]) => void | Promise<void> = (queue) =>
    shared.save(queue),
) {
  let seen: DecisionCard = shared.stored();
  let queue: { id: string; text: string }[] = [];
  const host: DecisionAnswerHost = {
    card: () => seen,
    saved: () => true,
    claim: shared.claim,
    resume: shared.resume,
    release: shared.release,
    queue: vi.fn(async (_s, id, text) => {
      if (!queue.some((message) => message.id === id))
        queue = [...queue, { id, text }];
      try {
        await save(queue.map((message) => message.id));
        return true;
      } catch {
        queue = queue.filter((message) => message.id !== id);
        return false;
      }
    }),
    show: (_s, card) => {
      seen = card;
    },
    now: () => 7,
  };
  return {
    host,
    seen: () => seen,
    queue: () => queue,
    ...decisionAnswerer(host),
  };
}

const reply = (value: string) => ({
  kind: "answered" as const,
  answers: { q1: [value] },
});

describe("answering a decision card", () => {
  it("saves the answer first, then queues it for the asking session", async () => {
    const shared = store();
    const { answer, seen, queue } = window(shared);
    await answer("mono", "old", reply("yes"));
    expect(shared.stored().outcome).toEqual({
      kind: "answered",
      at: 7,
      reply: reply("yes"),
    });
    expect(queue()).toEqual([{ id: "decision-old", text: "Merge now?\nyes" }]);
    expect(shared.savedQueue()).toEqual(["decision-old"]);
    expect(shared.stored().sending).toBeUndefined();
    expect(seen().outcome?.kind).toBe("answered");
    expect(seen().sending).toBeUndefined();
  });

  it("queues only the first of two conflicting answers from different windows", async () => {
    const shared = store();
    const left = window(shared);
    const right = window(shared);
    await Promise.all([
      left.answer("mono", "old", reply("yes")),
      right.answer("mono", "old", reply("no")),
    ]);
    expect(left.queue().map((message) => message.text)).toEqual([
      "Merge now?\nyes",
    ]);
    expect(right.host.queue).not.toHaveBeenCalled();
    // The late window now shows the answer that won.
    expect(right.seen().outcome).toEqual(shared.stored().outcome);
  });

  it("queues once when Continue is clicked again before the first answer lands", async () => {
    const shared = store();
    let saved!: () => void;
    const { host, answer } = window(
      shared,
      (queue) =>
        new Promise<void>((resolve) => {
          saved = () => {
            shared.save(queue);
            resolve();
          };
        }),
    );
    const first = answer("mono", "old", reply("yes"));
    await answer("mono", "old", reply("yes"));
    await vi.waitFor(() => expect(host.queue).toHaveBeenCalled());
    saved();
    await first;
    await answer("mono", "old", reply("yes"));
    expect(host.queue).toHaveBeenCalledTimes(1);
    expect(shared.claim).toHaveBeenCalledTimes(1);
  });

  it("queues nothing when claiming fails, and once when the user tries again", async () => {
    const shared = store();
    const { host, answer, queue } = window(shared);
    shared.claim.mockRejectedValueOnce(new Error("database is locked"));
    await expect(answer("mono", "old", reply("yes"))).rejects.toThrow("locked");
    expect(host.queue).not.toHaveBeenCalled();
    expect(shared.stored().outcome).toBeUndefined();
    await answer("mono", "old", reply("yes"));
    await answer("mono", "old", reply("yes"));
    expect(queue().map((message) => message.text)).toEqual([
      "Merge now?\nyes",
    ]);
  });

  it("puts the card back to waiting when the answer's save fails", async () => {
    const shared = store();
    let fail = true;
    const { answer, seen, queue } = window(shared, (ids) => {
      if (fail) throw new Error("disk full");
      shared.save(ids);
    });
    await answer("mono", "old", reply("yes"));
    // Never Answered with nothing sent: the card waits again, nothing queued.
    expect(shared.stored().outcome).toBeUndefined();
    expect(shared.stored().sending).toBeUndefined();
    expect(seen().outcome).toBeUndefined();
    expect(queue()).toEqual([]);
    expect(shared.savedQueue()).toEqual([]);
    fail = false;
    await answer("mono", "old", reply("no"));
    expect(queue().map((message) => message.text)).toEqual(["Merge now?\nno"]);
    expect(shared.stored().outcome?.kind).toBe("answered");
  });

  it("queues an answer lost to a quit once, after restart", async () => {
    const shared = store();
    // MonoCode quits while the answer's save is still on its way.
    const before = window(shared, () => new Promise<void>(() => {}));
    void before.answer("mono", "old", reply("yes"));
    await vi.waitFor(() => expect(before.host.queue).toHaveBeenCalled());
    shared.quit();
    expect(shared.stored().outcome?.kind).toBe("answered");
    expect(shared.stored().sending).toBe(true);
    expect(shared.savedQueue()).toEqual([]);

    // After restart the session loads the card still sending, in two windows.
    const after = window(shared);
    const other = window(shared);
    await Promise.all([
      after.resume("mono", "old"),
      other.resume("mono", "old"),
      after.resume("mono", "old"),
    ]);
    const queued = [...after.queue(), ...other.queue()];
    expect(queued).toEqual([{ id: "decision-old", text: "Merge now?\nyes" }]);
    expect(shared.savedQueue()).toEqual(["decision-old"]);
    expect(shared.stored().sending).toBeUndefined();
    // A later load finds nothing left to send.
    const later = window(shared);
    await later.resume("mono", "old");
    expect(later.host.queue).not.toHaveBeenCalled();
  });

  it("dismisses a card whose questions were all skipped, without queuing", async () => {
    const shared = store();
    const { host, answer } = window(shared);
    await answer("mono", "old", { kind: "skipped" });
    expect(host.queue).not.toHaveBeenCalled();
    expect(shared.stored().outcome).toEqual({ kind: "dismissed", at: 7 });
    expect(shared.stored().sending).toBeUndefined();
  });
});

describe("queuing a decision answer", () => {
  const sending: DecisionCard = {
    ...asked,
    outcome: { kind: "answered", at: 1, reply: reply("yes") },
    sending: true,
  };
  const chat = (patch: Partial<Session> = {}): Session => ({
    ...newSession("claude", "/tmp/project"),
    decisionCards: [sending],
    ...patch,
  });

  it("holds the answer in the queue until its save settles the card", () => {
    const queued = withDecisionAnswer(chat(), "decision-old", "yes");
    expect(queued.queuedMessages?.map((message) => message.id)).toEqual([
      "decision-old",
    ]);
    expect(canDispatchQueuedHead(queued)).toBe(false);
    const { sending: _, ...sent } = sending;
    expect(canDispatchQueuedHead({ ...queued, decisionCards: [sent] })).toBe(
      true,
    );
  });

  it("sends itself when alone, and waits with messages paused by a restart", () => {
    const alone = withDecisionAnswer(chat(), "decision-old", "yes");
    expect(alone.queueStatus).toBe("active");
    const paused = withDecisionAnswer(
      chat({
        queuedMessages: [{ id: "earlier", text: "hi", attachments: [] }],
        queueStatus: "paused",
      }),
      "decision-old",
      "yes",
    );
    expect(paused.queuedMessages?.map((message) => message.id)).toEqual([
      "earlier",
      "decision-old",
    ]);
    expect(paused.queueStatus).toBe("paused");
  });

  it("queues an answer once and takes it back with its bubble", () => {
    const once = withDecisionAnswer(
      withDecisionAnswer(chat(), "decision-old", "yes"),
      "decision-old",
      "yes",
    );
    expect(once.queuedMessages).toHaveLength(1);
    const bubble = { id: "decision-old", role: "user" as const, text: "yes" };
    const back = withoutDecisionAnswer(
      { ...once, blocks: [...once.blocks, bubble] },
      "decision-old",
    );
    expect(back.queuedMessages).toBeUndefined();
    expect(back.blocks.some((block) => block.id === "decision-old")).toBe(false);
  });
});
