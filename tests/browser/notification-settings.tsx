import { createRoot } from "react-dom/client";
import { ProjectNotificationSettings } from "../../src/features/notifications/ui/ProjectNotificationSettings";
import { createMono, saveMonoName } from "../../src/features/monos/model/mono";
import "../../src/styles/index.css";

// Native calls answer as an empty project would; nothing here needs them.
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async () => null,
    transformCallback: () => 0,
    unregisterCallback: () => {},
  },
});

localStorage.clear();
saveMonoName(createMono(["/tmp/monocode"]).id, "Pixi");

createRoot(document.getElementById("root")!).render(
  <div data-fixture className="w-[640px] bg-background-base p-6 text-content">
    <ProjectNotificationSettings cwd="/tmp/monocode" />
  </div>,
);
