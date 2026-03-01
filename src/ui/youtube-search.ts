import { getYoutubeVideo, searchYoutube, type YoutubeVideo } from "../lib/api";
import { addClipsToClipBoard } from "../lib/clip-board";
import { loadLastYoutubeSearchResults, saveLastYoutubeSearchResults } from "../lib/youtube-search-cache";
import { renderErrorBoundary } from "./error-boundary";
import { mountYoutubeVideoDetail } from "./youtube-video-detail";

const styles = `
.youtube-search { display: grid; grid-template-columns: 1fr 460px; gap: 12px; height: 100%; }
.youtube-search__panel { border: 1px solid #ddd; border-radius: 8px; padding: 12px; overflow: auto; }
.youtube-search__form { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-bottom: 12px; }
.youtube-search__form input { width: 100%; padding: 8px 10px; font-size: 14px; }
.youtube-search__form button { border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 8px 12px; cursor: pointer; }
.youtube-search__results { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.youtube-search__item { border: 1px solid #eee; border-radius: 8px; padding: 10px; display: grid; grid-template-columns: 120px 1fr auto; gap: 10px; align-items: start; }
.youtube-search__thumb { width: 120px; border-radius: 6px; object-fit: cover; }
.youtube-search__title { margin: 0 0 6px; font-size: 14px; }
.youtube-search__meta { margin: 0; color: #5f6368; font-size: 12px; }
.youtube-search__open { border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 6px 10px; cursor: pointer; }
.youtube-search__next { margin-top: 12px; border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 8px 12px; cursor: pointer; }
.youtube-search__status { color: #5f6368; margin: 8px 0 0; font-size: 13px; }
`;

function formatDuration(durationSec: number): string {
  const hours = Math.floor(durationSec / 3600);
  const minutes = Math.floor((durationSec % 3600) / 60);
  const seconds = durationSec % 60;

  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function mountYoutubeSearchUI(container: HTMLElement): Promise<void> {
  container.innerHTML = "";
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  container.appendChild(styleEl);

  const shell = document.createElement("section");
  shell.className = "youtube-search";
  shell.innerHTML = `
    <div class="youtube-search__panel">
      <form class="youtube-search__form">
        <input type="search" name="q" placeholder="Search YouTube..." required minlength="2" />
        <button type="submit">Search</button>
      </form>
      <ul class="youtube-search__results"></ul>
      <button type="button" class="youtube-search__next" hidden>Load more</button>
      <p class="youtube-search__status">Enter a query to search YouTube.</p>
    </div>
    <aside class="youtube-search__panel">
      <h3>Video Detail</h3>
      <p class="youtube-search__status">Open a result to view detail.</p>
    </aside>
  `;
  container.appendChild(shell);

  const form = shell.querySelector<HTMLFormElement>(".youtube-search__form");
  const resultsList = shell.querySelector<HTMLUListElement>(".youtube-search__results");
  const statusEl = shell.querySelector<HTMLParagraphElement>(".youtube-search__status");
  const nextBtn = shell.querySelector<HTMLButtonElement>(".youtube-search__next");
  const detailPanel = shell.querySelector<HTMLElement>("aside");

  if (!form || !resultsList || !statusEl || !nextBtn || !detailPanel) {
    renderErrorBoundary(container, new Error("Unable to mount YouTube search UI."));
    return;
  }

  let nextPageToken: string | undefined;
  let lastQuery = "";
  let cleanupDetail: (() => void) | undefined;

  async function openVideoDetail(videoId: string): Promise<void> {
    detailPanel.innerHTML = `<h3>Video Detail</h3><p class="youtube-search__status">Loading...</p>`;

    cleanupDetail?.();
    cleanupDetail = undefined;

    try {
      const video = await getYoutubeVideo(videoId);
      cleanupDetail = await mountYoutubeVideoDetail(detailPanel, video, {
        onAddClips: (clips) => {
          addClipsToClipBoard(clips);
        },
      });
    } catch (error) {
      detailPanel.innerHTML = `<h3>Video Detail</h3><p class="youtube-search__status">${String(error)}</p>`;
    }
  }

  function renderItems(items: YoutubeVideo[], append = false): void {
    if (!append) {
      resultsList.innerHTML = "";
    }

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "youtube-search__item";
      li.innerHTML = `
        <img class="youtube-search__thumb" src="${escapeHtml(item.thumbUrl)}" alt="Thumbnail for ${escapeHtml(item.title)}" loading="lazy" />
        <div>
          <p class="youtube-search__title">${escapeHtml(item.title)}</p>
          <p class="youtube-search__meta">${escapeHtml(item.channelTitle)}</p>
          <p class="youtube-search__meta">${formatDuration(item.durationSec)} • ${new Date(item.publishedAt).toLocaleDateString()}</p>
        </div>
        <button type="button" class="youtube-search__open">Open</button>
      `;

      li.querySelector<HTMLButtonElement>(".youtube-search__open")?.addEventListener("click", () => {
        void openVideoDetail(item.videoId);
      });

      resultsList.appendChild(li);
    }
  }

  async function runSearch(query: string, append = false): Promise<void> {
    statusEl.textContent = "Searching...";
    try {
      const result = await searchYoutube(query, 10, append ? nextPageToken : undefined);
      renderItems(result.items, append);
      if (!append) {
        saveLastYoutubeSearchResults(result.items);
      } else {
        // append into cache for playlist staging-from-search workflow
        saveLastYoutubeSearchResults([...loadLastYoutubeSearchResults(), ...result.items]);
      }
      nextPageToken = result.nextPageToken;
      nextBtn.hidden = !nextPageToken;
      statusEl.textContent = result.items.length > 0 ? `${result.items.length} result(s) loaded.` : "No results.";
    } catch (error) {
      statusEl.textContent = String(error);
      nextBtn.hidden = true;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const query = String(formData.get("q") ?? "").trim();
    if (!query) {
      return;
    }

    lastQuery = query;
    nextPageToken = undefined;
    void runSearch(query, false);
  });

  nextBtn.addEventListener("click", () => {
    if (!lastQuery || !nextPageToken) {
      return;
    }
    void runSearch(lastQuery, true);
  });
}
