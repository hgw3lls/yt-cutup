export type PlaylistMirrorItem = {
  playlist_item_id: string;
  video_id: string;
  title: string;
  channel: string;
  published_at?: string | null;
  thumb_url?: string | null;
  position: number;
};

export type PlaylistMirrorPendingChanges = {
  adds: string[];
  removes: string[];
  reorder?: string[];
};

export type PlaylistMirror = {
  mirror_version: 1;
  playlist_id: string;
  playlist_url: string;
  playlist_title: string;
  playlist_description?: string;
  playlist_privacy?: string;
  etag?: string;
  last_synced_at?: string;
  items: PlaylistMirrorItem[];
  pending_changes?: PlaylistMirrorPendingChanges;
};

export type PlaylistMirrorDiff = {
  added: string[];
  removed: string[];
  moved: string[];
};
