// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import type {
  UserQuestionPrompt,
  UserQuestionReply,
} from "../model/userQuestion";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function prompt(multiSelect = false): UserQuestionPrompt {
  return {
    requestId: 7,
    questions: [
      {
        id: "colour",
        prompt: "Pick a colour",
        multiSelect,
        allowCustom: false,
        options: [
          { id: "red", label: "Red" },
          { id: "green", label: "Green" },
          { id: "blue", label: "Blue" },
        ],
      },
    ],
  };
}

function renderQuestion(
  onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  multiSelect = false,
) {
  act(() =>
    root.render(
      createElement(QuestionForm, {
        prompt: prompt(multiSelect),
        onReply,
      }),
    ),
  );
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  );
}

function keyDown(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("QuestionForm keyboard navigation", () => {
  it("moves the highlighted option with arrow keys and selects it with Enter", () => {
    const onReply = vi.fn();
    const options = renderQuestion(onReply);

    expect(options[0].tabIndex).toBe(0);
    expect(options[1].tabIndex).toBe(-1);
    act(() => options[0].focus());

    keyDown(options[0], "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].dataset.highlighted).toBe("true");
    expect(options[1].tabIndex).toBe(0);

    keyDown(options[1], "Enter");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["green"] },
    });
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "ArrowUp");
    expect(document.activeElement).toBe(options[2]);

    keyDown(options[2], "Home");
    expect(document.activeElement).toBe(options[0]);

    keyDown(options[0], "End");
    expect(document.activeElement).toBe(options[2]);
  });

  it("answers with a number key while an option has focus", () => {
    const onReply = vi.fn();
    const options = renderQuestion(onReply);
    act(() => options[0].focus());

    keyDown(options[0], "3");

    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["blue"] },
    });
    expect(options[2].getAttribute("aria-keyshortcuts")).toBe("3");
  });

  it("toggles highlighted options for multi-select questions", () => {
    const options = renderQuestion(vi.fn(), true);
    act(() => options[0].focus());

    keyDown(options[0], "Enter");
    keyDown(options[0], "ArrowDown");
    keyDown(options[1], " ");

    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    keyDown(options[1], " ");
    expect(options[1].getAttribute("aria-pressed")).toBe("false");
  });
});

describe("QuestionForm steps", () => {
  function twoQuestions(): UserQuestionPrompt {
    return {
      requestId: 9,
      questions: [
        {
          id: "colour",
          prompt: "Pick a colour",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "red", label: "Red" },
            { id: "green", label: "Green" },
          ],
        },
        {
          id: "size",
          prompt: "Pick a size",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
        },
      ],
    };
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll("button")).find(
      (item) =>
        // Option rows end in their number hint, which is not part of the label.
        (item.textContent ?? "")
          .replace(item.querySelector("[data-question-digit]")?.textContent ?? "", "")
          .trim() === label,
    );
    if (!match) throw new Error(`No button labelled ${label}`);
    return match;
  }

  it("returns to the previous question with its answer and submits the change", () => {
    const onReply = vi.fn();
    act(() =>
      root.render(createElement(QuestionForm, { prompt: twoQuestions(), onReply })),
    );
    expect(container.textContent).not.toContain("Back");

    act(() => button("Red").click());
    act(() => button("Continue").click());
    expect(container.textContent).toContain("Pick a size");

    act(() => button("Back").click());
    expect(container.textContent).toContain("Pick a colour");
    expect(button("Red").getAttribute("aria-pressed")).toBe("true");

    act(() => button("Green").click());
    act(() => button("Continue").click());
    act(() => button("Large").click());
    act(() => button("Continue").click());

    expect(onReply).toHaveBeenCalledWith(9, {
      kind: "answered",
      answers: { colour: ["green"], size: ["large"] },
    });
  });
});

