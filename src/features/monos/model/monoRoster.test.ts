// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  addMonoProject,
  createMono,
  findMono,
  listMonos,
  monoLook,
  monoProjectsPhrase,
  monoWorksOn,
  removeMono,
  removeMonoProject,
  reorderMonos,
  saveMonoAccount,
} from "./mono";
import { monoBackgroundKey, monoChatBackground } from "./monoBackground";
import { saveProjectChatBackgroundSettings } from "../../projects/model/projectChatBackground";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("gives each new Mono a mascot and color the others are not using", () => {
  const first = createMono();
  const second = createMono();
  expect(second.mascot).not.toBe(first.mascot);
  expect(second.color).not.toBe(first.color);
  expect(monoLook(first).name).toMatch(/^Mono[A-Z]/);
  expect(first.projects).toEqual([]);
});

it("adds each project once and takes one away by its path", () => {
  const { id } = createMono(["/code/app"]);
  addMonoProject(id, "/code/site");
  addMonoProject(id, "/code/app/");
  expect(findMono(id)?.projects).toEqual(["/code/app", "/code/site"]);
  expect(monoWorksOn(findMono(id)!, "/code/site/")).toBe(true);
  removeMonoProject(id, "/code/app/");
  expect(findMono(id)?.projects).toEqual(["/code/site"]);
});

it("keeps the rail's order and forgets a removed Mono", () => {
  const a = createMono();
  const b = createMono();
  const c = createMono();
  reorderMonos([c.id, a.id, b.id]);
  expect(listMonos().map((mono) => mono.id)).toEqual([c.id, a.id, b.id]);
  removeMono(a.id);
  expect(listMonos().map((mono) => mono.id)).toEqual([c.id, b.id]);
});

it("names its projects the way a sentence would", () => {
  const project = (name: string) => ({ path: `/code/${name}`, name });
  expect(monoProjectsPhrase([])).toBe("");
  expect(monoProjectsPhrase([project("app")])).toBe("app");
  expect(
    monoProjectsPhrase([project("app"), project("site"), project("api")]),
  ).toBe("app, site and api");
});

it("forgets its background along with the Mono", () => {
  const mono = createMono();
  saveProjectChatBackgroundSettings(monoBackgroundKey(mono.id), {
    path: "/bg/mono.png",
    emptyOpacity: 0.24,
    sessionOpacity: 0.24,
    scope: "all",
    effect: "gradient-blur",
  });
  expect(monoChatBackground(mono.id)?.path).toBe("/bg/mono.png");
  removeMono(mono.id);
  expect(monoChatBackground(mono.id)).toBeNull();
});

it("keeps a Mono's account across a restart and loads Monos saved without one", () => {
  const mono = createMono();
  expect(findMono(mono.id)?.accounts).toBeUndefined();
  saveMonoAccount(mono.id, "claude", "account-work");
  saveMonoAccount(mono.id, "codex", "default");
  expect(findMono(mono.id)?.accounts).toEqual({
    claude: "account-work",
    codex: "default",
  });
  // Another Mono is untouched, and stored junk is dropped.
  const other = createMono();
  expect(findMono(other.id)?.accounts).toBeUndefined();
  localStorage.setItem(
    "monocode:mono-roster",
    JSON.stringify([
      { id: "old", mascot: "cat", color: "#fff", projects: [] },
      {
        id: "odd",
        mascot: "cat",
        color: "#fff",
        projects: [],
        accounts: { claude: 5, devin: "account-x", codex: "account-a" },
      },
    ]),
  );
  expect(listMonos()[0]).not.toHaveProperty("accounts");
  expect(listMonos()[1].accounts).toEqual({ codex: "account-a" });
});
