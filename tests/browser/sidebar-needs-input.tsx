import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/app/shell/Sidebar";
import { MonoRailSection } from "../../src/app/shell/MonoRailSection";
import { summaryFromSession } from "../../src/features/sessions/data/sessionHistory";
import {
  parseDecisionQuestions,
  type DecisionCard,
} from "../../src/features/sessions/model/decisionCard";
import {
  formatSessionTitle,
  needsInputSessionIds,
  newSession,
  type Session,
} from "../../src/features/sessions/model/session";
import {
  MONO_WAITING_CARD_STATE,
  createMono,
  monoState,
  saveMonoName,
  saveMonoSessionId,
  type MonoState,
} from "../../src/features/monos/model/mono";
import "../../src/styles/index.css";

const CWD = "/tmp/monocode";

// Native calls answer as an empty project would; nothing here needs them.
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async () => null,
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

function card(id: string, header: string, question: string): DecisionCard {
  return {
    id,
    turnId: `${id}-turn`,
    askedAt: 1,
    questions: parseDecisionQuestions([{ header, question }]),
  };
}

function chat(id: string, title: string, patch: Partial<Session> = {}): Session {
  return {
    ...newSession("codex", CWD, "codex:test"),
    id,
    title: formatSessionTitle("codex", title),
    blocks: [{ id: `${id}-user`, role: "user", text: title }],
    ...patch,
  };
}

const merge = card("merge", "Release", "Merge PR #12 now?");
const answered = {
  ...card("tag", "Release", "Tag it?"),
  outcome: { kind: "dismissed" as const, at: 2 },
};

const loaded = [
  chat("question", "Blocked on a question", {
    pendingQuestion: {
      requestId: 1,
      questions: [
        {
          id: "q1",
          prompt: "Which file?",
          multiSelect: false,
          allowCustom: true,
          options: [],
        },
      ],
    },
  }),
  chat("card", "Left a decision card", { decisionCards: [merge] }),
  chat("settled", "Card already answered", { decisionCards: [answered] }),
  chat("mono-loaded", "Pixi", { decisionCards: [card("plan", "Tomorrow", "What goes first?")] }),
];
// A chat whose tab closed before a restart: only its saved card is known.
const closed = chat("closed", "Closed chat with a saved card");
const savedWaiting = new Map<string, string | undefined>([
  ["closed", undefined],
  ["mono-saved", undefined],
]);

localStorage.clear();
const monos = [
  ["Pixi", "mono-loaded"],
  ["Nova", "mono-saved"],
  ["Idle", "mono-idle"],
].map(([name, sessionId]) => {
  const mono = createMono();
  saveMonoName(mono.id, name);
  saveMonoSessionId(mono.id, sessionId);
  return { id: mono.id, sessionId };
});

function Fixture() {
  const [sessions, setSessions] = useState(loaded);
  const approval = needsInputSessionIds(sessions, savedWaiting);
  const states = new Map<string, MonoState>();
  // As the app's rail reads them: a loaded chat, else its saved card.
  for (const mono of monos) {
    const session = sessions.find((entry) => entry.id === mono.sessionId);
    if (session) states.set(mono.id, monoState(session));
    else if (savedWaiting.has(mono.sessionId))
      states.set(mono.id, MONO_WAITING_CARD_STATE);
  }
  return (
    <div
      data-fixture
      className="flex h-[640px] w-[300px] flex-col border border-content/10 bg-background-base"
    >
      <MonoRailSection states={states} onOpen={() => {}} onCreate={() => {}} onDelete={() => {}} />
      <div className="min-h-0 flex-1">
        <Sidebar
          cwd={CWD}
          open
          sessions={[...sessions.filter((s) => !s.id.startsWith("mono")), closed].map((s) =>
            summaryFromSession(s),
          )}
          busySessionIds={new Set()}
          approvalSessionIds={approval}
          status="idle"
          pending={false}
          tab="sessions"
          filesSearchOpen={false}
          onSelectSession={() => {}}
          onOpenFile={() => {}}
          onTabChange={() => {}}
          onFilesSearchOpenChange={() => {}}
        />
      </div>
      <button
        data-answer
        className="m-2 rounded border border-content/20 px-2 py-1 text-[12px]"
        onClick={() =>
          setSessions((current) =>
            current.map((session) => ({
              ...session,
              decisionCards: session.decisionCards?.map((entry) => ({
                ...entry,
                outcome: entry.outcome ?? { kind: "dismissed", at: 3 },
              })),
            })),
          )
        }
      >
        Answer every loaded card
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
