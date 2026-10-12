import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PaneTree } from "../../src/features/workspace/ui/PaneTree";
import type { LayoutNode } from "../../src/features/workspace/model/layout";
import {
  findDecisionCard,
  parseDecisionQuestions,
  withDecisionCard,
  type DecisionCard,
} from "../../src/features/sessions/model/decisionCard";
import { decisionAnswerer } from "../../src/features/sessions/model/decisionAnswers";
import {
  newSession,
  type Session,
} from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

saveTranscriptAnchor(false);
saveTranscriptLayout("chat");

/** What the app would send to each chat's agent. */
const sent: { sessionId: string; text: string }[] = [];
Object.assign(window, {
  sent,
  // Native calls answer as an empty project would; nothing here needs them.
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

function chat(id: string, title: string, question: string): Session {
  const card: DecisionCard = {
    id: `${id}-card`,
    turnId: `${id}-user`,
    askedAt: 1,
    questions: parseDecisionQuestions([
      {
        header: "Release",
        question,
        options: [{ label: "Merge now", recommended: true }, { label: "Wait" }],
      },
    ]),
  };
  return {
    ...newSession("codex", "/tmp/monocode", "codex:test"),
    id,
    title,
    blocks: [
      { id: `${id}-user`, role: "user", text: "Get the release ready." },
      { id: `${id}-reply`, role: "assistant", text: "I left you a card." },
    ],
    decisionCards: [card],
  };
}

const start = [
  chat("alpha", "Alpha chat", "Merge alpha now?"),
  chat("beta", "Beta chat", "Merge beta now?"),
];

// ?split=1 draws both chats side by side, as a split workspace tab does.
const split = new URLSearchParams(location.search).has("split");
const layout: LayoutNode = split
  ? {
      type: "split",
      id: "split",
      dir: "right",
      children: [
        { type: "leaf", id: "alpha" },
        { type: "leaf", id: "beta" },
      ],
      sizes: [0.5, 0.5],
    }
  : { type: "leaf", id: "alpha" };

const noop = () => {};

function Fixture() {
  const [sessions, setSessions] = useState(start);
  const latest = useRef(sessions);
  latest.current = sessions;
  // The app's own answering, with storage and sending stubbed.
  const [answer] = useState(() =>
    decisionAnswerer({
      card: (sessionId, cardId) => {
        const session = latest.current.find((entry) => entry.id === sessionId);
        return session && findDecisionCard(session, cardId);
      },
      send: (sessionId, text) => {
        sent.push({ sessionId, text });
        return true;
      },
      claim: async (sessionId, cardId, outcome) => {
        const session = latest.current.find((entry) => entry.id === sessionId);
        const card = session && findDecisionCard(session, cardId);
        if (!card || card.outcome) return { card, claimed: false };
        const claimed = { ...card, outcome };
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId ? withDecisionCard(entry, claimed) : entry,
          ),
        );
        return { card: claimed, claimed: true };
      },
      release: async () => undefined,
      show: noop,
      now: () => 2,
    }),
  );
  return (
    <div className="h-screen">
      <PaneTree
        visible
        layout={layout}
        sessions={sessions}
        editorPanes={[]}
        dirtyFileIds={new Set()}
        fileErrorCounts={new Map()}
        focusedId="alpha"
        composerFocused={false}
        recents={[]}
        hideProjectPicker
        onFocus={noop}
        onClose={noop}
        onSelectFile={noop}
        onCloseFile={noop}
        onCloseOtherFiles={noop}
        onReorderFiles={noop}
        onFileDirtyChange={noop}
        onFileErrorCountChange={noop}
        onRatio={noop}
        onCwdChange={noop}
        onBranchChange={noop}
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
        onApproval={noop}
        onQuestionReply={noop}
        onDecisionAnswer={(sessionId, cardId, reply) =>
          void answer(sessionId, cardId, reply)
        }
        onOpenFile={noop}
        onOpenDiff={noop}
        onOpenPlan={noop}
        onUpdatePlan={noop}
        onBuildPlan={noop}
        onMovePane={noop}
        onDetachPane={noop}
        onNewTerminal={noop}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
