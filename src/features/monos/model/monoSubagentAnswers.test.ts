import { describe, expect, it, vi } from "vitest";
import {
  parseDecisionQuestions,
  type DecisionCard,
} from "../../sessions/model/decisionCard";
import { newSession, type Session } from "../../sessions/model/session";
import {
  subagentAnswerer,
  type SubagentAnswerHost,
} from "./monoSubagentAnswers";

const waiting: DecisionCard = {
  id: "c1",
  turnId: "t1",
  askedAt: 1,
  questions: parseDecisionQuestions([{ question: "Merge?" }]),
};
const reply = { kind: "answered" as const, answers: { q1: ["yes"] } };

const sub = (patch: Partial<Session> = {}): Session => ({
  ...newSession("codex", "/repo"),
  id: "child",
  decisionCards: [waiting],
  ...patch,
});

function setup(
  loaded: Session | undefined,
  saved: Session | null = null,
  answered = true,
) {
  let held = loaded;
  const host: SubagentAnswerHost = {
    session: () => held,
    open: vi.fn(async () => {
      held = saved ?? undefined;
      return saved;
    }),
    answer: vi.fn(async () => answered),
  };
  return { host, answer: subagentAnswerer(host) };
}

describe("answering a sub-agent's card from the Mono", () => {
  it("answers a session that is already open", async () => {
    const { host, answer } = setup(sub());
    await answer("child", "c1", reply);
    expect(host.open).not.toHaveBeenCalled();
    expect(host.answer).toHaveBeenCalledWith("child", "c1", reply);
  });

  it("opens a session that is not open before answering it", async () => {
    const { host, answer } = setup(undefined, sub());
    await answer("child", "c1", reply);
    expect(host.open).toHaveBeenCalledWith("child");
    expect(host.answer).toHaveBeenCalledTimes(1);
  });

  it("fails loudly rather than answering a session that is gone", async () => {
    const { host, answer } = setup(undefined, null);
    await expect(answer("child", "c1", reply)).rejects.toThrow("no longer");
    expect(host.answer).not.toHaveBeenCalled();
    const removed = setup(sub({ worktreeRemoved: true }));
    await expect(removed.answer("child", "c1", reply)).rejects.toThrow(
      "no longer",
    );
  });

  it("sends nothing for a card already answered", async () => {
    const { host, answer } = setup(
      sub({
        decisionCards: [{ ...waiting, outcome: { kind: "dismissed", at: 2 } }],
      }),
    );
    await answer("child", "c1", reply);
    expect(host.answer).not.toHaveBeenCalled();
  });

  it("says when the answer could not be sent", async () => {
    const { answer } = setup(sub(), null, false);
    await expect(answer("child", "c1", reply)).rejects.toThrow("Try again");
  });
});
