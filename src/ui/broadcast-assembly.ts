import { loadIndex, loadModule } from "../lib/loaders";
import type { TransmissionModule, TransmissionsIndex } from "../lib/schema";
import { renderErrorBoundary } from "./error-boundary";

type TransmissionAssemblyState = {
  transmissionId: string;
  title: string;
  file: string;
  activeBeds: Set<string>;
  introStingerGroup: string;
  outroStingerGroup: string;
  shutdownEvent: boolean;
};

type BroadcastBlock = {
  type: "stinger" | "spokenword" | "samplebed";
  duration_sec: number;
  source: string;
};

type BroadcastPlanSequenceItem = {
  transmission_id: string;
  title: string;
  active_beds: string[];
  shutdown_event: boolean;
  blocks: BroadcastBlock[];
};

type BroadcastPlan = {
  created_at: string;
  runtime_target_minutes: 45;
  sequence: BroadcastPlanSequenceItem[];
};

const styles = `
.broadcast-assembly { display: grid; grid-template-rows: auto auto 1fr; gap: 12px; font-family: system-ui, sans-serif; }
.broadcast-assembly__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.broadcast-assembly__helper { color: #5f6368; font-size: 13px; }
.broadcast-assembly__workspace { display: grid; grid-template-columns: 360px 1fr; gap: 12px; min-height: 0; }
.broadcast-assembly__list, .broadcast-assembly__editor { border: 1px solid #ddd; border-radius: 8px; padding: 12px; overflow: auto; }
.broadcast-assembly__sequence { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.broadcast-assembly__sequence-item { border: 1px solid #dadce0; border-radius: 8px; padding: 8px; background: #fff; cursor: grab; }
.broadcast-assembly__sequence-item.is-selected { border-color: #1a73e8; background: #e8f0fe; }
.broadcast-assembly__sequence-item.is-dragging { opacity: 0.5; }
.broadcast-assembly__title { font-weight: 600; }
.broadcast-assembly__meta { font-size: 12px; color: #5f6368; }
.broadcast-assembly__group { margin-bottom: 12px; }
.broadcast-assembly__group label { display: block; margin-bottom: 6px; }
.broadcast-assembly__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.broadcast-assembly__chip { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f1f3f4; font-size: 12px; }
.broadcast-assembly__json { width: 100%; min-height: 240px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.broadcast-assembly__empty { color: #5f6368; }
`;

