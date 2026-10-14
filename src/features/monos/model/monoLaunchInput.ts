import {
  sessionNeedsInput,
  type MonoSpawnedSession,
  type Session,
} from "../../sessions/model/session";
import {
  launchedSessionState,
  type LaunchedSessionState,
} from "./monoSpawnedSessions";

/** Saved chats with a waiting card, as `savedWaitingDecisions()` reports them. */
export type SavedWaiting = ReadonlyMap<string, string | undefined>;

/**
 * The launches waiting on the user. An open session answers for itself; one
 * that is not open is known only by its saved card, so it is never loaded
 * just to find out.
 */
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
