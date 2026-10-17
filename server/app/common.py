"""Định dạng chung, lỗi và hằng số dùng chung cho sidecar."""

from __future__ import annotations

import subprocess


class JobCancelled(Exception):
    """Người dùng đã hủy job."""


class MediaError(RuntimeError):
    """Lỗi liên quan ffmpeg / chuyển định dạng."""


class LiveVideoError(ValueError):
    """Video đang phát trực tiếp, không hỗ trợ trích xuất."""


# Trọng số tiến trình tổng của từng giai đoạn (tổng = 1.0)
STAGE_WEIGHTS = {
    "downloading": (0.0, 0.45),
    "separating": (0.45, 0.85),
    "converting": (0.85, 1.0),
}

VALID_FORMATS = ("wav", "mp3", "aac")
BITRATE_QUALITIES = ("128", "192", "256", "320")  # kbps, cho mp3/aac
WAV_SAMPLE_RATES = ("44100", "48000")  # Hz, cho wav

# Windows: không mở cửa sổ console cho subprocess
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
