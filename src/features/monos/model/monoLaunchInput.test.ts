import { describe, expect, it } from "vitest";
import {
  parseDecisionQuestions,
  type DecisionCard,
} from "../../sessions/model/decisionCard";
import {
  newSession,
  type MonoSpawnedSession,
  type Session,
} from "../../sessions/model/session";
import { monoLaunchesNeedingInput, monoLaunchState } from "./monoLaunchInput";

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

describe("monoLaunchesNeedingInput, settled cases", () => {
  it("ignores answered cards, a removed worktree and ids that are not launches", () => {
    const waiting = monoLaunchesNeedingInput(
      [launch("answered"), launch("removed"), launch("saved")],
      [
        child("answered", "Answered", [
          card("c", 1, { outcome: { kind: "dismissed", at: 2 } }),
        ]),
        child("removed", "Removed", [card("c", 1)], { worktreeRemoved: true }),
      ],
      new Map([
        ["saved", undefined],
        ["stranger", undefined],
      ]),
    );
    expect([...waiting]).toEqual(["saved"]);
  });

  it("counts each launch once", () => {
    expect(
      monoLaunchesNeedingInput(
        [launch("saved"), launch("saved")],
        [],
        new Map([["saved", undefined]]),
      ).size,
    ).toBe(1);
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
