import { loadIndex, loadModule } from "../lib/loaders";
import type { TransmissionModule, TransmissionsIndex } from "../lib/schema";
import { getDefaultCategory, renderCategoryTabs } from "./components/CategoryTabs";
import { renderQueryTable, type QueryRow } from "./components/QueryTable";
import { renderTransmissionList } from "./components/TransmissionList";
import { renderErrorBoundary } from "./error-boundary";

type BrowsingState = {
  searchTerm: string;
  selectedTransmissionId: string | null;
  selectedCategoryId: string;
  queuedQueries: Set<string>;
};

const styles = `
.transmission-browser { display: grid; grid-template-rows: auto 1fr; height: 100%; gap: 12px; font-family: system-ui, sans-serif; }
.transmission-browser__topbar input { width: 100%; padding: 8px 10px; font-size: 14px; }
.transmission-browser__content { display: grid; grid-template-columns: 320px 1fr; gap: 12px; min-height: 0; }
.transmission-browser__sidebar { border: 1px solid #ddd; border-radius: 8px; padding: 12px; overflow: auto; }
.transmission-browser__main { border: 1px solid #ddd; border-radius: 8px; padding: 12px; overflow: auto; }
.transmission-browser__empty { color: #5f6368; }
.transmission-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.transmission-list__item { width: 100%; text-align: left; border: 1px solid #dadce0; border-radius: 6px; background: #fff; padding: 8px; cursor: pointer; }
.transmission-list__item.is-active { background: #e8f0fe; border-color: #1a73e8; }
.category-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.category-tabs__tab { border: 1px solid #dadce0; background: #fff; border-radius: 999px; padding: 4px 8px; cursor: pointer; }
.category-tabs__tab.is-active { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.category-tabs__tab:disabled { opacity: 0.4; cursor: not-allowed; }
.query-table { width: 100%; border-collapse: collapse; }
.query-table th, .query-table td { border-bottom: 1px solid #eee; padding: 8px; vertical-align: top; }
.tag-chip { display: inline-block; margin-right: 6px; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #f1f3f4; }
`;