export async function mountBroadcastAssemblyUI(container: HTMLElement): Promise<void> {
  let index: TransmissionsIndex;

  try {
    index = await loadIndex();
  } catch (error) {
    renderErrorBoundary(container, error, {
      title: "Unable to load broadcast assembly data",
      retry: () => {
        void mountBroadcastAssemblyUI(container);
      },
    });
    return;
  }

  if (index.transmissions.length === 0) {
    container.innerHTML = "<p class=\"broadcast-assembly__empty\">No transmissions found. Ensure /data/transmissions is deployed.</p>";
    return;
  }

  const moduleCache = new Map<string, Promise<TransmissionModule>>();

  const sequence: TransmissionAssemblyState[] = index.transmissions.map((entry) => ({
    transmissionId: entry.transmission_id,
    title: entry.title,
    file: entry.file,
    activeBeds: new Set<string>(),
    introStingerGroup: "",
    outroStingerGroup: "",
    shutdownEvent: false,
  }));

  let selectedId: string | null = sequence[0]?.transmissionId ?? null;
  let draggedId: string | null = null;

  function getModule(file: string): Promise<TransmissionModule> {
    if (!moduleCache.has(file)) {
      moduleCache.set(file, loadModule(file));
    }

    return moduleCache.get(file)!;
  }

  const root = document.createElement("div");
  root.className = "broadcast-assembly";

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;

  const header = document.createElement("div");
  header.className = "broadcast-assembly__header";
  const title = document.createElement("h2");
  title.textContent = "Broadcast Assembly";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export broadcast_plan JSON";
  header.appendChild(title);
  header.appendChild(exportButton);

  const helper = document.createElement("p");
  helper.className = "broadcast-assembly__helper";
  helper.textContent = "Structures playback and sampling plans only. This tool does not generate or rewrite lyrics.";

  const workspace = document.createElement("div");
  workspace.className = "broadcast-assembly__workspace";

  const listPanel = document.createElement("section");
  listPanel.className = "broadcast-assembly__list";

  const editorPanel = document.createElement("section");
  editorPanel.className = "broadcast-assembly__editor";

  const output = document.createElement("textarea");
  output.className = "broadcast-assembly__json";
  output.readOnly = true;

  workspace.appendChild(listPanel);
  workspace.appendChild(editorPanel);

  root.appendChild(header);
  root.appendChild(helper);
  root.appendChild(workspace);
  root.appendChild(output);

  container.innerHTML = "";
  container.appendChild(styleEl);
  container.appendChild(root);

  exportButton.addEventListener("click", () => {
    const plan = buildBroadcastPlan(sequence);
    output.value = JSON.stringify(plan, null, 2);
  });

  async function render(): Promise<void> {
    try {
      renderSequenceList();
      await renderEditor();
    } catch (error) {
      renderErrorBoundary(editorPanel, error, {
        title: "Unable to render broadcast settings",
        retry: () => {
          void render();
        },
      });
    }
  }

  function renderSequenceList(): void {
    listPanel.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = "Transmission Order (drag + drop)";
    listPanel.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "broadcast-assembly__sequence";

    for (const item of sequence) {
      const li = document.createElement("li");
      li.className = "broadcast-assembly__sequence-item";
      li.draggable = true;
      li.dataset.transmissionId = item.transmissionId;

      if (item.transmissionId === selectedId) {
        li.classList.add("is-selected");
      }

      li.addEventListener("click", () => {
        selectedId = item.transmissionId;
        void render();
      });

      li.addEventListener("dragstart", () => {
        draggedId = item.transmissionId;
        li.classList.add("is-dragging");
      });

      li.addEventListener("dragend", () => {
        draggedId = null;
        li.classList.remove("is-dragging");
      });

      li.addEventListener("dragover", (event) => {
        event.preventDefault();
      });

      li.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!draggedId || draggedId === item.transmissionId) {
          return;
        }

        reorderSequence(draggedId, item.transmissionId);
        void render();
      });

      const titleText = document.createElement("div");
      titleText.className = "broadcast-assembly__title";
      titleText.textContent = `${item.title} (${item.transmissionId})`;

      const meta = document.createElement("div");
      meta.className = "broadcast-assembly__meta";
      meta.textContent = item.shutdownEvent ? "Shutdown marker enabled" : "No shutdown marker";

      li.appendChild(titleText);
      li.appendChild(meta);
      list.appendChild(li);
    }

    listPanel.appendChild(list);
  }

  async function renderEditor(): Promise<void> {
    editorPanel.innerHTML = "";

    const selected = sequence.find((item) => item.transmissionId === selectedId);
    if (!selected) {
      editorPanel.innerHTML = '<p class="broadcast-assembly__empty">Select a transmission to configure blocks.</p>';
      return;
    }

    const moduleData = await getModule(selected.file);

    const heading = document.createElement("h3");
    heading.textContent = `${selected.title} (${selected.transmissionId})`;
    editorPanel.appendChild(heading);

    editorPanel.appendChild(renderStingerGroupControl("Intro stinger query group", selected.introStingerGroup, (value) => {
      selected.introStingerGroup = value;
    }));

    editorPanel.appendChild(renderStingerGroupControl("Outro stinger query group", selected.outroStingerGroup, (value) => {
      selected.outroStingerGroup = value;
    }));

    const bedsGroup = document.createElement("div");
    bedsGroup.className = "broadcast-assembly__group";
    const bedsHeading = document.createElement("h4");
    bedsHeading.textContent = "Active bed categories";
    bedsGroup.appendChild(bedsHeading);

    for (const category of moduleData.categories) {
      const row = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.activeBeds.has(category.category_id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.activeBeds.add(category.category_id);
        } else {
          selected.activeBeds.delete(category.category_id);
        }
      });

      row.appendChild(checkbox);
      row.append(` ${category.category_id}`);
      bedsGroup.appendChild(row);
    }

    editorPanel.appendChild(bedsGroup);

    const shutdownGroup = document.createElement("div");
    shutdownGroup.className = "broadcast-assembly__group";
    const shutdownLabel = document.createElement("label");
    const shutdownCheckbox = document.createElement("input");
    shutdownCheckbox.type = "checkbox";
    shutdownCheckbox.checked = selected.shutdownEvent;
    shutdownCheckbox.addEventListener("change", () => {
      selected.shutdownEvent = shutdownCheckbox.checked;
      void render();
    });
    shutdownLabel.appendChild(shutdownCheckbox);
    shutdownLabel.append(" Mark shutdown event after this transmission");
    shutdownGroup.appendChild(shutdownLabel);
    editorPanel.appendChild(shutdownGroup);

    const summaryGroup = document.createElement("div");
    summaryGroup.className = "broadcast-assembly__group";
    const summaryHeading = document.createElement("h4");
    summaryHeading.textContent = "Current selected active beds";
    summaryGroup.appendChild(summaryHeading);

    const chips = document.createElement("div");
    chips.className = "broadcast-assembly__chips";
    const activeBeds = [...selected.activeBeds];
    if (activeBeds.length === 0) {
      const empty = document.createElement("span");
      empty.className = "broadcast-assembly__empty";
      empty.textContent = "No active beds selected.";
      chips.appendChild(empty);
    } else {
      for (const bed of activeBeds) {
        const chip = document.createElement("span");
        chip.className = "broadcast-assembly__chip";
        chip.textContent = bed;
        chips.appendChild(chip);
      }
    }

    summaryGroup.appendChild(chips);
    editorPanel.appendChild(summaryGroup);
  }

  function reorderSequence(sourceId: string, targetId: string): void {
    const sourceIndex = sequence.findIndex((item) => item.transmissionId === sourceId);
    const targetIndex = sequence.findIndex((item) => item.transmissionId === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const [moved] = sequence.splice(sourceIndex, 1);
    sequence.splice(targetIndex, 0, moved);
  }

  await render();
}

