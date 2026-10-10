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

/**
 * Saved chats with a card still waiting, each with the orchestration lead it
 * works for. Only chats this window has not loaded go by it; a loaded chat's
 * own cards answer for it.
 */
export type SavedWaitingDecisions = ReadonlyMap<string, string | undefined>;

let savedWaiting: SavedWaitingDecisions = new Map();
let reads = 0;
const listeners = new Set<() => void>();

export function savedWaitingDecisions(): SavedWaitingDecisions {
  return savedWaiting;
}

export function subscribeSavedWaitingDecisions(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sameWaiting(a: SavedWaitingDecisions, b: SavedWaitingDecisions) {
  if (a.size !== b.size) return false;
  for (const [id, lead] of a) if (!b.has(id) || b.get(id) !== lead) return false;
  return true;
}

/**
 * Reread the list after anything that can settle a card out of this window's
 * sight: startup, focus (another window may have answered), deleting a chat
 * and removing a worktree. The latest read wins; a failed one keeps the last.
 */
export async function refreshSavedWaitingDecisions(): Promise<void> {
  const read = ++reads;
  try {
    const rows = await invoke<{ sessionId: string; leadId?: string }[]>(
      "decision_card_waiting_sessions",
    );
    if (read !== reads || !Array.isArray(rows)) return;
    const next = new Map(rows.map((row) => [row.sessionId, row.leadId]));
    if (sameWaiting(savedWaiting, next)) return;
    savedWaiting = next;
    for (const listener of listeners) listener();
  } catch {
    // The marks stay as last read; the next refresh tries again.
  }
}
