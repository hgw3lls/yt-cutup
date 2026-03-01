export type ClipRange = {
  clipId: string;
  startSec: number;
  endSec: number;
  notes: string;
  tags: string;
};

type RangeEditorSettings = {
  maxClipSeconds: number;
};

type RangeEditorStoredState = {
  ranges: ClipRange[];
  selectedRangeIndex: number | null;
};

export type RangeEditorApi = {
  destroy: () => void;
  getRanges: () => ClipRange[];
  addRange: () => void;
  setSelectedStartFromCurrentTime: () => void;
  setSelectedEndFromCurrentTime: () => void;
  ensureSelectedRange: () => void;
};

type RangeEditorOptions = {
  videoId: string;
  videoDurationSec: number;
  getCurrentTime: () => number;
  defaultTags?: string[];
};

const DEFAULT_MAX_CLIP_SECONDS = 600;
const SETTINGS_KEY = "yt-cutup:range-editor:settings";

const styles = `
.range-editor { display: grid; gap: 10px; }
.range-editor__settings { display: grid; gap: 6px; border: 1px solid #eee; border-radius: 8px; padding: 10px; }
.range-editor__settings-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.range-editor__settings input { width: 100px; padding: 6px; }
.range-editor__add { justify-self: start; border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 6px 10px; cursor: pointer; }
.range-editor__table-wrap { overflow: auto; border: 1px solid #eee; border-radius: 8px; }
.range-editor__table { width: 100%; border-collapse: collapse; min-width: 760px; }
.range-editor__table th, .range-editor__table td { border-bottom: 1px solid #f1f3f4; padding: 8px; vertical-align: top; }
.range-editor__table tr.is-selected { background: #e8f0fe; }
.range-editor__table input { width: 100%; box-sizing: border-box; padding: 6px; border: 1px solid #dadce0; border-radius: 6px; }
.range-editor__table .range-editor__num { max-width: 100px; }
.range-editor__row-actions { display: grid; gap: 6px; }
.range-editor__btn { border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 5px 9px; cursor: pointer; font-size: 12px; }
.range-editor__btn--danger { border-color: #d93025; color: #d93025; }
.range-editor__validation { margin: 0; font-size: 12px; }
.range-editor__validation--ok { color: #188038; }
.range-editor__validation--error { color: #d93025; }
.range-editor__hint { margin: 0; color: #5f6368; font-size: 12px; }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clampRangeValue(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function getStateStorageKey(videoId: string): string {
  return `yt-cutup:range-editor:video:${videoId}`;
}

function loadSettings(): RangeEditorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { maxClipSeconds: DEFAULT_MAX_CLIP_SECONDS };
    }

    const parsed = JSON.parse(raw) as Partial<RangeEditorSettings>;
    if (typeof parsed.maxClipSeconds === "number" && parsed.maxClipSeconds > 0) {
      return { maxClipSeconds: Math.floor(parsed.maxClipSeconds) };
    }
  } catch {
    // ignore localStorage parse errors
  }

  return { maxClipSeconds: DEFAULT_MAX_CLIP_SECONDS };
}

function saveSettings(settings: RangeEditorSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadState(videoId: string): RangeEditorStoredState {
  try {
    const raw = localStorage.getItem(getStateStorageKey(videoId));
    if (!raw) {
      return { ranges: [], selectedRangeIndex: null };
    }
    const parsed = JSON.parse(raw) as Partial<RangeEditorStoredState>;
    const ranges = Array.isArray(parsed.ranges)
      ? parsed.ranges
          .map((range, index) => {
            const clipId = typeof range.clipId === "string" && range.clipId.trim() !== "" ? range.clipId : `clip-${index + 1}`;
            const startSec = typeof range.startSec === "number" ? range.startSec : 0;
            const endSec = typeof range.endSec === "number" ? range.endSec : 1;
            return {
              clipId,
              startSec,
              endSec,
              notes: typeof range.notes === "string" ? range.notes : "",
              tags: typeof range.tags === "string" ? range.tags : "",
            };
          })
          .filter((range) => Number.isFinite(range.startSec) && Number.isFinite(range.endSec))
      : [];

    const selectedRangeIndex =
      typeof parsed.selectedRangeIndex === "number" && parsed.selectedRangeIndex >= 0
        ? parsed.selectedRangeIndex
        : null;

    return { ranges, selectedRangeIndex };
  } catch {
    return { ranges: [], selectedRangeIndex: null };
  }
}

function saveState(videoId: string, state: RangeEditorStoredState): void {
  localStorage.setItem(getStateStorageKey(videoId), JSON.stringify(state));
}

function getRangeValidation(range: ClipRange, maxClipSeconds: number, videoDurationSec: number): string | null {
  if (range.startSec < 0 || range.endSec < 0) {
    return "Start/end must be non-negative.";
  }

  if (range.startSec > videoDurationSec || range.endSec > videoDurationSec) {
    return `Start/end must be within 0..${videoDurationSec}.`;
  }

  if (range.endSec <= range.startSec) {
    return "End must be greater than start.";
  }

  if (range.endSec - range.startSec > maxClipSeconds) {
    return `Duration exceeds max clip seconds (${maxClipSeconds}).`;
  }

  return null;
}

function normalizeTagString(tags: string[]): string {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .join(",");
}

export function mountRangeEditor(container: HTMLElement, options: RangeEditorOptions): RangeEditorApi {
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  container.appendChild(styleEl);

  const shell = document.createElement("div");
  shell.className = "range-editor";
  container.appendChild(shell);

  const settings = loadSettings();
  const initial = loadState(options.videoId);
  let ranges = initial.ranges;
  let selectedRangeIndex: number | null = initial.selectedRangeIndex;
  const defaultTags = normalizeTagString(options.defaultTags ?? []);

  function persistAndRender(): void {
    saveState(options.videoId, { ranges, selectedRangeIndex });
    saveSettings(settings);
    render();
  }

  function addRange(): void {
    if (options.videoDurationSec < 1) {
      return;
    }

    const index = ranges.length + 1;
    const startSec = clampRangeValue(Math.floor(options.getCurrentTime()), 0, Math.max(0, options.videoDurationSec - 1));
    const endSec = clampRangeValue(startSec + 15, startSec + 1, options.videoDurationSec);
    ranges = [...ranges, { clipId: `clip-${index}`, startSec, endSec, notes: "", tags: defaultTags }];
    selectedRangeIndex = ranges.length - 1;
    persistAndRender();
  }

  function ensureSelectedRange(): void {
    if (selectedRangeIndex === null || !ranges[selectedRangeIndex]) {
      addRange();
    }
  }

  function updateRange(index: number, patch: Partial<ClipRange>): void {
    ranges = ranges.map((range, rangeIndex) => (rangeIndex === index ? { ...range, ...patch } : range));
    selectedRangeIndex = index;
    persistAndRender();
  }

  function deleteRange(index: number): void {
    ranges = ranges.filter((_, rangeIndex) => rangeIndex !== index);
    if (selectedRangeIndex !== null) {
      if (selectedRangeIndex === index) {
        selectedRangeIndex = ranges.length > 0 ? Math.min(index, ranges.length - 1) : null;
      } else if (selectedRangeIndex > index) {
        selectedRangeIndex -= 1;
      }
    }
    persistAndRender();
  }

  function setSelectedStartFromCurrentTime(): void {
    ensureSelectedRange();
    if (selectedRangeIndex === null || !ranges[selectedRangeIndex]) {
      return;
    }
    const current = clampRangeValue(Math.floor(options.getCurrentTime()), 0, options.videoDurationSec);
    updateRange(selectedRangeIndex, { startSec: current });
  }

  function setSelectedEndFromCurrentTime(): void {
    ensureSelectedRange();
    if (selectedRangeIndex === null || !ranges[selectedRangeIndex]) {
      return;
    }
    const current = clampRangeValue(Math.floor(options.getCurrentTime()), 0, options.videoDurationSec);
    updateRange(selectedRangeIndex, { endSec: current });
  }

  function render(): void {
    const rows = ranges
      .map((range, index) => {
        const duration = Math.max(0, range.endSec - range.startSec);
        const validationError = getRangeValidation(range, settings.maxClipSeconds, options.videoDurationSec);

        return `
          <tr data-range-index="${index}" class="${selectedRangeIndex === index ? "is-selected" : ""}">
            <td><input data-field="clipId" value="${escapeHtml(range.clipId)}" /></td>
            <td><input class="range-editor__num" type="number" min="0" max="${options.videoDurationSec}" step="1" data-field="startSec" value="${range.startSec}" /></td>
            <td><input class="range-editor__num" type="number" min="0" max="${options.videoDurationSec}" step="1" data-field="endSec" value="${range.endSec}" /></td>
            <td>${duration}s</td>
            <td><input data-field="notes" value="${escapeHtml(range.notes)}" placeholder="notes" /></td>
            <td><input data-field="tags" value="${escapeHtml(range.tags)}" placeholder="comma,separated" /></td>
            <td>
              <div class="range-editor__row-actions">
                <button type="button" class="range-editor__btn" data-action="set-start">Set Start = current time</button>
                <button type="button" class="range-editor__btn" data-action="set-end">Set End = current time</button>
                <button type="button" class="range-editor__btn range-editor__btn--danger" data-action="delete">Delete Range</button>
              </div>
            </td>
            <td>
              <p class="range-editor__validation ${validationError ? "range-editor__validation--error" : "range-editor__validation--ok"}">
                ${escapeHtml(validationError ?? "Valid")}
              </p>
            </td>
          </tr>
        `;
      })
      .join("");

    shell.innerHTML = `
      <section class="range-editor__settings">
        <strong>Range Settings</strong>
        <div class="range-editor__settings-row">
          <label for="range-editor-max-seconds-${options.videoId}">Max clip seconds</label>
          <input id="range-editor-max-seconds-${options.videoId}" type="number" min="1" step="1" value="${settings.maxClipSeconds}" />
          <small>Default is ${DEFAULT_MAX_CLIP_SECONDS}. Override is persisted in localStorage.</small>
        </div>
        <small>Allowed range is 0..${options.videoDurationSec} seconds and end must be greater than start.</small>
        <p class="range-editor__hint">Tip: click a row to target hotkeys (I/O) from the player.</p>
        ${options.videoDurationSec < 1 ? "<small>This video reports duration 0s, so ranges cannot be added yet.</small>" : ""}
      </section>
      <button type="button" class="range-editor__add" ${options.videoDurationSec < 1 ? "disabled" : ""}>Add Range</button>
      <div class="range-editor__table-wrap">
        <table class="range-editor__table">
          <thead>
            <tr>
              <th>clip_id</th>
              <th>start_sec</th>
              <th>end_sec</th>
              <th>duration</th>
              <th>notes</th>
              <th>tags</th>
              <th>actions</th>
              <th>validation</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="8">No ranges yet. Click Add Range.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    shell.querySelector<HTMLButtonElement>(".range-editor__add")?.addEventListener("click", addRange);

    const maxInput = shell.querySelector<HTMLInputElement>(`#range-editor-max-seconds-${options.videoId}`);
    maxInput?.addEventListener("change", () => {
      const nextValue = Number(maxInput.value);
      settings.maxClipSeconds = Number.isFinite(nextValue) && nextValue > 0 ? Math.floor(nextValue) : DEFAULT_MAX_CLIP_SECONDS;
      persistAndRender();
    });

    shell.querySelectorAll<HTMLTableRowElement>("tbody tr[data-range-index]").forEach((row) => {
      const index = Number(row.dataset.rangeIndex);
      if (!Number.isInteger(index)) {
        return;
      }

      row.addEventListener("click", () => {
        selectedRangeIndex = index;
        persistAndRender();
      });

      row.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((input) => {
        input.addEventListener("change", () => {
          const field = input.dataset.field as keyof ClipRange;
          if (field === "startSec" || field === "endSec") {
            const next = clampRangeValue(Number(input.value), 0, options.videoDurationSec);
            updateRange(index, { [field]: Math.floor(next) } as Partial<ClipRange>);
            return;
          }

          updateRange(index, { [field]: input.value } as Partial<ClipRange>);
        });
      });

      row.querySelector<HTMLButtonElement>('button[data-action="set-start"]')?.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedRangeIndex = index;
        setSelectedStartFromCurrentTime();
      });

      row.querySelector<HTMLButtonElement>('button[data-action="set-end"]')?.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedRangeIndex = index;
        setSelectedEndFromCurrentTime();
      });

      row.querySelector<HTMLButtonElement>('button[data-action="delete"]')?.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteRange(index);
      });
    });
  }

  render();

  return {
    destroy: () => {
      shell.remove();
      styleEl.remove();
    },
    getRanges: () => [...ranges],
    addRange,
    setSelectedStartFromCurrentTime,
    setSelectedEndFromCurrentTime,
    ensureSelectedRange,
  };
}
