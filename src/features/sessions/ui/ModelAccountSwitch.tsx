import { useSyncExternalStore } from "react";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccounts,
  selectedProviderAccountId,
  subscribeProviderAccounts,
  supportsProviderAccounts,
  supportsAccountProfiles,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";
import type { HarnessId, Session } from "../model/session";

/**
 * The account a conversation runs on, for the selector in its composer: the
 * one it is pinned to, else the one selected for its folder.
 */
export function useSessionAccountId(
  session: Pick<Session, "harness" | "cwd" | "providerAccountId">,
): string | undefined {
  return useSyncExternalStore(
    subscribeProviderAccounts,
    () =>
      supportsProviderAccounts(session.harness)
        ? (session.providerAccountId ??
          selectedProviderAccountId(session.harness, session.cwd))
        : undefined,
    () => undefined,
  );
}

/** What the selector knows about the account a surface runs on. */
export type ModelAccount = {
  harness: HarnessId;
  accounts: ProviderAccount[];
  /** Absent once the account was removed. */
  selected?: ProviderAccount;
  notice?: string;
  onSelect?: (accountId: string) => void;
};

/**
 * The accounts to offer next to the model: only for Claude and Codex, only
 * when the surface says which account it uses, and only with a choice to make.
 */
export function useModelAccount(
  harness: HarnessId,
  accountId: string | undefined,
  notice: string | undefined,
  onSelect: ((accountId: string) => void) | undefined,
): ModelAccount | undefined {
  const snapshot = useSyncExternalStore(
    subscribeProviderAccounts,
    () =>
      supportsAccountProfiles(harness)
        ? JSON.stringify(providerAccounts(harness))
        : "[]",
    () => "[]",
  );
  if (accountId === undefined || !supportsAccountProfiles(harness))
    return undefined;
  const accounts = JSON.parse(snapshot) as ProviderAccount[];
  if (accounts.length < 2) return undefined;
  return {
    harness,
    accounts,
    selected: accounts.find((account) => account.id === accountId),
    notice,
    onSelect,
  };
}

/** The name shown beside the model, unless it is the default account. */
export function accountTriggerLabel(account?: ModelAccount): string | undefined {
  if (!account) return undefined;
  if (!account.selected) return "Removed account";
  return account.selected.id === DEFAULT_PROVIDER_ACCOUNT_ID
    ? undefined
    : account.selected.label;
}

/** A row under the model search: one small button per account. */
export function ModelAccountSwitch({ account }: { account: ModelAccount }) {
  return (
    <div className="shrink-0 border-b border-stroke px-2 py-1.5">
      <div
        role="radiogroup"
        aria-label="Account"
        className="flex items-center gap-1 overflow-x-auto"
      >
        <span className="shrink-0 pr-1 text-[10px] font-medium uppercase tracking-wide text-content/40">
          Account
        </span>
        {account.accounts.map((entry) => {
          const selected = entry.id === account.selected?.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!account.onSelect}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!selected) account.onSelect?.(entry.id);
              }}
              className={`h-6 max-w-28 shrink-0 truncate rounded-md px-2 text-[11px] ${
                selected
                  ? "bg-selection text-content"
                  : "text-content/70 hover:bg-content/5 hover:text-content"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
      {account.notice || !account.selected ? (
        <p
          className="pt-1 text-[11px] leading-4 text-content/50"
          data-model-account-notice
        >
          {account.notice ?? "This account was removed. Pick another."}
        </p>
      ) : null}
    </div>
  );
}
