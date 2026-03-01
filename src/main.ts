import { validateSearchMap } from "./lib/loaders";
import { mountBroadcastAssemblyUI } from "./ui/broadcast-assembly";
import { mountBrowsingUI } from "./ui";
import { renderValidationReport } from "./ui/validation-report";

type AppView = "browse" | "assembly" | "validation";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app container.");
}

const shell = document.createElement("div");
shell.innerHTML = `
  <style>
    :root { font-family: system-ui, sans-serif; }
    body { margin: 0; }
    .app-shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    .app-shell__nav {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #dadce0;
      padding: 12px;
      position: sticky;
      top: 0;
      background: #fff;
      z-index: 1;
    }
    .app-shell__nav button {
      border: 1px solid #dadce0;
      border-radius: 999px;
      background: #fff;
      padding: 6px 10px;
      cursor: pointer;
    }
    .app-shell__nav button.is-active {
      background: #1a73e8;
      color: #fff;
      border-color: #1a73e8;
    }
    .app-shell__content {
      padding: 12px;
      min-height: 0;
      height: calc(100vh - 62px);
      box-sizing: border-box;
    }
  </style>
  <div class="app-shell">
    <nav class="app-shell__nav" aria-label="Application views"></nav>
    <main class="app-shell__content"></main>
  </div>
`;

const nav = shell.querySelector<HTMLElement>(".app-shell__nav");
const content = shell.querySelector<HTMLElement>(".app-shell__content");

if (!nav || !content) {
  throw new Error("Unable to initialize app shell.");
}

const views: { id: AppView; label: string }[] = [
  { id: "browse", label: "Transmission Browser" },
  { id: "assembly", label: "Broadcast Assembly" },
  { id: "validation", label: "Validation Report" },
];

let currentView: AppView = "browse";

function updateNav(): void {
  nav.innerHTML = "";

  for (const view of views) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = view.label;
    if (view.id === currentView) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      currentView = view.id;
      void renderView();
    });

    nav.appendChild(button);
  }
}

async function renderView(): Promise<void> {
  updateNav();
  content.innerHTML = "";

  if (currentView === "browse") {
    await mountBrowsingUI(content);
    return;
  }

  if (currentView === "assembly") {
    await mountBroadcastAssemblyUI(content);
    return;
  }

  const report = await validateSearchMap();
  renderValidationReport(content, report);
}

root.innerHTML = "";
root.appendChild(shell);
void renderView();
