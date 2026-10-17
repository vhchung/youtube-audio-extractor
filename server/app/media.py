"""Tìm ffmpeg và chuyển đổi sang wav/mp3/aac."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable

from .common import CREATE_NO_WINDOW, JobCancelled, MediaError

log = logging.getLogger("ytaudio.media")

_ffmpeg_cache: str | None = None


def find_ffmpeg() -> str:
    """Dò ffmpeg theo thứ tự: FFMPEG_PATH -> PATH hệ thống -> imageio-ffmpeg."""
    global _ffmpeg_cache
    if _ffmpeg_cache:
        return _ffmpeg_cache

    env_path = os.environ.get("FFMPEG_PATH")
    if env_path and Path(env_path).is_file():
        _ffmpeg_cache = env_path
        return env_path

    which = shutil.which("ffmpeg")
    if which:
        _ffmpeg_cache = which
        return which

    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            _ffmpeg_cache = bundled
            return bundled
    except Exception as exc:  # noqa: BLE001
        log.warning("imageio-ffmpeg không dùng được: %s", exc)

    raise MediaError(
        "Không tìm thấy ffmpeg. Cài ffmpeg vào PATH hoặc đặt biến FFMPEG_PATH."
    )


def convert(
    input_path: Path,
    output_path: Path,
    fmt: str,
    quality: str,
    *,
    register_proc: Callable[[subprocess.Popen], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> Path:
    """Encode file audio đầu vào thành wav/mp3/aac theo chất lượng chọn."""
    ffmpeg = find_ffmpeg()
    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(input_path)]

    if fmt == "wav":
        args += ["-vn", "-c:a", "pcm_s16le", "-ar", quality]
    elif fmt == "mp3":
        args += ["-vn", "-c:a", "libmp3lame", "-b:a", f"{quality}k"]
    elif fmt == "aac":
        args += ["-vn", "-c:a", "aac", "-b:a", f"{quality}k"]
    else:
        raise MediaError(f"Định dạng không hỗ trợ: {fmt}")

    args.append(str(output_path))

    proc = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=CREATE_NO_WINDOW,
    )
    if register_proc:
        register_proc(proc)
    _, stderr = proc.communicate()

    if should_cancel and should_cancel():
        output_path.unlink(missing_ok=True)
        raise JobCancelled()
    if proc.returncode != 0:
        detail = (stderr or b"").decode("utf-8", "replace").strip()[-400:]
        raise MediaError(f"ffmpeg lỗi (code {proc.returncode}): {detail}")
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise MediaError("ffmpeg không tạo được file đầu ra")
    return output_path
