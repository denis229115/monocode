import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { MonoOverview } from "../../src/features/monos/ui/MonoOverview";
import { MonoComposer } from "../../src/features/monos/ui/MonoComposer";
import {
  monoLaunchState,
  monoSubagentQuestions,
} from "../../src/features/monos/model/monoLaunchInput";
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
// Another tab open leaves Sessions folded to its icon.
const tab = params.get("tab") === "documents" ? "documents" : "sessions";

/** The sub-agents the Mono's cards asked to open in its side panel. */
const opened: string[] = [];

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

// The docs session is saved with a waiting card and is never opened here: its
// status comes from the saved marker alone.
const savedDocsTitle = formatSessionTitle("codex", "Rewrite the install guide");
const savedWaiting = new Map<string, string | undefined>([
  ["app-docs", undefined],
]);

Object.assign(window, {
  opened,
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
            title: savedDocsTitle,
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
  const [sessions] = useState<Session[]>([
    mono,
    child("app-tests", "Speed up the updater tests", { busy: true }),
    child("app-login", "Fix the login redirect bug", {
      decisionCards: [loginCard],
    }),
  ]);

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
            onOpenSession={(_turnId, _blocks, id) => opened.push(id)}
            onShowWork={() => {}}
            launchedSessions={launchedSessions}
          />
        </div>
        <div className="mx-auto w-full max-w-4xl shrink-0">
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
