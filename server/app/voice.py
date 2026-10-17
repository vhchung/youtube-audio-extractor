"""Tách lời thoại khỏi nhạc nền bằng Demucs (htdemucs, two-stems=vocals).

Chạy demucs như subprocess để có thể kill khi người dùng hủy, và tránh nạp
PyTorch trong process của server (tiết kiệm RAM, khởi động nhanh hơn).
"""

from __future__ import annotations

import logging
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable

from .common import CREATE_NO_WINDOW, JobCancelled, MediaError

log = logging.getLogger("ytaudio.voice")


def demucs_available() -> bool:
    try:
        from importlib.util import find_spec

        return find_spec("demucs") is not None
    except Exception:  # noqa: BLE001
        return False


def separate_vocals(
    input_path: Path,
    out_dir: Path,
    *,
    clip_seconds: float,
    register_proc: Callable[[subprocess.Popen], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    on_progress: Callable[[float], None] | None = None,
    on_detail: Callable[[str], None] | None = None,
) -> Path:
    """Trả về đường dẫn stem `vocals.wav` sau khi tách.

    Ước lượng thời gian xử lý theo độ dài đoạn (CPU, htdemucs) để cập nhật
    progress xấp xỉ — demucs không cung cấp progress hook.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "-n",
        "htdemucs",
        "--two-stems",
        "vocals",
        "-o",
        str(out_dir),
        str(input_path),
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=CREATE_NO_WINDOW,
    )
    if register_proc:
        register_proc(proc)

    # Thu output để log và đưa vào thông báo lỗi
    output_lines: list[str] = []

    def reader() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                log.info("[demucs] %s", line)
                output_lines.append(line)

    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()

    # Ước lượng: htdemucs trên CPU xử lý khoảng 5-8x chậm hơn thời lượng thực
    expected = max(20.0, min(900.0, clip_seconds * 6.0))
    start = time.monotonic()
    model_downloading = False

    def watchdog() -> None:
        nonlocal model_downloading
        last_note = 0.0
        while proc.poll() is None:
            elapsed = time.monotonic() - start
            frac = min(elapsed / expected, 0.92)
            if on_progress:
                on_progress(frac)
            # Lần đầu chạy, demucs tải model htdemucs (~80MB) — phản ánh qua detail
            if not model_downloading and elapsed > expected * 0.8 and proc.poll() is None:
                model_downloading = True
                if on_detail:
                    on_detail("Có thể đang tải model htdemucs lần đầu (chỉ mất một lần)...")
            if on_detail and model_downloading and time.monotonic() - last_note > 30:
                last_note = time.monotonic()
                on_detail("Vẫn đang xử lý (lần đầu tải model có thể mất vài phút)...")
            time.sleep(2.0)

    watcher = threading.Thread(target=watchdog, daemon=True)
    watcher.start()
    proc.wait()
    reader_thread.join(timeout=3)

    if should_cancel and should_cancel():
        raise JobCancelled()
    if proc.returncode != 0:
        tail = "\n".join(output_lines[-12:])
        raise MediaError(
            f"Tách lời thoại thất bại (demucs code {proc.returncode}).\n{tail}"
        )

    vocals = out_dir / "htdemucs" / input_path.stem / "vocals.wav"
    if not vocals.is_file():
        raise MediaError(f"Không tìm thấy kết quả tách giọng: {vocals}")
    return vocals
