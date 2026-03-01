import type { YoutubeVideo } from "../lib/api";
import { clipManifestClipSchema, type ClipManifestClip } from "../lib/schema";
import { mountRangeEditor } from "./components/range-editor";

interface YouTubeIframeApi {
  Player: new (elementId: string, options: Record<string, unknown>) => YouTubePlayer;
}

interface YouTubePlayer {
  destroy: () => void;
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getPlayerState?: () => number;
}

type YoutubeVideoDetailOptions = {
  onAddClips: (clips: ClipManifestClip[]) => void;
};

type ClipContext = {
  transmissionId: string;
  categoryId: string;
};

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
    __ytIframeApiPromise?: Promise<YouTubeIframeApi>;
  }
}

const styles = `
.youtube-video-detail { display: grid; gap: 12px; }
.youtube-video-detail__header h3 { margin: 0 0 6px; }
.youtube-video-detail__meta { margin: 0; color: #5f6368; font-size: 12px; }
.youtube-video-detail__player-wrap { border: 1px solid #eee; border-radius: 8px; padding: 10px; }
.youtube-video-detail__player { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; outline: none; }
.youtube-video-detail__controls { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.youtube-video-detail__btn { border: 1px solid #dadce0; border-radius: 999px; background: #fff; padding: 6px 10px; cursor: pointer; }
.youtube-video-detail__btn--primary { border-color: #1a73e8; color: #fff; background: #1a73e8; }
.youtube-video-detail__link { color: #1a73e8; text-decoration: none; font-size: 13px; }
.youtube-video-detail__status { margin: 0; font-size: 12px; color: #5f6368; }
.youtube-video-detail__context { border: 1px solid #eee; border-radius: 8px; padding: 10px; display: grid; gap: 8px; }
.youtube-video-detail__context-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.youtube-video-detail__context input { width: 100%; box-sizing: border-box; padding: 7px; border: 1px solid #dadce0; border-radius: 6px; }
.youtube-video-detail__modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: grid; place-items: center; z-index: 20; }
.youtube-video-detail__modal { background: #fff; width: min(560px, 92vw); border-radius: 10px; border: 1px solid #ddd; padding: 16px; }
.youtube-video-detail__modal h4 { margin-top: 0; }
.youtube-video-detail__shortcuts { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uniquePlayerElementId(videoId: string): string {
  return `yt-player-${videoId}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(durationSec: number): string {
  const hours = Math.floor(durationSec / 3600);
  const minutes = Math.floor((durationSec % 3600) / 60);
  const seconds = durationSec % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function getContextStorageKey(videoId: string): string {
  return `yt-cutup:video-detail:context:${videoId}`;
}

function loadClipContext(videoId: string): ClipContext {
  try {
    const raw = localStorage.getItem(getContextStorageKey(videoId));
    if (!raw) {
      return { transmissionId: "", categoryId: "" };
    }
    const parsed = JSON.parse(raw) as Partial<ClipContext>;
    return {
      transmissionId: typeof parsed.transmissionId === "string" ? parsed.transmissionId : "",
      categoryId: typeof parsed.categoryId === "string" ? parsed.categoryId : "",
    };
  } catch {
    return { transmissionId: "", categoryId: "" };
  }
}

function saveClipContext(videoId: string, context: ClipContext): void {
  localStorage.setItem(getContextStorageKey(videoId), JSON.stringify(context));
}

function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (window.__ytIframeApiPromise) {
    return window.__ytIframeApiPromise;
  }

  window.__ytIframeApiPromise = new Promise<YouTubeIframeApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Failed to load YouTube Iframe API script."));
      document.head.appendChild(script);
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) {
        resolve(window.YT);
        return;
      }
      reject(new Error("YouTube Iframe API did not initialize."));
    };
  });

  return window.__ytIframeApiPromise;
}

async function createPlayer(playerElementId: string, videoId: string): Promise<YouTubePlayer> {
  const YT = await loadYouTubeIframeApi();

  return new Promise<YouTubePlayer>((resolve) => {
    const player = new YT.Player(playerElementId, {
      videoId,
      playerVars: {
        autoplay: 0,
        rel: 0,
        modestbranding: 1,
      },
      events: {
        onReady: () => resolve(player),
      },
    });
  });
}

function normalizeTags(tagsString: string, context: ClipContext): string[] {
  const tags = tagsString
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  if (context.transmissionId.trim()) {
    tags.push(context.transmissionId.trim());
  }
  if (context.categoryId.trim()) {
    tags.push(context.categoryId.trim());
  }

  return [...new Set(tags)];
}

