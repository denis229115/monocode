import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { DecisionCardPanel } from "../../src/features/sessions/ui/DecisionCards";
import {
  findDecisionCard,
  parseDecisionQuestions,
  waitingDecisionCards,
  withDecisionCard,
  type DecisionCard,
} from "../../src/features/sessions/model/decisionCard";
import { decisionAnswerer } from "../../src/features/sessions/model/decisionAnswers";
import type { UserQuestionReply } from "../../src/features/sessions/model/userQuestion";
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

/** What the app would send, and the links it would open. */
const sent: { sessionId: string; text: string }[] = [];
const opened: string[] = [];
Object.assign(window, {
  sent,
  opened,
  // GitHub and the opener answer as the desktop app's Rust side would.
  __TAURI_INTERNALS__: {
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "plugin:opener|open_url") {
        opened.push(String(args.url));
        return null;
      }
      if (cmd === "git_github_work_item")
        return {
          kind: "pr",
          number: 12,
          title: "Ask decision cards that wait without blocking",
          url: "https://github.com/denis229115/monocode/pull/12",
          state: "OPEN",
          updatedAt: new Date().toISOString(),
          labels: [],
          assignees: [],
          draft: false,
          repo: "denis229115/monocode",
        };
      if (cmd === "git_github_work_item_details")
        return {
          body: "Agents can leave a card and end their turn; the answer arrives as their next message.",
          author: "denis229115",
          baseRefName: "main",
          headRefName: "1-decision-cards",
        };
      throw new Error(`No fixture for ${cmd}`);
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

function card(id: string, turnId: string, questions: unknown[]): DecisionCard {
  return { id, turnId, questions: parseDecisionQuestions(questions), askedAt: 1 };
}

function session(
  id: string,
  title: string,
  prompt: string,
  reply: string,
  cards: DecisionCard[],
): Session {
  return {
    ...newSession("codex", "/tmp/monocode", "codex:test"),
    id,
    title,
    blocks: [
      { id: `${id}-user`, role: "user", text: prompt },
      { id: `${id}-reply`, role: "assistant", text: reply },
    ],
    decisionCards: cards,
  };
}

const longQuestion = [
  "The release branch has three open problems and I can only fix one before the window closes tonight.",
  "First, the Windows installer job fails about one run in four. The logs show a timeout while the signing service answers, and it has done the same on main for two weeks. Retrying has worked every time so far, but I cannot prove the signed build is identical when it does.",
  "Second, the updater test now takes nine minutes instead of three because it downloads the whole fixture bundle on every run. I can cache it, which is a small change, or leave it for the next release and accept slow checks until then.",
  "Third, the changelog lists the decision cards twice, once under features and once under fixes. Nothing is broken by it, but readers will notice, and fixing it means regenerating the notes by hand.",
  "Which one should I take first? Whatever you pick, I will finish it, run the whole check suite, and leave the other two for the next card instead of starting them without asking.",
].join("\n\n");

const initial = [
  session(
    "session",
    "Release session",
    "Get PR #12 ready to merge.",
    "PR #12 is green except the flaky Windows job. I need two calls from you before I go on, so I left them as cards and stopped here.",
    [
      card("merge", "session-user", [
        {
          header: "Release",
          question: "Merge PR #12 now, or wait for the Windows check?",
          options: [
            {
              label: "Merge now",
              description:
                "Windows is flaky on main too; nothing in this PR touches it.",
              value: "merge",
              recommended: true,
            },
            {
              label: "Wait for Windows",
              description: "About 20 minutes; I check again then.",
              value: "wait",
            },
          ],
          links: [
            "https://github.com/denis229115/monocode/pull/12",
            "https://github.com/denis229115/monocode/actions/runs/4411",
          ],
        },
      ]),
      card("notes", "session-user", [
        {
          header: "Release notes",
          question: "Which changes go in the release notes?",
          multiSelect: true,
          options: [
            { label: "Decision cards", recommended: true },
            { label: "Finder paste fix" },
            { label: "CI fixture fix" },
          ],
        },
      ]),
    ],
  ),
  session(
    "mono",
    "Pixi (Mono)",
    "Plan tomorrow's work.",
    "Your morning is open. One question before I book it.",
    [
      // Asked weeks ago: its turn is outside the loaded history.
      card("old-habit", "mono-turn-from-last-month", [
        {
          header: "Habits",
          question: "Keep the Monday CI check?",
          options: [{ label: "Keep it", recommended: true }, { label: "Stop it" }],
        },
      ]),
      card("focus", "mono-user", [
        {
          header: "Tomorrow",
          question: "What should I put first?",
          options: [
            { label: "Ship #12", recommended: true },
            { label: "Triage the inbox" },
          ],
        },
      ]),
    ],
  ),
  session(
    "layout",
    "Layout (cards)",
    "Review the release.",
    "Three things need you. The first card is already settled.",
    [
      {
        ...card("settled-long", "layout-user", [
          {
            header: "Release",
            question: longQuestion,
            options: [{ label: "Windows first" }, { label: "Updater first" }],
          },
        ]),
        outcome: {
          kind: "answered",
          at: 2,
          reply: {
            kind: "answered",
            answers: { q1: ["Windows first"] },
            custom: {},
          },
        },
      },
      card("repeat", "layout-user", [
        {
          header: "PR #12",
          question: "Merge this now?",
          options: [
            { label: "Merge now", description: "Checks are green.", recommended: true },
            { label: "Wait", description: "Hold until Windows is back." },
          ],
          links: ["https://github.com/denis229115/monocode/pull/12"],
        },
      ]),
      card("long", "layout-user", [
        {
          header: "Release",
          question: longQuestion,
          options: [
            { label: "Windows installer", description: "Take the flaky job first." },
            { label: "Updater test", description: "Cache the fixture bundle." },
            { label: "Changelog", description: "Regenerate the notes." },
          ],
          links: ["https://github.com/denis229115/monocode/pull/12"],
        },
      ]),
      card("comment", "layout-user", [
        {
          header: "Comment",
          question: "What should the PR comment say?",
        },
      ]),
    ],
  ),
];

function Pane({
  session,
  onAnswer,
}: {
  session: Session;
  onAnswer: (cardId: string, reply: UserQuestionReply) => void;
}) {
  return (
    <section
      data-pane={session.id}
      className="flex h-[780px] w-[480px] flex-col border border-content/10 bg-background-base"
    >
      <h2 className="px-4 py-2 text-[12px] text-content/60">{session.title}</h2>
      <div className="min-h-0 flex-1">
        <AgentTranscript
          blocks={session.blocks}
          decisionCards={session.decisionCards}
          initialTurns={10}
          visible
        />
      </div>
      <div className="shrink-0 p-1.5">
        <DecisionCardPanel
          cards={waitingDecisionCards(session.decisionCards)}
          cwd={session.cwd}
          onAnswer={onAnswer}
        />
        <div className="mx-1.5 rounded-lg border border-content/10 px-3 py-2.5 text-[12px] text-content/35">
          Message the agent…
        </div>
      </div>
    </section>
  );
}

/** Cards as storage keeps them: the first claim settles each, like the app's store. */
const stored = new Map(
  initial.flatMap((entry) =>
    (entry.decisionCards ?? []).map((card) => [`${entry.id}:${card.id}`, card]),
  ),
);

function Fixture() {
  // ?only=<id> shows one pane, for cases that would crowd the others.
  const only = new URLSearchParams(location.search).get("only");
  const [sessions, setSessions] = useState(() =>
    initial.filter((entry) => (only ? entry.id === only : entry.id !== "layout")),
  );
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
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId
              ? {
                  ...entry,
                  blocks: [
                    ...entry.blocks,
                    { id: `answer-${sent.length}`, role: "user", text },
                  ],
                }
              : entry,
          ),
        );
        return true;
      },
      claim: async (sessionId, cardId, outcome) => {
        const key = `${sessionId}:${cardId}`;
        const card = stored.get(key);
        if (!card || card.outcome) return { card, claimed: false };
        stored.set(key, { ...card, outcome });
        return { card: stored.get(key), claimed: true };
      },
      release: async (sessionId, cardId, outcome) => {
        const key = `${sessionId}:${cardId}`;
        const card = stored.get(key);
        if (card?.outcome === outcome) stored.set(key, { ...card, outcome: undefined });
        return stored.get(key);
      },
      show: (sessionId, card) =>
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId ? withDecisionCard(entry, card) : entry,
          ),
        ),
      now: () => 2,
    }),
  );
  return (
    <div className="flex gap-4 p-2">
      {sessions.map((entry) => (
        <Pane
          key={entry.id}
          session={entry}
          onAnswer={(cardId, reply) => void answer(entry.id, cardId, reply)}
        />
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
