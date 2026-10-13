// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "../../../platform/tauri/fs";
import { AgentMarkdown } from "./AgentMarkdown";
import { LocalMedia } from "./LocalMedia";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(async (_command: string, args: { path: string }) => args.path),
}));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  readBinaryFile: vi.fn(),
}));
vi.mock("../../../platform/tauri/trackpadZoom", () => ({
  claimTrackpadMagnify: () => () => {},
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(fs.readBinaryFile).mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shot");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(node: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(node);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe("LocalMedia image lightbox", () => {
  const fallback = createElement("a", { href: "/shot.png" }, "the link");

  async function renderImage() {
    vi.mocked(fs.readBinaryFile).mockResolvedValue(PNG);
    await render(
      createElement(LocalMedia, { path: "/shot.png", label: "Shot", fallback }),
    );
    return container.querySelector<HTMLImageElement>("img")!;
  }

  it("opens the lightbox on click and closes it with Escape", async () => {
    const image = await renderImage();
    expect(dialog()).toBeNull();

    act(() => image.click());
    expect(dialog()?.getAttribute("aria-label")).toBe("Image preview: Shot");
    expect(dialog()?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:shot",
    );

    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(dialog()).toBeNull();
  });

  it("closes on a click outside the image", async () => {
    const image = await renderImage();
    act(() => image.click());

    act(() => {
      dialog()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it("shows the link when the image cannot load", async () => {
    vi.mocked(fs.readBinaryFile).mockRejectedValue(new Error("gone"));
    await render(
      createElement(LocalMedia, { path: "/shot.png", label: "Shot", fallback }),
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")?.textContent).toBe("the link");
  });

  it("leaves videos with their controls and no lightbox", async () => {
    await render(
      createElement(LocalMedia, {
        path: "/clip.mp4",
        label: "Clip",
        fallback,
      }),
    );
    const video = container.querySelector("video")!;

    expect(video.hasAttribute("controls")).toBe(true);
    act(() => video.click());
    expect(dialog()).toBeNull();
  });
});

describe("AgentMarkdown local media clicks", () => {
  it("opens the lightbox, not the file viewer, for an image", async () => {
    vi.mocked(fs.readBinaryFile).mockResolvedValue(PNG);
    const onOpenFile = vi.fn();
    await render(
      createElement(AgentMarkdown, {
        text: "[Shot](/Users/me/shot.png)",
        localMedia: true,
        onOpenFile,
      }),
    );

    act(() => container.querySelector("img")!.click());

    expect(dialog()).not.toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("still opens non-image links in the file viewer", async () => {
    const onOpenFile = vi.fn();
    await render(
      createElement(AgentMarkdown, {
        text: "[the notes](/Users/me/notes.md)",
        localMedia: true,
        cwd: "/Users/me",
        onOpenFile,
      }),
    );

    act(() => container.querySelector("a")!.click());

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});
