import { invoke } from "@tauri-apps/api/core";
import {
  restoreDecisionCard,
  type DecisionCard,
  type DecisionOutcome,
} from "../model/decisionCard";

/** Saves a new card, or returns the one its request ID already named. */
export async function askDecisionCard(
  sessionId: string,
  card: DecisionCard,
): Promise<DecisionCard> {
  const stored = restoreDecisionCard(
    await invoke("decision_card_ask", { sessionId, card }),
  );
  if (!stored) throw new Error("The saved card could not be read");
  return stored;
}

/** Settles a waiting card if no one has; says whether this call did. */
export async function claimDecisionCard(
  sessionId: string,
  cardId: string,
  outcome: DecisionOutcome,
): Promise<{ card?: DecisionCard; claimed: boolean }> {
  const result = await invoke<{ card: unknown; claimed: boolean }>(
    "decision_card_claim",
    { sessionId, cardId, outcome },
  );
  return { card: restoreDecisionCard(result.card), claimed: result.claimed };
}

/** Gives back a claim whose answer could not be sent. */
export async function releaseDecisionCard(
  sessionId: string,
  cardId: string,
  outcome: DecisionOutcome,
): Promise<DecisionCard | undefined> {
  return restoreDecisionCard(
    await invoke("decision_card_release", { sessionId, cardId, outcome }),
  );
}
