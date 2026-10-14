import { describe, expect, it } from "vitest";
import {
  parseDecisionQuestions,
  type DecisionCard,
} from "../../sessions/model/decisionCard";
import {
  formatSessionTitle,
  newSession,
  type MonoSpawnedSession,
  type Session,
} from "../../sessions/model/session";
import {
  monoLaunchesNeedingInput,
  monoLaunchState,
  monoSubagentQuestions,
} from "./monoSubagentQuestions";

const launch = (sessionId: string, title = sessionId): MonoSpawnedSession => ({
  sessionId,
  cwd: "/repo",
  title,
  harness: "codex",
  model: "gpt-6",
});

const card = (
  id: string,
  askedAt: number,
  patch: Partial<DecisionCard> = {},
): DecisionCard => ({
  id,
  turnId: `${id}-turn`,
  askedAt,
  questions: parseDecisionQuestions([{ question: `Question ${id}?` }]),
  ...patch,
});

function child(
  id: string,
  title: string,
  cards: DecisionCard[],
  patch: Partial<Session> = {},
): Session {
  return {
    ...newSession("codex", "/repo"),
    id,
    title,
    decisionCards: cards,
    ...patch,
  };
}

const none = new Map<string, string | undefined>();

describe("monoSubagentQuestions", () => {
  it("lists a loaded sub-agent's waiting cards with its title", () => {
    const { ready, unloaded } = monoSubagentQuestions(
      [launch("a")],
      [
        child("a", formatSessionTitle("codex", "Fix the login bug"), [
          card("c1", 5),
        ]),
      ],
    );
    expect(unloaded).toEqual([]);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      sessionId: "a",
      title: "Fix the login bug",
      cwd: "/repo",
    });
    expect(ready[0].cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("leaves out answered and dismissed cards, and sub-agents with none left", () => {
    const answered = card("done", 1, {
      outcome: { kind: "dismissed", at: 2 },
    });
    const { ready } = monoSubagentQuestions(
      [launch("a"), launch("b")],
      [
        child("a", "Mixed", [answered, card("open", 3)]),
        child("b", "Settled", [answered]),
      ],
    );
    expect(ready.map((entry) => entry.sessionId)).toEqual(["a"]);
    expect(ready[0].cards.map((c) => c.id)).toEqual(["open"]);
  });

  it("asks nothing for a sub-agent whose worktree was removed", () => {
    const { ready, unloaded } = monoSubagentQuestions(
      [launch("a")],
      [child("a", "Gone", [card("c1", 1)], { worktreeRemoved: true })],
      new Map([["a", undefined]]),
    );
    expect(ready).toEqual([]);
    // Open here, so the saved marker is not what answers for it.
    expect(unloaded).toEqual([]);
  });

  it("orders sub-agents by their oldest waiting card and cards by when they were asked", () => {
    const { ready } = monoSubagentQuestions(
      [launch("late"), launch("early"), launch("tie")],
      [
        child("late", "Late", [card("l1", 90)]),
        child("early", "Early", [card("e2", 40), card("e1", 10)]),
        child("tie", "Tie", [card("t1", 90)]),
      ],
    );
    expect(ready.map((entry) => entry.sessionId)).toEqual([
      "early",
      "late",
      "tie",
    ]);
    expect(ready[0].cards.map((c) => c.id)).toEqual(["e1", "e2"]);
  });

  it("does not sort the sessions it was given", () => {
    const cards = [card("b", 2), card("a", 1)];
    const session = child("a", "Own", cards);
    monoSubagentQuestions([launch("a")], [session]);
    expect(session.decisionCards?.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("names a saved sub-agent that is not open so it can be opened", () => {
    const { ready, unloaded } = monoSubagentQuestions(
      [launch("open"), launch("closed"), launch("quiet")],
      [child("open", "Open", [card("c1", 1)])],
      new Map([
        ["closed", undefined],
        ["stranger", undefined],
      ]),
    );
    expect(ready.map((entry) => entry.sessionId)).toEqual(["open"]);
    // Only the Mono's own launches, and only the ones with a saved card.
    expect(unloaded).toEqual(["closed"]);
  });

  it("lists each launch once even when the Mono followed it up", () => {
    const { ready, unloaded } = monoSubagentQuestions(
      [launch("a"), launch("a"), launch("b"), launch("b")],
      [child("a", "A", [card("c1", 1)])],
      new Map([["b", undefined]]),
    );
    expect(ready).toHaveLength(1);
    expect(unloaded).toEqual(["b"]);
  });

  it("is empty for a Mono that started nothing", () => {
    expect(
      monoSubagentQuestions([], [child("a", "A", [card("c", 1)])]),
    ).toEqual({ ready: [], unloaded: [] });
  });
});

describe("monoLaunchesNeedingInput", () => {
  it("counts a loaded session by itself and an unloaded one by its saved card", () => {
    const waiting = monoLaunchesNeedingInput(
      [launch("card"), launch("approval"), launch("quiet"), launch("saved")],
      [
        child("card", "Card", [card("c", 1)]),
        child("approval", "Approval", [], {
          blocks: [
            { id: "a", role: "tool", text: "rm", approval: { requestId: 1 } },
          ],
        }),
        child("quiet", "Quiet", []),
      ],
      new Map([
        ["saved", undefined],
        // Loaded, so its own cards decide, not a stale saved marker.
        ["quiet", undefined],
      ]),
    );
    expect([...waiting].sort()).toEqual(["approval", "card", "saved"]);
  });
});

describe("monoLaunchState", () => {
  it("reads the loaded session, else the saved card, else done", () => {
    const working = child("a", "A", [], { busy: true });
    expect(monoLaunchState(working, "a")).toBe("working");
    expect(
      monoLaunchState(child("a", "A", [card("c", 1)], { busy: true }), "a"),
    ).toBe("input");
    expect(monoLaunchState(undefined, "b", new Map([["b", undefined]]))).toBe(
      "input",
    );
    expect(monoLaunchState(undefined, "b", none)).toBe("done");
  });
});
