// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

type Row = { sessionId: string; leadId?: string };

/** Storage as the Rust side keeps it: the list follows what was settled. */
function storage(initial: Row[]) {
  const state = { waiting: initial };
  mocks.invoke.mockImplementation(async (command: string, args?: { sessionId?: string }) => {
    if (command === "decision_card_waiting_sessions") return state.waiting;
    if (command === "git_worktree_remove") {
      state.waiting = state.waiting.filter((row) => row.sessionId !== "in-tree");
      return { sessionIds: ["in-tree"], projectCwd: "/repo" };
    }
    if (command === "session_delete") {
      state.waiting = state.waiting.filter((row) => row.sessionId !== args?.sessionId);
      return undefined;
    }
    throw new Error(`No fixture for ${command}`);
  });
  return state;
}

async function load() {
  vi.resetModules();
  return import("./decisionCards");
}

afterEach(() => mocks.invoke.mockReset());

describe("saved waiting cards", () => {
  it("clears a card answered in another window on the next refresh", async () => {
    const state = storage([{ sessionId: "closed" }, { sessionId: "worker", leadId: "lead" }]);
    const store = await load();
    const changed = vi.fn();
    store.subscribeSavedWaitingDecisions(changed);
    await store.refreshSavedWaitingDecisions();
    expect([...store.savedWaitingDecisions()]).toEqual([
      ["closed", undefined],
      ["worker", "lead"],
    ]);
    // The other window settles the card; focusing this one rereads.
    state.waiting = [{ sessionId: "worker", leadId: "lead" }];
    await store.refreshSavedWaitingDecisions();
    expect([...store.savedWaitingDecisions().keys()]).toEqual(["worker"]);
    // Rereading the same list does not repaint.
    await store.refreshSavedWaitingDecisions();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest read when an older one lands late, and the last list on failure", async () => {
    const store = await load();
    let first!: (rows: Row[]) => void;
    mocks.invoke
      .mockImplementationOnce(() => new Promise<Row[]>((resolve) => (first = resolve)))
      .mockResolvedValueOnce([{ sessionId: "new" }])
      .mockRejectedValueOnce(new Error("locked"));
    const older = store.refreshSavedWaitingDecisions();
    await store.refreshSavedWaitingDecisions();
    first([{ sessionId: "old" }]);
    await older;
    expect([...store.savedWaitingDecisions().keys()]).toEqual(["new"]);
    await store.refreshSavedWaitingDecisions();
    expect([...store.savedWaitingDecisions().keys()]).toEqual(["new"]);
  });

  it("drops a chat whose worktree is removed after startup", async () => {
    storage([{ sessionId: "in-tree" }, { sessionId: "elsewhere" }]);
    const store = await load();
    await store.refreshSavedWaitingDecisions();
    const { removeWorktree } = await import(
      "../../source-control/model/worktrees"
    );
    await removeWorktree("/repo", "/repo-worktrees/feature");
    await vi.waitFor(() =>
      expect([...store.savedWaitingDecisions().keys()]).toEqual(["elsewhere"]),
    );
  });

  it("drops a deleted chat", async () => {
    storage([{ sessionId: "gone" }, { sessionId: "kept" }]);
    const store = await load();
    await store.refreshSavedWaitingDecisions();
    const { deleteSession } = await import("./sessionStore");
    await deleteSession("gone");
    await vi.waitFor(() =>
      expect([...store.savedWaitingDecisions().keys()]).toEqual(["kept"]),
    );
  });
});
