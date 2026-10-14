import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DecisionCardPanel } from "../../src/features/sessions/ui/DecisionCards";
import {
  parseDecisionQuestions,
  type DecisionCard,
} from "../../src/features/sessions/model/decisionCard";
import type { UserQuestionReply } from "../../src/features/sessions/model/userQuestion";
import "../../src/styles/index.css";

/** Every answer the cards sent, with the pane that sent it. */
const replies: { pane: string; cardId: string; reply: UserQuestionReply }[] = [];
Object.assign(window, { replies });

function card(id: string, questions: unknown[]): DecisionCard {
  return { id, turnId: "turn", questions: parseDecisionQuestions(questions), askedAt: 1 };
}

const panes: { id: string; title: string; cards: DecisionCard[] }[] = [
  {
    id: "alpha",
    title: "Release session",
    cards: [
      card("release", [
        {
          header: "Release",
          question: "Merge PR #12 now, or wait for the Windows check?",
          options: [
            { label: "Merge now", description: "Nothing here touches Windows.", value: "merge", recommended: true },
            { label: "Wait for Windows", description: "About 20 minutes.", value: "wait" },
          ],
        },
        {
          header: "Notes",
          question: "Where should the release notes go?",
          options: [
            { label: "Changelog", value: "changelog" },
            { label: "GitHub release", value: "release" },
            { label: "Both", value: "both" },
          ],
        },
      ]),
    ],
  },
  {
    id: "beta",
    title: "Notes session",
    cards: [
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
  },
];

function Pane({ id, title, cards }: (typeof panes)[number]) {
  const [waiting, setWaiting] = useState(cards);
  return (
    <section
      data-pane={id}
      data-session-drop={id}
      className="flex h-[420px] w-[460px] flex-col border border-content/10 bg-background-base"
    >
      <h2 className="px-4 py-2 text-[12px] text-content/60">{title}</h2>
      <p
        data-transcript={id}
        className="min-h-0 flex-1 px-4 text-[13px] text-content/80"
      >
        The agent left a card and ended its turn.
      </p>
      <div className="shrink-0 p-1.5">
        <DecisionCardPanel
          cards={waiting}
          onAnswer={(cardId, reply) => {
            replies.push({ pane: id, cardId, reply });
            setWaiting((current) => current.filter((item) => item.id !== cardId));
          }}
        />
        <div className="mx-1.5 flex rounded-lg border border-content/10 text-[12px]">
          <input
            data-composer
            aria-label={`Message ${id}`}
            placeholder="Message the agent…"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-content outline-none placeholder:text-content/35"
          />
        </div>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <div className="flex gap-4 p-2">
    {panes.map((pane) => (
      <Pane key={pane.id} {...pane} />
    ))}
  </div>,
);
