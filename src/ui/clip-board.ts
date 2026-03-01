import {
  clearClipBoard,
  clipsManifestToCsv,
  copyToClipboard,
  downloadTextFile,
  loadClipBoardManifest,
  replaceClipBoardManifest,
  saveClipBoardManifest,
} from "../lib/clip-board";
import { clipsManifestSchema } from "../lib/schema";

const styles = `
.clip-board { display: grid; grid-template-rows: auto auto auto 1fr; gap: 12px; height: 100%; }
.clip-board__toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.clip-board__bulk { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border: 1px solid #eee; border-radius: 8px; padding: 10px; }
.clip-board__bulk input { min-width: 220px; padding: 7px 9px; border: 1px solid #dadce0; border-radius: 6px; }
.clip-board__toolbar input { flex: 1; min-width: 260px; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 8px; }
.clip-board__btn { border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 7px 12px; cursor: pointer; }
.clip-board__btn--danger { border-color: #d93025; color: #d93025; }
.clip-board__status { margin: 0; color: #5f6368; font-size: 13px; }
.clip-board__table-wrap { border: 1px solid #eee; border-radius: 8px; overflow: auto; }
.clip-board__table { width: 100%; border-collapse: collapse; min-width: 1120px; }
.clip-board__table th, .clip-board__table td { border-bottom: 1px solid #f1f3f4; padding: 8px; text-align: left; vertical-align: top; }
.clip-board__table a { color: #1a73e8; text-decoration: none; }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeTags(raw: string): string[] {
  return [...new Set(raw.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

export async function mountClipBoardUI(container: HTMLElement): Promise<void> {
  container.innerHTML = "";

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  container.appendChild(styleEl);

  const shell = document.createElement("section");
  shell.className = "clip-board";
  shell.innerHTML = `
    <h2>Clip Board</h2>
    <div class="clip-board__toolbar">
      <input type="search" name="filter" placeholder="Filter by tag, title, or channel..." />
      <button type="button" class="clip-board__btn" data-action="export-json">Download clips.manifest.json</button>
      <button type="button" class="clip-board__btn" data-action="export-csv">Download CSV</button>
      <input type="file" data-action="import" accept="application/json,.json" />
      <button type="button" class="clip-board__btn clip-board__btn--danger" data-action="clear">Clear</button>
    </div>
    <div class="clip-board__bulk">
      <strong>Bulk tag edit</strong>
      <input type="text" data-role="bulk-tag" placeholder="tag1,tag2" />
      <button type="button" class="clip-board__btn" data-action="append-bulk-tags">Append tags to filtered clips</button>
      <button type="button" class="clip-board__btn" data-action="replace-bulk-tags">Replace tags on filtered clips</button>
    </div>
    <p class="clip-board__status"></p>
    <div class="clip-board__table-wrap">
      <table class="clip-board__table">
        <thead>
          <tr>
            <th>clip_id</th><th>title</th><th>channel</th><th>playlist</th><th>range</th><th>duration</th><th>notes</th><th>tags</th><th>link</th><th>share</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;

  container.appendChild(shell);

  const filterInput = shell.querySelector<HTMLInputElement>('input[name="filter"]');
  const importInput = shell.querySelector<HTMLInputElement>('input[data-action="import"]');
  const bulkInput = shell.querySelector<HTMLInputElement>('input[data-role="bulk-tag"]');
  const status = shell.querySelector<HTMLElement>(".clip-board__status");
  const tbody = shell.querySelector<HTMLTableSectionElement>("tbody");

  if (!filterInput || !importInput || !bulkInput || !status || !tbody) {
    return;
  }

  function filteredClips() {
    const manifest = loadClipBoardManifest();
    const query = filterInput.value.trim().toLowerCase();
    const filtered = manifest.clips.filter((clip) => {
      if (!query) return true;
      return (
        clip.title.toLowerCase().includes(query) ||
        clip.channel.toLowerCase().includes(query) ||
        (clip.playlist_title ?? "").toLowerCase().includes(query) ||
        clip.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
    return { manifest, filtered };
  }

  function render(): void {
    const { manifest, filtered } = filteredClips();
    status.textContent = `${filtered.length} clip(s) shown • ${manifest.clips.length} total`;

    tbody.innerHTML =
      filtered.length === 0
        ? '<tr><td colspan="10">No clips in board.</td></tr>'
        : filtered
            .map(
              (clip, index) => `
      <tr>
        <td>${escapeHtml(clip.clip_id)}</td>
        <td>${escapeHtml(clip.title)}</td>
        <td>${escapeHtml(clip.channel)}</td>
        <td>${escapeHtml(clip.playlist_title ?? "")}</td>
        <td>${clip.start_sec} → ${clip.end_sec}</td>
        <td>${clip.duration_sec}s</td>
        <td>${escapeHtml(clip.notes)}</td>
        <td>${escapeHtml(clip.tags.join(", "))}</td>
        <td><a href="${escapeHtml(clip.share_url)}" target="_blank" rel="noopener noreferrer">Open</a></td>
        <td><button type="button" class="clip-board__btn" data-action="copy" data-index="${index}">Copy share link</button></td>
      </tr>`,
            )
            .join("");

    tbody.querySelectorAll<HTMLButtonElement>('button[data-action="copy"]').forEach((button) => {
      button.addEventListener("click", async () => {
        const i = Number(button.dataset.index);
        const clip = filtered[i];
        if (!clip) return;

        const copied = await copyToClipboard(`${clip.share_url} (end_sec=${clip.end_sec})`);
        status.textContent = copied
          ? `Copied share link for ${clip.clip_id} (includes end_sec note).`
          : "Unable to copy automatically; your browser blocked clipboard access.";
      });
    });
  }

  function applyBulkTags(replace: boolean): void {
    const tags = normalizeTags(bulkInput.value);
    const { manifest, filtered } = filteredClips();
    const filteredIds = new Set(filtered.map((clip) => clip.clip_id));

    manifest.clips = manifest.clips.map((clip) => {
      if (!filteredIds.has(clip.clip_id)) return clip;
      const nextTags = replace ? tags : [...new Set([...clip.tags, ...tags])];
      return { ...clip, tags: nextTags };
    });

    manifest.created_at = new Date().toISOString();
    saveClipBoardManifest(manifest);
    render();
  }

  filterInput.addEventListener("input", render);

  shell.querySelector<HTMLButtonElement>('button[data-action="append-bulk-tags"]')?.addEventListener("click", () => {
    applyBulkTags(false);
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="replace-bulk-tags"]')?.addEventListener("click", () => {
    applyBulkTags(true);
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validated = clipsManifestSchema.safeParse(parsed);
      if (!validated.success) {
        const issue = validated.error.issues[0];
        throw new Error(`${issue.path.join(".") || "root"}: ${issue.message}`);
      }

      replaceClipBoardManifest(validated.data);
      status.textContent = `Imported ${validated.data.clips.length} clips from manifest.`;
      render();
    } catch (error) {
      status.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      importInput.value = "";
    }
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="export-json"]')?.addEventListener("click", () => {
    const manifest = loadClipBoardManifest();
    downloadTextFile("clips.manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, "application/json");
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="export-csv"]')?.addEventListener("click", () => {
    const manifest = loadClipBoardManifest();
    downloadTextFile("clips.manifest.csv", `${clipsManifestToCsv(manifest)}\n`, "text/csv");
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="clear"]')?.addEventListener("click", () => {
    clearClipBoard();
    render();
  });

  render();
}
