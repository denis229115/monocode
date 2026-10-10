import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { DecisionCardPanel } from "../../src/features/sessions/ui/DecisionCards";
import {
  decisionAnswerText,
  findDecisionCard,
  parseDecisionQuestions,
  recordDecisionCard,
  settleDecisionCard,
  waitingDecisionCards,
  type DecisionCard,
} from "../../src/features/sessions/model/decisionCard";
import {
  newSession,
  type Session,
} from "../../src/features/sessions/model/session";
import type { UserQuestionReply } from "../../src/features/sessions/model/userQuestion";
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

function card(id: string, questions: unknown[]): DecisionCard {
  return { id, questions: parseDecisionQuestions(questions), askedAt: 1 };
}

function session(
  id: string,
  title: string,
  prompt: string,
  reply: string,
  cards: DecisionCard[],
): Session {
  let next: Session = {
    ...newSession("codex", "/tmp/monocode", "codex:test"),
    id,
    title,
    blocks: [
      { id: `${id}-user`, role: "user", text: prompt },
      { id: `${id}-reply`, role: "assistant", text: reply },
    ],
  };
  for (const entry of cards)
    next = recordDecisionCard(next, `${id}-user`, entry);
  return next;
}

const initial = [
  session(
    "session",
    "Release session",
    "Get PR #12 ready to merge.",
    "PR #12 is green except the flaky Windows job. I need two calls from you before I go on, so I left them as cards and stopped here.",
    [
      card("merge", [
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
      card("notes", [
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
      card("focus", [
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
        <AgentTranscript blocks={session.blocks} initialTurns={10} visible />
      </div>
      <div className="shrink-0 p-1.5">
        <DecisionCardPanel
          cards={waitingDecisionCards(session.blocks)}
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

function Fixture() {
  const [sessions, setSessions] = useState(initial);
  // Mirrors App's onDecisionAnswer: send to the asking session, then settle.
  const answer = (
    sessionId: string,
    cardId: string,
    reply: UserQuestionReply,
  ) =>
    setSessions((prev) =>
      prev.map((current) => {
        if (current.id !== sessionId) return current;
        const asked = findDecisionCard(current.blocks, cardId);
        if (!asked || asked.outcome) return current;
        if (reply.kind === "skipped")
          return settleDecisionCard(current, cardId, {
            kind: "dismissed",
            at: 2,
          });
        const text = decisionAnswerText(asked, reply);
        if (!sent.some((entry) => entry.text === text))
          sent.push({ sessionId, text });
        const settled = settleDecisionCard(current, cardId, {
          kind: "answered",
          at: 2,
          reply,
        });
        return {
          ...settled,
          blocks: [
            ...settled.blocks,
            { id: `${cardId}-answer`, role: "user", text },
          ],
        };
      }),
    );
  return (
    <div className="flex gap-4 p-2">
      {sessions.map((entry) => (
        <Pane
          key={entry.id}
          session={entry}
          onAnswer={(cardId, reply) => answer(entry.id, cardId, reply)}
        />
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
