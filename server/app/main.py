import json
import os
import re
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Any
import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from pydantic import BaseModel, Field

YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube"
ISO_DURATION_RE = re.compile(
    r"^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)

TOKENS_DIR = Path(__file__).resolve().parent.parent / ".tokens"
TOKEN_FILE = TOKENS_DIR / "oauth_token.json"

WRITE_RATE_LIMIT_WINDOW_SEC = int(os.getenv("WRITE_RATE_LIMIT_WINDOW_SEC", "60"))
WRITE_RATE_LIMIT_MAX_CALLS = int(os.getenv("WRITE_RATE_LIMIT_MAX_CALLS", "30"))
REORDER_MAX_BATCH = int(os.getenv("REORDER_MAX_BATCH", "200"))
REORDER_ALLOW_REBUILD = os.getenv("REORDER_ALLOW_REBUILD", "true").lower() == "true"

state_store: dict[str, float] = {}
write_rate_limit: dict[str, deque[float]] = defaultdict(deque)


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: Any | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)


class PlaylistCreateBody(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=5000)
    privacyStatus: str = Field(pattern="^(private|public|unlisted)$")


class PlaylistItemCreateBody(BaseModel):
    playlistId: str = Field(min_length=1)
    videoId: str = Field(min_length=1)


class ReorderBody(BaseModel):
    playlistId: str = Field(min_length=1)
    orderedVideoIds: list[str] | None = None
    orderedPlaylistItemIds: list[str] | None = None


app = FastAPI(title="yt-cutup youtube api", version="2.0.0")


def get_frontend_origin() -> str:
    return os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_frontend_origin()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(ApiError)
async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
    )


def enforce_write_rate_limit(request: Request, action: str) -> None:
    now = time.time()
    key = f"{request.client.host if request.client else 'unknown'}:{action}"
    bucket = write_rate_limit[key]

    while bucket and (now - bucket[0]) > WRITE_RATE_LIMIT_WINDOW_SEC:
        bucket.popleft()

    if len(bucket) >= WRITE_RATE_LIMIT_MAX_CALLS:
        raise ApiError(429, "rate_limited", "Write rate limit exceeded. Please retry later.")

    bucket.append(now)


def get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ApiError(500, "missing_env", f"Missing required environment variable: {name}")
    return value


def get_api_key() -> str:
    return get_required_env("YOUTUBE_API_KEY")


def get_oauth_flow(state: str | None = None) -> Flow:
    client_id = get_required_env("GOOGLE_CLIENT_ID")
    client_secret = get_required_env("GOOGLE_CLIENT_SECRET")
    redirect_url = get_required_env("OAUTH_REDIRECT_URL")

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=[YOUTUBE_SCOPE],
        state=state,
    )
    flow.redirect_uri = redirect_url
    return flow


def ensure_tokens_dir() -> None:
    TOKENS_DIR.mkdir(parents=True, exist_ok=True)


def save_credentials(creds: Credentials) -> None:
    ensure_tokens_dir()
    payload = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or []),
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }
    TOKEN_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_credentials() -> Credentials | None:
    if not TOKEN_FILE.exists():
        return None

    try:
        payload = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        creds = Credentials.from_authorized_user_info(payload, scopes=[YOUTUBE_SCOPE])
    except Exception as exc:
        raise ApiError(500, "token_read_error", f"Failed to load oauth token file: {exc}")

    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(GoogleAuthRequest())
            save_credentials(creds)
        except Exception as exc:
            raise ApiError(401, "token_refresh_failed", f"OAuth token refresh failed: {exc}")

    if not creds.valid:
        return None

    return creds


def clear_credentials() -> None:
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()


def parse_iso8601_duration_to_seconds(duration: str) -> int:
    match = ISO_DURATION_RE.match(duration)
    if not match:
        return 0

    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes") or 0)
    seconds = int(match.group("seconds") or 0)
    return (hours * 3600) + (minutes * 60) + seconds


def pick_best_thumb(snippet: dict[str, Any]) -> str:
    thumbnails = (snippet.get("thumbnails") or {})
    for key in ("high", "medium", "default"):
        thumb = thumbnails.get(key)
        if isinstance(thumb, dict) and thumb.get("url"):
            return str(thumb["url"])
    return ""


