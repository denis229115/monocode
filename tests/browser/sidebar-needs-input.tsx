import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/app/shell/Sidebar";
import { MonoRailSection } from "../../src/app/shell/MonoRailSection";
import { summaryFromSession } from "../../src/features/sessions/data/sessionHistory";
import { setSessionArchived } from "../../src/features/sessions/data/sessionStore";
import {
  refreshSavedWaitingDecisions,
  savedWaitingDecisions,
  subscribeSavedWaitingDecisions,
} from "../../src/features/sessions/data/decisionCards";
import {
  parseDecisionQuestions,
  withDecisionCard,
  type DecisionCard,
} from "../../src/features/sessions/model/decisionCard";
import {
  formatSessionTitle,
  needsInputCount,
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
import { DecisionCardSummary } from "../../src/features/sessions/ui/DecisionCards";
import "../../src/styles/index.css";

const CWD = "/tmp/monocode";

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
  chat("finished", "Finished chat with a waiting card", {
    decisionCards: [card("deploy", "Deploy", "Ship it to staging?")],
  }),
  chat("lead", "Lead of a worker"),
  chat("worker", "Worker", {
    orchestrationLeadId: "lead",
    decisionCards: [card("review", "Review", "Keep the old API?")],
  }),
  chat("mono-loaded", "Pixi", { decisionCards: [card("plan", "Tomorrow", "What goes first?")] }),
];
// A chat whose tab closed before a restart: only its saved card is known.
const closed = chat("closed", "Closed chat with a saved card");

// Storage as the Rust side keeps it: each chat's saved cards, and whether it
// is archived. Archiving closes the chat's waiting cards and returns them.
const stored = new Map<string, { archived: boolean; lead?: string; cards: DecisionCard[] }>(
  loaded.map((session) => [
    session.id,
    {
      archived: false,
      lead: session.orchestrationLeadId,
      cards: session.decisionCards ?? [],
    },
  ]),
);
stored.set("closed", { archived: false, cards: [card("saved", "Later", "Rename it?")] });
stored.set("mono-saved", { archived: false, cards: [card("idea", "Idea", "Try it?")] });
const commands: string[] = [];

Object.assign(window, {
  __commands: commands,
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: { sessionId?: string; archived?: boolean }) => {
      commands.push(command);
      if (command === "decision_card_waiting_sessions")
        return [...stored]
          .filter(([, entry]) => !entry.archived && entry.cards.some((c) => !c.outcome))
          .map(([sessionId, entry]) => ({ sessionId, leadId: entry.lead }));
      if (command === "session_set_archived") {
        const entry = stored.get(args.sessionId!)!;
        entry.archived = !!args.archived;
        if (!entry.archived) return [];
        const shut = entry.cards
          .filter((c) => !c.outcome)
          .map((c) => ({ ...c, outcome: { kind: "dismissed" as const, at: 4 } }));
        entry.cards = entry.cards.map((c) => shut.find((s) => s.id === c.id) ?? c);
        return shut;
      }
      // Native calls answer as an empty project would; nothing else needs them.
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

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
  const [archived, setArchived] = useState<Session[]>([]);
  const savedWaiting = useSyncExternalStore(
    subscribeSavedWaitingDecisions,
    savedWaitingDecisions,
  );
  useEffect(() => {
    void refreshSavedWaitingDecisions();
  }, []);
  const approval = needsInputSessionIds(sessions, savedWaiting);
  const states = new Map<string, MonoState>();
  // As the app's rail reads them: a loaded chat, else its saved card.
  for (const mono of monos) {
    const session = sessions.find((entry) => entry.id === mono.sessionId);
    if (session) states.set(mono.id, monoState(session));
    else if (savedWaiting.has(mono.sessionId))
      states.set(mono.id, MONO_WAITING_CARD_STATE);
  }
  // As the app archives: the chat leaves the open list with its cards closed.
  const archive = async () => {
    for (const id of ["finished", "worker", "mono-saved", "settled"]) {
      const shut = await setSessionArchived(id, true);
      const session = sessions.find((entry) => entry.id === id);
      if (session) setArchived((current) => [...current, shut.reduce(withDecisionCard, session)]);
      setSessions((current) => current.filter((entry) => entry.id !== id));
    }
  };
  return (
    <div
      data-fixture
      className="flex h-[1040px] w-[300px] flex-col border border-content/10 bg-background-base"
    >
      <MonoRailSection states={states} onOpen={() => {}} onCreate={() => {}} onDelete={() => {}} />
      <div className="min-h-0 flex-1">
        <Sidebar
          cwd={CWD}
          open
          sessions={[
            ...[...sessions.filter((s) => !s.id.startsWith("mono")), closed].map((s) =>
              summaryFromSession(s),
            ),
            ...archived.map((s) => ({ ...summaryFromSession(s), archived: true })),
          ]}
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
      <div className="flex flex-col gap-1.5 px-2 text-[12px] text-content/60">
        <p>
          Dock badge: <span data-dock-count>{needsInputCount(sessions, savedWaiting)}</span>
        </p>
        <p data-needs-input>{[...approval].sort().join(" ")}</p>
        {archived.map((session) => (
          <div key={session.id} data-archived={session.id}>
            {session.decisionCards?.map((entry) => (
              <DecisionCardSummary key={entry.id} card={entry} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2 p-2">
        <button
          data-answer
          className="rounded border border-content/20 px-2 py-1 text-[12px]"
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
        <button
          data-archive
          className="rounded border border-content/20 px-2 py-1 text-[12px]"
          onClick={() => void archive()}
        >
          Archive four chats
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
