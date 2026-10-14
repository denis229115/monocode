import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { MonoOverview } from "../../src/features/monos/ui/MonoOverview";
import { MonoSubagentQuestions } from "../../src/features/monos/ui/MonoSubagentQuestions";
import { MonoComposer } from "../../src/features/monos/ui/MonoComposer";
import {
  monoLaunchState,
  monoSubagentQuestions,
} from "../../src/features/monos/model/monoSubagentQuestions";
import { subagentAnswerer } from "../../src/features/monos/model/monoSubagentAnswers";
import { decisionAnswerer } from "../../src/features/sessions/model/decisionAnswers";
import {
  findDecisionCard,
  parseDecisionQuestions,
  withDecisionCard,
  type DecisionCard,
  type DecisionOutcome,
} from "../../src/features/sessions/model/decisionCard";
import {
  formatSessionTitle,
  newSession,
  type Block,
  type MonoSpawnedSession,
  type Session,
} from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

saveTranscriptAnchor(false);
saveTranscriptLayout("chat");

const CWD = "/tmp/monocode";
const params = new URLSearchParams(location.search);
const hold = params.has("hold");
// Another tab open leaves Sessions folded to its icon.
const tab = params.get("tab") === "documents" ? "documents" : "sessions";

/** What the app would send to each sub-agent. */
const sent: { sessionId: string; text: string }[] = [];
const failures = { send: false };

const now = Date.now();
const child = (
  id: string,
  title: string,
  patch: Partial<Session> = {},
): Session => ({
  ...newSession("codex", CWD, "codex:test"),
  id,
  title: formatSessionTitle("codex", title),
  blocks: [{ id: `${id}-user`, role: "user", text: title }],
  ...patch,
});

const launches: MonoSpawnedSession[] = [
  ["app-tests", "Speed up the updater tests"],
  ["app-login", "Fix the login redirect bug"],
  ["app-docs", "Rewrite the install guide"],
].map(([sessionId, title]) => ({
  sessionId,
  cwd: CWD,
  title,
  harness: "codex",
  model: "codex:test",
}));

const loginCard: DecisionCard = {
  id: "redirect",
  turnId: "app-login-user",
  askedAt: now - 60_000,
  questions: parseDecisionQuestions([
    {
      header: "Login redirect",
      question:
        "After sign-in, should the redirect go back to the page the user came from, or always to the dashboard?",
      options: [
        {
          label: "Back to where they were",
          description: "Keeps the deep link; needs the return URL checked.",
          value: "return",
          recommended: true,
        },
        { label: "Always the dashboard", value: "dashboard" },
      ],
    },
  ]),
};
const docsCard: DecisionCard = {
  id: "audience",
  turnId: "app-docs-user",
  askedAt: now - 30_000,
  questions: parseDecisionQuestions([
    {
      header: "Install guide",
      question: "Should the guide cover Linux packages too, or macOS only?",
      options: [
        { label: "macOS only", value: "mac" },
        { label: "Include Linux", value: "linux" },
      ],
    },
  ]),
};

const mono: Session = {
  ...newSession("codex", CWD, "codex:test"),
  id: "mono-pixi",
  title: "Pixi",
  blocks: [
    {
      id: "mono-request",
      role: "user",
      text: "Speed up the updater tests, fix the login redirect bug, and rewrite the install guide.",
      startedAt: now - 120_000,
      durationMs: 4000,
      monoSpawnedSessions: launches,
    },
    {
      id: "mono-reply",
      role: "assistant",
      text: "I started three sessions, one per task. I will let you know when they finish, and any of them can ask you a question here.",
    } satisfies Block,
  ],
};

// The docs session is saved with a waiting card but not open until the app
// opens it; ?hold keeps it that way so the unopened state can be seen.
const savedDocs = child("app-docs", "Rewrite the install guide", {
  decisionCards: [docsCard],
});
const savedWaiting = new Map<string, string | undefined>([
  ["app-docs", undefined],
]);

