import { enqueueMonoMessage } from "../../monos/model/monoMessaging";
import { isMonoSession } from "../../monos/model/mono";
import {
  decisionAnswerId,
  decisionAnswerText,
  type DecisionCard,
  type DecisionOutcome,
} from "./decisionCard";
import { dequeueQueuedMessage } from "./messageQueue";
import type { Session } from "./session";
import type { UserQuestionReply } from "./userQuestion";

type Answered = Extract<DecisionOutcome, { kind: "answered" }>;

export type DecisionAnswerHost = {
  /** The card as this window holds it now. */
  card(sessionId: string, cardId: string): DecisionCard | undefined;
  /** Whether the session is saved, so its answer can wait for that save. */
  saved(sessionId: string): boolean;
  /**
   * Settles the card in storage if no window has yet: the first outcome wins.
   * With `sending`, the card stays sending until a session save queues its
   * answer. Returns the card as stored and whether this call settled it.
   */
  claim(
    sessionId: string,
    cardId: string,
    outcome: DecisionOutcome,
    sending: boolean,
  ): Promise<{ card?: DecisionCard; claimed: boolean }>;
  /** Takes up a card still sending that no one is queuing; first caller only. */
  resume(sessionId: string, cardId: string): Promise<boolean>;
  /** Puts a claimed card back to waiting, when its answer could not be queued. */
  release(
    sessionId: string,
    cardId: string,
    outcome: DecisionOutcome,
  ): Promise<DecisionCard | undefined>;
  /**
   * Queues the answer as the agent's next message under `messageId` and saves
   * the session; false, with the message taken back out, when it could not.
   */
  queue(sessionId: string, messageId: string, text: string): Promise<boolean>;
  /** Shows the stored card in the session. */
  show(sessionId: string, card: DecisionCard): void;
  now(): number;
};

/**
 * Answers decision cards. The outcome is claimed in storage first, so of two
 * answers, from this window or another, only the first is sent; a retry or a
 * late answer sends nothing. The claimed card stays sending until the session
 * save that queues its answer settles it; the queue holds the answer until
 * then. When the answer cannot be queued, the claim is given back and the card
 * waits again. A card still sending after a restart is queued again by
 * `resume`. Skipping dismisses without sending.
 */
export function decisionAnswerer(host: DecisionAnswerHost) {
  const answering = new Set<string>();
  const resumed = new Set<string>();

  const deliver = async (
    sessionId: string,
    card: DecisionCard,
    outcome: Answered,
  ) => {
    let queued = false;
    try {
      queued = await host.queue(
        sessionId,
        decisionAnswerId(card.id),
        decisionAnswerText(card, outcome.reply),
      );
    } finally {
      if (queued) {
        host.show(sessionId, { ...card, outcome, sending: undefined });
      } else {
        const waiting = await host.release(sessionId, card.id, outcome);
        if (waiting) host.show(sessionId, waiting);
      }
    }
  };

  const answer = async (
    sessionId: string,
    cardId: string,
    reply: UserQuestionReply,
  ): Promise<void> => {
    const key = `${sessionId}:${cardId}`;
    const card = host.card(sessionId, cardId);
    if (!card || card.outcome || answering.has(key)) return;
    answering.add(key);
    try {
      if (reply.kind === "skipped") {
        const claim = await host.claim(
          sessionId,
          cardId,
          { kind: "dismissed", at: host.now() },
          false,
        );
        if (claim.card) host.show(sessionId, claim.card);
        return;
      }
      const outcome: Answered = { kind: "answered", at: host.now(), reply };
      const claim = await host.claim(
        sessionId,
        cardId,
        outcome,
        host.saved(sessionId),
      );
      if (claim.card) host.show(sessionId, claim.card);
      if (claim.claimed) await deliver(sessionId, card, outcome);
    } finally {
      answering.delete(key);
    }
  };

  /** Queues the answer of a card loaded while still sending, once. */
  const resume = async (sessionId: string, cardId: string): Promise<void> => {
    const key = `${sessionId}:${cardId}`;
    const card = host.card(sessionId, cardId);
    if (
      !card?.sending ||
      card.outcome?.kind !== "answered" ||
      answering.has(key) ||
      resumed.has(key)
    )
      return;
    resumed.add(key);
    answering.add(key);
    try {
      if (await host.resume(sessionId, cardId))
        await deliver(sessionId, card, card.outcome);
    } finally {
      answering.delete(key);
    }
  };

  return { answer, resume };
}

/**
 * The session with a card's answer queued behind any waiting messages, once.
 * A Mono shows it in its conversation at once, as it does every queued message.
 */
export function withDecisionAnswer(
  session: Session,
  messageId: string,
  text: string,
): Session {
  if (session.queuedMessages?.some((message) => message.id === messageId))
    return session;
  const message = { id: messageId, text, attachments: [] };
  if (isMonoSession(session.id)) return enqueueMonoMessage(session, message);
  return {
    ...session,
    queuedMessages: [...(session.queuedMessages ?? []), message],
    queueStatus: session.queueStatus === "paused" ? "paused" : "active",
  };
}

/** Takes back an answer whose save failed, with a Mono's bubble for it. */
export function withoutDecisionAnswer(
  session: Session,
  messageId: string,
): Session {
  const next = dequeueQueuedMessage(session, messageId);
  return next.blocks.some((block) => block.id === messageId)
    ? { ...next, blocks: next.blocks.filter((block) => block.id !== messageId) }
    : next;
}
