import { invoke } from "@tauri-apps/api/core";
import { needsInputCount, type Session } from "../../sessions/model/session";
import { savedWaitingDecisions } from "../../sessions/data/decisionCards";

let lastCount = -1;

/** Push the count of chats waiting on the user to the macOS Dock badge,
 * including closed ones whose saved decision card still waits. */
export function syncDockBadge(sessions: Session[]): void {
  const count = needsInputCount(sessions, savedWaitingDecisions());
  if (count === lastCount) return;
  lastCount = count;
  void invoke("set_dock_badge", { count }).catch(() => {});
}
