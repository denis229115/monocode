import {
  useEffect,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { listMonos } from "../../features/monos/model/mono";
import { followMonoAccounts } from "../../features/monos/model/monoAccount";
import {
  providerAccounts,
  subscribeProviderAccounts,
} from "../../features/providers/model/providerAccounts";
import type { Session } from "../../features/sessions/model/session";

/**
 * Keeps each Mono's conversation on the account the Mono chose, so changing
 * it in the Mono's settings, the usage chip or after an account is removed all
 * take the same path. A running turn finishes on its account first.
 */
export function useMonoAccounts(
  sessions: Session[],
  setSessions: Dispatch<SetStateAction<Session[]>>,
  rosterKey: string,
) {
  const accountsKey = useSyncExternalStore(
    subscribeProviderAccounts,
    () => JSON.stringify([providerAccounts("claude"), providerAccounts("codex")]),
    () => "",
  );
  useEffect(() => {
    if (followMonoAccounts(sessions, listMonos()) === sessions) return;
    setSessions((current) => followMonoAccounts(current, listMonos()));
  }, [sessions, setSessions, rosterKey, accountsKey]);
}
