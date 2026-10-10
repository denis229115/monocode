import { describe, expect, it } from "vitest";
import { newSession, type Session } from "./session";
import {
  decisionAnswerText,
  parseDecisionQuestions,
  recordDecisionCard,
  restoreDecisionCards,
  settleDecisionCard,
  waitingDecisionCards,
  type DecisionCard,
} from "./decisionCard";
import { CUSTOM_OPTION_ID } from "./userQuestion";

function card(id: string, questions: unknown[]): DecisionCard {
  return { id, questions: parseDecisionQuestions(questions), askedAt: 1 };
}

function sessionWith(...cards: DecisionCard[]): Session {
  let session: Session = {
    ...newSession("codex", "/tmp/project", "codex:test"),
    id: "asker",
    blocks: [
      { id: "turn-1", role: "user", text: "one" },
      { id: "reply-1", role: "assistant", text: "Two things to decide." },
    ],
  };
  for (const entry of cards)
    session = recordDecisionCard(session, "turn-1", entry);
  return session;
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
});

describe("waiting cards", () => {
  it("lists waiting cards in the order they were asked, until each is settled", () => {
    const first = card("first", [{ question: "First?" }]);
    const second = card("second", [{ question: "Second?" }]);
    let session = sessionWith(first, second);
    expect(waitingDecisionCards(session.blocks).map((c) => c.id)).toEqual([
      "first",
      "second",
    ]);
    session = settleDecisionCard(session, "second", {
      kind: "answered",
      at: 5,
      reply: { kind: "answered", answers: {}, custom: { q1: "Yes" } },
    });
    expect(waitingDecisionCards(session.blocks).map((c) => c.id)).toEqual([
      "first",
    ]);
    // A settled card keeps its first outcome.
    const again = settleDecisionCard(session, "second", {
      kind: "dismissed",
      at: 6,
    });
    expect(again).toBe(session);
    session = settleDecisionCard(session, "first", { kind: "dismissed", at: 7 });
    expect(waitingDecisionCards(session.blocks)).toEqual([]);
  });

  it("survives a save and load, waiting or settled", () => {
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
    expect(restoreDecisionCards(saved)).toEqual([waiting, answered]);
    expect(
      restoreDecisionCards([
        { id: "broken" },
        {
          id: "unsafe",
          askedAt: 1,
          questions: [
            { id: "q1", prompt: "Q?", options: [], links: ["javascript:x"] },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "unsafe",
        askedAt: 1,
        questions: [
          {
            id: "q1",
            prompt: "Q?",
            multiSelect: false,
            allowCustom: true,
            options: [],
          },
        ],
      },
    ]);
  });
});