function renderStingerGroupControl(
  labelText: string,
  value: string,
  onUpdate: (value: string) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "broadcast-assembly__group";

  const label = document.createElement("label");
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Optional query group label";
  input.value = value;
  input.addEventListener("input", () => onUpdate(input.value.trim()));

  group.appendChild(label);
  group.appendChild(input);
  return group;
}

function buildBroadcastPlan(sequence: TransmissionAssemblyState[]): BroadcastPlan {
  return {
    created_at: new Date().toISOString(),
    runtime_target_minutes: 45,
    sequence: sequence.map((item) => {
      const blocks: BroadcastBlock[] = [];

      if (item.introStingerGroup) {
        blocks.push({
          type: "stinger",
          duration_sec: 15,
          source: `query:${item.introStingerGroup}`,
        });
      }

      blocks.push({
        type: "spokenword",
        duration_sec: 180,
        source: "lyrics_reference_only",
      });

      if (item.activeBeds.size > 0) {
        blocks.push({
          type: "samplebed",
          duration_sec: 90,
          source: "clips",
        });
      }

      if (item.outroStingerGroup) {
        blocks.push({
          type: "stinger",
          duration_sec: 15,
          source: `query:${item.outroStingerGroup}`,
        });
      }

      return {
        transmission_id: item.transmissionId,
        title: item.title,
        active_beds: [...item.activeBeds],
        shutdown_event: item.shutdownEvent,
        blocks,
      };
    }),
  };
}