export async function mountYoutubeVideoDetail(
  container: HTMLElement,
  video: YoutubeVideo,
  options: YoutubeVideoDetailOptions,
): Promise<() => void> {
  container.innerHTML = "";

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  container.appendChild(styleEl);

  const shell = document.createElement("section");
  shell.className = "youtube-video-detail";
  const playerElementId = uniquePlayerElementId(video.videoId);
  const context = loadClipContext(video.videoId);

  shell.innerHTML = `
    <header class="youtube-video-detail__header">
      <h3>Video Detail</h3>
      <p class="youtube-video-detail__meta"><strong>${escapeHtml(video.title)}</strong></p>
      <p class="youtube-video-detail__meta">${escapeHtml(video.channelTitle)} • ${new Date(video.publishedAt).toLocaleString()} • ${formatDuration(video.durationSec)}</p>
      <a class="youtube-video-detail__link" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>
    </header>
    <div class="youtube-video-detail__context">
      <strong>Research context (optional)</strong>
      <div class="youtube-video-detail__context-row">
        <label>
          Transmission ID
          <input type="text" data-role="context-transmission" value="${escapeHtml(context.transmissionId)}" placeholder="e.g. TT01" />
        </label>
        <label>
          Category ID
          <input type="text" data-role="context-category" value="${escapeHtml(context.categoryId)}" placeholder="e.g. radio_broadcast" />
        </label>
      </div>
      <small class="youtube-video-detail__status">If provided, these are auto-tagged on clip export.</small>
    </div>
    <div class="youtube-video-detail__player-wrap">
      <div id="${playerElementId}" class="youtube-video-detail__player" aria-label="Embedded YouTube player" tabindex="0" data-role="player-hotkeys"></div>
      <div class="youtube-video-detail__controls">
        <button type="button" class="youtube-video-detail__btn" data-action="play">Play</button>
        <button type="button" class="youtube-video-detail__btn" data-action="pause">Pause</button>
        <button type="button" class="youtube-video-detail__btn" data-action="seek-back">J -5s</button>
        <button type="button" class="youtube-video-detail__btn" data-action="seek-forward">L +5s</button>
        <button type="button" class="youtube-video-detail__btn" data-action="set-start">I set start</button>
        <button type="button" class="youtube-video-detail__btn" data-action="set-end">O set end</button>
        <button type="button" class="youtube-video-detail__btn" data-action="help">Shortcuts</button>
        <button type="button" class="youtube-video-detail__btn youtube-video-detail__btn--primary" data-action="add-clips">Add ranges to Clipboard</button>
      </div>
      <p class="youtube-video-detail__status" data-role="status">Build ranges, then add them to Clip Board.</p>
    </div>
    <div class="youtube-video-detail__ranges"></div>
  `;

  container.appendChild(shell);

  let destroyed = false;
  const player = await createPlayer(playerElementId, video.videoId);
  if (destroyed) {
    player.destroy();
    return () => undefined;
  }

  const rangeMount = shell.querySelector<HTMLElement>(".youtube-video-detail__ranges");
  if (!rangeMount) {
    player.destroy();
    return () => undefined;
  }

  const rangeEditor = mountRangeEditor(rangeMount, {
    videoId: video.videoId,
    videoDurationSec: video.durationSec,
    getCurrentTime: () => {
      try {
        return player.getCurrentTime();
      } catch {
        return 0;
      }
    },
    defaultTags: [context.transmissionId, context.categoryId].filter((v) => v.trim().length > 0),
  });

  const status = shell.querySelector<HTMLElement>('[data-role="status"]');
  const playerHotkeysTarget = shell.querySelector<HTMLElement>('[data-role="player-hotkeys"]');
  const contextTransmission = shell.querySelector<HTMLInputElement>('[data-role="context-transmission"]');
  const contextCategory = shell.querySelector<HTMLInputElement>('[data-role="context-category"]');

  function currentContext(): ClipContext {
    return {
      transmissionId: contextTransmission?.value.trim() ?? "",
      categoryId: contextCategory?.value.trim() ?? "",
    };
  }

  function persistContext(): void {
    saveClipContext(video.videoId, currentContext());
  }

  contextTransmission?.addEventListener("input", persistContext);
  contextCategory?.addEventListener("input", persistContext);

  function seekBy(delta: number): void {
    try {
      const current = player.getCurrentTime();
      const target = Math.max(0, Math.floor(current + delta));
      player.seekTo(target, true);
    } catch {
      // no-op
    }
  }

  function togglePlayPause(): void {
    const state = player.getPlayerState?.() ?? -1;
    if (state === 1) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  shell.querySelector<HTMLButtonElement>('button[data-action="play"]')?.addEventListener("click", () => {
    player.playVideo();
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="pause"]')?.addEventListener("click", () => {
    player.pauseVideo();
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="seek-back"]')?.addEventListener("click", () => {
    seekBy(-5);
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="seek-forward"]')?.addEventListener("click", () => {
    seekBy(5);
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="set-start"]')?.addEventListener("click", () => {
    rangeEditor.ensureSelectedRange();
    rangeEditor.setSelectedStartFromCurrentTime();
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="set-end"]')?.addEventListener("click", () => {
    rangeEditor.ensureSelectedRange();
    rangeEditor.setSelectedEndFromCurrentTime();
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="help"]')?.addEventListener("click", () => {
    const backdrop = document.createElement("div");
    backdrop.className = "youtube-video-detail__modal-backdrop";
    backdrop.innerHTML = `
      <div class="youtube-video-detail__modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h4>Keyboard shortcuts (player focused)</h4>
        <ul class="youtube-video-detail__shortcuts">
          <li><strong>I</strong> set start</li>
          <li><strong>O</strong> set end</li>
          <li><strong>Space</strong> play / pause</li>
          <li><strong>J</strong> seek -5 seconds</li>
          <li><strong>L</strong> seek +5 seconds</li>
        </ul>
        <p class="youtube-video-detail__status">Click the player area first, then use shortcuts.</p>
        <button type="button" class="youtube-video-detail__btn" data-action="close-help">Close</button>
      </div>
    `;

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        backdrop.remove();
      }
    });

    backdrop.querySelector<HTMLButtonElement>('button[data-action="close-help"]')?.addEventListener("click", () => {
      backdrop.remove();
    });

    document.body.appendChild(backdrop);
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="add-clips"]')?.addEventListener("click", () => {
    const ctx = currentContext();
    persistContext();

    const rawRanges = rangeEditor.getRanges();

    const validClips: ClipManifestClip[] = rawRanges
      .map((range) => {
        const start = Math.max(0, Math.floor(range.startSec));
        const end = Math.max(0, Math.floor(range.endSec));
        const tags = normalizeTags(range.tags, ctx);

        return {
          clip_id: range.clipId,
          source_type: "youtube",
          video_id: video.videoId,
          video_url: video.url,
          title: video.title,
          channel: video.channelTitle,
          published_at: video.publishedAt || null,
          start_sec: start,
          end_sec: end,
          duration_sec: end - start,
          notes: `${range.notes}${range.notes ? " | " : ""}end_sec=${end}`,
          tags,
          playlist_id: null,
          playlist_title: null,
          share_url: `https://www.youtube.com/watch?v=${video.videoId}&t=${start}s`,
        } satisfies ClipManifestClip;
      })
      .filter((clip) => clipManifestClipSchema.safeParse(clip).success);

    options.onAddClips(validClips);

    if (status) {
      status.textContent =
        validClips.length > 0
          ? `Added ${validClips.length} clip(s) to Clip Board.`
          : "No valid ranges were added. Ensure end > start and duration is valid.";
    }
  });

  const onPlayerKeyDown = (event: KeyboardEvent): void => {
    if (document.activeElement !== playerHotkeysTarget) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "i") {
      event.preventDefault();
      rangeEditor.ensureSelectedRange();
      rangeEditor.setSelectedStartFromCurrentTime();
      return;
    }

    if (key === "o") {
      event.preventDefault();
      rangeEditor.ensureSelectedRange();
      rangeEditor.setSelectedEndFromCurrentTime();
      return;
    }

    if (key === "j") {
      event.preventDefault();
      seekBy(-5);
      return;
    }

    if (key === "l") {
      event.preventDefault();
      seekBy(5);
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      togglePlayPause();
    }
  };

  playerHotkeysTarget?.addEventListener("keydown", onPlayerKeyDown);
  playerHotkeysTarget?.addEventListener("click", () => playerHotkeysTarget.focus());

  return () => {
    destroyed = true;
    playerHotkeysTarget?.removeEventListener("keydown", onPlayerKeyDown);
    rangeEditor.destroy();
    player.destroy();
    shell.remove();
    styleEl.remove();
  };
}
