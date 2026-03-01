import { loadClipBoardManifest } from "../lib/clip-board";
import { loadIndex, loadModule } from "../lib/loaders";
import { clipsManifestSchema, type ClipManifestClip, type ClipsManifest, type TransmissionModule, type TransmissionsIndex } from "../lib/schema";
import { renderErrorBoundary } from "./error-boundary";

type TransmissionAssemblyState = {
  transmissionId: string;
  title: string;
  file: string;
  activeBeds: Set<string>;
  introStingerGroup: string;
  outroStingerGroup: string;
  shutdownEvent: boolean;
  youtubeClips: YoutubeClipBlock[];
};

type StandardBroadcastBlock = {
  type: "stinger" | "spokenword" | "samplebed";
  duration_sec: number;
  source: string;
};

type YoutubeClipBlock = {
  type: "youtube_clip";
  source: "youtube_clip";
  clip_id: string;
  video_url: string;
  start_sec: number;
  end_sec: number;
  notes: string;
  tags: string[];
};

type BroadcastBlock = StandardBroadcastBlock | YoutubeClipBlock;

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
.broadcast-assembly__header-actions { display: flex; gap: 8px; align-items: center; }
.broadcast-assembly__helper { color: #5f6368; font-size: 13px; }
.broadcast-assembly__workspace { display: grid; grid-template-columns: 360px 1fr; gap: 12px; min-height: 0; }
.broadcast-assembly__workspace.has-clips { grid-template-columns: 320px 1fr 360px; }
.broadcast-assembly__list, .broadcast-assembly__editor, .broadcast-assembly__clips { border: 1px solid #ddd; border-radius: 8px; padding: 12px; overflow: auto; }
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
.broadcast-assembly__clip-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.broadcast-assembly__clip-item { border: 1px solid #eee; border-radius: 8px; padding: 8px; display: grid; gap: 4px; }
.broadcast-assembly__button { border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 6px 10px; cursor: pointer; }
.broadcast-assembly__button--danger { border-color: #d93025; color: #d93025; }
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
    youtubeClips: [],
  }));

  let selectedId: string | null = sequence[0]?.transmissionId ?? null;
  let draggedId: string | null = null;
  let showClipsSidebar = false;
  let importedManifest: ClipsManifest | null = null;

  function getModule(file: string): Promise<TransmissionModule> {
    if (!moduleCache.has(file)) {
      moduleCache.set(file, loadModule(file));
    }

    return moduleCache.get(file)!;
  }

  function getAvailableClips(): ClipManifestClip[] {
    if (importedManifest) {
      return importedManifest.clips;
    }

    return loadClipBoardManifest().clips;
  }

  const root = document.createElement("div");
  root.className = "broadcast-assembly";

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;

  const header = document.createElement("div");
  header.className = "broadcast-assembly__header";
  const title = document.createElement("h2");
  title.textContent = "Broadcast Assembly";

  const actions = document.createElement("div");
  actions.className = "broadcast-assembly__header-actions";

  const showClipsLabel = document.createElement("label");
  const showClipsToggle = document.createElement("input");
  showClipsToggle.type = "checkbox";
  showClipsToggle.checked = showClipsSidebar;
  showClipsToggle.addEventListener("change", () => {
    showClipsSidebar = showClipsToggle.checked;
    void render();
  });
  showClipsLabel.appendChild(showClipsToggle);
  showClipsLabel.append(" Show Clips Available");

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "broadcast-assembly__button";
  exportButton.textContent = "Export broadcast_plan JSON";

  actions.appendChild(showClipsLabel);
  actions.appendChild(exportButton);

  header.appendChild(title);
  header.appendChild(actions);

  const helper = document.createElement("p");
  helper.className = "broadcast-assembly__helper";
  helper.textContent = "Annotation + assembly only. No downloading, extraction, or audio playback outside YouTube embed.";

  const workspace = document.createElement("div");
  workspace.className = "broadcast-assembly__workspace";

  const listPanel = document.createElement("section");
  listPanel.className = "broadcast-assembly__list";

  const editorPanel = document.createElement("section");
  editorPanel.className = "broadcast-assembly__editor";

  const clipsPanel = document.createElement("section");
  clipsPanel.className = "broadcast-assembly__clips";

  const output = document.createElement("textarea");
  output.className = "broadcast-assembly__json";
  output.readOnly = true;

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
      workspace.classList.toggle("has-clips", showClipsSidebar);
      workspace.innerHTML = "";
      workspace.appendChild(listPanel);
      workspace.appendChild(editorPanel);
      if (showClipsSidebar) {
        workspace.appendChild(clipsPanel);
      }

      renderSequenceList();
      await renderEditor();
      renderClipsPanel();
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
    heading.textContent = "Transmission Order (drag to reorder)";
    listPanel.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "broadcast-assembly__sequence";

    for (const item of sequence) {
      const li = document.createElement("li");
      li.className = "broadcast-assembly__sequence-item";
      li.draggable = true;

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

    const youtubeClipGroup = document.createElement("div");
    youtubeClipGroup.className = "broadcast-assembly__group";
    const youtubeClipHeading = document.createElement("h4");
    youtubeClipHeading.textContent = "YouTube clip blocks in this transmission";
    youtubeClipGroup.appendChild(youtubeClipHeading);

    if (selected.youtubeClips.length === 0) {
      const empty = document.createElement("p");
      empty.className = "broadcast-assembly__empty";
      empty.textContent = "No youtube_clip blocks added yet.";
      youtubeClipGroup.appendChild(empty);
    } else {
      const clipList = document.createElement("ul");
      clipList.className = "broadcast-assembly__clip-list";

      selected.youtubeClips.forEach((clip, index) => {
        const item = document.createElement("li");
        item.className = "broadcast-assembly__clip-item";
        item.innerHTML = `
          <strong>${clip.clip_id}</strong>
          <span class="broadcast-assembly__meta">${clip.start_sec}s → ${clip.end_sec}s</span>
          <span class="broadcast-assembly__meta">${clip.tags.join(", ")}</span>
          <a href="${clip.video_url}" target="_blank" rel="noopener noreferrer">${clip.video_url}</a>
        `;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "broadcast-assembly__button broadcast-assembly__button--danger";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => {
          selected.youtubeClips.splice(index, 1);
          void render();
        });

        item.appendChild(removeButton);
        clipList.appendChild(item);
      });

      youtubeClipGroup.appendChild(clipList);
    }

    editorPanel.appendChild(youtubeClipGroup);

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

  function renderClipsPanel(): void {
    clipsPanel.innerHTML = "";

    if (!showClipsSidebar) {
      return;
    }

    const heading = document.createElement("h3");
    heading.textContent = "Clips Available";
    clipsPanel.appendChild(heading);

    const source = document.createElement("p");
    source.className = "broadcast-assembly__meta";
    source.textContent = importedManifest
      ? `Source: imported clips.manifest.json (${importedManifest.clips.length} clips)`
      : "Source: current Clip Board (local)";
    clipsPanel.appendChild(source);

    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      if (!file) {
        return;
      }

      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        const result = clipsManifestSchema.safeParse(parsed);
        if (!result.success) {
          const issue = result.error.issues[0];
          throw new Error(`${issue.path.join(".") || "root"}: ${issue.message}`);
        }

        importedManifest = result.data;
        void render();
      } catch (error) {
        alert(`Invalid clips manifest: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    clipsPanel.appendChild(importInput);

    const useBoardButton = document.createElement("button");
    useBoardButton.type = "button";
    useBoardButton.className = "broadcast-assembly__button";
    useBoardButton.textContent = "Use current Clip Board";
    useBoardButton.addEventListener("click", () => {
      importedManifest = null;
      void render();
    });
    clipsPanel.appendChild(useBoardButton);

    const available = getAvailableClips();
    if (available.length === 0) {
      const empty = document.createElement("p");
      empty.className = "broadcast-assembly__empty";
      empty.textContent = "No clips available.";
      clipsPanel.appendChild(empty);
      return;
    }

    const selected = sequence.find((item) => item.transmissionId === selectedId) ?? null;

    const list = document.createElement("ul");
    list.className = "broadcast-assembly__clip-list";

    for (const clip of available) {
      const item = document.createElement("li");
      item.className = "broadcast-assembly__clip-item";
      item.innerHTML = `
        <strong>${clip.clip_id}</strong>
        <span class="broadcast-assembly__meta">${clip.title}</span>
        <span class="broadcast-assembly__meta">${clip.start_sec}s → ${clip.end_sec}s</span>
      `;

      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "broadcast-assembly__button";
      addButton.textContent = "Add to selected transmission";
      addButton.disabled = !selected;
      addButton.addEventListener("click", () => {
        if (!selected) {
          return;
        }

        selected.youtubeClips.push({
          type: "youtube_clip",
          source: "youtube_clip",
          clip_id: clip.clip_id,
          video_url: clip.video_url,
          start_sec: clip.start_sec,
          end_sec: clip.end_sec,
          notes: clip.notes,
          tags: clip.tags,
        });

        void render();
      });

      item.appendChild(addButton);
      list.appendChild(item);
    }

    clipsPanel.appendChild(list);
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

      blocks.push(...item.youtubeClips);

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
