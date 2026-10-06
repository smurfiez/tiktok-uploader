"""
Tests the MCP server's tools without starting a browser
"""

import datetime
import logging
import os
from unittest.mock import MagicMock, patch

import pytz
from mcp.server.mcpserver.exceptions import ToolError
from pytest import MonkeyPatch, raises

from tiktok_uploader import mcp_server


def _video(tmp_path, name: str = "26-10-07_KevwT-dFgBI_Dance_Cover.mp4") -> str:
    video = tmp_path / name
    video.write_text("")
    return str(video)


def _cookies(tmp_path, monkeypatch: MonkeyPatch) -> None:
    cookies = tmp_path / "cookies.txt"
    cookies.write_text("")
    monkeypatch.setenv("TIKTOK_COOKIES", str(cookies))


def test_list_videos_newest_first_with_titles(tmp_path) -> None:
    old = _video(tmp_path, "26-10-07_aaaaaaaaaaa_Old_one.mp4")
    new = _video(tmp_path, "26-10-07_bbbbbbbbbbb_New_one.mp4")
    (tmp_path / "26-10-07_bbbbbbbbbbb_New_one.txt").write_text("새로운 #dance")
    (tmp_path / "notes.md").write_text("")
    os.utime(old, (1, 1))

    assert mcp_server.list_videos(str(tmp_path)) == [
        {"path": new, "title": "새로운 #dance"},
        {"path": old, "title": "Old one"},
    ]


def test_upload_rejects_scheduled_draft(tmp_path, monkeypatch: MonkeyPatch) -> None:
    _cookies(tmp_path, monkeypatch)

    with raises(ToolError, match="draft"):
        mcp_server.upload_video(
            _video(tmp_path), draft=True, schedule="2026-10-16 18:30"
        )


def test_upload_needs_cookies(tmp_path, monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("TIKTOK_COOKIES", raising=False)

    with raises(ToolError, match="TIKTOK_COOKIES"):
        mcp_server.upload_video(_video(tmp_path), description="hi")


def test_upload_rejects_schedule_out_of_range(
    tmp_path, monkeypatch: MonkeyPatch
) -> None:
    _cookies(tmp_path, monkeypatch)
    too_late = datetime.datetime.now(pytz.UTC) + datetime.timedelta(days=11)

    with raises(ToolError, match="10 days"):
        mcp_server.upload_video(
            _video(tmp_path), schedule=too_late.strftime("%Y-%m-%d %H:%M")
        )


@patch("tiktok_uploader.mcp_server.auto_caption", return_value="Generated #dance")
@patch("tiktok_uploader.mcp_server.TikTokUploader")
def test_upload_writes_caption_and_passes_options(
    mock_uploader_class: MagicMock,
    mock_caption: MagicMock,
    tmp_path,
    monkeypatch: MonkeyPatch,
) -> None:
    _cookies(tmp_path, monkeypatch)
    uploader = mock_uploader_class.return_value.__enter__.return_value
    uploader.upload_video.return_value = True
    video = _video(tmp_path)

    result = mcp_server.upload_video(video, draft=True, visibility="only_you")

    assert result["description"] == "Generated #dance"
    assert mock_uploader_class.call_args.kwargs["headless"] is True
    kwargs = uploader.upload_video.call_args.kwargs
    assert kwargs["filename"] == video
    assert kwargs["description"] == "Generated #dance"
    assert kwargs["draft"] is True
    assert kwargs["visibility"] == "only_you"


@patch("tiktok_uploader.mcp_server.auto_caption")
@patch("tiktok_uploader.mcp_server.TikTokUploader")
def test_upload_keeps_given_description_and_reports_failure(
    mock_uploader_class: MagicMock,
    mock_caption: MagicMock,
    tmp_path,
    monkeypatch: MonkeyPatch,
) -> None:
    _cookies(tmp_path, monkeypatch)
    uploader = mock_uploader_class.return_value.__enter__.return_value

    def failing_upload(**kwargs) -> bool:
        logging.getLogger("tiktok_uploader.upload").error("Failed to set schedule")
        return False

    uploader.upload_video.side_effect = failing_upload

    with raises(ToolError, match="Failed to set schedule"):
        mcp_server.upload_video(_video(tmp_path), description="My own #title")

    mock_caption.assert_not_called()
    assert uploader.upload_video.call_args.kwargs["description"] == "My own #title"


@patch("tiktok_uploader.mcp_server.TikTokUploader")
def test_upload_reports_crashes_as_tool_errors(
    mock_uploader_class: MagicMock, tmp_path, monkeypatch: MonkeyPatch
) -> None:
    _cookies(tmp_path, monkeypatch)
    mock_uploader_class.return_value.__enter__.side_effect = Exception(
        "cookies expired"
    )

    with raises(ToolError, match="cookies expired"):
        mcp_server.upload_video(_video(tmp_path), description="hi")
