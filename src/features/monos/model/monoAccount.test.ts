// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { canDispatchQueuedHead } from "../../sessions/model/messageQueue";
import {
  pendingComposerSwitch,
  shouldAskOutgoingAgent,
} from "../../sessions/model/handoff";
import {
  saveProviderAccount,
  selectProviderAccount,
} from "../../providers/model/providerAccounts";
import { newSession, type Session } from "../../sessions/model/session";
import type { Mono } from "./mono";
import {
  followMonoAccount,
  followMonoAccounts,
  handOverMonoAccount,
  monoAccountChoice,
  monoAccountState,
} from "./monoAccount";
import { switchMonoUsageLimitAccount } from "./monoUsageLimit";

function mono(patch: Partial<Mono> = {}): Mono {
  return {
    id: "mono-1",
    sessionId: "chat",
    mascot: "cat",
    color: "#fff",
    projects: [],
    ...patch,
  };
}

function chat(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/home"),
    id: "chat",
    providerSessionId: "old-thread",
    providerAccountId: "default",
    blocks: [{ id: "u", role: "user", text: "Hello" }],
    ...patch,
  };
}

beforeEach(() => {
  localStorage.clear();
  saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
  saveProviderAccount({ id: "account-lab", provider: "codex", label: "Lab" });
});

describe("a Mono's account", () => {
  it("is its own choice for the provider, and nothing until one is picked", () => {
    expect(monoAccountChoice(mono(), "claude")).toEqual({ removed: false });
    const picked = mono({ accounts: { claude: "account-work" } });
    expect(monoAccountChoice(picked, "claude")).toEqual({
      accountId: "account-work",
      removed: false,
    });
    // Each provider keeps its own, and providers without profiles have none.
    expect(monoAccountChoice(picked, "codex")).toEqual({ removed: false });
    expect(monoAccountChoice(picked, "devin")).toEqual({ removed: false });
  });

  it("falls back to the default account when the chosen one was removed", () => {
    const gone = mono({ accounts: { claude: "account-gone" } });
    expect(monoAccountChoice(gone, "claude")).toEqual({
      accountId: "default",
      removed: true,
    });
    // A conversation pinned to a removed account is told the same.
    expect(
      monoAccountState(mono(), chat({ providerAccountId: "account-gone" })),
    ).toEqual({ accountId: "default", removed: true });
    expect(monoAccountState(mono(), chat())).toEqual({
      accountId: "default",
      removed: false,
    });
    expect(
      monoAccountState(mono(), chat({ providerAccountId: undefined })),
    ).toEqual({ accountId: undefined, removed: false });
  });

  it("hands the conversation over without losing history, as a usage-limit switch does", () => {
    const original = chat();
    const moved = handOverMonoAccount(original, "account-work");
    expect(moved.providerAccountId).toBe("account-work");
    expect(moved.providerSessionId).toBeUndefined();
    expect(moved.blocks).toBe(original.blocks);
    expect(pendingComposerSwitch(moved)).toMatchObject({
      from: "claude",
      fromProviderSessionId: "old-thread",
      fromProviderAccountId: "default",
      skipOutgoingRecap: true,
    });
    expect(shouldAskOutgoingAgent(moved)).toBe(false);
    // The usage-limit switch is this hand-over plus carrying on.
    const limited = chat({ usageLimit: { resetsAt: 1000 } });
    const resumed = switchMonoUsageLimitAccount(limited, "account-work");
    expect(resumed).toMatchObject({
      providerAccountId: moved.providerAccountId,
      pendingSwitch: moved.pendingSwitch,
    });
    expect(canDispatchQueuedHead(resumed)).toBe(true);
    // Same account, or a turn still running: nothing moves.
    expect(handOverMonoAccount(original, "default")).toBe(original);
    const busy = chat({ busy: true });
    expect(handOverMonoAccount(busy, "account-work")).toBe(busy);
  });

  it("moves the conversation to the account the Mono chose, once it is idle", () => {
    const picked = mono({ accounts: { claude: "account-work" } });
    const moved = followMonoAccount(chat(), picked);
    expect(moved.providerAccountId).toBe("account-work");
    expect(moved.pendingSwitch).toBeDefined();
    expect(followMonoAccount(moved, picked)).toBe(moved);
    const busy = chat({ busy: true });
    expect(followMonoAccount(busy, picked)).toBe(busy);
    // A Mono that has not chosen leaves its conversation where it is.
    const same = chat();
    expect(followMonoAccount(same, mono())).toBe(same);
  });

  it("just takes the account before any conversation, and keeps a harness switch's own hand-over", () => {
    const picked = mono({ accounts: { claude: "account-work" } });
    const fresh = chat({
      blocks: [],
      providerSessionId: undefined,
      providerAccountId: undefined,
    });
    const taken = followMonoAccount(fresh, picked);
    expect(taken.providerAccountId).toBe("account-work");
    expect(taken.pendingSwitch).toBeUndefined();
    const switching = chat({
      providerAccountId: undefined,
      pendingSwitch: { from: "codex", fromModel: "x" },
    });
    const followed = followMonoAccount(switching, picked);
    expect(followed.providerAccountId).toBe("account-work");
    expect(followed.pendingSwitch).toBe(switching.pendingSwitch);
  });

  it("leaves the default account alone when a legacy conversation never named one", () => {
    const picked = mono({ accounts: { claude: "default" } });
    const legacy = chat({ providerAccountId: undefined });
    const followed = followMonoAccount(legacy, picked);
    expect(followed.providerAccountId).toBe("default");
    expect(followed.pendingSwitch).toBeUndefined();
  });

  it("sends a removed account's conversation to the default account", () => {
    const moved = followMonoAccount(
      chat({ providerAccountId: "account-gone" }),
      mono(),
    );
    expect(moved.providerAccountId).toBe("default");
    expect(moved.pendingSwitch?.fromProviderAccountId).toBe("account-gone");
  });

  it("starts a new Mono on the account selected for its folder, until it picks one", () => {
    selectProviderAccount("claude", "/home", "account-work");
    const fresh = chat({
      blocks: [],
      providerSessionId: undefined,
      providerAccountId: undefined,
      cwd: "/home",
    });
    expect(monoAccountState(mono(), fresh)).toEqual({
      accountId: "account-work",
      removed: false,
    });
    // A conversation that already ran does not guess.
    expect(
      monoAccountState(mono(), { ...fresh, blocks: chat().blocks }).accountId,
    ).toBeUndefined();
    // Its own choice wins over the folder's.
    const picked = mono({ accounts: { claude: "default" } });
    expect(monoAccountState(picked, fresh).accountId).toBe("default");
  });

  it("puts two Monos on two different accounts", () => {
    const sessions = [
      chat({ id: "a", providerAccountId: "default" }),
      chat({ id: "b", providerAccountId: "default" }),
      chat({ id: "other", providerAccountId: "default" }),
    ];
    const next = followMonoAccounts(sessions, [
      mono({ id: "m1", sessionId: "a", accounts: { claude: "account-work" } }),
      mono({ id: "m2", sessionId: "b" }),
    ]);
    expect(next.map((session) => session.providerAccountId)).toEqual([
      "account-work",
      "default",
      "default",
    ]);
    expect(next[1]).toBe(sessions[1]);
    expect(next[2]).toBe(sessions[2]);
    expect(followMonoAccounts(next, [mono({ sessionId: "b" })])).toBe(next);
  });
});
