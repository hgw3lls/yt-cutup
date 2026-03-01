export type YoutubeVideo = {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbUrl: string;
  durationSec: number;
  url: string;
};

export type YoutubeSearchResponse = {
  items: YoutubeVideo[];
  nextPageToken?: string;
};

export type AuthStatus = {
  authenticated: boolean;
  hasRefreshToken?: boolean;
  scopes?: string[];
  tokenExpiry?: string | null;
};

export type YoutubePlaylist = {
  playlistId: string;
  title: string;
  description: string;
  privacyStatus: string;
  itemCount: number;
  thumbUrl: string;
};

export type YoutubePlaylistsResponse = {
  items: YoutubePlaylist[];
  nextPageToken?: string;
};

export type YoutubePlaylistItem = {
  playlistItemId: string;
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbUrl: string;
  position: number;
};

export type YoutubePlaylistItemsResponse = {
  playlistId: string;
  etag: string;
  title: string;
  description: string;
  privacyStatus: string;
  items: YoutubePlaylistItem[];
};

export type PlaylistCreateRequest = {
  title: string;
  description: string;
  privacyStatus: "private" | "public" | "unlisted";
};

export type PlaylistCreateResponse = {
  playlistId: string;
  url: string;
};

export type PlaylistItemCreateRequest = {
  playlistId: string;
  videoId: string;
};

export type PlaylistItemCreateResponse = {
  playlistItemId: string;
  position: number;
};

export type PlaylistReorderRequest = {
  playlistId: string;
  orderedVideoIds?: string[];
  orderedPlaylistItemIds?: string[];
};

export type PlaylistReorderResponse = {
  usedRebuild: boolean;
  warnings: string[];
  progress?: {
    total: number;
    processed: number;
  };
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8787";

async function requestJson<T>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "DELETE";
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  },
): Promise<T> {
  const url = new URL(path, API_BASE);

  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

export async function youtubeHealth(): Promise<{ status: string }> {
  return requestJson<{ status: string }>("/api/health");
}

export async function searchYoutube(q: string, max = 10, pageToken?: string): Promise<YoutubeSearchResponse> {
  return requestJson<YoutubeSearchResponse>("/api/youtube/search", {
    query: { q, max, pageToken },
  });
}

export async function getYoutubeVideo(videoId: string): Promise<YoutubeVideo> {
  return requestJson<YoutubeVideo>("/api/youtube/video", { query: { videoId } });
}

export function getAuthLoginUrl(): string {
  return new URL("/api/auth/login", API_BASE).toString();
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return requestJson<AuthStatus>("/api/auth/status");
}

export async function logoutAuth(): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function listPlaylists(mine = true, pageToken?: string): Promise<YoutubePlaylistsResponse> {
  return requestJson<YoutubePlaylistsResponse>("/api/youtube/playlists", {
    query: { mine, pageToken },
  });
}

export async function getPlaylistItems(playlistId: string): Promise<YoutubePlaylistItemsResponse> {
  return requestJson<YoutubePlaylistItemsResponse>("/api/youtube/playlistItems", {
    query: { playlistId },
  });
}

export async function createPlaylist(body: PlaylistCreateRequest): Promise<PlaylistCreateResponse> {
  return requestJson<PlaylistCreateResponse>("/api/youtube/playlists", {
    method: "POST",
    body,
  });
}

export async function addPlaylistItem(body: PlaylistItemCreateRequest): Promise<PlaylistItemCreateResponse> {
  return requestJson<PlaylistItemCreateResponse>("/api/youtube/playlistItems", {
    method: "POST",
    body,
  });
}

export async function deletePlaylistItem(playlistItemId: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/youtube/playlistItems/${playlistItemId}`, {
    method: "DELETE",
  });
}

export async function reorderPlaylistItems(body: PlaylistReorderRequest): Promise<PlaylistReorderResponse> {
  return requestJson<PlaylistReorderResponse>("/api/youtube/playlistItems/reorder", {
    method: "POST",
    body,
  });
}