Object.assign(window, {
  sent,
  failures,
  __TAURI_INTERNALS__: {
    invoke: async (cmd: string) => {
      if (cmd === "session_list_by_project")
        return [
          {
            id: "app-docs",
            cwd: CWD,
            harness: "codex",
            model: "codex:test",
            runtimeMode: "auto",
            title: savedDocs.title,
            createdAt: 1,
            updatedAt: now - 30_000,
          },
        ];
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

function Fixture() {
  const [sessions, setSessions] = useState<Session[]>([
    mono,
    child("app-tests", "Speed up the updater tests", { busy: true }),
    child("app-login", "Fix the login redirect bug", {
      decisionCards: [loginCard],
    }),
  ]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const store = useRef(new Map<string, DecisionOutcome>());

  const answer = useMemo(
    () =>
      subagentAnswerer({
        session: (id) => sessionsRef.current.find((s) => s.id === id),
        open: async (id) => {
          if (id !== "app-docs") return null;
          sessionsRef.current = [...sessionsRef.current, savedDocs];
          setSessions(sessionsRef.current);
          return savedDocs;
        },
        answer: decisionAnswerer({
          card: (id, cardId) => {
            const found = sessionsRef.current.find((s) => s.id === id);
            return found ? findDecisionCard(found, cardId) : undefined;
          },
          claim: async (id, cardId, outcome) => {
            const key = `${id}:${cardId}`;
            const found = sessionsRef.current.find((s) => s.id === id)!;
            const card = findDecisionCard(found, cardId)!;
            if (store.current.has(key))
              return { card: { ...card, outcome: store.current.get(key) }, claimed: false };
            store.current.set(key, outcome);
            return { card: { ...card, outcome }, claimed: true };
          },
          release: async (id, cardId) => {
            store.current.delete(`${id}:${cardId}`);
            const found = sessionsRef.current.find((s) => s.id === id)!;
            const { outcome: _, ...card } = findDecisionCard(found, cardId)!;
            return card;
          },
          send: (id, text) => {
            if (failures.send) return false;
            sent.push({ sessionId: id, text });
            // The answer is queued as the sub-agent's next message, so it
            // is working again.
            setSessions((prev) =>
              prev.map((s) => (s.id === id ? { ...s, busy: true } : s)),
            );
            return true;
          },
          show: (id, card) =>
            setSessions((prev) =>
              prev.map((s) => (s.id === id ? withDecisionCard(s, card) : s)),
            ),
          now: Date.now,
        }),
      }),
    [],
  );

  const waiting = useMemo(
    () => monoSubagentQuestions(launches, sessions, savedWaiting),
    [sessions],
  );
  // As the app does: open a waiting sub-agent that is not open, once.
  const tried = useRef(false);
  useEffect(() => {
    if (hold || tried.current || !waiting.unloaded.length) return;
    tried.current = true;
    setSessions((prev) => [...prev, savedDocs]);
  }, [waiting.unloaded.length]);

  const launchedSessions = useMemo(
    () =>
      new Map(
        launches.map((launch) => [
          launch.sessionId,
          {
            state: monoLaunchState(
              sessions.find((s) => s.id === launch.sessionId),
              launch.sessionId,
              savedWaiting,
            ),
            title: launch.title,
          },
        ]),
      ),
    [sessions],
  );

  return (
    <div data-fixture className="flex h-[800px] w-[1100px] bg-background-base">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <AgentTranscript
            blocks={mono.blocks}
            agentName="Pixi"
            agentMascot={{ mascot: "crab", color: "#aaf" }}
            bottomAligned
            inlineWork
            onOpenSession={() => {}}
            onShowWork={() => {}}
            launchedSessions={launchedSessions}
          />
        </div>
        <div className="mx-auto w-full max-w-4xl shrink-0">
          {waiting.ready.length ? (
            <MonoSubagentQuestions
              questions={waiting.ready}
              onAnswer={answer}
              onOpenSession={() => {}}
            />
          ) : null}
          <MonoComposer
            sessionId="subagent-mono"
            name="Pixi"
            enabled={false}
            onSubmit={() => false}
            controls={<span className="h-6.5">Model · Effort · Context</span>}
          />
        </div>
      </div>
      <MonoOverview
        open
        monoId="mono-pixi"
        cwd={CWD}
        agent={{ name: "Pixi", mascot: "crab", color: "#aaf", projects: [] }}
        state={{ status: "idle" }}
        launches={launches}
        sessions={sessions}
        savedWaiting={savedWaiting}
        documents={[]}
        tab={tab}
        onTabChange={() => {}}
        onOpenSession={() => {}}
        onOpenDocument={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
