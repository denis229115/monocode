const REQUEST_EVENT = "monocode-session-account-request";

/**
 * A conversation's model selector asks for another account. The app decides
 * what that means for the conversation, so the selector needs no wiring
 * through every pane in between.
 */
export function requestSessionAccount(
  sessionId: string,
  accountId: string,
): void {
  window.dispatchEvent(
    new CustomEvent(REQUEST_EVENT, { detail: { sessionId, accountId } }),
  );
}

export function subscribeSessionAccountRequests(
  listener: (sessionId: string, accountId: string) => void,
): () => void {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (
      detail &&
      typeof detail === "object" &&
      "sessionId" in detail &&
      "accountId" in detail &&
      typeof detail.sessionId === "string" &&
      typeof detail.accountId === "string"
    )
      listener(detail.sessionId, detail.accountId);
  };
  window.addEventListener(REQUEST_EVENT, handle);
  return () => window.removeEventListener(REQUEST_EVENT, handle);
}
