const KEY = "yt-cutup:youtube-search:intent-query";

export function setYoutubeSearchIntentQuery(query: string): void {
  const value = query.trim();
  if (!value) {
    sessionStorage.removeItem(KEY);
    return;
  }
  sessionStorage.setItem(KEY, value);
}

export function consumeYoutubeSearchIntentQuery(): string {
  const value = sessionStorage.getItem(KEY) ?? "";
  sessionStorage.removeItem(KEY);
  return value;
}

export type OpenYoutubeSearchEventDetail = {
  query: string;
};

export const OPEN_YOUTUBE_SEARCH_EVENT = "yt-cutup:open-youtube-search";
