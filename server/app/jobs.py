"""Quản lý job trích xuất: tạo, chạy nền, báo tiến trình, hủy."""

from __future__ import annotations

import logging
import re
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from . import media, voice, yt
from .common import (
    BITRATE_QUALITIES,
    STAGE_WEIGHTS,
    VALID_FORMATS,
    WAV_SAMPLE_RATES,
    JobCancelled,
    MediaError,
)

log = logging.getLogger("ytaudio.jobs")


class JobNotFound(KeyError):
    pass


def _fmt_range(seconds: float) -> str:
    seconds = int(seconds)
    m, s = divmod(seconds, 60)
    return f"{m:02d}{s:02d}"


def _safe_name(title: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", title).strip()
    name = re.sub(r"\s+", "_", name)
    return name[:60] or "youtube_audio"


@dataclass
class Job:
    id: str
    url: str
    start: float
    end: float
    format: str
    quality: str
    voice_only: bool
    title: str
    status: str = "queued"  # queued | running | done | error | cancelled
    stage: str = ""
    stage_frac: float = 0.0
    detail: str = ""
    error: str = ""
    output_path: str = ""
    output_name: str = ""
    created_at: float = field(default_factory=time.time)
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    proc: subprocess.Popen | None = field(default=None, repr=False)

    @property
    def progress(self) -> float:
        if self.status == "done":
            return 1.0
        lo, hi = STAGE_WEIGHTS.get(self.stage, (0.0, 0.0))
        return lo + (hi - lo) * self.stage_frac

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "id": self.id,
                "status": self.status,
                "stage": self.stage,
                "progress": round(self.progress, 3),
                "detail": self.detail,
                "error": self.error,
                "output_path": self.output_path,
                "output_name": self.output_name,
                "voice_only": self.voice_only,
                "cancel_requested": self.cancel_requested,
            }


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    # -- API ----------------------------------------------------------------

    def create(
        self,
        *,
        url: str,
        start: float,
        end: float,
        fmt: str,
        quality: str,
        voice_only: bool,
        title: str,
    ) -> Job:
        if fmt not in VALID_FORMATS:
            raise ValueError(f"Định dạng không hỗ trợ: {fmt}")
        expected = WAV_SAMPLE_RATES if fmt == "wav" else BITRATE_QUALITIES
        if quality not in expected:
            raise ValueError(f"Chất lượng không hợp lệ cho {fmt}: {quality}")
        if end <= start:
            raise ValueError("Thời điểm kết thúc phải sau thời điểm bắt đầu")
        if end - start < 1:
            raise ValueError("Đoạn trích xuất phải dài ít nhất 1 giây")

        job = Job(
            id=uuid.uuid4().hex[:12],
            url=url,
            start=start,
            end=end,
            format=fmt,
            quality=quality,
            voice_only=voice_only,
            title=title,
        )
        with self._lock:
            self._jobs[job.id] = job
        threading.Thread(target=self._run, args=(job,), daemon=True, name=f"job-{job.id}").start()
        return job

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
        if not job:
            raise JobNotFound(job_id)
        return job

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        with job.lock:
            if job.status in ("done", "error", "cancelled"):
                return job
            job.cancel_requested = True
            proc = job.proc
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass
        return job

    # -- Pipeline ------------------------------------------------------------

    def _set_stage(self, job: Job, stage: str, detail: str = "") -> None:
        with job.lock:
            job.stage = stage
            job.stage_frac = 0.0
            job.detail = detail

    def _set_frac(self, job: Job, frac: float) -> None:
        with job.lock:
            job.stage_frac = max(0.0, min(frac, 1.0))

    def _register_proc(self, job: Job, proc: subprocess.Popen) -> None:
        with job.lock:
            if job.cancel_requested and proc.poll() is None:
                proc.kill()
            job.proc = proc

    def _run(self, job: Job) -> None:
        with job.lock:
            if job.cancel_requested:
                job.status = "cancelled"
                return
            job.status = "running"

        work = Path(tempfile.gettempdir()) / "ytae" / job.id
        try:
            work.mkdir(parents=True, exist_ok=True)

            # 1) Tải đúng đoạn
            self._set_stage(job, "downloading", "Đang tải đoạn đã chọn...")
            src = yt.download_section(
                job.url,
                job.start,
                job.end,
                work,
                on_progress=lambda frac: self._set_frac(job, frac),
                should_cancel=lambda: job.cancel_requested,
            )

            # 2) Tách lời thoại (optional)
            current = src
            if job.voice_only:
                if job.cancel_requested:
                    raise JobCancelled()
                # demucs không đọc được mọi container (webm/opus...) và cần
                # ffmpeg trên PATH để fallback — chuyển sang wav trước.
                self._set_stage(job, "separating", "Đang chuẩn bị audio cho Demucs...")
                demucs_in = work / "for_demucs.wav"
                media.convert(
                    src,
                    demucs_in,
                    "wav",
                    "44100",
                    register_proc=lambda p: self._register_proc(job, p),
                    should_cancel=lambda: job.cancel_requested,
                )
                self._set_stage(job, "separating", "Đang tách lời thoại khỏi nhạc nền...")
                current = voice.separate_vocals(
                    demucs_in,
                    work / "stems",
                    clip_seconds=job.end - job.start,
                    register_proc=lambda p: self._register_proc(job, p),
                    should_cancel=lambda: job.cancel_requested,
                    on_progress=lambda frac: self._set_frac(job, frac),
                    on_detail=lambda text: self._set_stage(job, "separating", text),
                )

            # 3) Chuyển định dạng
            if job.cancel_requested:
                raise JobCancelled()
            ext = "wav" if job.format == "wav" else job.format
            out_name = (
                f"{_safe_name(job.title)}__{_fmt_range(job.start)}-{_fmt_range(job.end)}.{ext}"
            )
            self._set_stage(job, "converting", "Đang chuyển đổi định dạng...")
            out = media.convert(
                current,
                work / out_name,
                job.format,
                job.quality,
                register_proc=lambda p: self._register_proc(job, p),
                should_cancel=lambda: job.cancel_requested,
            )

            with job.lock:
                job.output_path = str(out)
                job.output_name = out_name
                job.detail = "Hoàn tất"
                job.status = "done"
        except JobCancelled:
            with job.lock:
                job.status = "cancelled"
                job.detail = "Đã hủy"
        except (MediaError, RuntimeError, ValueError) as exc:
            log.exception("Job %s lỗi", job.id)
            with job.lock:
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.detail = "Đã hủy"
                else:
                    job.error = str(exc)[:500]
                    job.status = "error"
        except Exception as exc:  # noqa: BLE001
            log.exception("Job %s lỗi không xác định", job.id)
            with job.lock:
                job.error = f"Lỗi không xác định: {exc}"[:500]
                job.status = "error"
