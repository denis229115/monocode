import { describe, expect, it } from "vitest";
import {
  needsInputCount,
  needsInputSessionIds,
  newSession,
  sessionNeedsInput,
  type Session,
} from "./session";
import {
  decisionAnswerText,
  parseDecisionQuestions,
  restoreDecisionCard,
  restoreDecisionCards,
  sameDecisionQuestions,
  turnDecisionCards,
  waitingDecisionCards,
  withDecisionCard,
  type DecisionCard,
} from "./decisionCard";
import { CUSTOM_OPTION_ID, isCustomSelection } from "./userQuestion";

function card(id: string, questions: unknown[], turnId = "turn-1"): DecisionCard {
  return { id, turnId, questions: parseDecisionQuestions(questions), askedAt: 1 };
}

describe("decision answers", () => {
  const release = card("release", [
    {
      id: "merge",
      question: "Merge PR #12 now?",
      options: [
        { label: "Merge now", value: "merge" },
        { label: "Wait" },
      ],
    },
    {
      id: "checks",
      question: "Which checks first?",
      multiSelect: true,
      options: [{ label: "Windows" }, { label: "Linux" }],
    },
    { id: "note", question: "Anything for the release notes?" },
  ]);

  it("sends each question with the option values or the typed answer under it", () => {
    expect(
      decisionAnswerText(release, {
        kind: "answered",
        answers: {
          merge: ["merge"],
          checks: ["Windows", "Linux"],
          note: [CUSTOM_OPTION_ID],
        },
        custom: { note: "  Mention the Finder fix  " },
      }),
    ).toBe(
      "Merge PR #12 now?\nmerge\n\nWhich checks first?\nWindows, Linux\n\nAnything for the release notes?\nMention the Finder fix",
    );
  });

  it("says which questions were skipped", () => {
    expect(
      decisionAnswerText(release, {
        kind: "answered",
        answers: { merge: ["Wait"] },
      }),
    ).toBe(
      "Merge PR #12 now?\nWait\n\nWhich checks first?\n(skipped)\n\nAnything for the release notes?\n(skipped)",
    );
  });

  it("sends an option labelled Other as its own value, never as a typed answer", () => {
    const plans = card("plans", [
      {
        question: "Which plan?",
        allowCustom: false,
        options: [
          { label: "Ship", value: "ship" },
          { label: "Other", value: "other-plan" },
        ],
      },
    ]);
    const [question] = plans.questions;
    expect(isCustomSelection(question, "other-plan")).toBe(false);
    expect(
      decisionAnswerText(plans, {
        kind: "answered",
        answers: { q1: ["other-plan"] },
        custom: { q1: "typed anyway" },
      }),
    ).toBe("Which plan?\nother-plan");
  });
});

describe("question ids", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "rejects %s, which would collide with an object's own properties",
    (id) => {
      expect(() => parseDecisionQuestions([{ id, question: "Q?" }])).toThrow(
        "reserved name",
      );
      expect(
        restoreDecisionCard({
          id: "saved",
          turnId: "t",
          questions: [{ id, prompt: "Q?", options: [] }],
        }),
      ).toBeUndefined();
    },
  );
});

describe("waiting cards", () => {
  it("lists waiting cards in the order they were asked, until each is settled", () => {
    const first = card("first", [{ question: "First?" }]);
    const second = card("second", [{ question: "Second?" }]);
    let session: Session = {
      ...newSession("codex", "/tmp/project", "codex:test"),
      decisionCards: [first, second],
    };
    expect(waitingDecisionCards(session.decisionCards).map((c) => c.id)).toEqual(
      ["first", "second"],
    );
    session = withDecisionCard(session, {
      ...second,
      outcome: { kind: "dismissed", at: 5 },
    });
    expect(waitingDecisionCards(session.decisionCards).map((c) => c.id)).toEqual(
      ["first"],
    );
    expect(session.decisionCards).toHaveLength(2);
  });

  it("waits whether or not the turn that asked is loaded, and shows under that turn", () => {
    const old = card("old", [{ question: "Asked long ago?" }], "turn-0");
    const recent = card("recent", [{ question: "Asked now?" }], "turn-9");
    const loaded = [
      { id: "turn-9", role: "user" as const, text: "latest" },
      { id: "reply-9", role: "assistant" as const, text: "ok" },
    ];
    expect(waitingDecisionCards([old, recent]).map((c) => c.id)).toEqual([
      "old",
      "recent",
    ]);
    expect(turnDecisionCards([old, recent], loaded).map((c) => c.id)).toEqual([
      "recent",
    ]);
  });
});

