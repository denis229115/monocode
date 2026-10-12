import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ModelPicker } from "../../src/features/sessions/ui/ModelPicker";
import {
  requestSessionAccount,
  subscribeSessionAccountRequests,
} from "../../src/features/providers/model/sessionAccountRequest";
import { UsageFooter } from "../../src/app/shell/UsageFooter";
import { useMonoAccounts } from "../../src/app/hooks/useMonoAccounts";
import { MonoDetails } from "../../src/features/monos/ui/MonoDetails";
import {
  createMono,
  monoForSession,
  monoLook,
  monosSnapshot,
  saveMonoAccount,
  saveMonoSessionId,
  subscribeMonos,
} from "../../src/features/monos/model/mono";
import {
  monoAccountState,
  pickMonoAccount,
} from "../../src/features/monos/model/monoAccount";
import {
  saveProviderAccount,
  type ProviderAccountProvider,
} from "../../src/features/providers/model/providerAccounts";
import { setCachedRateLimits } from "../../src/features/providers/model/rateLimitsCache";
import {
  newSession,
  type HarnessId,
  type Session,
} from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// Native calls answer as an empty machine would; nothing here needs them.
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async () => null,
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

// ?accounts=one leaves only the default login; ?removed=1 gives Pixi an
// account that no longer exists; ?harness=devin has no profiles at all.
const params = new URLSearchParams(location.search);
const harness = (params.get("harness") ?? "claude") as HarnessId;
const MODEL: Partial<Record<HarnessId, string>> = {
  claude: "claude:sonnet",
  codex: "codex:gpt-5.4",
  devin: "devin:default",
};
if (params.get("accounts") !== "one") {
  saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
  saveProviderAccount({ id: "account-lab", provider: "codex", label: "Lab" });
}

// Each account has its own usage, so the chip shows which one it is reading.
const usage = (usedPercent: number) => ({
  provider: "claude" as const,
  session: { usedPercent, windowMinutes: 300, resetsAt: Date.now() + 3_600_000 },
  weekly: null,
  monthly: null,
  resetCredits: null,
  updatedAt: Date.now() + 3_600_000,
  error: null,
  status: "ok" as const,
});
setCachedRateLimits("claude", "default", usage(20));
setCachedRateLimits("claude", "account-work", usage(65));

function chat(id: string, account = "default"): Session {
  return {
    ...newSession(harness, "/home/me", MODEL[harness]),
    id,
    providerAccountId: account,
    providerSessionId: `${id}-thread`,
    blocks: [{ id: `${id}-u`, role: "user", text: "Hello" }],
  };
}

const pixi = createMono();
const nova = createMono();
saveMonoSessionId(pixi.id, "chat-pixi");
saveMonoSessionId(nova.id, "chat-nova");
if (params.get("removed")) saveMonoAccount(pixi.id, "claude", "account-gone");

// A normal chat's composer: the same selector, asking the app for an account.
function ChatComposer() {
  const [account, setAccount] = useState("default");
  useEffect(
    () =>
      subscribeSessionAccountRequests((id, next) => {
        if (id === "chat-plain") setAccount(next);
      }),
    [],
  );
  return (
    <div data-chat className="flex h-10 items-center border-t border-stroke px-4">
      <ModelPicker
        harness="claude"
        model="claude:sonnet"
        values={{}}
        accountId={account}
        onAccountChange={(next) => requestSessionAccount("chat-plain", next)}
        onChange={() => {}}
        onSettingsChange={() => {}}
      />
      <span data-chat-account hidden>
        {account}
      </span>
    </div>
  );
}

function Fixture() {
  const [sessions, setSessions] = useState([
    chat("chat-pixi", params.get("removed") ? "account-gone" : "default"),
    chat("chat-nova"),
  ]);
  const [selected, setSelected] = useState("chat-pixi");
  const rosterKey = useSyncExternalStore(subscribeMonos, monosSnapshot);
  useMonoAccounts(sessions, setSessions, rosterKey);
  const session = sessions.find((entry) => entry.id === selected)!;
  const mono = monoForSession(selected)!;
  const account = monoAccountState(mono, session);
  const pick = (provider: ProviderAccountProvider, accountId: string) =>
    pickMonoAccount(mono.id, provider, accountId);
  return (
    <div data-fixture className="flex h-[560px] w-[900px] flex-col bg-background-base">
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-1 gap-2 p-4">
          {sessions.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-select={entry.id}
              onClick={() => setSelected(entry.id)}
              className="h-7 rounded-md bg-selection px-3 text-[12px]"
            >
              {monoLook(monoForSession(entry.id)!).name}
            </button>
          ))}
        </div>
        <MonoDetails
          open
          monoId={mono.id}
          cwd={session.cwd}
          agent={monoLook(mono)}
          state={{ status: "idle" }}
          harness={session.harness}
          model={session.model}
          modelSettings={session.modelSettings}
          runtimeMode={session.runtimeMode}
          accountId={account.accountId}
          accountRemoved={account.removed}
          onAccountChange={(accountId) =>
            pickMonoAccount(mono.id, session.harness, accountId)
          }
          onModelChange={() => {}}
          onModelSettingsChange={() => {}}
          onRuntimeModeChange={() => {}}
          onClose={() => {}}
        />
      </div>
      {params.get("chat") ? <ChatComposer /> : null}
      <UsageFooter
        providers={[session.harness as "claude"]}
        session={{
          id: session.id,
          harness: session.harness,
          model: session.model,
          providerAccountId: account.accountId ?? session.providerAccountId,
        }}
        project={session.cwd}
        onPickAccount={pick}
      />
      <pre data-log hidden>
        {JSON.stringify(
          sessions.map((entry) => ({
            id: entry.id,
            account: entry.providerAccountId,
            thread: entry.providerSessionId ?? null,
            handOver: entry.pendingSwitch?.skipOutgoingRecap === true,
          })),
        )}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
