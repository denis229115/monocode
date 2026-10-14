import { useEffect, useRef, type RefObject } from "react";

/**
 * Number keys for question forms. One window listener serves every form on
 * screen and hands the key to the one form that belongs to the pane the user
 * is working in, so two panes with open questions never both answer.
 */

/** The panes a form can live in: a session pane or a Mono's floating chat. */
const PANE = "[data-session-drop], [data-floating-mono]";

/** Places a digit is not for the form: a terminal, a menu, a modal. */
const OTHER_UI =
  '.monocode-terminal, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type Entry = {
  root: RefObject<HTMLElement | null>;
  handle: (event: KeyboardEvent) => void;
};

const entries = new Set<Entry>();
/** The pane last clicked or focused, as the app's own pane focus follows. */
let lastPane: Element | null = null;

function paneOf(node: EventTarget | null): Element | null {
  return node instanceof Element ? node.closest(PANE) : null;
}

function noteInteraction(event: Event) {
  // Clicks outside every pane (the sidebar, say) do not move pane focus.
  lastPane = paneOf(event.target) ?? lastPane;
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  return element.getClientRects().length > 0;
}

/**
 * The form a digit belongs to: the form holding focus; else the one in the
 * pane the user last worked in; else the only form visible.
 */
export function pickQuestionForm<T extends { root: HTMLElement }>(
  forms: T[],
  target: EventTarget | null,
  pane: Element | null,
): T | null {
  const shown = forms
    .filter((form) => visible(form.root))
    .sort((a, b) =>
      a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );
  const holding = forms.find(
    (form) => target instanceof Node && form.root.contains(target),
  );
  if (holding) return holding;
  const scope =
    paneOf(target) ?? (pane?.isConnected ? pane : null);
  if (scope) {
    return shown.find((form) => paneOf(form.root) === scope) ?? null;
  }
  return shown.length === 1 ? shown[0] : null;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || !/^[1-9]$/.test(event.key)) return;
  const target = event.target;
  if (target instanceof Element && target.closest(OTHER_UI)) return;
  if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
  const live = [...entries].flatMap((entry) =>
    entry.root.current ? [{ entry, root: entry.root.current }] : [],
  );
  // With focus on body the pane is the one last used; else where focus is.
  const focusTarget =
    target instanceof Element && target !== document.body
      ? target
      : document.activeElement === document.body
        ? null
        : document.activeElement;
  const picked = pickQuestionForm(live, focusTarget, lastPane);
  picked?.entry.handle(event);
}

let tracking = false;

/** Follows the user's pane from the first form on, so a click made before a question arrived still counts. */
function track() {
  if (tracking) return;
  tracking = true;
  window.addEventListener("pointerdown", noteInteraction, true);
  window.addEventListener("focusin", noteInteraction, true);
}

/**
 * Calls `handle` for number keys meant for the form inside `root`. The handler
 * decides what the key does and calls preventDefault when it acts.
 */
export function useQuestionDigitKeys(
  root: RefObject<HTMLElement | null>,
  handle: (event: KeyboardEvent) => void,
) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    const entry: Entry = { root, handle: (event) => latest.current(event) };
    track();
    lastPane ??= paneOf(document.activeElement);
    if (entries.size === 0) window.addEventListener("keydown", onKeyDown);
    entries.add(entry);
    return () => {
      entries.delete(entry);
      if (entries.size === 0) window.removeEventListener("keydown", onKeyDown);
    };
  }, [root]);
}