describe("saved cards", () => {
  it("come back as they were asked, waiting or settled, whatever their key order", () => {
    const waiting = card("waiting", [
      {
        question: "Merge?",
        options: [{ label: "Yes", description: "Ship", recommended: true }],
        links: ["https://github.com/o/r/pull/1"],
      },
    ]);
    const answered: DecisionCard = {
      ...card("answered", [{ question: "Name?" }]),
      outcome: {
        kind: "answered",
        at: 3,
        reply: { kind: "answered", answers: {}, custom: { q1: "Mono" } },
      },
    };
    const saved = JSON.parse(JSON.stringify([waiting, answered]));
    // Storage may hand keys back sorted.
    const sorted = JSON.parse(JSON.stringify(saved, Object.keys(saved[0]).sort()));
    expect(restoreDecisionCards(saved)).toEqual([waiting, answered]);
    expect(
      sameDecisionQuestions(
        restoreDecisionCard({ ...sorted[0], questions: saved[0].questions })!
          .questions,
        waiting.questions,
      ),
    ).toBe(true);
  });

  it("are held to the same rules as a new card", () => {
    const question = (extra: Record<string, unknown>) => ({
      id: "q1",
      prompt: "Q?",
      options: [],
      ...extra,
    });
    for (const questions of [
      [question({}), question({})],
      [
        question({
          options: [
            { id: "a", label: "A", recommended: true },
            { id: "b", label: "B", recommended: true },
          ],
        }),
      ],
      [question({ options: [{ id: "a", label: "A" }, { id: "a", label: "B" }] })],
      [question({ allowCustom: false })],
      [question({ links: ["javascript:alert(1)"] })],
      [question({ options: [{ id: CUSTOM_OPTION_ID, label: "Other" }] })],
      Array(5).fill(question({})),
      [],
      [question({ prompt: "   " })],
      [question({ prompt: "x".repeat(2001) })],
      [question({ id: "x".repeat(65) })],
      [question({ header: "" })],
      [question({ options: [{ id: "a", label: "" }] })],
      [question({ options: [{ id: "a", label: "A", description: "x".repeat(501) }] })],
    ])
      expect(
        restoreDecisionCard({ id: "saved", turnId: "t", questions }),
      ).toBeUndefined();
    expect(
      restoreDecisionCard({ id: "saved", turnId: "t", questions: [question({})] }),
    ).toMatchObject({ id: "saved", questions: [{ id: "q1", exactOptions: true }] });
  });
});

describe("a waiting card needs the user", () => {
  const ask = card("ask", [{ question: "Merge now?" }]);
  const other = card("other", [{ question: "Tag it?" }]);
  const chat = (id: string, patch: Partial<Session> = {}): Session => ({
    ...newSession("codex", "/tmp/monocode", "codex:test"),
    id,
    ...patch,
  });

  it("until every card is answered or dismissed", () => {
    const answered = {
      ...ask,
      outcome: {
        kind: "answered" as const,
        at: 2,
        reply: { kind: "answered" as const, answers: {} },
      },
    };
    const dismissed = { ...other, outcome: { kind: "dismissed" as const, at: 3 } };
    expect(sessionNeedsInput(chat("s"))).toBe(false);
    expect(sessionNeedsInput(chat("s", { decisionCards: [ask, other] }))).toBe(true);
    expect(sessionNeedsInput(chat("s", { decisionCards: [answered, other] }))).toBe(true);
    expect(
      sessionNeedsInput(chat("s", { decisionCards: [answered, dismissed] })),
    ).toBe(false);
  });

  it("not once its worktree is removed", () => {
    expect(
      sessionNeedsInput(
        chat("s", { decisionCards: [ask], worktreeRemoved: true }),
      ),
    ).toBe(false);
  });

  it("marks a worker's lead, and a chat not loaded by its saved card", () => {
    const worker = chat("worker", {
      decisionCards: [ask],
      orchestrationLeadId: "lead",
    });
    expect(needsInputSessionIds([worker, chat("idle")])).toEqual(
      new Set(["worker", "lead"]),
    );
    expect(needsInputSessionIds([], new Map([["closed", undefined]]))).toEqual(
      new Set(["closed"]),
    );
  });

  it("marks the lead of a worker known only by its saved card", () => {
    expect(
      needsInputSessionIds([chat("lead")], new Map([["worker", "lead"]])),
    ).toEqual(new Set(["worker", "lead"]));
  });

  it("counts loaded and saved chats once each for the Dock, not their leads", () => {
    const loaded = [
      chat("open", { decisionCards: [ask] }),
      chat("idle"),
      chat("worker", { decisionCards: [ask], orchestrationLeadId: "lead" }),
    ];
    const saved = new Map<string, string | undefined>([
      ["open", undefined],
      ["closed", undefined],
      ["closed-worker", "lead"],
    ]);
    expect(needsInputCount(loaded, saved)).toBe(4);
    expect(needsInputCount([], saved)).toBe(3);
  });

  it("lets a loaded chat answer for itself over its saved card", () => {
    const settled = chat("s", {
      decisionCards: [{ ...ask, outcome: { kind: "dismissed", at: 2 } }],
    });
    expect(needsInputSessionIds([settled], new Map([["s", undefined]]))).toEqual(
      new Set(),
    );
  });
});
