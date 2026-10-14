import type { DecisionCard } from "../../sessions/model/decisionCard";
import {
  sessionDisplayTitle,
  sessionNeedsInput,
  sessionWaitingDecisionCards,
  type HarnessId,
  type MonoSpawnedSession,
  type Session,
} from "../../sessions/model/session";
import {
  launchedSessionState,
  type LaunchedSessionState,
} from "./monoSpawnedSessions";

/** Saved chats with a waiting card, as `savedWaitingDecisions()` reports them. */
export type SavedWaiting = ReadonlyMap<string, string | undefined>;

/** The cards a sub-agent the Mono started is waiting on, to answer from the Mono. */
export type MonoSubagentQuestion = {
  sessionId: string;
  title: string;
  harness: HarnessId;
  cwd: string;
  /** Oldest first. */
  cards: DecisionCard[];
};

export type MonoSubagentQuestions = {
  /** Sub-agents that are open here, the one asked longest ago first. */
  ready: MonoSubagentQuestion[];
  /**
   * Sub-agents saved with a waiting card that are not open here, so their
   * cards are not known yet. The caller opens them, which moves them to `ready`.
   */
  unloaded: string[];
};

/**
 * What the Mono's sub-agents are asking. A loaded session answers for itself
 * (a removed worktree asks nothing); a saved chat that is not loaded is only
 * known by its marker, so it is listed to be opened.
 */
export function monoSubagentQuestions(
  launches: readonly MonoSpawnedSession[],
  sessions: readonly Session[],
  savedWaiting: SavedWaiting = new Map(),
): MonoSubagentQuestions {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const seen = new Set<string>();
  const ready: MonoSubagentQuestion[] = [];
  const unloaded: string[] = [];
  for (const launch of launches) {
    if (seen.has(launch.sessionId)) continue;
    seen.add(launch.sessionId);
    const session = byId.get(launch.sessionId);
    if (!session) {
      if (savedWaiting.has(launch.sessionId)) unloaded.push(launch.sessionId);
      continue;
    }
    const cards = sessionWaitingDecisionCards(session)
      .slice()
      .sort((a, b) => a.askedAt - b.askedAt);
    if (!cards.length) continue;
    ready.push({
      sessionId: session.id,
      title: sessionDisplayTitle(session.title, session.harness),
      harness: session.harness,
      cwd: session.cwd,
      cards,
    });
  }
  // A stable sort keeps launch order for sub-agents asked at the same moment.
  ready.sort((a, b) => a.cards[0].askedAt - b.cards[0].askedAt);
  return { ready, unloaded };
}

/** The launches waiting on the user, open here or known by a saved card. */
export function monoLaunchesNeedingInput(
  launches: readonly MonoSpawnedSession[],
  sessions: readonly Session[],
  savedWaiting: SavedWaiting = new Map(),
): Set<string> {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const waiting = new Set<string>();
  for (const launch of launches) {
    const session = byId.get(launch.sessionId);
    if (
      session ? sessionNeedsInput(session) : savedWaiting.has(launch.sessionId)
    )
      waiting.add(launch.sessionId);
  }
  return waiting;
}

/**
 * Where a launch stands for its card. One that is not open cannot be running,
 * so it reads as done unless a saved card is waiting on the user.
 */
export function monoLaunchState(
  session: Session | undefined,
  sessionId: string,
  savedWaiting: SavedWaiting = new Map(),
): LaunchedSessionState {
  if (session) return launchedSessionState(session);
  return savedWaiting.has(sessionId) ? "input" : "done";
}
