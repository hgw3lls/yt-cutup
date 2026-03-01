import {
  addPlaylistItem,
  createPlaylist,
  getAuthLoginUrl,
  getAuthStatus,
  getPlaylistItems,
  listPlaylists,
  logoutAuth,
  reorderPlaylistItems,
  deletePlaylistItem,
  type YoutubePlaylist,
} from "../lib/api";
import { addClipsToClipBoard, getClipBoardVideoIds, markOrphanedByPlaylist } from "../lib/clip-board";
import { loadLastYoutubeSearchResults } from "../lib/youtube-search-cache";
import {
  applyPendingToMirror,
  clearPendingChanges,
  computeDiff,
  getActiveMirrorPlaylistId,
  getMirror,
  pullRemoteToMirror,
  saveMirror,
  setActiveMirrorPlaylistId,
  stageAdd,
  stageRemove,
  stageReorder,
} from "../lib/playlistMirrorStore";
import type { PlaylistMirror } from "../lib/types";

const styles = `
.playlists { display: grid; grid-template-rows: auto auto 1fr; gap: 12px; height: 100%; }
.playlists__panel { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
.playlists__row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.playlists__row input { padding: 7px 9px; border: 1px solid #dadce0; border-radius: 6px; min-width: 260px; }
.playlists__btn { border: 1px solid #dadce0; border-radius: 999px; padding: 6px 10px; background: #fff; cursor: pointer; }
.playlists__workspace { display: grid; grid-template-columns: 280px 1fr 1fr; gap: 12px; min-height: 0; }
.playlists__list { border: 1px solid #eee; border-radius: 8px; padding: 10px; overflow: auto; }
.playlists__list ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.playlists__item { border: 1px solid #eee; border-radius: 6px; padding: 8px; }
.playlists__sync { border: 1px solid #eee; border-radius: 8px; padding: 10px; overflow: auto; }
.playlists__sync h4 { margin: 0 0 8px; }
.playlists__table { width: 100%; border-collapse: collapse; }
.playlists__table th,.playlists__table td { border-bottom: 1px solid #f1f3f4; padding: 6px; text-align: left; }
.playlists__status { color: #5f6368; font-size: 13px; margin: 0; }
.playlists__danger { color: #d93025; }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parsePlaylistId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("http")) return trimmed;

  const url = new URL(trimmed);
  return url.searchParams.get("list") ?? "";
}

export async function mountPlaylistsUI(container: HTMLElement): Promise<void> {
  container.innerHTML = "";
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  container.appendChild(styleEl);

  const shell = document.createElement("section");
  shell.className = "playlists";
  shell.innerHTML = `
    <div class="playlists__panel">
      <h3>Auth</h3>
      <div class="playlists__row">
        <span data-role="auth-status">Checking auth...</span>
        <a class="playlists__btn" href="${escapeHtml(getAuthLoginUrl())}">Sign in</a>
        <button type="button" class="playlists__btn" data-action="signout">Sign out</button>
      </div>
    </div>
    <div class="playlists__panel">
      <div class="playlists__row">
        <button type="button" class="playlists__btn" data-action="load-mine">Load My Playlists</button>
        <input type="text" placeholder="Import playlist URL or ID" data-role="import-playlist-id" />
        <button type="button" class="playlists__btn" data-action="import-playlist">Import Playlist</button>
      </div>
      <p class="playlists__status" data-role="status"></p>
    </div>
    <div class="playlists__workspace">
      <aside class="playlists__list"><h4>Playlists</h4><ul data-role="playlist-list"></ul></aside>
      <section class="playlists__sync"><h4>Remote Snapshot</h4><div data-role="remote"></div></section>
      <section class="playlists__sync"><h4>Local Mirror + Diff</h4><div data-role="mirror"></div></section>
    </div>
  `;
  container.appendChild(shell);

  const authStatusEl = shell.querySelector<HTMLElement>('[data-role="auth-status"]');
  const statusEl = shell.querySelector<HTMLElement>('[data-role="status"]');
  const playlistListEl = shell.querySelector<HTMLElement>('[data-role="playlist-list"]');
  const remoteEl = shell.querySelector<HTMLElement>('[data-role="remote"]');
  const mirrorEl = shell.querySelector<HTMLElement>('[data-role="mirror"]');
  const importInput = shell.querySelector<HTMLInputElement>('[data-role="import-playlist-id"]');

  if (!authStatusEl || !statusEl || !playlistListEl || !remoteEl || !mirrorEl || !importInput) return;

  let myPlaylists: YoutubePlaylist[] = [];
  let activePlaylistId = getActiveMirrorPlaylistId();
  let remoteSnapshot: PlaylistMirror | null = null;

  async function refreshAuth(): Promise<void> {
    try {
      const status = await getAuthStatus();
      authStatusEl.textContent = status.authenticated ? "Signed in" : "Signed out";
    } catch (error) {
      authStatusEl.textContent = `Auth status error: ${String(error)}`;
    }
  }

  function renderPlaylistList(): void {
    playlistListEl.innerHTML = myPlaylists
      .map(
        (playlist) => `
      <li class="playlists__item">
        <strong>${escapeHtml(playlist.title)}</strong>
        <div class="playlists__status">${escapeHtml(playlist.playlistId)}</div>
        <div class="playlists__status">${playlist.itemCount} items • ${escapeHtml(playlist.privacyStatus)}</div>
        <div class="playlists__row">
          <button type="button" class="playlists__btn" data-action="select" data-id="${escapeHtml(playlist.playlistId)}">Open Sync</button>
          <button type="button" class="playlists__btn" data-action="clone" data-id="${escapeHtml(playlist.playlistId)}">Clone to My Account</button>
        </div>
      </li>`,
      )
      .join("");

    playlistListEl.querySelectorAll<HTMLButtonElement>('button[data-action="select"]').forEach((button) => {
      button.addEventListener("click", async () => {
        const playlistId = button.dataset.id;
        if (!playlistId) return;
        activePlaylistId = playlistId;
        setActiveMirrorPlaylistId(playlistId);
        await refreshSync();
      });
    });

    playlistListEl.querySelectorAll<HTMLButtonElement>('button[data-action="clone"]').forEach((button) => {
      button.addEventListener("click", async () => {
        const playlistId = button.dataset.id;
        if (!playlistId) return;

        try {
          statusEl.textContent = "Cloning playlist...";
          const source = await getPlaylistItems(playlistId);
          const created = await createPlaylist({
            title: `${source.title} (Clone)`,
            description: source.description,
            privacyStatus: "private",
          });
          for (const item of source.items) {
            await addPlaylistItem({ playlistId: created.playlistId, videoId: item.videoId });
          }
          activePlaylistId = created.playlistId;
          setActiveMirrorPlaylistId(created.playlistId);
          statusEl.textContent = `Cloned to ${created.playlistId}`;
          await refreshMine();
          await refreshSync();
        } catch (error) {
          statusEl.textContent = `Clone failed: ${String(error)}`;
        }
      });
    });
  }

  function renderRemote(): void {
    if (!remoteSnapshot) {
      remoteEl.innerHTML = '<p class="playlists__status">No remote playlist loaded.</p>';
      return;
    }

    remoteEl.innerHTML = `
      <p class="playlists__status"><strong>${escapeHtml(remoteSnapshot.playlist_title)}</strong> (${escapeHtml(remoteSnapshot.playlist_id)})</p>
      <p class="playlists__status">etag=${escapeHtml(remoteSnapshot.etag ?? "")}</p>
      <table class="playlists__table">
        <thead><tr><th>#</th><th>title</th><th>video</th></tr></thead>
        <tbody>
          ${remoteSnapshot.items
            .map(
              (item) => `<tr><td>${item.position}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.video_id)}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderMirror(): void {
    const mirror = activePlaylistId ? getMirror(activePlaylistId) : null;
    if (!mirror || !remoteSnapshot) {
      mirrorEl.innerHTML = '<p class="playlists__status">Select/import a playlist to start mirroring.</p>';
      return;
    }

    const staged = applyPendingToMirror(mirror);
    const diff = computeDiff(remoteSnapshot, staged);

    mirrorEl.innerHTML = `
      <p class="playlists__status"><strong>Diff:</strong> added ${diff.added.length}, removed ${diff.removed.length}, moved ${diff.moved.length}</p>
      <div class="playlists__row">
        <input type="text" data-role="add-video-id" placeholder="Paste video URL or ID" />
        <button type="button" class="playlists__btn" data-action="stage-add">Stage Add</button>
        <button type="button" class="playlists__btn" data-action="from-clipboard">Add Videos from Clip Board</button>
        <button type="button" class="playlists__btn" data-action="from-search">Add from last YouTube Search</button>
        <button type="button" class="playlists__btn" data-action="to-clipboard">Add Playlist Videos to Clip Board</button>
        <button type="button" class="playlists__btn" data-action="pull-discard">Pull remote + discard staged</button>
        <button type="button" class="playlists__btn" data-action="clear-staged">Clear staged</button>
      </div>
      <div class="playlists__row">
        <button type="button" class="playlists__btn playlists__danger" data-action="push">Push to YouTube</button>
      </div>
      <table class="playlists__table">
        <thead><tr><th>#</th><th>title</th><th>video</th><th>actions</th></tr></thead>
        <tbody>
          ${staged.items
            .map(
              (item) => `<tr>
                <td>${item.position}</td>
                <td>${escapeHtml(item.title)}</td>
                <td>${escapeHtml(item.video_id)}</td>
                <td>
                  <button type="button" class="playlists__btn" data-action="remove" data-id="${escapeHtml(item.playlist_item_id)}">Stage Remove</button>
                  <button type="button" class="playlists__btn" data-action="up" data-video="${escapeHtml(item.video_id)}">↑</button>
                  <button type="button" class="playlists__btn" data-action="down" data-video="${escapeHtml(item.video_id)}">↓</button>
                </td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    `;

    const addVideoInput = mirrorEl.querySelector<HTMLInputElement>('[data-role="add-video-id"]');

    mirrorEl.querySelector<HTMLButtonElement>('button[data-action="stage-add"]')?.addEventListener("click", () => {
      const raw = addVideoInput?.value.trim() ?? "";
      const videoId = raw.includes("watch?v=") ? new URL(raw).searchParams.get("v") ?? "" : raw;
      if (!videoId || !activePlaylistId) return;
      stageAdd(activePlaylistId, videoId);
      renderMirror();
    });

    mirrorEl.querySelector<HTMLButtonElement>('button[data-action="from-clipboard"]')?.addEventListener("click", () => {
      if (!activePlaylistId) return;
      for (const videoId of getClipBoardVideoIds()) {
        stageAdd(activePlaylistId, videoId);
      }
      renderMirror();
    });

    
    
    mirrorEl.querySelector<HTMLButtonElement>('button[data-action="from-search"]')?.addEventListener("click", () => {
      if (!activePlaylistId) return;
      const results = loadLastYoutubeSearchResults();
      for (const item of results) {
        stageAdd(activePlaylistId, item.videoId);
      }
      statusEl.textContent = `Staged ${results.length} video(s) from last YouTube Search results.`;
      renderMirror();
    });
mirrorEl.querySelector<HTMLButtonElement>('button[data-action="to-clipboard"]')?.addEventListener("click", () => {
      if (!activePlaylistId) return;
      const current = applyPendingToMirror(getMirror(activePlaylistId)!);
      const clips = current.items.map((item) => ({
        clip_id: `playlist-${activePlaylistId}-${item.video_id}`,
        source_type: "youtube" as const,
        video_id: item.video_id,
        video_url: `https://www.youtube.com/watch?v=${item.video_id}`,
        title: item.title,
        channel: item.channel,
        published_at: item.published_at ?? null,
        start_sec: 0,
        end_sec: 1,
        duration_sec: 1,
        notes: "playlist_source:no_timestamp_range",
        tags: [`playlist:${activePlaylistId}`],
        playlist_id: activePlaylistId,
        playlist_title: current.playlist_title,
        share_url: `https://www.youtube.com/watch?v=${item.video_id}&t=0s`,
      }));
      addClipsToClipBoard(clips);
      statusEl.textContent = `Added ${clips.length} playlist video sources to Clip Board.`;
    });
mirrorEl.querySelector<HTMLButtonElement>('button[data-action="pull-discard"]')?.addEventListener("click", async () => {
      if (!activePlaylistId) return;
      await pullRemoteToMirror(activePlaylistId);
      await refreshSync();
    });

    mirrorEl.querySelector<HTMLButtonElement>('button[data-action="clear-staged"]')?.addEventListener("click", () => {
      if (!activePlaylistId) return;
      clearPendingChanges(activePlaylistId);
      renderMirror();
    });

    mirrorEl.querySelector<HTMLButtonElement>('button[data-action="push"]')?.addEventListener("click", async () => {
      if (!activePlaylistId) return;

      try {
        statusEl.textContent = "Push: fetching latest remote...";
        const latest = await pullRemoteToMirror(activePlaylistId);
        const local = getMirror(activePlaylistId);
        if (!local) return;

        const desired = applyPendingToMirror(local);
        const diffNow = computeDiff(latest, desired);

        if (diffNow.added.length === 0 && diffNow.removed.length === 0 && diffNow.moved.length === 0) {
          statusEl.textContent = "Nothing to push.";
          return;
        }

        statusEl.textContent = "Applying deletes...";
        const remoteByVideo = new Map(latest.items.map((item) => [item.video_id, item]));
        for (const videoId of diffNow.removed) {
          const item = remoteByVideo.get(videoId);
          if (item) {
            await deletePlaylistItem(item.playlist_item_id);
          }
        }

        statusEl.textContent = "Applying inserts...";
        for (const videoId of diffNow.added) {
          await addPlaylistItem({ playlistId: activePlaylistId, videoId });
        }

        statusEl.textContent = "Applying reorder...";
        const reorder = desired.items.map((item) => item.video_id);
        const reorderResult = await reorderPlaylistItems({
          playlistId: activePlaylistId,
          orderedVideoIds: reorder,
        });

        if (diffNow.removed.length > 0) {
          markOrphanedByPlaylist(activePlaylistId, diffNow.removed);
        }

        statusEl.textContent = `Push complete. rebuild=${reorderResult.usedRebuild}, warnings=${reorderResult.warnings.length}`;

        await pullRemoteToMirror(activePlaylistId);
        const fresh = getMirror(activePlaylistId);
        if (fresh) {
          fresh.pending_changes = { adds: [], removes: [] };
          saveMirror(fresh);
        }
        await refreshSync();
      } catch (error) {
        statusEl.textContent = `Push failed: ${String(error)}`;
      }
    });

    mirrorEl.querySelectorAll<HTMLButtonElement>('button[data-action="remove"]').forEach((button) => {
      button.addEventListener("click", () => {
        if (!activePlaylistId || !button.dataset.id) return;
        stageRemove(activePlaylistId, button.dataset.id);
        renderMirror();
      });
    });

    function stageMove(videoId: string, delta: -1 | 1): void {
      if (!activePlaylistId) return;
      const current = applyPendingToMirror(getMirror(activePlaylistId)!);
      const ids = current.items.map((item) => item.video_id);
      const index = ids.indexOf(videoId);
      if (index < 0) return;
      const target = index + delta;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      stageReorder(activePlaylistId, ids);
      renderMirror();
    }

    mirrorEl.querySelectorAll<HTMLButtonElement>('button[data-action="up"]').forEach((button) => {
      button.addEventListener("click", () => {
        if (!button.dataset.video) return;
        stageMove(button.dataset.video, -1);
      });
    });

    mirrorEl.querySelectorAll<HTMLButtonElement>('button[data-action="down"]').forEach((button) => {
      button.addEventListener("click", () => {
        if (!button.dataset.video) return;
        stageMove(button.dataset.video, 1);
      });
    });
  }

  async function refreshMine(): Promise<void> {
    try {
      const payload = await listPlaylists(true);
      myPlaylists = payload.items;
      renderPlaylistList();
      statusEl.textContent = `Loaded ${payload.items.length} playlists.`;
    } catch (error) {
      statusEl.textContent = `Load playlists failed: ${String(error)}`;
    }
  }

  async function refreshSync(): Promise<void> {
    if (!activePlaylistId) {
      remoteSnapshot = null;
      renderRemote();
      renderMirror();
      return;
    }

    try {
      const remote = await getPlaylistItems(activePlaylistId);
      remoteSnapshot = {
        mirror_version: 1,
        playlist_id: remote.playlistId,
        playlist_url: `https://www.youtube.com/playlist?list=${remote.playlistId}`,
        playlist_title: remote.title,
        playlist_description: remote.description,
        playlist_privacy: remote.privacyStatus,
        etag: remote.etag,
        last_synced_at: new Date().toISOString(),
        items: remote.items.map((item) => ({
          playlist_item_id: item.playlistItemId,
          video_id: item.videoId,
          title: item.title,
          channel: item.channelTitle,
          published_at: item.publishedAt,
          thumb_url: item.thumbUrl,
          position: item.position,
        })),
        pending_changes: { adds: [], removes: [] },
      };

      if (!getMirror(activePlaylistId)) {
        saveMirror(remoteSnapshot);
      }

      renderRemote();
      renderMirror();
    } catch (error) {
      statusEl.textContent = `Refresh sync failed: ${String(error)}`;
    }
  }

  shell.querySelector<HTMLButtonElement>('button[data-action="signout"]')?.addEventListener("click", async () => {
    try {
      await logoutAuth();
      await refreshAuth();
      statusEl.textContent = "Signed out.";
    } catch (error) {
      statusEl.textContent = `Sign out failed: ${String(error)}`;
    }
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="load-mine"]')?.addEventListener("click", async () => {
    await refreshMine();
  });

  shell.querySelector<HTMLButtonElement>('button[data-action="import-playlist"]')?.addEventListener("click", async () => {
    const playlistId = parsePlaylistId(importInput.value);
    if (!playlistId) {
      statusEl.textContent = "Enter valid playlist URL or ID.";
      return;
    }

    activePlaylistId = playlistId;
    setActiveMirrorPlaylistId(playlistId);
    statusEl.textContent = `Imported playlist ${playlistId}.`;
    await refreshSync();
  });

  await refreshAuth();
  await refreshSync();
}