describe("QuestionForm number keys", () => {
  function questions(): UserQuestionPrompt {
    return {
      requestId: 11,
      questions: [
        {
          id: "colour",
          prompt: "Pick a colour",
          multiSelect: false,
          allowCustom: true,
          options: [
            { id: "red", label: "Red" },
            { id: "green", label: "Green" },
          ],
        },
        {
          id: "size",
          prompt: "Pick a size",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
        },
      ],
    };
  }

  function show(
    prompt: UserQuestionPrompt,
    onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  ) {
    act(() => root.render(createElement(QuestionForm, { prompt, onReply })));
  }

  function press(key: string, target: Element = document.body, init = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("shows each option's number as a hidden hint beside its shortcut", () => {
    show(questions());
    const hints = Array.from(
      container.querySelectorAll<HTMLElement>("[data-question-digit]"),
    );
    // Red, Green and the Other row the question adds.
    expect(hints.map((hint) => hint.textContent)).toEqual(["1", "2", "3"]);
    expect(hints.every((hint) => hint.getAttribute("aria-hidden") === "true"))
      .toBe(true);
    const buttons = container.querySelectorAll("button[aria-pressed]");
    expect(buttons[2].getAttribute("aria-keyshortcuts")).toBe("3");
  });

  it("answers and moves on from the page body, then sends on the last question", () => {
    const onReply = vi.fn();
    show(questions(), onReply);

    const first = press("2");
    expect(first.defaultPrevented).toBe(true);
    expect(container.textContent).toContain("Pick a size");
    expect(onReply).not.toHaveBeenCalled();

    press("1");
    expect(onReply).toHaveBeenCalledWith(11, {
      kind: "answered",
      answers: { colour: ["green"], size: ["small"] },
    });
  });

  it("leaves digits typed into a text field alone", () => {
    show(questions());
    const field = document.createElement("textarea");
    document.body.append(field);
    const event = press("2", field);
    field.remove();
    expect(event.defaultPrevented).toBe(false);
    expect(container.textContent).toContain("Pick a colour");
    expect(container.querySelector("[aria-pressed='true']")).toBeNull();
  });

  it("ignores digits with a modifier held", () => {
    show(questions());
    press("1", document.body, { metaKey: true });
    press("1", document.body, { ctrlKey: true });
    expect(container.textContent).toContain("Pick a colour");
  });

  it("toggles a multi-select option without advancing", () => {
    const prompt = questions();
    prompt.questions[0].multiSelect = true;
    show(prompt);
    press("1");
    press("2");
    const options = container.querySelectorAll("button[aria-pressed]");
    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Pick a colour");
    press("1");
    expect(options[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("selects the Other option and moves focus to its text field", () => {
    show(questions());
    press("3");
    const field = container.querySelector<HTMLInputElement>(
      'input[aria-label="Your answer"]',
    );
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    expect(container.textContent).toContain("Pick a colour");
    // Typing a digit there is just typing.
    const event = press("1", field!);
    expect(event.defaultPrevented).toBe(false);
  });

  it("answers in the pane the user last worked in, not both", () => {
    const first = vi.fn();
    const second = vi.fn();
    const single = (id: number): UserQuestionPrompt => ({
      requestId: id,
      questions: [
        {
          id: "q",
          prompt: "Go?",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      ],
    });
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(
            "section",
            { "data-session-drop": "a", id: "a" },
            createElement(QuestionForm, { prompt: single(1), onReply: first }),
            createElement("p", { id: "a-text" }, "transcript a"),
          ),
          createElement(
            "section",
            { "data-session-drop": "b", id: "b" },
            createElement(QuestionForm, { prompt: single(2), onReply: second }),
            createElement("p", { id: "b-text" }, "transcript b"),
          ),
        ),
      ),
    );
    // No pane worked in and two forms: nothing guesses.
    press("1");
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    act(() => {
      container
        .querySelector("#b-text")!
        .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    press("2");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(2, {
      kind: "answered",
      answers: { q: ["no"] },
    });
  });
});
