import {
  decisionAnswerText,
  type DecisionCard,
  type DecisionOutcome,
} from "./decisionCard";
import type { UserQuestionReply } from "./userQuestion";

export type DecisionAnswerHost = {
  /** The card as this window holds it now. */
  card(sessionId: string, cardId: string): DecisionCard | undefined;
  /**
   * Settles the card in storage if no window has yet: the first outcome wins.
   * Returns the card as stored and whether this call settled it.
   */
  claim(
    sessionId: string,
    cardId: string,
    outcome: DecisionOutcome,
  ): Promise<{ card?: DecisionCard; claimed: boolean }>;
  /** Puts a claimed card back to waiting, when its answer could not be sent. */
  release(
    sessionId: string,
    cardId: string,
    outcome: DecisionOutcome,
  ): Promise<DecisionCard | undefined>;
  /**
   * Sends the agent its next message and saves it; false when the session
   * refused it.
   */
  send(sessionId: string, text: string): boolean | Promise<boolean>;
  /** Shows the stored card in the session. */
  show(sessionId: string, card: DecisionCard): void;
  now(): number;
};

/**
 * Answers decision cards. The outcome is claimed in storage first, so of two
 * answers, from this window or another, only the first is sent; a retry or a
 * late answer sends nothing. When the claimed answer cannot be sent, the claim
 * is given back and the card waits again. Skipping dismisses without sending.
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
      const outcome: DecisionOutcome =
        reply.kind === "skipped"
          ? { kind: "dismissed", at: host.now() }
          : { kind: "answered", at: host.now(), reply };
      const claim = await host.claim(sessionId, cardId, outcome);
      if (claim.card) host.show(sessionId, claim.card);
      if (!claim.claimed || reply.kind === "skipped") return;
      let sent = false;
      try {
        sent = await host.send(sessionId, decisionAnswerText(card, reply));
      } finally {
        if (!sent) {
          const waiting = await host.release(sessionId, cardId, outcome);
          if (waiting) host.show(sessionId, waiting);
        }
      }
    } finally {
      answering.delete(key);
    }
  };
}
