# YouTube Metadata + Playlist API Server

FastAPI backend for YouTube metadata search/read and playlist manipulation.

## Scope (strict)

- ✅ YouTube Data API metadata + playlist operations
- ✅ OAuth-based playlist write operations
- ❌ No yt-dlp
- ❌ No ffmpeg
- ❌ No media download/extraction/transcoding

## Environment

Set these before running:

```bash
export YOUTUBE_API_KEY="..."
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
export OAUTH_REDIRECT_URL="http://localhost:8787/api/auth/callback"
export FRONTEND_ORIGIN="http://localhost:5173"
```

Optional controls:

```bash
export WRITE_RATE_LIMIT_WINDOW_SEC=60
export WRITE_RATE_LIMIT_MAX_CALLS=30
export REORDER_MAX_BATCH=200
export REORDER_ALLOW_REBUILD=true
```

## Install & Run

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

## Endpoints

### Health

- `GET /api/health`

### API key metadata endpoints

- `GET /api/youtube/search?q=&max=&pageToken=`
  - Returns:
    - `{ items:[{ videoId,title,channelTitle,publishedAt,thumbUrl,durationSec,url }], nextPageToken }`
  - Enriches `durationSec` from `videos.list(contentDetails)` and ISO8601 parsing.
- `GET /api/youtube/video?videoId=`
  - Returns normalized single video object with the same fields.

### OAuth endpoints

- `GET /api/auth/login`
- `GET /api/auth/callback`
- `GET /api/auth/status`
- `POST /api/auth/logout`

Tokens are stored under `server/.tokens/oauth_token.json` and refreshed automatically.

### Playlist endpoints

- `GET /api/youtube/playlists?mine=true&pageToken=`
  - Returns `{items:[{playlistId,title,description,privacyStatus,itemCount,thumbUrl}], nextPageToken}`
- `GET /api/youtube/playlistItems?playlistId=`
  - Returns full paginated normalized list:
    - `{playlistId, etag, title, description, privacyStatus, items:[{playlistItemId, videoId, title, channelTitle, publishedAt, thumbUrl, position}]}`
  - Tries API key first for public; falls back to OAuth for private/auth-required.
- `POST /api/youtube/playlists`
  - Body: `{title,description,privacyStatus}`
  - Returns `{playlistId,url}`
- `POST /api/youtube/playlistItems`
  - Body: `{playlistId,videoId}`
  - Returns `{playlistItemId,position}`
- `DELETE /api/youtube/playlistItems/{playlistItemId}`
  - Returns `{ok:true}`
- `POST /api/youtube/playlistItems/reorder`
  - Body: `{playlistId, orderedVideoIds:[...]}` or `{playlistId, orderedPlaylistItemIds:[...]}`
  - Best effort:
    1) `playlistItems.update` by position
    2) fallback (if enabled) rebuild by delete+reinsert
  - Returns `{usedRebuild:boolean, warnings:[...], progress:{total,processed}}`

## Notes

- CORS is limited to `FRONTEND_ORIGIN`.
- Write endpoints are rate-limited (in-memory per-client/action).
- Errors are structured:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```
