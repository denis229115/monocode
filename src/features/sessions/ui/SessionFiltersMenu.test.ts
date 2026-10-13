// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SESSION_SIDEBAR_FILTERS } from "../model/sessionFilters";
import { SessionFiltersMenu } from "./SessionFiltersMenu";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function show(props: Record<string, unknown>) {
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(SessionFiltersMenu, {
        x: 10,
        y: 10,
        harnesses: [],
        filters: DEFAULT_SESSION_SIDEBAR_FILTERS,
        onChange,
        onClose: vi.fn(),
        ...props,
      }),
    ),
  );
  return onChange;
}

const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
    (entry) => entry.textContent === label,
  );

it("offers hiding archived sessions only when asked to", () => {
  show({});
  expect(item("Archived")).toBeDefined();
  expect(item("Hide archived")).toBeUndefined();
  show({ hideArchivedOption: true });
  expect(item("Hide archived")).toBeDefined();
});

it("turns hiding archived sessions on and off", () => {
  const filters = { ...DEFAULT_SESSION_SIDEBAR_FILTERS, hideArchived: true };
  const onChange = show({ hideArchivedOption: true, filters });
  expect(item("Hide archived")!.getAttribute("aria-checked")).toBe("true");
  act(() => item("Hide archived")!.click());
  expect(onChange).toHaveBeenLastCalledWith({
    ...filters,
    hideArchived: false,
  });
  const off = { ...filters, hideArchived: false };
  const onChangeOff = show({ hideArchivedOption: true, filters: off });
  expect(item("Hide archived")!.getAttribute("aria-checked")).toBe("false");
  act(() => item("Hide archived")!.click());
  expect(onChangeOff).toHaveBeenLastCalledWith({
    ...filters,
    hideArchived: true,
  });
});

it("clears filters back to the default it is given", () => {
  const defaults = { ...DEFAULT_SESSION_SIDEBAR_FILTERS, hideArchived: true };
  const onChange = show({
    hideArchivedOption: true,
    defaultFilters: defaults,
    filters: { ...defaults, hideArchived: false },
  });
  const clear = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((entry) => entry.textContent === "Clear filters");
  act(() => clear!.click());
  expect(onChange).toHaveBeenCalledWith(defaults);
});
