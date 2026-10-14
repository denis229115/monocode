import { isTypedAnswerOption, type UserQuestion } from "./userQuestion";

/** How many options get a number key; the keys are 1 to 9. */
export const QUESTION_DIGIT_LIMIT = 9;

export type QuestionDigitAction =
  | { type: "ignore" }
  /** Pick (or toggle) the option and stay on this question. */
  | {
      type: "select";
      index: number;
      optionId: string;
      /** The option is the typed answer, so its text field should take focus. */
      focusCustom: boolean;
    }
  /** Pick the option and move on, as clicking it then Continue would. */
  | {
      type: "advance";
      index: number;
      optionId: string;
      /** The last question sends the reply; any other shows the next one. */
      then: "next" | "finish";
    };

export type QuestionDigitInput = {
  question: UserQuestion;
  /** The options as shown, including a trailing "Other" row. */
  options: UserQuestion["options"];
  /** The option ids already chosen for this question. */
  selected: string[];
  /** Whether this is the last question of the card. */
  last: boolean;
  key: string;
  modifiers?: {
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    repeat?: boolean;
    isComposing?: boolean;
  };
  /** Where the key was pressed. */
  target?: EventTarget | null;
};

/**
 * What a number key does on a question form. Only a bare digit pressed
 * outside a text field counts, so typing numbers is never taken over.
 */
export function questionDigitAction({
  question,
  options,
  selected,
  last,
  key,
  modifiers = {},
  target = null,
}: QuestionDigitInput): QuestionDigitAction {
  const ignore: QuestionDigitAction = { type: "ignore" };
  if (!/^[1-9]$/.test(key)) return ignore;
  if (
    modifiers.ctrlKey ||
    modifiers.altKey ||
    modifiers.metaKey ||
    modifiers.repeat ||
    modifiers.isComposing
  ) {
    return ignore;
  }
  if (isTextEntryTarget(target)) return ignore;

  const index = Number(key) - 1;
  const option = options[index];
  if (!option) return ignore;

  const typed = isTypedAnswerOption(question, option);
  if (typed) {
    return {
      type: "select",
      index,
      optionId: option.id,
      focusCustom: !selected.includes(option.id),
    };
  }
  if (question.multiSelect) {
    return { type: "select", index, optionId: option.id, focusCustom: false };
  }
  return {
    type: "advance",
    index,
    optionId: option.id,
    then: last ? "finish" : "next",
  };
}

/** Whether typing here enters text, where a digit is a character. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element.isContentEditable) return true;
  return Boolean(
    element.closest(
      '[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"]',
    ),
  );
}
