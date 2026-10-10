import {
  decisionAnswerText,
  type DecisionCard,
  type DecisionOutcome,
} from "./decisionCard";
import type { UserQuestionReply } from "./userQuestion";

export type DecisionAnswerHost = {
  /** The waiting card as the session holds it now. */
  card(sessionId: string, cardId: string): DecisionCard | undefined;
  /** Sends the agent its next message; false when the session refused it. */
  send(sessionId: string, text: string): boolean | Promise<boolean>;
  /** Saves the outcome and returns the card as stored. */
  settle(
    sessionId: string,
    cardId: string,
    outcome: DecisionOutcome,
  ): Promise<DecisionCard | undefined>;
  /** Shows the stored card in the session. */
  show(sessionId: string, card: DecisionCard): void;
  now(): number;
};

/**
 * Answers decision cards: the answer goes to the agent first, then the card
 * settles, so a refused message leaves it waiting. Skipping dismisses it
 * without sending. A second answer while one is in flight sends nothing.
 */
export function decisionAnswerer(host: DecisionAnswerHost) {
  const answering = new Set<string>();
  return async (
    sessionId: string,
    cardId: string,
    reply: UserQuestionReply,
  ): Promise<void> => {
    const key = `${sessionId}:${cardId}`;
    const card = host.card(sessionId, cardId);
    if (!card || card.outcome || answering.has(key)) return;
    answering.add(key);
    try {
      let outcome: DecisionOutcome;
      if (reply.kind === "skipped") {
        outcome = { kind: "dismissed", at: host.now() };
      } else {
        if (!(await host.send(sessionId, decisionAnswerText(card, reply))))
          return;
        outcome = { kind: "answered", at: host.now(), reply };
      }
      const stored = await host.settle(sessionId, cardId, outcome);
      if (stored) host.show(sessionId, stored);
    } finally {
      answering.delete(key);
    }
  };
}
