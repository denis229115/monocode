import { enqueueMonoMessage } from "../../monos/model/monoMessaging";
import { isMonoSession } from "../../monos/model/mono";
import {
  decisionAnswerId,
  decisionAnswerText,
  isDecisionAnswerId,
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
  /**
   * Puts a claimed card back to waiting, when its answer could not be queued.
   * A card whose answer another save already queued comes back answered.
   */
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
  /** Puts back in this window's queue an answer storage already holds. */
  restore(sessionId: string, messageId: string, text: string): void;
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
const MAX_FAILURES = 3;
const RETRY_MS = 2_000;

export function decisionAnswerer(host: DecisionAnswerHost) {
  const answering = new Set<string>();
  /** Cards this window holds whose answer is not queued or given back yet. */
  const owned = new Set<string>();
  /** Sending cards another caller holds. */
  const elsewhere = new Set<string>();
  const failures = new Map<string, number>();

  /** A failed step is tried again later, a few times. */
  const retry = (sessionId: string, cardId: string) => {
    const key = `${sessionId}:${cardId}`;
    const count = (failures.get(key) ?? 0) + 1;
    failures.set(key, count);
    if (count < MAX_FAILURES)
      setTimeout(
        () => void resume(sessionId, cardId).catch(() => undefined),
        RETRY_MS * count,
      );
  };

  const deliver = async (
    sessionId: string,
    card: DecisionCard,
    outcome: Answered,
  ) => {
    const messageId = decisionAnswerId(card.id);
    const text = decisionAnswerText(card, outcome.reply);
    let queued = false;
    try {
      queued = await host.queue(sessionId, messageId, text);
    } finally {
      if (queued) {
        host.show(sessionId, { ...card, outcome, sending: undefined });
      } else {
        const after = await host.release(sessionId, card.id, outcome);
        if (after) host.show(sessionId, after);
        if (after?.outcome) host.restore(sessionId, messageId, text);
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
      if (!claim.claimed) return;
      owned.add(key);
      try {
        await deliver(sessionId, card, outcome);
        owned.delete(key);
      } catch (error) {
        retry(sessionId, cardId);
        throw error;
      }
    } finally {
      answering.delete(key);
    }
  };

  /**
   * Queues the answer of a card still sending: one loaded after a restart, or
   * one whose queuing here failed and could not be given back either.
   */
  const resume = async (sessionId: string, cardId: string): Promise<void> => {
    const key = `${sessionId}:${cardId}`;
    const card = host.card(sessionId, cardId);
    if (
      !card?.sending ||
      card.outcome?.kind !== "answered" ||
      answering.has(key) ||
      elsewhere.has(key) ||
      (failures.get(key) ?? 0) >= MAX_FAILURES
    )
      return;
    answering.add(key);
    try {
      if (!owned.has(key)) {
        if (!(await host.resume(sessionId, cardId))) {
          elsewhere.add(key);
          return;
        }
        owned.add(key);
      }
      await deliver(sessionId, card, card.outcome);
      owned.delete(key);
    } catch (error) {
      retry(sessionId, cardId);
      throw error;
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

/**
 * The session as a turn left it that sends a decision answer, with the answer
 * still queued, marked delivering, until the provider takes it; a failed
 * launch or a quit before then loses nothing. The turn's user message carries
 * the answer's id, in place of one left by an attempt that never got through.
 */
export function keepDecisionAnswer(
  before: Session,
  after: Session,
  messageId: string | undefined,
): Session {
  const message =
    messageId && isDecisionAnswerId(messageId)
      ? before.queuedMessages?.find((entry) => entry.id === messageId)
      : undefined;
  if (!message) return after;
  let blocks = after.blocks;
  // A Mono's bubble already carries the id; elsewhere the newest user message
  // is this turn's.
  if (!message.blockId) {
    let newest = blocks.length - 1;
    while (newest >= 0 && blocks[newest].role !== "user") newest--;
    blocks = blocks.flatMap((block, index) =>
      index === newest
        ? [{ ...block, id: message.id }]
        : block.id === message.id
          ? []
          : [block],
    );
  }
  return {
    ...after,
    blocks,
    queuedMessages: [
      { ...message, delivering: true },
      ...(after.queuedMessages ?? []).filter((entry) => entry.id !== message.id),
    ],
    queueStatus: before.queueStatus ?? "active",
  };
}

/** The provider took the answer: it leaves the queue. */
export function acceptDecisionAnswer(
  session: Session,
  messageId: string,
): Session {
  return session.queuedMessages?.some(
    (entry) => entry.id === messageId && entry.delivering,
  )
    ? dequeueQueuedMessage(session, messageId)
    : session;
}

/**
 * The answer did not reach the provider: it waits in the queue, paused, with
 * the error, and the user message of the failed attempt goes.
 */
export function returnDecisionAnswer(
  session: Session,
  messageId: string,
  error: string,
): Session {
  const message = session.queuedMessages?.find(
    (entry) => entry.id === messageId && entry.delivering,
  );
  if (!message) return session;
  return {
    ...session,
    blocks: message.blockId
      ? session.blocks
      : session.blocks.filter((block) => block.id !== messageId),
    queuedMessages: session.queuedMessages?.map((entry) =>
      entry === message ? { ...entry, delivering: undefined, error } : entry,
    ),
    queueStatus: "paused",
  };
}

/**
 * Settles a decision answer that a turn sends. It leaves the queue once the
 * provider takes the turn, or, for providers that never say, once the turn
 * finished cleanly without a Stop. Anything else puts it back, paused: a
 * failure, a Stop, a launch that never got going.
 */
export function decisionAnswerTurn(
  answerId: string | undefined,
  update: (change: (session: Session) => Session) => void,
) {
  let settled = false;
  const settle = (change: (session: Session, id: string) => Session) => {
    if (!answerId || settled) return;
    settled = true;
    update((session) => change(session, answerId));
  };
  return {
    /** The provider took the turn. */
    accepted: () => settle(acceptDecisionAnswer),
    /** The turn's send returned; `current` is false after a Stop. */
    finished: (failed: boolean, current: boolean) => {
      if (!failed && current) settle(acceptDecisionAnswer);
    },
    /** The turn is over: an answer not taken by now goes back. */
    done: (error: string | undefined, current: boolean) =>
      settle((session, id) =>
        returnDecisionAnswer(
          session,
          id,
          current
            ? (error ?? "The agent did not get this answer.")
            : "Stopped before the agent got this answer.",
        ),
      ),
  };
}
