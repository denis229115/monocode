// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  questionDigitAction,
  type QuestionDigitInput,
} from "./questionDigit";
import type { UserQuestion } from "./userQuestion";

function question(overrides: Partial<UserQuestion> = {}): UserQuestion {
  return {
    id: "q",
    prompt: "Pick",
    multiSelect: false,
    allowCustom: false,
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    ...overrides,
  };
}

function press(
  key: string,
  overrides: Partial<QuestionDigitInput> = {},
  q = question(),
) {
  return questionDigitAction({
    question: q,
    options: q.options,
    selected: [],
    last: false,
    key,
    ...overrides,
  });
}

describe("questionDigitAction", () => {
  it("answers a single-select question and moves to the next", () => {
    expect(press("2")).toEqual({
      type: "advance",
      index: 1,
      optionId: "b",
      then: "next",
    });
  });

  it("finishes on the last question", () => {
    expect(press("1", { last: true })).toEqual({
      type: "advance",
      index: 0,
      optionId: "a",
      then: "finish",
    });
  });

  it("toggles on a multi-select question without advancing", () => {
    const q = question({ multiSelect: true });
    expect(press("3", { last: true }, q)).toEqual({
      type: "select",
      index: 2,
      optionId: "c",
      focusCustom: false,
    });
    // Pressing it again still only toggles.
    expect(press("3", { selected: ["c"] }, q).type).toBe("select");
  });

  it("selects the custom option and asks for its text field", () => {
    const q = question({
      allowCustom: true,
      options: [
        { id: "a", label: "A" },
        { id: "__custom__", label: "Other" },
      ],
    });
    expect(press("2", { last: true }, q)).toEqual({
      type: "select",
      index: 1,
      optionId: "__custom__",
      focusCustom: true,
    });
    expect(press("2", { selected: ["__custom__"] }, q)).toMatchObject({
      type: "select",
      focusCustom: false,
    });
    const multi = { ...q, multiSelect: true };
    expect(press("2", {}, multi)).toMatchObject({
      type: "select",
      optionId: "__custom__",
      focusCustom: true,
    });
  });

  it("ignores digits with no option behind them", () => {
    expect(press("4")).toEqual({ type: "ignore" });
    expect(press("9")).toEqual({ type: "ignore" });
    expect(press("0")).toEqual({ type: "ignore" });
    expect(press("1", { options: [] })).toEqual({ type: "ignore" });
  });

  it("only numbers the first nine options", () => {
    const options = Array.from({ length: 12 }, (_, i) => ({
      id: `o${i + 1}`,
      label: `Option ${i + 1}`,
    }));
    const q = question({ options });
    expect(press("9", {}, q)).toMatchObject({ index: 8, optionId: "o9" });
    expect(press("0", {}, q)).toEqual({ type: "ignore" });
    // Two keystrokes never make a ten.
    expect(press("10", {}, q)).toEqual({ type: "ignore" });
  });

  it("ignores other keys", () => {
    for (const key of ["a", "Enter", " ", "ArrowDown", "!", "Digit1"]) {
      expect(press(key)).toEqual({ type: "ignore" });
    }
  });

  it("ignores digits with Ctrl, Alt or Meta held, and held-down repeats", () => {
    expect(press("1", { modifiers: { ctrlKey: true } })).toEqual({
      type: "ignore",
    });
    expect(press("1", { modifiers: { altKey: true } })).toEqual({
      type: "ignore",
    });
    expect(press("1", { modifiers: { metaKey: true } })).toEqual({
      type: "ignore",
    });
    expect(press("1", { modifiers: { repeat: true } })).toEqual({
      type: "ignore",
    });
    expect(press("1", { modifiers: { isComposing: true } })).toEqual({
      type: "ignore",
    });
    expect(press("1", { modifiers: { ctrlKey: false } }).type).toBe("advance");
  });

  it("ignores digits typed into text fields", () => {
    const targets = [
      document.createElement("textarea"),
      document.createElement("input"),
      document.createElement("select"),
    ];
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    for (const target of [...targets, editable, inner, textbox]) {
      expect(press("1", { target })).toEqual({ type: "ignore" });
    }
  });

  it("answers from the page body and from buttons", () => {
    const button = document.createElement("button");
    expect(press("1", { target: document.body }).type).toBe("advance");
    expect(press("1", { target: button }).type).toBe("advance");
    expect(press("1", { target: null }).type).toBe("advance");
  });
});
