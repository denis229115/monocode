import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { SessionPane } from "../../src/features/sessions/ui/SessionPane";
import { useMonoAccounts } from "../../src/app/hooks/useMonoAccounts";
import {
  createMono,
  monoForSession,
  monoLook,
  monosSnapshot,
  saveMonoAccount,
  saveMonoSessionId,
  subscribeMonos,
} from "../../src/features/monos/model/mono";
import { pickMonoAccount } from "../../src/features/monos/model/monoAccount";
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
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    invoke: async (cmd: string) => {
      if (cmd === "plugin:event|listen") return 0;
      if (cmd === "session_checkpoint_status") return { files: [] };
      if (cmd.startsWith("list_") || cmd === "git_branches") return [];
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

// ?accounts=one leaves only the default login; ?harness=devin has no
// profiles at all; ?removed=1 gives Pixi an account that no longer exists.
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

const noop = () => {};

// A Mono's chat as the app draws it, with its composer under the transcript.
function Fixture() {
  const [sessions, setSessions] = useState([
    chat("chat-pixi", params.get("removed") ? "account-gone" : "default"),
    chat("chat-nova"),
  ]);
  const [selected, setSelected] = useState("chat-pixi");
  const rosterKey = useSyncExternalStore(subscribeMonos, monosSnapshot);
  useMonoAccounts(sessions, setSessions, rosterKey);
  const session = sessions.find((entry) => entry.id === selected)!;
  // The app's side of a pick in the composer's usage chips.
  const onPickMonoAccount = (
    sessionId: string,
    provider: ProviderAccountProvider,
    accountId: string,
  ) => {
    const owner = monoForSession(sessionId);
    if (owner) pickMonoAccount(owner.id, provider, accountId);
  };
  return (
    <div data-fixture className="flex h-[640px] w-[900px] flex-col bg-background-base">
      <div className="flex gap-2 border-b border-stroke p-2">
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
      <div className="min-h-0 flex-1" data-mono-pane>
        <SessionPane
          key={session.id}
          session={session}
          visible
          focused
          inSplit={false}
          composerFocused={false}
          recents={[]}
          hideProjectPicker
          onFocus={noop}
          onClose={noop}
          onCwdChange={noop}
          onBranchChange={noop}
          onWorkspaceModeChange={noop}
          onWorktreeBaseChange={noop}
          onModelChange={noop}
          onModelSettingsChange={noop}
          onRuntimeModeChange={noop}
          onSaveDraft={noop}
          onRemoveDraft={noop}
          onSubmit={noop}
          onStop={noop}
          onCompactContext={() => false}
          onPlaceSessionInFolder={noop}
          onDeleteQueuedMessage={noop}
          onEditQueuedMessage={noop}
          onQueuedMessageEditingChange={noop}
          onSteerQueuedMessage={noop}
          onResumeQueue={noop}
          onUsageLimitResume={noop}
          onUsageLimitResumeAtReset={noop}
          onUsageLimitDismiss={noop}
          onPickMonoAccount={
            params.get("picker") === "off" ? undefined : onPickMonoAccount
          }
          onApproval={noop}
          onQuestionReply={noop}
          onOpenFile={noop}
          onOpenDiff={noop}
          onOpenPlan={noop}
          onBuildPlan={noop}
          onNewTerminal={noop}
        />
      </div>
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
