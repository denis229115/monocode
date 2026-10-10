import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
} from "../../../shared/ui/icons";
import type { DecisionCard } from "../model/decisionCard";
import {
  selectedAnswerLabels,
  type UserQuestionReply,
} from "../model/userQuestion";
import { QuestionForm } from "./QuestionForm";

const pagerButton =
  "grid size-5 place-items-center rounded-md hover:bg-content/10 hover:text-content disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * The cards an agent left waiting, one at a time above the composer. Skipping
 * every question dismisses the card without sending anything.
 */
export function DecisionCardPanel({
  cards,
  cwd,
  onAnswer,
}: {
  cards: DecisionCard[];
  cwd?: string;
  onAnswer: (cardId: string, reply: UserQuestionReply) => void;
}) {
  const [index, setIndex] = useState(0);
  if (!cards.length) return null;
  const at = Math.min(index, cards.length - 1);
  const card = cards[at];
  const pager =
    cards.length > 1 ? (
      <span
        data-decision-pager
        className="flex shrink-0 items-center gap-0.5 text-[11px] text-content/40"
      >
        <button
          type="button"
          aria-label="Previous card"
          className={pagerButton}
          disabled={at === 0}
          onClick={() => setIndex(at - 1)}
        >
          <ChevronLeft className="size-3" />
        </button>
        <span>
          Card {at + 1} of {cards.length}
        </span>
        <button
          type="button"
          aria-label="Next card"
          className={pagerButton}
          disabled={at === cards.length - 1}
          onClick={() => setIndex(at + 1)}
        >
          <ChevronRight className="size-3" />
        </button>
      </span>
    ) : undefined;
  return (
    <div data-decision-card={card.id}>
      <QuestionForm
        key={card.id}
        prompt={{ requestId: 0, title: "Decision", questions: card.questions }}
        pager={pager}
        cwd={cwd}
        onReply={(_, reply) => onAnswer(card.id, reply)}
      />
    </div>
  );
}

/** A decision card in the transcript, under the turn that asked it. */
export function DecisionCardSummary({ card }: { card: DecisionCard }) {
  const outcome = card.outcome;
  const status =
    outcome?.kind === "answered"
      ? "Answered"
      : outcome?.kind === "dismissed"
        ? "Dismissed"
        : "Waiting for your answer";
  return (
    <div
      data-decision-summary={card.id}
      data-status={outcome?.kind ?? "waiting"}
      className="w-full max-w-lg rounded-xl border border-content/10 bg-content/5 px-4 py-3 font-sans"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-content/45">
        <MessageSquare className="size-3.5 shrink-0" strokeWidth={1.75} />
        Decision · {status}
      </div>
      {card.questions.map((question) => {
        const answer =
          outcome?.kind === "answered"
            ? selectedAnswerLabels(question, outcome.reply)
            : [];
        return (
          <p
            key={question.id}
            className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-content"
          >
            {question.prompt}
            {outcome?.kind === "answered" ? (
              <span className="text-content/50">
                {" → "}
                {answer.length ? (
                  <span className="font-medium text-content">
                    {answer.join(", ")}
                  </span>
                ) : (
                  "skipped"
                )}
              </span>
            ) : null}
          </p>
        );
      })}
    </div>
  );
}
