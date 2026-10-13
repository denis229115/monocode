import { useEffect, useMemo, useRef } from "react";
import { notifySession, pendingInputNotifications } from "../model/notifications";
import type { Session } from "../../sessions/model/session";

export function useInputNotifications(
  sessions: Session[],
  activeSessionId: string | undefined,
) {
  const inputNotifications = useMemo(
    () => pendingInputNotifications(sessions),
    [sessions],
  );
  const notifiedInputIdsRef = useRef(new Set<string>());
  // Decision cards each chat already had, by chat. A card notifies once, the
  // first time it waits in a chat this window had already loaded; cards that
  // arrive with the chat (startup, opening a Mono or a saved chat) or arrive
  // settled are old news, and a retry or a failed answer never repeats it.
  const seenCardsRef = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    const notified = notifiedInputIdsRef.current;
    for (const key of notified) {
      if (!inputNotifications.has(key)) notified.delete(key);
    }
    const seenCards = seenCardsRef.current;
    const loaded = new Set(sessions.map((session) => session.id));
    for (const id of seenCards.keys()) {
      if (!loaded.has(id)) seenCards.delete(id);
    }
    for (const session of sessions) {
      const seen = seenCards.get(session.id);
      if (!seen) {
        seenCards.set(
          session.id,
          new Set(session.decisionCards?.map((card) => card.id)),
        );
        continue;
      }
      for (const card of session.decisionCards ?? [])
        if (card.outcome) seen.add(card.id);
    }
    const notifiedSessions = new Set<string>();
    for (const [key, { session, event }] of inputNotifications) {
      const already =
        event.kind === "decision"
          ? (seenCards.get(session.id)?.has(event.cardId) ?? true)
          : notified.has(key);
      if (already || notifiedSessions.has(session.id)) continue;
      notifiedSessions.add(session.id);
      // Coalesce this render's banners per session, but leave other requests
      // eligible for the next update (including resolution of the first one).
      if (event.kind === "decision")
        seenCards.get(session.id)?.add(event.cardId);
      else notified.add(key);
      void notifySession(
        session,
        event,
        session.id === activeSessionId,
      );
    }
  }, [activeSessionId, inputNotifications, sessions]);
}
