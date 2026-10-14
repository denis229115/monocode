import { useMemo, useState } from "react";
import { projectName } from "../../../shared/lib/paths";
import { Clock } from "../../../shared/ui/icons";
import type { DecisionCard } from "../../sessions/model/decisionCard";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { DecisionCardPanel } from "../../sessions/ui/DecisionCards";
import type { MonoSubagentQuestion } from "../model/monoSubagentQuestions";

/**
 * The questions a Mono's sub-agents left waiting, answered from the Mono's
 * chat. Each card names the sub-agent that asked; the answer goes to that
 * session, as it would from its own chat.
 */
export function MonoSubagentQuestions({
  questions,
  onAnswer,
  onOpenSession,
}: {
  questions: readonly MonoSubagentQuestion[];
  /** Rejects when the answer could not be sent. */
  onAnswer: (
    sessionId: string,
    cardId: string,
    reply: UserQuestionReply,
  ) => Promise<void>;
  onOpenSession?: (sessionId: string) => void;
}) {
  // Card IDs are only unique within their session, so each is keyed with it.
  const { cards, owners } = useMemo(() => {
    const owners = new Map<
      string,
      { question: MonoSubagentQuestion; id: string }
    >();
    const cards: DecisionCard[] = [];
    for (const question of questions)
      for (const card of question.cards) {
        const id = `${question.sessionId}:${card.id}`;
        owners.set(id, { question, id: card.id });
        cards.push({ ...card, id });
      }
    return { cards, owners };
  }, [questions]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  if (!cards.length) return null;
  return (
    <div
      data-subagent-questions
      inert={sending || undefined}
      className={sending ? "opacity-60" : undefined}
    >
      <DecisionCardPanel
        cards={cards}
        cwd={owners.get(cards[0].id)?.question.cwd}
        heading={(card) => {
          const asker = owners.get(card.id)?.question;
          if (!asker) return null;
          return (
            <div
              data-subagent-heading={asker.sessionId}
              className="flex items-center gap-1.5 px-3 pb-1.5 font-sans text-[12px]"
            >
              <Clock
                className="size-3.5 shrink-0 text-amber-400"
                strokeWidth={1.75}
              />
              <span className="min-w-0 truncate">
                <span className="font-medium text-content">{asker.title}</span>
                <span className="text-content/55"> needs input</span>
              </span>
              <span
                className="shrink-0 truncate text-[11px] text-content/40"
                title={asker.cwd}
              >
                {projectName(asker.cwd)}
              </span>
              {onOpenSession ? (
                <button
                  type="button"
                  className="ml-auto shrink-0 text-[11px] text-accent hover:underline"
                  onClick={() => onOpenSession(asker.sessionId)}
                >
                  Open session
                </button>
              ) : null}
            </div>
          );
        }}
        onAnswer={(cardId, reply) => {
          const owner = owners.get(cardId);
          if (!owner) return;
          setError(undefined);
          setSending(true);
          onAnswer(owner.question.sessionId, owner.id, reply)
            .catch((cause) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "The answer could not be sent.",
              ),
            )
            .finally(() => setSending(false));
        }}
      />
      {error ? (
        <p role="alert" className="px-3 pb-1.5 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
