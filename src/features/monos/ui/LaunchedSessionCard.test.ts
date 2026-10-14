// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MonoSpawnedSession } from "../../sessions/model/session";
import type { LaunchedSessionState } from "../model/monoSpawnedSessions";
import { LaunchedSessionCard } from "./LaunchedSessionCard";

const launch: MonoSpawnedSession = {
  sessionId: "app-login",
  cwd: "/repo",
  title: "Fix the login bug",
  harness: "codex",
  model: "gpt-6",
};

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

function render(state: LaunchedSessionState, onOpen = vi.fn()) {
  act(() =>
    root.render(
      createElement(LaunchedSessionCard, {
        launch,
        view: { state, title: launch.title },
        onOpen,
      }),
    ),
  );
  return onOpen;
}

it("says it needs input and offers to open the session from inside the card", () => {
  const onOpen = render("input");
  const card = container.querySelector("[data-launched-session-card]")!;
  expect(card.textContent).toContain("Needs input");
  const open = card.querySelector<HTMLButtonElement>(
    "[data-launched-session-open]",
  )!;
  expect(open.textContent).toBe("Open session");
  act(() => open.click());
  expect(onOpen).toHaveBeenCalledTimes(1);
  // The card itself still opens it, as it does in every state.
  act(() =>
    card.querySelector<HTMLButtonElement>("[data-launched-session]")!.click(),
  );
  expect(onOpen).toHaveBeenCalledTimes(2);
  // Buttons do not nest.
  expect(card.querySelector("button button")).toBeNull();
});

it("offers no extra action in the other states", () => {
  for (const state of ["working", "done", "failed"] as const) {
    render(state);
    expect(container.querySelector("[data-launched-session-open]")).toBeNull();
    expect(container.textContent).not.toContain("Needs input");
    expect(
      container
        .querySelector("[data-launched-session]")!
        .getAttribute("data-state"),
    ).toBe(state);
  }
});
