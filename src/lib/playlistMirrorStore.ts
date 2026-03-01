import { getPlaylistItems, type YoutubePlaylistItemsResponse } from "./api";
import type { PlaylistMirror, PlaylistMirrorDiff, PlaylistMirrorItem } from "./types";

const STORAGE_KEY = "yt-cutup:playlist-mirror:v1";
const ACTIVE_KEY = "yt-cutup:playlist-mirror:active";

type MirrorMap = Record<string, PlaylistMirror>;

function loadMirrorMap(): MirrorMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as MirrorMap;
  } catch {
    return {};
  }
}

function saveMirrorMap(map: MirrorMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map, null, 2));
}

function toMirrorItem(item: YoutubePlaylistItemsResponse["items"][number]): PlaylistMirrorItem {
  return {
    playlist_item_id: item.playlistItemId,
    video_id: item.videoId,
    title: item.title,
    channel: item.channelTitle,
    published_at: item.publishedAt || null,
    thumb_url: item.thumbUrl || null,
    position: item.position,
  };
}

export function getMirror(playlistId: string): PlaylistMirror | null {
  return loadMirrorMap()[playlistId] ?? null;
}

export function saveMirror(mirror: PlaylistMirror): PlaylistMirror {
  const map = loadMirrorMap();
  map[mirror.playlist_id] = mirror;
  saveMirrorMap(map);
  return mirror;
}

export function setActiveMirrorPlaylistId(playlistId: string): void {
  localStorage.setItem(ACTIVE_KEY, playlistId);
}

export function getActiveMirrorPlaylistId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export async function pullRemoteToMirror(playlistId: string): Promise<PlaylistMirror> {
  const remote = await getPlaylistItems(playlistId);
  const mirror: PlaylistMirror = {
    mirror_version: 1,
    playlist_id: remote.playlistId,
    playlist_url: `https://www.youtube.com/playlist?list=${remote.playlistId}`,
    playlist_title: remote.title,
    playlist_description: remote.description,
    playlist_privacy: remote.privacyStatus,
    etag: remote.etag,
    last_synced_at: new Date().toISOString(),
    items: remote.items.map(toMirrorItem).sort((a, b) => a.position - b.position),
    pending_changes: { adds: [], removes: [] },
  };

  saveMirror(mirror);
  setActiveMirrorPlaylistId(playlistId);
  return mirror;
}

export function stageAdd(playlistId: string, videoId: string): PlaylistMirror {
  const mirror = getMirror(playlistId);
  if (!mirror) throw new Error("Missing mirror. Pull remote playlist first.");

  const pending = mirror.pending_changes ?? { adds: [], removes: [] };
  if (!pending.adds.includes(videoId)) {
    pending.adds.push(videoId);
  }
  mirror.pending_changes = pending;
  return saveMirror(mirror);
}

export function stageRemove(playlistId: string, playlistItemId: string): PlaylistMirror {
  const mirror = getMirror(playlistId);
  if (!mirror) throw new Error("Missing mirror. Pull remote playlist first.");

  const pending = mirror.pending_changes ?? { adds: [], removes: [] };
  if (!pending.removes.includes(playlistItemId)) {
    pending.removes.push(playlistItemId);
  }
  mirror.pending_changes = pending;
  return saveMirror(mirror);
}

export function stageReorder(playlistId: string, orderedVideoIds: string[]): PlaylistMirror {
  const mirror = getMirror(playlistId);
  if (!mirror) throw new Error("Missing mirror. Pull remote playlist first.");

  const pending = mirror.pending_changes ?? { adds: [], removes: [] };
  pending.reorder = orderedVideoIds;
  mirror.pending_changes = pending;
  return saveMirror(mirror);
}

export function clearPendingChanges(playlistId: string): PlaylistMirror {
  const mirror = getMirror(playlistId);
  if (!mirror) throw new Error("Missing mirror. Pull remote playlist first.");

  mirror.pending_changes = { adds: [], removes: [] };
  return saveMirror(mirror);
}

export function computeDiff(remote: PlaylistMirror, mirror: PlaylistMirror): PlaylistMirrorDiff {
  const remoteVideos = remote.items.map((item) => item.video_id);
  const mirrorVideos = mirror.items.map((item) => item.video_id);

  const added = mirrorVideos.filter((videoId) => !remoteVideos.includes(videoId));
  const removed = remoteVideos.filter((videoId) => !mirrorVideos.includes(videoId));

  const moved: string[] = [];
  for (let i = 0; i < Math.min(remoteVideos.length, mirrorVideos.length); i += 1) {
    if (remoteVideos[i] !== mirrorVideos[i] && !moved.includes(mirrorVideos[i])) {
      moved.push(mirrorVideos[i]);
    }
  }

  return { added, removed, moved };
}

export function applyPendingToMirror(mirror: PlaylistMirror): PlaylistMirror {
  const pending = mirror.pending_changes;
  if (!pending) return mirror;

  let items = [...mirror.items];

  if (pending.removes.length > 0) {
    items = items.filter((item) => !pending.removes.includes(item.playlist_item_id));
  }

  if (pending.adds.length > 0) {
    const existingVideoIds = new Set(items.map((item) => item.video_id));
    for (const videoId of pending.adds) {
      if (existingVideoIds.has(videoId)) continue;
      items.push({
        playlist_item_id: `staged-${videoId}-${Math.random().toString(36).slice(2, 8)}`,
        video_id: videoId,
        title: `Staged ${videoId}`,
        channel: "",
        published_at: null,
        thumb_url: null,
        position: items.length,
      });
      existingVideoIds.add(videoId);
    }
  }

  if (pending.reorder && pending.reorder.length > 0) {
    const byVideo = new Map(items.map((item) => [item.video_id, item]));
    const reordered: PlaylistMirrorItem[] = [];
    for (const videoId of pending.reorder) {
      const item = byVideo.get(videoId);
      if (!item) continue;
      reordered.push(item);
      byVideo.delete(videoId);
    }
    for (const item of byVideo.values()) reordered.push(item);
    items = reordered;
  }

  items = items.map((item, index) => ({ ...item, position: index }));
  return { ...mirror, items };
}
