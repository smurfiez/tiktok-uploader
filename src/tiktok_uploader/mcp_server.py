"""
MCP server for the uploader: list videos, write captions, and post, schedule or
draft videos on TikTok

Configured with environment variables:
- TIKTOK_COOKIES: the Netscape cookies file to log in with (required for uploads)
- the variable named by `api_key_env` in config.toml, for generated captions
"""

import datetime
import logging
import os
import threading
from pathlib import Path
from typing import Literal

import pytz
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from tiktok_uploader.captions import auto_caption, source_title
from tiktok_uploader.upload import (
    TikTokUploader,
    _check_valid_path,
    _check_valid_schedule,
    _get_valid_schedule_minute,
)

server = MCPServer(
    name="tiktok-uploader",
    instructions="Uploads videos to the TikTok account whose cookies the server was "
    + "started with. Without a description, an English caption with hashtags is "
    + "written from the video's .txt title or filename. Posting is public; use "
    + "draft=True or visibility='only_you' when unsure.",
)

# one browser at a time: TikTok sessions do not like parallel uploads
_upload_lock = threading.Lock()


class _LogCapture(logging.Handler):
    """Collects the uploader's log lines so failures can be reported back"""

    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(record.getMessage())


def _last_lines(capture: _LogCapture) -> str:
    return "\nLast log lines:\n" + "\n".join(capture.lines[-8:])


def _video_path(video_path: str) -> str:
    path = str(Path(video_path).expanduser().resolve())
    if not _check_valid_path(path):
        raise ToolError(f"Not a supported video file: {video_path}")
    return path


def _parse_schedule(schedule: str) -> datetime.datetime:
    try:
        parsed = datetime.datetime.strptime(schedule, "%Y-%m-%d %H:%M")
    except ValueError as e:
        raise ToolError("schedule must be a UTC time like '2026-10-16 18:30'") from e

    parsed = _get_valid_schedule_minute(pytz.UTC.localize(parsed), 5)
    if not _check_valid_schedule(parsed):
        raise ToolError(
            "schedule must be at least 20 minutes and at most 10 days in the future"
        )
    return parsed


@server.tool(annotations=ToolAnnotations(read_only_hint=True))
def list_videos(directory: str) -> list[dict[str, str]]:
    """
    Lists the uploadable videos in a directory, newest first, with each video's
    original title (from its .txt sidecar or filename).
    """
    folder = Path(directory).expanduser()
    if not folder.is_dir():
        raise ToolError(f"Not a directory: {directory}")

    videos = sorted(
        (p for p in folder.iterdir() if _check_valid_path(str(p))),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return [{"path": str(p), "title": source_title(str(p))} for p in videos]


@server.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True))
def suggest_caption(video_path: str) -> str:
    """
    Writes an English TikTok caption with hashtags from the video's original title,
    without uploading anything. Falls back to the original title if the caption
    model can not be reached.
    """
    return auto_caption(_video_path(video_path))


@server.tool(
    annotations=ToolAnnotations(
        read_only_hint=False, destructive_hint=False, open_world_hint=True
    )
)
def upload_video(
    video_path: str,
    description: str | None = None,
    schedule: str | None = None,
    draft: bool = False,
    visibility: Literal["everyone", "friends", "only_you"] = "everyone",
) -> dict[str, str | bool | None]:
    """
    Uploads a video to TikTok. Takes one to two minutes.

    - description: the caption, used as given. Leave it out to write an English
      caption with hashtags from the video's original title.
    - schedule: post later instead of now, as a UTC time 'YYYY-MM-DD HH:MM',
      20 minutes to 10 days ahead. Minutes round up to a multiple of 5.
    - draft: save to the account's drafts instead of posting. Can not be scheduled.
    - visibility: who can see the post.
    """
    path = _video_path(video_path)
    if draft and schedule:
        raise ToolError("A draft can not be scheduled")

    cookies = os.environ.get("TIKTOK_COOKIES", "")
    if not cookies or not Path(cookies).expanduser().exists():
        raise ToolError("TIKTOK_COOKIES must point to a cookies file")

    when = _parse_schedule(schedule) if schedule else None
    if description is None:
        description = auto_caption(path)

    capture = _LogCapture()
    package_logger = logging.getLogger("tiktok_uploader")
    with _upload_lock:
        package_logger.addHandler(capture)
        try:
            with TikTokUploader(
                cookies=str(Path(cookies).expanduser()), headless=True
            ) as uploader:
                success = uploader.upload_video(
                    filename=path,
                    description=description,
                    schedule=when,
                    visibility=visibility,
                    draft=draft,
                )
        except Exception as e:
            # e.g. expired cookies: report it instead of a bare "tool crashed"
            raise ToolError(f"Upload failed: {e}{_last_lines(capture)}") from e
        finally:
            package_logger.removeHandler(capture)

    if not success:
        raise ToolError(f"Upload failed.{_last_lines(capture)}")

    return {
        "video": path,
        "description": description,
        "scheduled_for_utc": when.strftime("%Y-%m-%d %H:%M") if when else None,
        "draft": draft,
        "visibility": visibility,
    }


def main() -> None:
    server.run()


if __name__ == "__main__":
    main()