async def youtube_get(client: httpx.AsyncClient, path: str, params: dict[str, Any], bearer_token: str | None = None) -> dict[str, Any]:
    headers: dict[str, str] = {}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    response = await client.get(f"{YOUTUBE_API_BASE}/{path}", params=params, headers=headers)
    if response.status_code >= 400:
        raise ApiError(
            502,
            "youtube_api_error",
            f"YouTube API request failed for {path}",
            {"status": response.status_code, "body": response.text},
        )

    return response.json()


async def youtube_post(
    client: httpx.AsyncClient,
    path: str,
    params: dict[str, Any],
    body: dict[str, Any],
    bearer_token: str,
) -> dict[str, Any]:
    response = await client.post(
        f"{YOUTUBE_API_BASE}/{path}",
        params=params,
        json=body,
        headers={"Authorization": f"Bearer {bearer_token}"},
    )
    if response.status_code >= 400:
        raise ApiError(
            502,
            "youtube_api_error",
            f"YouTube API POST failed for {path}",
            {"status": response.status_code, "body": response.text},
        )

    return response.json()


async def youtube_put(
    client: httpx.AsyncClient,
    path: str,
    params: dict[str, Any],
    body: dict[str, Any],
    bearer_token: str,
) -> dict[str, Any]:
    response = await client.put(
        f"{YOUTUBE_API_BASE}/{path}",
        params=params,
        json=body,
        headers={"Authorization": f"Bearer {bearer_token}"},
    )
    if response.status_code >= 400:
        raise ApiError(
            502,
            "youtube_api_error",
            f"YouTube API PUT failed for {path}",
            {"status": response.status_code, "body": response.text},
        )

    return response.json()


async def youtube_delete(client: httpx.AsyncClient, path: str, params: dict[str, Any], bearer_token: str) -> None:
    response = await client.delete(
        f"{YOUTUBE_API_BASE}/{path}",
        params=params,
        headers={"Authorization": f"Bearer {bearer_token}"},
    )
    if response.status_code >= 400:
        raise ApiError(
            502,
            "youtube_api_error",
            f"YouTube API DELETE failed for {path}",
            {"status": response.status_code, "body": response.text},
        )


async def fetch_video_durations(
    client: httpx.AsyncClient,
    video_ids: list[str],
    api_key: str,
) -> dict[str, int]:
    if not video_ids:
        return {}

    payload = await youtube_get(
        client,
        "videos",
        {
            "part": "contentDetails",
            "id": ",".join(video_ids),
            "maxResults": min(len(video_ids), 50),
            "key": api_key,
        },
    )

    durations: dict[str, int] = {}
    for item in payload.get("items", []):
        video_id = item.get("id")
        if isinstance(video_id, str):
            durations[video_id] = parse_iso8601_duration_to_seconds(str((item.get("contentDetails") or {}).get("duration") or ""))

    return durations


