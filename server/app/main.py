"""FastAPI sidecar: metadata, extract job, tiến trình và tải file kết quả."""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import FileResponse

from .common import LiveVideoError
from .jobs import JobManager, JobNotFound
from .voice import demucs_available
from .yt import get_metadata, is_valid_youtube_url

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("ytaudio")

app = FastAPI(title="YouTube Audio Extract sidecar", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # chỉ bind 127.0.0.1, dùng nội bộ
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = JobManager()


class ExtractRequest(BaseModel):
    url: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    format: str = "mp3"
    quality: str = "192"
    voice_only: bool = False
    title: str = ""


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "voice_available": demucs_available()}


@app.get("/api/metadata")
def metadata(url: str = Query(...)) -> dict:
    if not is_valid_youtube_url(url):
        raise HTTPException(status_code=400, detail="URL YouTube không hợp lệ")
    try:
        return get_metadata(url)
    except LiveVideoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/extract")
def extract(req: ExtractRequest) -> dict:
    if not is_valid_youtube_url(req.url):
        raise HTTPException(status_code=400, detail="URL YouTube không hợp lệ")
    try:
        job = manager.create(
            url=req.url,
            start=req.start,
            end=req.end,
            fmt=req.format,
            quality=req.quality,
            voice_only=req.voice_only,
            title=req.title or "youtube_audio",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"job_id": job.id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    try:
        return manager.get(job_id).snapshot()
    except JobNotFound as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy job") from exc


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str) -> dict:
    try:
        return manager.cancel(job_id).snapshot()
    except JobNotFound as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy job") from exc


@app.get("/api/jobs/{job_id}/file")
def job_file(job_id: str) -> FileResponse:
    """Dùng cho chế độ chạy trong trình duyệt (không có Tauri IPC)."""
    try:
        job = manager.get(job_id)
    except JobNotFound as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy job") from exc
    if job.status != "done" or not job.output_path:
        raise HTTPException(status_code=409, detail="Job chưa hoàn tất")
    return FileResponse(path=job.output_path, filename=job.output_name)
