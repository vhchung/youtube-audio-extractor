"""Lấy metadata và tải đúng đoạn audio từ YouTube bằng yt-dlp Python API."""

from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Callable

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from .common import JobCancelled, LiveVideoError
from .media import find_ffmpeg


def _section_ranges(start: float, end: float):
    """Callback `download_ranges` cho yt-dlp, tương thích cả bản cũ và mới.

    Bản mới (utils là package) nhận list dict với start_time/end_time;
    bản cũ nhận list DownloadRange(start, end).
    """
    def callback(info, ydl):  # noqa: ANN001, ANN202
        try:
            from yt_dlp.utils import DownloadRange

            return [DownloadRange(start, end)]
        except ImportError:
            return [{"start_time": start, "end_time": end}]

    return callback


def _announce_ffmpeg(ffmpeg: str) -> None:
    """Báo vị trí ffmpeg cho yt-dlp qua cả param lẫn contextvar.

    FFmpegFD.available() dựng FFmpegPostProcessor() không kèm downloader nên
    không đọc được param `ffmpeg_location` — nó đọc contextvar. Bản yt-dlp cũ
    không có contextvar thì bỏ qua.
    """
    try:
        from yt_dlp.postprocessor.ffmpeg import FFmpegPostProcessor

        FFmpegPostProcessor._ffmpeg_location.set(ffmpeg)
    except (ImportError, AttributeError):
        pass

log = logging.getLogger("ytaudio.yt")

_YT_RE = re.compile(
    r"^https?://(?:www\.|m\.|music\.)?"
    r"(?:youtube\.com/(?:watch\?[^#\s]*v=|shorts/|live/|embed/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})",
    re.IGNORECASE,
)

_meta_cache: dict[str, dict] = {}
_meta_lock = threading.Lock()
_META_CACHE_MAX = 50

# Lỗi mà client di động (android) thường vượt qua được: video chặn web/tv
# client (UNPLAYABLE "not available") hoặc yêu cầu xác minh robot.
_RETRYABLE_RE = re.compile(
    r"not available|sign in to (?:confirm|continue)|you'?re not a robot"
    r"|log ?in required|confirm you'?re not a bot",
    re.IGNORECASE,
)
_FALLBACK_EXTRACTOR_ARGS = {"youtube": {"player_client": ["android", "android_vr"]}}


def extract_video_id(url: str) -> str | None:
    m = _YT_RE.match(url.strip())
    return m.group(1) if m else None


def is_valid_youtube_url(url: str) -> bool:
    return extract_video_id(url) is not None


def _clean_ytdlp_error(exc: Exception) -> str:
    """Rút gọn thông báo lỗi nhiều dòng của yt-dlp để hiển thị trên UI."""
    msg = str(exc)
    if match := re.search(r"ERROR:\s*(.+)", msg, re.DOTALL):
        msg = match.group(1)
    msg = msg.strip().splitlines()[0] if msg.strip() else exc.__class__.__name__
    return msg[:300]


def get_metadata(url: str) -> dict:
    """Lấy thông tin video (không tải). Có cache theo video ID.

    Nếu client mặc định bị chặn ("not available" / kiểm tra robot), thử lại
    bằng client android trước khi từ bỏ.
    """
    video_id = extract_video_id(url)
    if not video_id:
        raise ValueError("URL YouTube không hợp lệ")

    with _meta_lock:
        cached = _meta_cache.get(video_id)
    if cached is not None:
        return cached

    base_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "socket_timeout": 15,
        "extractor_retries": 2,
    }
    info = None
    last_exc: Exception | None = None
    for attempt_opts in (base_opts, {**base_opts, "extractor_args": _FALLBACK_EXTRACTOR_ARGS}):
        try:
            with YoutubeDL(attempt_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            break
        except DownloadError as exc:
            last_exc = exc
            if _RETRYABLE_RE.search(str(exc)):
                continue
            raise RuntimeError(_clean_ytdlp_error(exc)) from exc
    if info is None and last_exc is not None:
        raise RuntimeError(_clean_ytdlp_error(last_exc)) from last_exc

    if not info:
        raise RuntimeError("Không lấy được thông tin video")
    if info.get("is_live"):
        raise LiveVideoError("Video đang phát trực tiếp — không hỗ trợ trích xuất")

    duration = info.get("duration")
    if not duration or duration <= 0:
        # Một số nguồn không trả duration: chỉ cảnh báo, slider sẽ dùng mốc mặc định
        duration = None

    data = {
        "id": info.get("id") or video_id,
        "title": info.get("title") or "Không rõ tiêu đề",
        "duration": duration,
        "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "is_live": bool(info.get("is_live")),
    }

    with _meta_lock:
        if len(_meta_cache) >= _META_CACHE_MAX:
            oldest = next(iter(_meta_cache))
            _meta_cache.pop(oldest, None)
        _meta_cache[video_id] = data
    return data


def download_section(
    url: str,
    start: float,
    end: float,
    out_dir: Path,
    *,
    on_progress: Callable[[float], None],
    should_cancel: Callable[[], bool],
) -> Path:
    """Tải đúng đoạn [start, end] (giây) ở định dạng bestaudio.

    Trả về đường dẫn file nguồn (m4a/webm/...) trong out_dir.
    Ném JobCancelled nếu người dùng hủy giữa chừng.
    """
    ffmpeg = find_ffmpeg()
    _announce_ffmpeg(ffmpeg)
    out_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(out_dir / "source.%(ext)s")

    def progress_hook(d: dict) -> None:
        if should_cancel():
            raise JobCancelled()
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                on_progress(min(done / total, 1.0))
        elif status == "finished":
            on_progress(1.0)

    opts = {
        "format": "bestaudio/best",
        "download_ranges": _section_ranges(start, end),
        "force_keyframes_at_cuts": True,
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "nopart": True,
        "overwrites": True,
        "progress_hooks": [progress_hook],
        # Trả về đường dẫn file thực thi (binary imageio-ffmpeg không tên
        # "ffmpeg.exe" nên không thể truyền thư mục)
        "ffmpeg_location": ffmpeg,
        "socket_timeout": 20,
        "retries": 3,
    }

    last_exc: Exception | None = None
    for attempt_opts in (opts, {**opts, "extractor_args": _FALLBACK_EXTRACTOR_ARGS}):
        try:
            with YoutubeDL(attempt_opts) as ydl:
                ydl.download([url])
            last_exc = None
            break
        except DownloadError as exc:
            last_exc = exc
            if should_cancel():
                raise JobCancelled() from exc
            if _RETRYABLE_RE.search(str(exc)):
                continue
            raise RuntimeError(_clean_ytdlp_error(exc)) from exc
    if last_exc is not None:
        raise RuntimeError(_clean_ytdlp_error(last_exc)) from last_exc

    files = [
        p
        for p in out_dir.glob("source.*")
        if p.is_file() and p.suffix not in (".part", ".ytdl")
    ]
    if not files:
        raise RuntimeError("Tải xong nhưng không tìm thấy file nguồn")
    return max(files, key=lambda p: p.stat().st_size)
