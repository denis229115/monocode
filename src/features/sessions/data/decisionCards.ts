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

/** Answers or dismisses a card; a settled card comes back unchanged. */
export async function settleDecisionCard(
  sessionId: string,
  cardId: string,
  outcome: DecisionOutcome,
): Promise<DecisionCard | undefined> {
  return restoreDecisionCard(
    await invoke("decision_card_settle", { sessionId, cardId, outcome }),
  );
}
