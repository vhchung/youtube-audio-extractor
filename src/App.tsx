import { useCallback, useEffect, useRef, useState } from "react";
import ExportPanel from "./components/ExportPanel";
import JobProgress from "./components/JobProgress";
import RangeSlider from "./components/RangeSlider";
import UrlInput from "./components/UrlInput";
import VideoPreview from "./components/VideoPreview";
import { ServerClient } from "./lib/server";
import { getServerStatus, isTauri, revealPath, saveAudioFile } from "./lib/tauri";
import type { PlayerControls } from "./lib/ytplayer";
import { clamp } from "./lib/time";
import type { AudioFormat, JobState, VideoMeta } from "./types";
import "./styles.css";

type Phase = "boot" | "input" | "loading-meta" | "ready" | "exporting" | "done";

export default function App() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [serverError, setServerError] = useState<string>("");
  const [client, setClient] = useState<ServerClient | null>(null);

  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string>("");

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [job, setJob] = useState<JobState | null>(null);
  const [jobError, setJobError] = useState<string>("");
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const playerRef = useRef<PlayerControls | null>(null);
  const pollTimer = useRef<number | null>(null);

  // -- Khởi động: chờ sidecar sẵn sàng ---------------------------------------
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const status = await getServerStatus();
      if (stopped) return;
      if (status.ready && status.port) {
        setClient(new ServerClient(`http://127.0.0.1:${status.port}`));
        setPhase((p) => (p === "boot" ? "input" : p));
      } else if (status.error) {
        setServerError(status.error);
        window.setTimeout(poll, 1500);
      } else {
        window.setTimeout(poll, 800);
      }
    };
    poll();
    return () => {
      stopped = true;
    };
  }, []);

  // -- Poll tiến trình job ----------------------------------------------------
  const stopPolling = () => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => {
    if (phase !== "exporting" || !client || !job) return;
    stopPolling();
    pollTimer.current = window.setInterval(async () => {
      try {
        const state = await client.job(job.id);
        setJob(state);
        if (state.status === "done") {
          stopPolling();
          setPhase("done");
        } else if (state.status === "error") {
          stopPolling();
          setJobError(state.error || "Lỗi không rõ nguyên nhân");
          setPhase("ready");
        } else if (state.status === "cancelled") {
          stopPolling();
          setPhase("ready");
        }
      } catch {
        /* tạm lỗi mạng — thử lại lần poll sau */
      }
    }, 500);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, client, job?.id]);

  // -- Nút đánh dấu từ player -------------------------------------------------
  useEffect(() => {
    const handler = (e: Event) => {
      const { kind, time } = (e as CustomEvent).detail as { kind: "start" | "end"; time: number };
      if (!meta?.duration) return;
      if (kind === "start") {
        const s = clamp(time, 0, end - 1);
        setStart(Number(s.toFixed(1)));
      } else {
        const en = clamp(time, start + 1, meta.duration);
        setEnd(Number(en.toFixed(1)));
      }
    };
    window.addEventListener("yt-mark", handler);
    return () => window.removeEventListener("yt-mark", handler);
  }, [meta, start, end]);

  // -- Actions -----------------------------------------------------------------
  const loadMetadata = useCallback(
    async (targetUrl: string) => {
      if (!client) return;
      setPhase("loading-meta");
      setMetaError("");
      setMeta(null);
      setJob(null);
      setJobError("");
      setSavedPath(null);
      try {
        const data = await client.metadata(targetUrl);
        setMeta(data);
        setUrl(targetUrl);
        const duration = data.duration ?? 60;
        setStart(0);
        setEnd(duration);
        setPhase("ready");
      } catch (err) {
        setMetaError(err instanceof Error ? err.message : String(err));
        setPhase("input");
      }
    },
    [client],
  );

  const startExport = async (format: AudioFormat, quality: string, voiceOnly: boolean) => {
    if (!client || !meta) return;
    setJobError("");
    setSavedPath(null);
    try {
      const jobId = await client.extract({
        url,
        start,
        end,
        format,
        quality,
        voiceOnly,
        title: meta.title,
      });
      setJob({
        id: jobId,
        status: "queued",
        stage: "",
        progress: 0,
        detail: "",
        error: "",
        output_path: "",
        output_name: "",
        voice_only: voiceOnly,
        cancel_requested: false,
      });
      setPhase("exporting");
    } catch (err) {
      setJobError(err instanceof Error ? err.message : String(err));
    }
  };

  const cancelJob = async () => {
    if (!client || !job) return;
    try {
      await client.cancel(job.id);
    } catch {
      /* job có thể đã xong */
    }
  };

  const doSave = async () => {
    if (!job) return;
    try {
      const saved = await saveAudioFile(job.output_path, job.output_name);
      if (saved !== null) setSavedPath(saved);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : String(err));
    }
  };

  const doReveal = async () => {
    if (!savedPath) return;
    try {
      await revealPath(savedPath);
    } catch {
      /* bỏ qua */
    }
  };

  const resetToReady = () => {
    setJob(null);
    setSavedPath(null);
    setJobError("");
    setPhase("ready");
  };

  // -- Render ------------------------------------------------------------------
  let body: React.ReactNode;
  if (phase === "boot") {
    body = (
      <div className="center-box">
        <div className="spinner" />
        <p>Đang khởi động môi trường Python (uv)...</p>
        <p className="muted small">Lần đầu chạy có thể mất vài phút để cài dependencies.</p>
        {serverError && <p className="field-error">{serverError}</p>}
      </div>
    );
  } else if (phase === "input" || phase === "loading-meta") {
    body = (
      <div className="center-box">
        <h1 className="hero-title">Trích xuất âm thanh từ YouTube</h1>
        <p className="hero-sub">
          Dán liên kết video, chọn đoạn mong muốn và tải về dưới dạng MP3 / AAC / WAV —
          có thể loại bỏ nhạc nền để chỉ giữ lời thoại.
        </p>
        <UrlInput disabled={phase === "loading-meta"} onSubmit={loadMetadata} initialValue={url} />
        {phase === "loading-meta" && <p className="muted">Đang lấy thông tin video (yt-dlp)...</p>}
        {metaError && <p className="field-error">{metaError}</p>}
      </div>
    );
  } else if (meta) {
    body = (
      <>
        <VideoPreview
          meta={meta}
          onPlayerReady={(controls) => {
            playerRef.current = controls;
          }}
        />
        {phase === "ready" && (
          <>
            {jobError && <p className="field-error banner">{jobError}</p>}
            {meta.duration ? (
              <>
                <RangeSlider
                  duration={meta.duration}
                  start={start}
                  end={end}
                  onChange={(s, e) => {
                    setStart(s);
                    setEnd(e);
                  }}
                  onSeek={(t) => playerRef.current?.seek(t)}
                />
                <ExportPanel start={start} end={end} onExport={startExport} />
              </>
            ) : (
              <p className="muted">
                Không xác định được thời lượng video — không thể chọn đoạn. Thử URL khác.
              </p>
            )}
          </>
        )}
        {phase === "exporting" && job && <JobProgress job={job} onCancel={cancelJob} />}
        {phase === "done" && job && (
          <section className="done-box">
            <h3>✅ Hoàn tất!</h3>
            <p className="file-name">{job.output_name}</p>
            <div className="done-actions">
              {isTauri ? (
                <>
                  <button className="btn accent" onClick={doSave}>
                    💾 Lưu vào máy...
                  </button>
                  {savedPath && (
                    <button className="btn ghost" onClick={doReveal}>
                      📂 Mở thư mục chứa file
                    </button>
                  )}
                </>
              ) : (
                <a className="btn accent" href={client?.fileUrl(job.id)} download={job.output_name}>
                  💾 Tải file về máy
                </a>
              )}
              <button className="btn ghost" onClick={resetToReady}>
                ↺ Trích xuất đoạn khác
              </button>
            </div>
            {savedPath && <p className="muted">Đã lưu tới: {savedPath}</p>}
          </section>
        )}
      </>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="logo">▶</span>
        <span className="app-title">YouTube Audio Extract</span>
        <span className="spacer" />
        {client && <span className="status-ok">sidecar ●</span>}
      </header>
      <main className="app-main">{body}</main>
      <footer className="app-footer">
        Chạy cục bộ · yt-dlp + ffmpeg + Demucs · chỉ dùng cho nội dung bạn có quyền trích xuất
      </footer>
    </div>
  );
}