def normalize_video_item(item: dict[str, Any], duration_sec: int | None = None) -> dict[str, Any]:
    snippet = item.get("snippet") or {}
    video_id = item.get("id")

    if isinstance(video_id, dict):
        video_id = video_id.get("videoId")

    if not isinstance(video_id, str):
        raise ApiError(502, "youtube_parse_error", "Unable to extract video id from YouTube response")

    if duration_sec is None:
        duration_sec = parse_iso8601_duration_to_seconds(str((item.get("contentDetails") or {}).get("duration") or ""))

    return {
        "videoId": video_id,
        "title": str(snippet.get("title") or ""),
        "channelTitle": str(snippet.get("channelTitle") or ""),
        "publishedAt": str(snippet.get("publishedAt") or ""),
        "thumbUrl": pick_best_thumb(snippet),
        "durationSec": duration_sec,
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


def extract_bearer_token() -> str:
    creds = load_credentials()
    if not creds or not creds.token:
        raise ApiError(401, "unauthorized", "OAuth login required for this endpoint")
    return creds.token


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/youtube/search")
async def youtube_search(
    q: str = Query(..., min_length=1),
    max: int = Query(10, ge=1, le=50),
    pageToken: str | None = Query(default=None),
) -> dict[str, Any]:
    api_key = get_api_key()
    params: dict[str, Any] = {
        "part": "snippet",
        "type": "video",
        "q": q,
        "maxResults": max,
        "key": api_key,
    }
    if pageToken:
        params["pageToken"] = pageToken

    async with httpx.AsyncClient(timeout=20.0) as client:
        payload = await youtube_get(client, "search", params)
        raw_items = payload.get("items", [])
        video_ids = [
            item.get("id", {}).get("videoId")
            for item in raw_items
            if isinstance(item.get("id", {}).get("videoId"), str)
        ]
        duration_map = await fetch_video_durations(client, video_ids, api_key)

    items = [
        normalize_video_item(item, duration_map.get(item.get("id", {}).get("videoId"), 0))
        for item in raw_items
        if isinstance(item.get("id", {}).get("videoId"), str)
    ]

    return {"items": items, "nextPageToken": payload.get("nextPageToken")}


@app.get("/api/youtube/video")
async def youtube_video(videoId: str = Query(..., min_length=1)) -> dict[str, Any]:
    api_key = get_api_key()

    async with httpx.AsyncClient(timeout=20.0) as client:
        payload = await youtube_get(
            client,
            "videos",
            {
                "part": "snippet,contentDetails",
                "id": videoId,
                "maxResults": 1,
                "key": api_key,
            },
        )

    items = payload.get("items", [])
    if not items:
        raise ApiError(404, "not_found", "Video not found")

    return normalize_video_item(items[0])


@app.get("/api/auth/login")
async def auth_login() -> RedirectResponse:
    state = uuid.uuid4().hex
    state_store[state] = time.time() + 600

    flow = get_oauth_flow(state=state)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return RedirectResponse(auth_url)


@app.get("/api/auth/callback")
async def auth_callback(code: str, state: str) -> RedirectResponse:
    expiry = state_store.get(state)
    if not expiry or expiry < time.time():
        raise ApiError(400, "invalid_state", "OAuth state is invalid or expired")
    del state_store[state]

    flow = get_oauth_flow(state=state)
    try:
        flow.fetch_token(code=code)
    except Exception as exc:
        raise ApiError(400, "oauth_exchange_failed", f"Failed exchanging OAuth code: {exc}")

    save_credentials(flow.credentials)
    frontend_origin = get_frontend_origin()
    return RedirectResponse(f"{frontend_origin}/?auth=connected")


@app.get("/api/auth/status")
async def auth_status() -> dict[str, Any]:
    creds = load_credentials()
    if not creds:
        return {"authenticated": False}

    return {
        "authenticated": True,
        "hasRefreshToken": bool(creds.refresh_token),
        "scopes": list(creds.scopes or []),
        "tokenExpiry": creds.expiry.isoformat() if creds.expiry else None,
    }


@app.post("/api/auth/logout")
async def auth_logout() -> dict[str, bool]:
    clear_credentials()
    return {"ok": True}


@app.get("/api/youtube/playlists")
async def youtube_playlists(
    mine: bool = Query(True),
    pageToken: str | None = Query(default=None),
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "part": "snippet,contentDetails,status",
        "maxResults": 50,
    }

    if pageToken:
        params["pageToken"] = pageToken

    bearer = None
    if mine:
        bearer = extract_bearer_token()
        params["mine"] = "true"
    else:
        params["key"] = get_api_key()

    async with httpx.AsyncClient(timeout=20.0) as client:
        payload = await youtube_get(client, "playlists", params, bearer_token=bearer)

    items = []
    for item in payload.get("items", []):
        snippet = item.get("snippet") or {}
        status = item.get("status") or {}
        details = item.get("contentDetails") or {}
        items.append(
            {
                "playlistId": str(item.get("id") or ""),
                "title": str(snippet.get("title") or ""),
                "description": str(snippet.get("description") or ""),
                "privacyStatus": str(status.get("privacyStatus") or ""),
                "itemCount": int(details.get("itemCount") or 0),
                "thumbUrl": pick_best_thumb(snippet),
            }
        )

    return {"items": items, "nextPageToken": payload.get("nextPageToken")}


async def fetch_playlist_items_all(
    playlist_id: str,
    use_oauth: bool,
) -> dict[str, Any]:
    bearer = extract_bearer_token() if use_oauth else None
    api_key = None if use_oauth else get_api_key()

    items: list[dict[str, Any]] = []
    next_page: str | None = None
    playlist_meta: dict[str, Any] | None = None

    async with httpx.AsyncClient(timeout=20.0) as client:
        while True:
            params: dict[str, Any] = {
                "part": "snippet,contentDetails,status",
                "playlistId": playlist_id,
                "maxResults": 50,
            }
            if next_page:
                params["pageToken"] = next_page
            if api_key:
                params["key"] = api_key

            payload = await youtube_get(client, "playlistItems", params, bearer_token=bearer)

            if playlist_meta is None:
                playlist_meta = {
                    "etag": payload.get("etag"),
                    "title": "",
                    "description": "",
                    "privacyStatus": "unknown",
                }

            for item in payload.get("items", []):
                snippet = item.get("snippet") or {}
                status = item.get("status") or {}
                resource = snippet.get("resourceId") or {}

                items.append(
                    {
                        "playlistItemId": str(item.get("id") or ""),
                        "videoId": str(resource.get("videoId") or ""),
                        "title": str(snippet.get("title") or ""),
                        "channelTitle": str(snippet.get("videoOwnerChannelTitle") or snippet.get("channelTitle") or ""),
                        "publishedAt": str(snippet.get("publishedAt") or ""),
                        "thumbUrl": pick_best_thumb(snippet),
                        "position": int(snippet.get("position") or 0),
                    }
                )

                if playlist_meta["title"] == "":
                    playlist_meta["title"] = str(snippet.get("playlistTitle") or "")
                if playlist_meta["privacyStatus"] == "unknown":
                    playlist_meta["privacyStatus"] = str(status.get("privacyStatus") or "unknown")

            next_page = payload.get("nextPageToken")
            if not next_page:
                break

    items.sort(key=lambda i: i["position"])
    return {
        "playlistId": playlist_id,
        "etag": playlist_meta.get("etag") if playlist_meta else "",
        "title": playlist_meta.get("title") if playlist_meta else "",
        "description": playlist_meta.get("description") if playlist_meta else "",
        "privacyStatus": playlist_meta.get("privacyStatus") if playlist_meta else "unknown",
        "items": items,
    }


@app.get("/api/youtube/playlistItems")
async def youtube_playlist_items(playlistId: str = Query(..., min_length=1)) -> dict[str, Any]:
    # Try API key first for public playlists.
    try:
        return await fetch_playlist_items_all(playlistId, use_oauth=False)
    except ApiError as exc:
        if exc.status_code == 502 and "403" in json.dumps(exc.details or {}):
            return await fetch_playlist_items_all(playlistId, use_oauth=True)
        raise


@app.post("/api/youtube/playlists")
async def create_playlist(request: Request, body: PlaylistCreateBody) -> dict[str, Any]:
    enforce_write_rate_limit(request, "create_playlist")
    bearer = extract_bearer_token()

    async with httpx.AsyncClient(timeout=20.0) as client:
        payload = await youtube_post(
            client,
            "playlists",
            {"part": "snippet,status"},
            {
                "snippet": {
                    "title": body.title,
                    "description": body.description,
                },
                "status": {"privacyStatus": body.privacyStatus},
            },
            bearer,
        )

    playlist_id = str(payload.get("id") or "")
    if not playlist_id:
        raise ApiError(502, "youtube_parse_error", "Playlist created but id missing")

    return {
        "playlistId": playlist_id,
        "url": f"https://www.youtube.com/playlist?list={playlist_id}",
    }


@app.post("/api/youtube/playlistItems")
async def add_playlist_item(request: Request, body: PlaylistItemCreateBody) -> dict[str, Any]:
    enforce_write_rate_limit(request, "add_playlist_item")
    bearer = extract_bearer_token()

    async with httpx.AsyncClient(timeout=20.0) as client:
        payload = await youtube_post(
            client,
            "playlistItems",
            {"part": "snippet"},
            {
                "snippet": {
                    "playlistId": body.playlistId,
                    "resourceId": {
                        "kind": "youtube#video",
                        "videoId": body.videoId,
                    },
                }
            },
            bearer,
        )

    snippet = payload.get("snippet") or {}
    return {
        "playlistItemId": str(payload.get("id") or ""),
        "position": int(snippet.get("position") or 0),
    }


@app.delete("/api/youtube/playlistItems/{playlistItemId}")
async def delete_playlist_item(request: Request, playlistItemId: str) -> dict[str, bool]:
    enforce_write_rate_limit(request, "delete_playlist_item")
    bearer = extract_bearer_token()

    async with httpx.AsyncClient(timeout=20.0) as client:
        await youtube_delete(client, "playlistItems", {"id": playlistItemId}, bearer)

    return {"ok": True}


@app.post("/api/youtube/playlistItems/reorder")
async def reorder_playlist_items(request: Request, body: ReorderBody) -> dict[str, Any]:
    enforce_write_rate_limit(request, "reorder_playlist_items")

    ordered_playlist_item_ids = body.orderedPlaylistItemIds or []
    ordered_video_ids = body.orderedVideoIds or []
    if not ordered_playlist_item_ids and not ordered_video_ids:
        raise ApiError(400, "invalid_request", "Provide orderedPlaylistItemIds or orderedVideoIds")

    target_size = len(ordered_playlist_item_ids or ordered_video_ids)
    if target_size > REORDER_MAX_BATCH:
        raise ApiError(400, "batch_too_large", f"Reorder batch exceeds REORDER_MAX_BATCH={REORDER_MAX_BATCH}")

    current = await fetch_playlist_items_all(body.playlistId, use_oauth=True)
    current_items = current["items"]

    by_item_id = {item["playlistItemId"]: item for item in current_items}
    by_video_id = {item["videoId"]: item for item in current_items}

    if ordered_playlist_item_ids:
        reordered = [by_item_id[item_id] for item_id in ordered_playlist_item_ids if item_id in by_item_id]
        missing_count = len(ordered_playlist_item_ids) - len(reordered)
    else:
        reordered = [by_video_id[video_id] for video_id in ordered_video_ids if video_id in by_video_id]
        missing_count = len(ordered_video_ids) - len(reordered)

    # append untouched items to preserve full order
    seen_ids = {item["playlistItemId"] for item in reordered}
    reordered.extend([item for item in current_items if item["playlistItemId"] not in seen_ids])

    warnings: list[str] = []
    if missing_count > 0:
        warnings.append(f"Skipped {missing_count} ids not found in playlist")

    bearer = extract_bearer_token()
    used_rebuild = False
    progress = {"total": len(reordered), "processed": 0}

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            for index, item in enumerate(reordered):
                await youtube_put(
                    client,
                    "playlistItems",
                    {"part": "snippet"},
                    {
                        "id": item["playlistItemId"],
                        "snippet": {
                            "playlistId": body.playlistId,
                            "resourceId": {
                                "kind": "youtube#video",
                                "videoId": item["videoId"],
                            },
                            "position": index,
                        },
                    },
                    bearer,
                )
                progress["processed"] = index + 1
        except ApiError as exc:
            if not REORDER_ALLOW_REBUILD:
                warnings.append("Position update failed and rebuild fallback disabled.")
                raise ApiError(exc.status_code, exc.code, exc.message, {"warnings": warnings, "progress": progress})

            used_rebuild = True
            warnings.append("playlistItems.update failed; used delete+reinsert rebuild fallback")

            # rebuild in desired order
            for item in current_items:
                await youtube_delete(client, "playlistItems", {"id": item["playlistItemId"]}, bearer)

            progress["processed"] = 0
            for index, item in enumerate(reordered):
                await youtube_post(
                    client,
                    "playlistItems",
                    {"part": "snippet"},
                    {
                        "snippet": {
                            "playlistId": body.playlistId,
                            "resourceId": {
                                "kind": "youtube#video",
                                "videoId": item["videoId"],
                            },
                        }
                    },
                    bearer,
                )
                progress["processed"] = index + 1

    return {
        "usedRebuild": used_rebuild,
        "warnings": warnings,
        "progress": progress,
    }