export async function mountBrowsingUI(container: HTMLElement): Promise<void> {
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  container.innerHTML = "";
  container.appendChild(styleEl);

  let index: TransmissionsIndex;
  try {
    index = await loadIndex();
  } catch (error) {
    renderErrorBoundary(container, error, {
      title: "Unable to load transmission data",
      retry: () => {
        void mountBrowsingUI(container);
      },
    });
    return;
  }

  if (index.transmissions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "transmission-browser__empty";
    empty.textContent = "No transmission data found. Ensure /data/transmissions is present in the deployment.";
    container.appendChild(empty);
    return;
  }

  const moduleCache = new Map<string, Promise<TransmissionModule>>();

  const state: BrowsingState = {
    searchTerm: "",
    selectedTransmissionId: index.transmissions[0]?.transmission_id ?? null,
    selectedCategoryId: "news_political",
    queuedQueries: new Set<string>(),
  };

  const transmissionById = new Map(index.transmissions.map((entry) => [entry.transmission_id, entry]));
  let renderToken = 0;

  function getModule(entryFile: string): Promise<TransmissionModule> {
    if (!moduleCache.has(entryFile)) {
      moduleCache.set(entryFile, loadModule(entryFile));
    }

    return moduleCache.get(entryFile)!;
  }

  const app = document.createElement("div");
  app.className = "transmission-browser";

  const topBar = document.createElement("div");
  topBar.className = "transmission-browser__topbar";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search transmissions and queries...";
  searchInput.setAttribute("aria-label", "Search transmissions and queries");
  searchInput.addEventListener("input", () => {
    state.searchTerm = searchInput.value.trim().toLowerCase();
    void render();
  });
  topBar.appendChild(searchInput);

  const content = document.createElement("div");
  content.className = "transmission-browser__content";
  const sidebar = document.createElement("aside");
  sidebar.className = "transmission-browser__sidebar";
  const main = document.createElement("section");
  main.className = "transmission-browser__main";
  content.appendChild(sidebar);
  content.appendChild(main);

  app.appendChild(topBar);
  app.appendChild(content);

  container.appendChild(app);

  async function render(): Promise<void> {
    try {
      const currentToken = ++renderToken;
      const term = state.searchTerm;

      const filteredEntries = await filterTransmissions(term);
      if (currentToken !== renderToken) {
        return;
      }

      const selectedIsVisible = filteredEntries.some((entry) => entry.transmission_id === state.selectedTransmissionId);
      if (!selectedIsVisible) {
        state.selectedTransmissionId = filteredEntries[0]?.transmission_id ?? null;
      }

      renderTransmissionList(sidebar, {
        transmissions: filteredEntries,
        selectedId: state.selectedTransmissionId,
        onSelect: (transmissionId) => {
          state.selectedTransmissionId = transmissionId;
          void render();
        },
      });

      if (!state.selectedTransmissionId) {
        main.innerHTML = '<p class="transmission-browser__empty">No transmissions match your search.</p>';
        return;
      }

      const selectedEntry = transmissionById.get(state.selectedTransmissionId);
      if (!selectedEntry) {
        main.innerHTML = '<p class="transmission-browser__empty">Unable to load selected transmission.</p>';
        return;
      }

      const moduleData = await getModule(selectedEntry.file);
      if (currentToken !== renderToken) {
        return;
      }

      const categoriesPresent = new Set(moduleData.categories.map((category) => category.category_id));
      if (!categoriesPresent.has(state.selectedCategoryId)) {
        state.selectedCategoryId = getDefaultCategory(categoriesPresent);
      }

      main.innerHTML = "";

      const header = document.createElement("h2");
      header.textContent = `${moduleData.title} (${moduleData.transmission_id})`;
      main.appendChild(header);

      const tabsContainer = document.createElement("div");
      main.appendChild(tabsContainer);
      renderCategoryTabs(tabsContainer, {
        categoriesPresent,
        selectedCategory: state.selectedCategoryId,
        onSelect: (categoryId) => {
          state.selectedCategoryId = categoryId;
          void render();
        },
      });

      const selectedCategory = moduleData.categories.find(
        (category) => category.category_id === state.selectedCategoryId,
      );
      const filteredQueries = (selectedCategory?.queries ?? []).filter((query) =>
        term.length === 0 ? true : query.toLowerCase().includes(term),
      );

      const rows: QueryRow[] = filteredQueries.map((query) => ({
        transmissionId: moduleData.transmission_id,
        categoryId: state.selectedCategoryId,
        query,
        queued: state.queuedQueries.has(toQueueKey(moduleData.transmission_id, state.selectedCategoryId, query)),
      }));

      const rowsContainer = document.createElement("div");
      main.appendChild(rowsContainer);
      renderQueryTable(rowsContainer, {
        rows,
        onToggleQueue: (row, queued) => {
          const key = toQueueKey(row.transmissionId, row.categoryId, row.query);
          if (queued) {
            state.queuedQueries.add(key);
            return;
          }

          state.queuedQueries.delete(key);
        },
      });
    } catch (error) {
      renderErrorBoundary(main, error, {
        title: "Unable to render transmission",
        retry: () => {
          void render();
        },
      });
    }
  }

  async function filterTransmissions(term: string) {
    if (!term) {
      return index.transmissions;
    }

    const results = await Promise.all(
      index.transmissions.map(async (entry) => {
        const basicMatch = `${entry.title} ${entry.transmission_id}`.toLowerCase().includes(term);
        if (basicMatch) {
          return { entry, matches: true };
        }

        const moduleData = await getModule(entry.file);
        const queryMatch = moduleData.categories.some((category) =>
          category.queries.some((query) => query.toLowerCase().includes(term)),
        );

        return { entry, matches: queryMatch };
      }),
    );

    return results.filter((result) => result.matches).map((result) => result.entry);
  }

  await render();
}

function toQueueKey(transmissionId: string, categoryId: string, query: string): string {
  return `${transmissionId}::${categoryId}::${query}`;
}

export { mountBroadcastAssemblyUI } from "./broadcast-assembly";
