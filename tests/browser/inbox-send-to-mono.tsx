import { useState } from "react";
import { createRoot } from "react-dom/client";
import { InboxDetail } from "../../src/features/inbox/ui/InboxView";
import type { InboxItem } from "../../src/features/inbox/model/githubTasks";
import { inboxMonoMessage } from "../../src/features/inbox/model/inboxMono";
import "../../src/styles/index.css";

// Native calls answer as an empty inbox would; nothing here needs them.
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async () => null,
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

const item: InboxItem = {
  kind: "issue",
  title: "Crash when saving a note",
  url: "https://github.com/acme/web/issues/157",
  state: "open",
  updatedAt: "2026-09-11T08:00:00Z",
  labels: [],
  assignees: [],
  draft: false,
  repo: "acme/web",
  number: 157,
  projectPath: "/tmp/web",
  provider: "github",
};

// ?monos=none shows today's button; otherwise the names are offered.
const params = new URLSearchParams(location.search);
const names = (params.get("monos") ?? "").split(",").filter(Boolean);
const split = params.get("monos") !== "none";
const monos = split
  ? names.filter((name) => name !== "none").map((name) => ({ id: name, name }))
  : undefined;

function Fixture() {
  const [log, setLog] = useState<string[]>([]);
  const record = (entry: string) => setLog((current) => [...current, entry]);
  return (
    <div data-fixture className="h-[260px] w-[620px] bg-background-base">
      <InboxDetail
        item={item}
        cwd="/tmp/web"
        projects={[]}
        revision={0}
        relatedSessions={[]}
        onStart={() => record("agent")}
        {...(monos
          ? {
              monos,
              // The text goes to the Mono as the app sends it.
              onStartInMono: (sent: InboxItem, monoId: string) =>
                record(`mono:${monoId}:${inboxMonoMessage(sent)}`),
            }
          : {})}
      />
      <pre data-log hidden>
        {JSON.stringify(log)}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
