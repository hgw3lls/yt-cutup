import { clipsManifestSchema, type ClipManifestClip, type ClipsManifest } from "./schema";

const CLIP_BOARD_KEY = "yt-cutup:clip-board:manifest";

function defaultManifest(): ClipsManifest {
  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    clips: [],
  };
}

export function loadClipBoardManifest(): ClipsManifest {
  try {
    const raw = localStorage.getItem(CLIP_BOARD_KEY);
    if (!raw) {
      return defaultManifest();
    }

    const parsed = JSON.parse(raw);
    const validated = clipsManifestSchema.safeParse(parsed);
    if (!validated.success) {
      return defaultManifest();
    }

    return validated.data;
  } catch {
    return defaultManifest();
  }
}

export function saveClipBoardManifest(manifest: ClipsManifest): void {
  localStorage.setItem(CLIP_BOARD_KEY, JSON.stringify(manifest, null, 2));
}

export function addClipsToClipBoard(clips: ClipManifestClip[]): ClipsManifest {
  const current = loadClipBoardManifest();
  const merged: ClipsManifest = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    clips: [...current.clips, ...clips],
  };
  saveClipBoardManifest(merged);
  return merged;
}

export function replaceClipBoardManifest(manifest: ClipsManifest): ClipsManifest {
  const normalized: ClipsManifest = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    clips: manifest.clips,
  };
  saveClipBoardManifest(normalized);
  return normalized;
}

export function clearClipBoard(): void {
  saveClipBoardManifest(defaultManifest());
}

export function clipsManifestToCsv(manifest: ClipsManifest): string {
  const headers = ["clip_id", "title", "url", "start", "end", "notes", "tags"];
  const escapeCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const rows = manifest.clips.map((clip) => [
    clip.clip_id,
    clip.title,
    clip.share_url,
    String(clip.start_sec),
    String(clip.end_sec),
    clip.notes,
    clip.tags.join("|"),
  ]);

  return [headers, ...rows].map((row) => row.map((col) => escapeCsv(col)).join(",")).join("\n");
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}


export function getClipBoardVideoIds(): string[] {
  const manifest = loadClipBoardManifest();
  return [...new Set(manifest.clips.map((clip) => clip.video_id))];
}

export function markOrphanedByPlaylist(playlistId: string, removedVideoIds: string[]): ClipsManifest {
  const removed = new Set(removedVideoIds);
  const manifest = loadClipBoardManifest();

  manifest.clips = manifest.clips.map((clip) => {
    if (!removed.has(clip.video_id)) {
      return clip;
    }

    const orphanTag = `orphaned_from_playlist:${playlistId}`;
    const tags = clip.tags.includes(orphanTag) ? clip.tags : [...clip.tags, orphanTag];
    return { ...clip, tags };
  });
  manifest.created_at = new Date().toISOString();
  saveClipBoardManifest(manifest);
  return manifest;
}
