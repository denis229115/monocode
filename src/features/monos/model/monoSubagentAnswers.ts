import { findDecisionCard } from "../../sessions/model/decisionCard";
import type { Session } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";

export type SubagentAnswerHost = {
  /** The session as this window holds it, once it is open. */
  session(sessionId: string): Session | undefined;
  /** Opens a saved session; null when it is gone. */
  open(sessionId: string): Promise<Session | null>;
  /** Answers the card as it would be from the sub-agent's own chat. */
  answer(
    sessionId: string,
    cardId: string,
    reply: UserQuestionReply,
  ): Promise<boolean>;
};

/**
 * Answers a sub-agent's decision card from the Mono. The card is answered
 * where it is held, so the session must be open first: answering a session
 * that is not would do nothing. Unlike the sub-agent's own chat, a failure
 * is raised for the Mono's card to show, since the answer was not sent.
 */
export function subagentAnswerer(host: SubagentAnswerHost) {
  return async (
    sessionId: string,
    cardId: string,
    reply: UserQuestionReply,
  ): Promise<void> => {
    const session = host.session(sessionId) ?? (await host.open(sessionId));
    if (!session || session.worktreeRemoved)
      throw new Error("That session is no longer available.");
    const card = findDecisionCard(session, cardId);
    // Answered meanwhile, here or in another window: nothing is left to send.
    if (!card || card.outcome) return;
    if (!(await host.answer(sessionId, cardId, reply)))
      throw new Error("The answer could not be sent. Try again.");
  };
}
