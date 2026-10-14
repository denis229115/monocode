import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccountExists,
  sameProviderAccountId,
  selectedProviderAccountId,
  supportsAccountProfiles,
} from "../../providers/model/providerAccounts";
import type { HarnessId, Session } from "../../sessions/model/session";
import { saveMonoAccount, type Mono } from "./mono";

/**
 * The account a Mono's choice points at for this provider. A choice whose
 * account was removed falls back to the default account, never another login.
 * Absent while nothing was picked: the Mono then follows the folder selection.
 */
export function monoAccountChoice(
  mono: Pick<Mono, "accounts">,
  harness: HarnessId,
): { accountId?: string; removed: boolean } {
  if (!supportsAccountProfiles(harness)) return { removed: false };
  const picked = mono.accounts?.[harness];
  if (!picked) return { removed: false };
  return providerAccountExists(harness, picked)
    ? { accountId: picked, removed: false }
    : { accountId: DEFAULT_PROVIDER_ACCOUNT_ID, removed: true };
}

/** Records the Mono's choice; the conversation follows it once it is idle. */
export function pickMonoAccount(
  monoId: string,
  harness: HarnessId,
  accountId: string,
): void {
  if (
    supportsAccountProfiles(harness) &&
    providerAccountExists(harness, accountId)
  )
    saveMonoAccount(monoId, harness, accountId);
}

/**
 * The account the Mono's conversation belongs on: its choice, else the
 * account the conversation already uses, else (before it has started) the one
 * selected for its folder today. A removed one becomes the default account,
 * flagged as removed.
 */
export function monoAccountState(
  mono: Pick<Mono, "accounts">,
  session: Pick<Session, "harness" | "providerAccountId" | "blocks" | "cwd">,
): { accountId?: string; removed: boolean } {
  const choice = monoAccountChoice(mono, session.harness);
  if (choice.accountId) return choice;
  const used = session.providerAccountId;
  return used &&
    supportsAccountProfiles(session.harness) &&
    !providerAccountExists(session.harness, used)
    ? { accountId: DEFAULT_PROVIDER_ACCOUNT_ID, removed: true }
    : {
        accountId:
          used ??
          (supportsAccountProfiles(session.harness) &&
          session.blocks.length === 0
            ? selectedProviderAccountId(session.harness, session.cwd)
            : undefined),
        removed: false,
      };
}

/**
 * Moves the conversation to another account the way the usage-limit switch
 * does: provider threads belong to an account, so the next turn opens a fresh
 * one and carries the transcript over instead of asking the old account.
 */
export function handOverMonoAccount(
  session: Session,
  accountId: string,
): Session {
  if (session.busy || sameProviderAccountId(session.providerAccountId, accountId))
    return session;
  return {
    ...session,
    providerAccountId: accountId,
    providerSessionId: undefined,
    pendingSwitch: {
      ...(session.pendingSwitch ?? {
        from: session.harness,
        fromModel: session.model,
        fromSettings: session.modelSettings,
        fromProviderSessionId: session.providerSessionId,
        fromProviderAccountId: session.providerAccountId,
      }),
      skipOutgoingRecap: true,
    },
  };
}

/**
 * Brings the Mono's conversation onto the account it chose. Nothing changes
 * while a turn runs; the next pass picks it up. A conversation not started yet
 * just takes the account, with no transcript to carry.
 */
export function followMonoAccount(session: Session, mono: Mono): Session {
  const { accountId } = monoAccountState(mono, session);
  if (!accountId || session.busy || session.providerAccountId === accountId)
    return session;
  const unstarted =
    session.blocks.length === 0 ||
    // A pending provider switch hands over on its own; the account follows it.
    (session.pendingSwitch && session.pendingSwitch.from !== session.harness);
  if (unstarted || sameProviderAccountId(session.providerAccountId, accountId))
    return { ...session, providerAccountId: accountId };
  return handOverMonoAccount(session, accountId);
}

/** Every Mono's conversation brought onto its account; the same array if none moved. */
export function followMonoAccounts(
  sessions: Session[],
  monos: readonly Mono[],
): Session[] {
  const owner = new Map(monos.map((mono) => [mono.sessionId, mono]));
  let changed = false;
  const next = sessions.map((session) => {
    const mono = owner.get(session.id);
    const followed = mono ? followMonoAccount(session, mono) : session;
    if (followed !== session) changed = true;
    return followed;
  });
  return changed ? next : sessions;
}
