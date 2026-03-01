import type { YoutubeVideo } from "./api";

const KEY = "yt-cutup:youtube-search:last-results";

export function saveLastYoutubeSearchResults(items: YoutubeVideo[]): void {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)));
}

export function loadLastYoutubeSearchResults(): YoutubeVideo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as YoutubeVideo[];
  } catch {
    return [];
  }
}
