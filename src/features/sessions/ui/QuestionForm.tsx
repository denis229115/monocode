import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, MessageSquare } from "../../../shared/ui/icons";
import {
  CUSTOM_OPTION_ID,
  buildQuestionReply,
  isTypedAnswerOption,
  questionIsComplete,
  type UserQuestion,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../model/userQuestion";
import { parseStandaloneHttpUrl } from "../model/linkPreview";
import {
  QUESTION_DIGIT_LIMIT,
  questionDigitAction,
} from "../model/questionDigit";
import { useQuestionDigitKeys } from "./useQuestionDigitKeys";
import { UserLinkPreview } from "./UserLinkPreview";

type Props = {
  prompt: UserQuestionPrompt;
  onReply: (requestId: number, reply: UserQuestionReply) => void;
  onInteraction?: (requestId: number) => void;
  /** Controls for moving between several waiting cards, beside Skip. */
  pager?: ReactNode;
  /** The project a GitHub link resolves against. */
  cwd?: string;
};

export function QuestionForm({
  prompt,
  onReply,
  onInteraction,
  pager,
  cwd,
}: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now);
  const root = useRef<HTMLDivElement>(null);
  const focusCustomNext = useRef(false);

  useEffect(() => {
    if (prompt.autoResolveAt == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [prompt.requestId, prompt.autoResolveAt]);

  const interact = () => {
    if (prompt.autoResolveAt != null) onInteraction?.(prompt.requestId);
  };

  useEffect(() => {
    setStep(0);
    setAnswers({});
    setCustom({});
  }, [prompt.requestId]);

  const questions = prompt.questions;
  const total = questions.length;
  const index = Math.min(step, Math.max(total - 1, 0));
  const question = questions[index];
  const last = index >= total - 1;
  const ready = useMemo(
    () => (question ? questionIsComplete(question, answers, custom) : false),
    [answers, custom, question],
  );

  const finish = (nextAnswers = answers, nextCustom = custom) => {
    onReply(prompt.requestId, buildQuestionReply(questions, nextAnswers, nextCustom));
  };

  const skipCurrent = () => {
    if (!question) {
      finish();
      return;
    }
    const nextAnswers = { ...answers };
    const nextCustom = { ...custom };
    delete nextAnswers[question.id];
    delete nextCustom[question.id];
    if (last) {
      finish(nextAnswers, nextCustom);
      return;
    }
    setAnswers(nextAnswers);
    setCustom(nextCustom);
    setStep(index + 1);
  };

  const continueCurrent = () => {
    if (!question || !ready) return;
    if (last) {
      finish();
      return;
    }
    setStep(index + 1);
  };

  const goBack = () => {
    if (index > 0) setStep(index - 1);
  };

  // Number keys answer without clicking first; see useQuestionDigitKeys for
  // which form hears them.
  useQuestionDigitKeys(root, (event) => {
    if (!question) return;
    const action = questionDigitAction({
      question,
      options: displayOptions(question),
      selected: answers[question.id] ?? [],
      last,
      key: event.key,
      modifiers: event,
      target: event.target,
    });
    if (action.type === "ignore") return;
    event.preventDefault();
    interact();
    if (action.type === "advance") {
      const nextAnswers = { ...answers, [question.id]: [action.optionId] };
      setAnswers(nextAnswers);
      if (action.then === "finish") finish(nextAnswers);
      else setStep(index + 1);
      return;
    }
    setAnswers((current) => ({
      ...current,
      [question.id]: nextSelection(
        question,
        current[question.id] ?? [],
        action.optionId,
      ),
    }));
    if (action.focusCustom) focusCustomNext.current = true;
    else
      root.current
        ?.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")
        [action.index]?.focus();
  });

  // The typed answer's field exists once its option is selected.
  useEffect(() => {
    if (!focusCustomNext.current) return;
    focusCustomNext.current = false;
    root.current
      ?.querySelector<HTMLInputElement>('input[aria-label="Your answer"]')
      ?.focus();
  }, [answers]);

  if (!question) return null;

  const title = question.header?.trim() || prompt.title?.trim() || "Question";

  return (
    <div
      ref={root}
      className="px-1.5 pb-1.5"
      data-question-form
      onPointerDownCapture={interact}
      onClickCapture={interact}
      onKeyDownCapture={interact}
      onPasteCapture={interact}
      onChangeCapture={interact}
    >
      <form
        className="rounded-lg border border-content/10 bg-content/3 px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          continueCurrent();
        }}
      >
        <div className="flex items-center gap-1.5">
          <MessageSquare
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span
            data-question-title
            className="min-w-0 flex-1 truncate text-[11px] text-content/50"
          >
            {headerRestatesLink(question) ? null : title}
          </span>
          {total > 1 ? (
            <span className="shrink-0 text-[11px] text-content/40">
              {index + 1} of {total}
            </span>
          ) : null}
          {pager}
          <button
            type="button"
            className="h-6 shrink-0 rounded-md px-1.5 text-[11px] text-content/55 hover:bg-content/10 hover:text-content"
            onClick={skipCurrent}
          >
            Skip
          </button>
        </div>
        <div className="mt-2">
          <QuestionFields
            key={question.id}
            question={question}
            cwd={cwd}
            selected={answers[question.id] ?? []}
            custom={custom[question.id] ?? ""}
            onSelect={(optionId) =>
              setAnswers((current) => ({
                ...current,
                [question.id]: nextSelection(
                  question,
                  current[question.id] ?? [],
                  optionId,
                ),
              }))
            }
            onCustom={(value) => {
              setCustom((current) => ({ ...current, [question.id]: value }));
              setAnswers((current) => {
                const selected = current[question.id] ?? [];
                if (question.multiSelect) {
                  const without = selected.filter(
                    (id) => !isCustomId(question, id),
                  );
                  return {
                    ...current,
                    [question.id]: [...without, customOptionId(question)],
                  };
                }
                return {
                  ...current,
                  [question.id]: [customOptionId(question)],
                };
              });
            }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-end gap-2">
          {prompt.autoResolveAt != null ? (
            <span
              className="mr-auto text-[11px] text-content/40"
              title="Interact to keep this question open."
            >
              {prompt.autoResolveAt - now > 60_000
                ? "Optional question"
                : `Continues without an answer in ${Math.max(0, Math.ceil((prompt.autoResolveAt - now) / 1000))}s`}
            </span>
          ) : null}
          {index > 0 ? (
            <button
              type="button"
              className="h-6 shrink-0 rounded-md px-1.5 text-[11px] text-content/55 hover:bg-content/10 hover:text-content"
              onClick={goBack}
            >
              Back
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!ready}
            className="h-6 rounded-md bg-content px-2.5 text-[11px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}

function QuestionFields({
  question,
  cwd,
  selected,
  custom,
  onSelect,
  onCustom,
}: {
  question: UserQuestion;
  cwd?: string;
  selected: string[];
  custom: string;
  onSelect: (optionId: string) => void;
  onCustom: (value: string) => void;
}) {
  const options = displayOptions(question);
  const customSelected = selected.some((id) => isCustomId(question, id));
  const customId = customOptionId(question);
  const [highlighted, setHighlighted] = useState(() => {
    const selectedIndex = options.findIndex((option) =>
      selected.includes(option.id),
    );
    return selectedIndex >= 0 ? selectedIndex : 0;
  });
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);

  const highlight = (index: number) => {
    setHighlighted(index);
    optionButtons.current[index]?.focus();
  };

  const onOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      highlight((index + offset + options.length) % options.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      highlight(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(options[index].id);
      return;
    }
    // Number keys are handled for the whole form by useQuestionDigitKeys.
  };

  return (
    <fieldset className="min-w-0" aria-label={question.header || question.prompt}>
      {question.links?.length ? (
        <div className="flex flex-wrap gap-1.5" data-question-links>
          {question.links.flatMap((url) => {
            const link = parseStandaloneHttpUrl(url);
            if (!link) return [];
            // A PR or issue shows as its GitHub card; other links as a chip.
            if (link.githubWorkItem)
              return [
                <UserLinkPreview key={url} link={link} cwd={cwd} compact />,
              ];
            return [
              <a
                key={url}
                href={link.url}
                data-question-link
                title={link.url}
                className="inline-flex h-[18px] max-w-60 items-center gap-1 rounded-[6px] bg-content/8 px-1.5 text-xs leading-4 text-content/70 no-underline hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(link.url).catch((error) =>
                    console.error("Failed to open web link:", error),
                  );
                }}
              >
                <ExternalLink className="size-3 shrink-0" />
                <span className="truncate">{link.displayUrl}</span>
              </a>,
            ];
          })}
        </div>
      ) : null}
      <p
        data-question-prompt
        className="mt-1.5 max-h-44 overflow-y-auto whitespace-pre-line break-words text-[13px] font-medium leading-snug text-content first:mt-0"
      >
        {question.prompt}
      </p>
      {question.multiSelect ? (
        <p className="mt-0.5 text-[11px] text-content/40">Select all that apply</p>
      ) : null}
      {options.length === 0 && question.allowCustom ? (
        <input
          value={custom}
          onChange={(event) => onCustom(event.target.value)}
          aria-label="Your answer"
          placeholder="Type your answer"
          className="mt-1.5 w-full rounded-md border border-content/15 bg-transparent px-2 py-1 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-content/30"
        />
      ) : (
        <div
          className="mt-1.5 flex max-h-52 flex-col gap-1 overflow-y-auto"
          role="group"
        >
          {options.map((option, optionIndex) => {
            const isCustom = isTypedAnswerOption(question, option);
            const active = selected.includes(option.id);
            return (
              <div key={option.id}>
                <button
                  ref={(button) => {
                    optionButtons.current[optionIndex] = button;
                  }}
                  type="button"
                  aria-pressed={active}
                  aria-keyshortcuts={
                    optionIndex < QUESTION_DIGIT_LIMIT
                      ? String(optionIndex + 1) : undefined
                  }
                  data-highlighted={
                    highlighted === optionIndex ? "true" : undefined
                  }
                  tabIndex={highlighted === optionIndex ? 0 : -1}
                  onFocus={() => setHighlighted(optionIndex)}
                  onKeyDown={(event) => onOptionKeyDown(event, optionIndex)}
                  onClick={() => {
                    setHighlighted(optionIndex);
                    onSelect(option.id);
                  }}
                  className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                    active
                      ? "border-content/35 bg-selection"
                      : "border-content/10 hover:bg-content/5"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 grid size-3.5 shrink-0 place-items-center border ${
                      question.multiSelect ? "rounded-[3px]" : "rounded-full"
                    } ${
                      active
                        ? "border-content bg-content text-background-base"
                        : "border-content/30"
                    }`}
                  >
                    {active ? (
                      <Check className="size-2.5" strokeWidth={2.5} />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] leading-snug text-content">
                      {option.label}
                      {option.recommended ? (
                        <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-px align-[1px] text-[10px] text-accent">
                          Recommended
                        </span>
                      ) : null}
                    </span>
                    {option.description ? (
                      <span className="mt-0.5 block text-[11px] leading-snug text-content/50">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {optionIndex < QUESTION_DIGIT_LIMIT ? (
                    <kbd
                      aria-hidden
                      data-question-digit
                      className="mt-px grid h-4 min-w-4 shrink-0 place-items-center rounded border border-content/12 bg-content/4 px-1 font-sans text-[10px] leading-none text-content/45"
                    >
                      {optionIndex + 1}
                    </kbd>
                  ) : null}
                </button>
                {isCustom && (active || customSelected) ? (
                  <input
                    value={custom}
                    onChange={(event) => onCustom(event.target.value)}
                    aria-label="Your answer"
                    placeholder="Type your answer"
                    className="mt-1 w-full rounded-md border border-content/15 bg-transparent px-2 py-1 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-content/30"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => {
                      if (!customSelected) onSelect(customId);
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/** A header like "PR #12" only repeats the link chip beside it. */
function headerRestatesLink(question: UserQuestion): boolean {
  const match = /^(pr|pull request|issue)?\s*#?(\d+)$/i.exec(
    question.header?.trim() ?? "",
  );
  if (!match) return false;
  const kind = match[1]?.toLowerCase();
  return (question.links ?? []).some((url) => {
    const item = parseStandaloneHttpUrl(url)?.githubWorkItem;
    return (
      item?.number === Number(match[2]) &&
      (!kind || (kind === "issue") === (item.kind === "issue"))
    );
  });
}

function displayOptions(question: UserQuestion): UserQuestion["options"] {
  if (question.options.length === 0) return question.options;
  if (
    question.options.some((option) => isTypedAnswerOption(question, option)) ||
    !question.allowCustom
  ) {
    return question.options;
  }
  return [
    ...question.options,
    {
      id: CUSTOM_OPTION_ID,
      label: "Other",
      description: "Type your own answer",
    },
  ];
}

function customOptionId(question: UserQuestion): string {
  return (
    question.options.find((option) => isTypedAnswerOption(question, option))
      ?.id ?? CUSTOM_OPTION_ID
  );
}

function isCustomId(question: UserQuestion, optionId: string): boolean {
  return optionId === CUSTOM_OPTION_ID || optionId === customOptionId(question);
}

function nextSelection(
  question: UserQuestion,
  current: string[],
  optionId: string,
): string[] {
  if (!question.multiSelect) return [optionId];
  if (current.includes(optionId)) {
    return current.filter((id) => id !== optionId);
  }
  if (isCustomId(question, optionId)) {
    return [...current.filter((id) => !isCustomId(question, id)), optionId];
  }
  return [...current, optionId];
}
